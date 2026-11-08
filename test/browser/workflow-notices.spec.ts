import {test,expect} from '@playwright/test';
test('cancellation between notification preparation and commit leaves no stored effect',async({page})=>{
 await page.goto('/?mode=dev&tools=1');
 const result=await page.evaluate(async()=>{
  const n=await import('/src/browser/workflow-notices.ts'),controller=new AbortController(),edit=n.workflowNoticesDocument.edit;let prepared=false,release!:()=>void;
  n.workflowNoticesDocument.edit=(initial,prepare,signal)=>edit.call(n.workflowNoticesDocument,initial,async data=>{const result=await prepare(data);prepared=true;await new Promise<void>(resolve=>release=resolve);return result;},signal);
  const pending=n.publishWorkflowNotice('cancel-at-commit','Do not save',controller.signal).then(()=>'',error=>(error as Error).name);
  try{while(!prepared)await new Promise(resolve=>setTimeout(resolve,0));controller.abort();release();return {error:await pending,saved:await n.workflowNoticesDocument.readRaw()};}finally{n.workflowNoticesDocument.edit=edit;}
 });expect(result).toEqual({error:'AbortError',saved:null});
});
test('workflow notices persist exact content and deduplicate matching receipts across reload',async({page})=>{
 await page.goto('/?mode=dev&tools=1');const row=await page.evaluate(async()=>{const {publishWorkflowNotice}=await import('/src/browser/workflow-notices.ts');return publishWorkflowNotice('durable','Exact workflow result',new AbortController().signal);});
 await page.reload();const result=await page.evaluate(async()=>{const {publishWorkflowNotice,listWorkflowNotices}=await import('/src/browser/workflow-notices.ts');const signal=new AbortController().signal;const replay=await publishWorkflowNotice('durable','Exact workflow result',signal);let mismatch=false;try{await publishWorkflowNotice('durable','Different content',signal);}catch{mismatch=true;}return {replay,mismatch,rows:(await listWorkflowNotices())};});expect(result.replay).toEqual(row);expect(result.mismatch).toBe(true);expect(result.rows).toHaveLength(1);expect(result.rows[0].text).toBe('Exact workflow result');
});
test('notification open and dismiss reject stale, locked and disabled identities',async({page})=>{
 await page.goto('/?mode=dev&tools=1');const result=await page.evaluate(async()=>{
  const {registerPlugin}=await import('/src/platform-plugins.ts');const notices=registerPlugin<any>('AlphaNotifications');const {publishWorkflowNotice}=await import('/src/browser/workflow-notices.ts');const row=await publishWorkflowNotice('policy','Private result',new AbortController().signal);const input={id:row.id,revision:row.revision,source:'own'};
  const rejected=async(fn:()=>Promise<unknown>)=>{try{await fn();return false;}catch{return true;}};
  document.documentElement.dataset.devBackground='true';const locked=(await notices.list()).items.find((item:any)=>item.id===row.id);const lockRejected=await rejected(()=>notices.open(input));delete document.documentElement.dataset.devBackground;
  const {notificationDocument}=await import('/src/browser/notification-store.ts');await notificationDocument.edit(state=>{state.appEnabled=false;});const disabled=[await rejected(()=>notices.open(input)),await rejected(()=>notices.dismiss(input))];await notificationDocument.edit(state=>{state.appEnabled=true;});
  const stale=await rejected(()=>notices.dismiss({...input,revision:'stale'}));await notices.dismiss(input);const replay=await rejected(()=>notices.open(input));return {locked,lockRejected,disabled,stale,replay,remaining:(await notices.list()).items.filter((item:any)=>item.id===row.id)};
 });expect(result.locked).toMatchObject({title:'Workflows',text:'',canOpen:false});expect(result.lockRejected).toBe(true);expect(result.disabled).toEqual([true,true]);expect(result.stale).toBe(true);expect(result.replay).toBe(true);expect(result.remaining).toEqual([]);
});
test('saved workflow notice opens Workflows through the real notification controls',async({page})=>{
 await page.goto('/?mode=dev&tools=1');await page.evaluate(async()=>{const {publishWorkflowNotice}=await import('/src/browser/workflow-notices.ts');await publishWorkflowNotice('open-ui','Ready to inspect',new AbortController().signal);});await page.getByRole('button',{name:'Device controls',exact:true}).click();await page.getByRole('dialog',{name:'Development device controls'}).getByRole('button',{name:'Notifications',exact:true}).click();await expect(page.getByText('Ready to inspect',{exact:true})).toBeVisible();await page.getByRole('button',{name:/Open Workflow result/}).click();await expect(page.locator('html')).toHaveAttribute('data-active-view','workflows');
});
test('cancelling a queued notice settles without waiting for the storage lock',async({page})=>{
 await page.goto('/?mode=dev&tools=1');const result=await page.evaluate(async()=>{
  const {publishWorkflowNotice}=await import('/src/browser/workflow-notices.ts');let release!:()=>void;const held=navigator.locks.request(JSON.stringify(['browser-document','alpha.browser.documents.v1','alpha.browser.workflow-notices.v1']),()=>new Promise<void>(resolve=>release=resolve));while(!release)await new Promise(resolve=>setTimeout(resolve,0));
  const abort=new AbortController();const pending=publishWorkflowNotice('queued','Do not persist',abort.signal).then(()=>false,error=>error.name==='AbortError');abort.abort();
  const settled=await Promise.race([pending,new Promise<boolean>(resolve=>setTimeout(()=>resolve(false),500))]);release();await held;await pending;return {settled,saved:await (await import('/src/browser/workflow-notices.ts')).workflowNoticesDocument.readRaw()};
 });expect(result).toEqual({settled:true,saved:null});
});
test('workflow Notify records the same text and step identity in its durable notice',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));localStorage.setItem('alpha.dev.app.workflows',JSON.stringify({flows:[{id:902,name:'Notice execution',on:true,short:'Save notification',summary:'Save notification',trig:{kind:'time',days:'Every day',t:8},steps:[{k:'Read',t:'Contacts',apps:['Contacts']},{k:'Notify',t:'A notification',apps:[]}],runs:[]}],localRuns:{}}));});
 await page.goto('/?mode=dev&tools=1');await page.getByRole('button',{name:'Workflows',exact:true}).click();await page.getByText('Notice execution',{exact:true}).click();await page.getByRole('button',{name:'Run now',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('alpha.dev.app.workflows')!).localRuns).map((r:any)=>r.status))).toEqual(['ok']);
 const result=await page.evaluate(async()=>{const run=Object.values(JSON.parse(localStorage.getItem('alpha.dev.app.workflows')!).localRuns)[0] as any;const notice=JSON.parse((await (await import('/src/browser/workflow-notices.ts')).workflowNoticesDocument.readRaw())!).rows[0];return {match:notice.id==='workflow:'+run.id+'-1'&&notice.text===run.out,cursor:run.cursor};});expect(result).toEqual({match:true,cursor:2});
});

test('custom notification titles remain bound through replay and compaction',async({page})=>{await page.goto('/?mode=dev&tools=1');const result=await page.evaluate(async()=>{const n=await import('/src/browser/workflow-notices.ts'),signal=new AbortController().signal;const first=await n.publishWorkflowNotice('custom-title','Exact body',signal,'Exact title');const replay=await n.publishWorkflowNotice('custom-title','Exact body',signal,'Exact title');let refused=0;try{await n.publishWorkflowNotice('custom-title','Exact body',signal,'Changed title');}catch{refused++;}await n.actOnWorkflowNotice(first,false);await n.compactWorkflowNotices((await n.workflowNoticeHistory()).recovery,signal);try{await n.publishWorkflowNotice('custom-title','Exact body',signal,'Changed title');}catch{refused++;}const retained=await n.publishWorkflowNotice('custom-title','Exact body',signal,'Exact title');return {title:retained.title,phase:retained.phase,same:first.id===replay.id,refused,visible:(await n.listWorkflowNotices()).length};});expect(result).toEqual({title:'Exact title',phase:'dismissed',same:true,refused:2,visible:0});});
