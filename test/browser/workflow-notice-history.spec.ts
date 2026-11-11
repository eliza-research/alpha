import {test,expect} from '@playwright/test';
test.beforeEach(async({page})=>{await page.addInitScript(()=>{localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));localStorage.setItem('alpha.dev.app.workflows',JSON.stringify({flows:[{id:995,name:'Notice history flow',on:true,trig:{kind:'time',days:'Every day',t:8},steps:[],runs:[]}],localRuns:{}}));});await page.goto('/?mode=dev');});
test('compaction frees capacity and preserves exact replay and conflicts after reload',async({page})=>{
 // This full-capacity journey performs 399 durable writes before compaction and reload.
 test.setTimeout(60_000);
 const result=await page.evaluate(async()=>{const m=await import('/src/browser/workflow-notices.ts'),signal=new AbortController().signal;for(let i=0;i<200;i++){const row=await m.publishWorkflowNotice('run-'+i,'Exact output '+i,signal);if(i<199)await m.actOnWorkflowNotice(row,false);}let full=false;try{await m.publishWorkflowNotice('new','New',signal);}catch{full=true;}const history=(await m.workflowNoticeHistory());const count=await m.compactWorkflowNotices(history.recovery,signal);await m.publishWorkflowNotice('new','New',signal);return {full,count,rows:(await m.listWorkflowNotices()).length,archived:(await m.workflowNoticeHistory()).state.archived?.length};});expect(result).toEqual({full:true,count:199,rows:2,archived:199});
 await page.reload();const replay=await page.evaluate(async()=>{const m=await import('/src/browser/workflow-notices.ts'),s=new AbortController().signal;const before=(await m.savedWorkflowNoticeHistory());const row=await m.publishWorkflowNotice('run-0','Exact output 0',s);let conflict=false;try{await m.publishWorkflowNotice('run-0','Changed output',s);}catch{conflict=true;}return {phase:row.phase,text:row.text,unchanged:before===(await m.savedWorkflowNoticeHistory()),conflict,posted:(await m.listWorkflowNotices()).length};});expect(replay).toEqual({phase:'dismissed',text:'Exact output 0',unchanged:true,conflict:true,posted:2});
});
test('history controls export exact text and compact only after confirmation',async({page})=>{
 await page.evaluate(async()=>{const m=await import('/src/browser/workflow-notices.ts');const row=await m.publishWorkflowNotice('ui','Private <text>',new AbortController().signal);await m.actOnWorkflowNotice(row,false);});
 await page.getByRole('button',{name:'Workflows',exact:true}).click();await page.getByText('Notice history flow',{exact:true}).click();await page.getByRole('button',{name:'Workflow history',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Workflow history',exact:true});
 await expect(dialog.getByRole('link',{name:'Download notification history',exact:true})).toHaveAttribute('href',/^blob:/);
 const exported=await dialog.getByRole('link',{name:'Download notification history',exact:true}).evaluate(async(a:HTMLAnchorElement)=>JSON.parse(await (await fetch(a.href)).text()));expect(exported.rows[0].text).toBe('Private <text>');
 await dialog.getByRole('button',{name:'Free notification space',exact:true}).click();expect(await page.evaluate(async()=>JSON.parse((await (await import('/src/browser/workflow-notices.ts')).workflowNoticesDocument.readRaw())!).rows.length)).toBe(1);
 await dialog.getByRole('button',{name:'Confirm free space',exact:true}).click();await expect(dialog.getByText('Freed 1',{exact:true})).toBeVisible();await page.screenshot({path:'test-results/notice-history-review/history.png'});
});
for(const mode of ['changed','cancelled','storage-failed','hidden'] as const)test(`${mode} compaction preserves the original document`,async({page})=>{
 const result=await page.evaluate(async(mode)=>{const m=await import('/src/browser/workflow-notices.ts');const abort=new AbortController();const row=await m.publishWorkflowNotice('keep','Keep exact text',abort.signal);await m.actOnWorkflowNotice(row,false);const snapshot=(await m.workflowNoticeHistory());if(mode==='changed')await m.publishWorkflowNotice('other','Another',abort.signal);if(mode==='cancelled')abort.abort();if(mode==='hidden')document.documentElement.dataset.devBackground='true';const before=(await m.savedWorkflowNoticeHistory()),original=IDBObjectStore.prototype.put;if(mode==='storage-failed')IDBObjectStore.prototype.put=function(v,k){if(k==='alpha.browser.workflow-notices.v1')throw Error('Quota exceeded');return original.call(this,v,k);};let failed=false;try{await m.compactWorkflowNotices(snapshot.recovery,abort.signal);}catch{failed=true;}finally{IDBObjectStore.prototype.put=original;delete document.documentElement.dataset.devBackground;}return {failed,same:before===(await m.savedWorkflowNoticeHistory())};},mode);expect(result).toEqual({failed:true,same:true});
});
test('malformed and duplicate receipts fail without rewriting saved data',async({page})=>{
 const result=await page.evaluate(async()=>{const m=await import('/src/browser/workflow-notices.ts');const s=new AbortController().signal;const row=await m.publishWorkflowNotice('duplicate','Keep',s);const raw=JSON.stringify({rows:[row,row]});await m.workflowNoticesDocument.edit(()=>({rows:[]}),state=>{state.rows=[row,row];});const recovery=await m.workflowNoticesDocument.capture();let rejected=0;for(const action of [()=>m.publishWorkflowNotice('new','New',s),()=>m.compactWorkflowNotices(recovery,s),async()=>(await m.listWorkflowNotices())])try{await action();}catch{rejected++;}return {rejected,same:(await m.savedWorkflowNoticeHistory())===raw};});expect(result).toEqual({rejected:3,same:true});
});
test('simultaneous compaction and publication preserve both receipts',async({page,context})=>{
 await page.evaluate(async()=>{const m=await import('/src/browser/workflow-notices.ts');const row=await m.publishWorkflowNotice('old','Old',new AbortController().signal);await m.actOnWorkflowNotice(row,false);});const second=await context.newPage();await second.goto('/?mode=dev');
 const snapshot=await page.evaluate(async()=>(await (await import('/src/browser/workflow-notices.ts')).workflowNoticeHistory()).recovery);
 const outcomes=await Promise.all([page.evaluate(async raw=>{const m=await import('/src/browser/workflow-notices.ts');try{await m.compactWorkflowNotices(raw,new AbortController().signal);return 'compacted';}catch{return 'stale';}},snapshot),second.evaluate(async()=>{const m=await import('/src/browser/workflow-notices.ts');await m.publishWorkflowNotice('new','New',new AbortController().signal);return 'posted';})]);expect(outcomes[1]).toBe('posted');
 const state=await page.evaluate(async()=>{const m=await import('/src/browser/workflow-notices.ts');return (await m.workflowNoticeHistory()).state;});expect([...state.rows,...state.archived||[]].map(row=>row.id).sort()).toEqual(['workflow:new','workflow:old']);expect(state.rows.find(row=>row.id==='workflow:new')?.text).toBe('New');
});

test('compacted receipts distinguish exact JavaScript text including lone surrogates',async({page})=>{
 const conflict=await page.evaluate(async()=>{const m=await import('/src/browser/workflow-notices.ts');const s=new AbortController().signal;const row=await m.publishWorkflowNotice('unicode','Output \ud800',s);await m.actOnWorkflowNotice(row,false);await m.compactWorkflowNotices((await m.workflowNoticeHistory()).recovery,s);try{await m.publishWorkflowNotice('unicode','Output \ud801',s);return false;}catch{return true;}});expect(conflict).toBe(true);
});

test('notification recovery remains reachable with no saved workflows',async({page})=>{
 await page.evaluate(()=>localStorage.setItem('alpha.dev.app.workflows',JSON.stringify({flows:[],localRuns:{}})));
 // Override the fixture seed on this reload to exercise the empty list.
 await page.addInitScript(()=>localStorage.setItem('alpha.dev.app.workflows',JSON.stringify({flows:[],localRuns:{}})));await page.reload();await page.getByRole('button',{name:'Workflows',exact:true}).click();await page.getByRole('button',{name:'Manage workflow history',exact:true}).click();await expect(page.getByRole('dialog',{name:'Workflow history',exact:true}).getByRole('link',{name:'Download notification history',exact:true})).toBeVisible();
});

test('abort during receipt hashing commits no partial archive',async({page})=>{
 const result=await page.evaluate(async()=>{const m=await import('/src/browser/workflow-notices.ts'),abort=new AbortController();const row=await m.publishWorkflowNotice('late','Retain this text',abort.signal);await m.actOnWorkflowNotice(row,false);const raw=(await m.workflowNoticeHistory()).recovery;const original=crypto.subtle.digest.bind(crypto.subtle);let release!:()=>void,started!:()=>void;const ready=new Promise<void>(resolve=>started=resolve);crypto.subtle.digest=async(...args)=>{started();await new Promise<void>(resolve=>release=resolve);return original(...args);};const pending=m.compactWorkflowNotices(raw,abort.signal).then(()=>false,error=>error.name==='AbortError');await ready;abort.abort();release();const cancelled=await pending;crypto.subtle.digest=original;return {cancelled,same:raw.raw===(await m.savedWorkflowNoticeHistory())};});expect(result).toEqual({cancelled:true,same:true});
});

test('compaction rejects a reviewed revision after identical bytes are restored',async({page})=>{
 const result=await page.evaluate(async()=>{
  const n=await import('/src/browser/workflow-notices.ts'),{browserDocuments}=await import('/src/browser/documents.ts'),signal=new AbortController().signal;
  const row=await n.publishWorkflowNotice('aba','Retain reviewed text',signal);await n.actOnWorkflowNotice(row,false);
  const reviewed=await n.workflowNoticeHistory(),key='alpha.browser.workflow-notices.v1';
  const changed=await browserDocuments.compareExchange(key,reviewed.recovery.snapshot,JSON.stringify({version:1,legacy:null,value:'{"rows":[]}'}));
  await browserDocuments.compareExchange(key,changed,reviewed.recovery.snapshot!.raw);
  let refused=false;try{await n.compactWorkflowNotices(reviewed.recovery,signal);}catch{refused=true;}
  return {refused,raw:await n.savedWorkflowNoticeHistory(),before:reviewed.raw};
 });expect(result.refused).toBe(true);expect(result.raw).toBe(result.before);
});

test('closing history during loading creates no late download URLs',async({page})=>{
 await page.evaluate(async()=>{
  const {workflowNoticesDocument:document}=await import('/src/browser/workflow-notices.ts'),{openWorkflowHistory}=await import('/src/browser/workflow-history.ts');
  const original=document.readRaw.bind(document),create=URL.createObjectURL.bind(URL);let release!:()=>void,started!:()=>void;const ready=new Promise<void>(r=>started=r);let created=0;
  URL.createObjectURL=(...args)=>{created++;return create(...args);};
  document.readRaw=async signal=>{started();await new Promise<void>(r=>release=r);return original(signal);};
  openWorkflowHistory(()=>({flows:[],localRuns:{}}),()=>{},()=>false);await ready;
  (window as any).finishNoticeLoading=()=>{document.readRaw=original;release();return created;};
  (window as any).noticeUrlsCreated=()=>created;
 });
 await expect(page.getByRole('link',{name:'Download notification history',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Close history',exact:true}).click();
 const before=await page.evaluate(()=>(window as any).finishNoticeLoading());
 await expect(page.getByRole('dialog',{name:'Workflow history',exact:true})).toHaveCount(0);
 await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,50)));
 expect(await page.evaluate(()=>(window as any).noticeUrlsCreated())).toBe(before);
});

test('changed older data exposes both exact backups and disables compaction',async({page})=>{
 await page.evaluate(async()=>{
  const n=await import('/src/browser/workflow-notices.ts'),{openWorkflowHistory}=await import('/src/browser/workflow-history.ts');
  const row=await n.publishWorkflowNotice('backup','Canonical text',new AbortController().signal);await n.actOnWorkflowNotice(row,false);
  localStorage.setItem('alpha.browser.workflow-notices.v1','{broken older data');
  openWorkflowHistory(()=>({flows:[],localRuns:{}}),()=>{},()=>false);
 });
 const dialog=page.getByRole('dialog',{name:'Workflow history',exact:true}),active=dialog.getByRole('link',{name:'Download notification history',exact:true}),older=dialog.getByRole('link',{name:'Download older notification history',exact:true});
 await expect(active).toHaveAttribute('href',/^blob:/);await expect(older).toBeVisible();
 expect(await active.evaluate(async(a:HTMLAnchorElement)=>JSON.parse(await(await fetch(a.href)).text()).rows[0].text)).toBe('Canonical text');
 expect(await older.evaluate(async(a:HTMLAnchorElement)=>(await fetch(a.href)).text())).toBe('{broken older data');
 await expect(dialog.getByRole('button',{name:'Free notification space',exact:true})).toBeDisabled();
});
