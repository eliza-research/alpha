import {test,expect} from '@playwright/test';
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await page.goto('/?mode=dev');});
test('history hides the older download when no older copy exists',async({page})=>{
 await page.evaluate(async()=>{const {openWorkflowHistory}=await import('/src/browser/workflow-history.ts');openWorkflowHistory(()=>({flows:[],localRuns:{}}),()=>{},()=>false);});
 const dialog=page.getByRole('dialog',{name:'Workflow history',exact:true});await expect(dialog.getByRole('link',{name:'Download notification history',exact:true})).toBeVisible();
 await expect(dialog.getByRole('link',{name:'Download older notification history',exact:true})).toBeHidden();
});
for(const event of ['launcher-home','alpha:device-state','alpha:dev-incoming-call'])test(`notice action cancelled by ${event} cannot commit or navigate later`,async({page})=>{
 const before=await page.evaluate(async()=>{
  const n=await import('/src/browser/workflow-notices.ts'),row=await n.publishWorkflowNotice('late-open','Retain notice',new AbortController().signal),edit=n.workflowNoticesDocument.edit.bind(n.workflowNoticesDocument);let navigated=0;
  window.addEventListener('alpha:browser-open-view',()=>navigated++);
  n.workflowNoticesDocument.edit=(initial,prepare,signal)=>edit(initial,async data=>{const result=await prepare(data);(window as any).noticePrepared=true;await new Promise<void>(resolve=>(window as any).releaseNotice=resolve);return result;},signal);
  (window as any).noticeAction=n.actOnWorkflowNotice(row,true).then(()=>({cancelled:false,navigated}),()=>({cancelled:true,navigated}));
  return n.savedWorkflowNoticeHistory();
 });
 await expect.poll(()=>page.evaluate(()=>(window as any).noticePrepared)).toBe(true);
 await page.evaluate(event=>{window.dispatchEvent(new Event(event));(window as any).releaseNotice();},event);
 expect(await page.evaluate(()=>(window as any).noticeAction)).toEqual({cancelled:true,navigated:0});
 expect(await page.evaluate(async()=>(await import('/src/browser/workflow-notices.ts')).savedWorkflowNoticeHistory())).toBe(before);
});
test('locking while another notice source is loading redacts the complete result',async({page})=>{
 await page.evaluate(async()=>{
  const n=await import('/src/browser/workflow-notices.ts'),{BrowserNotifications}=await import('/src/browser/notifications.ts'),{browserHostedResults}=await import('/src/browser/hosted-results.ts');
  await n.publishWorkflowNotice('late-read','Private result',new AbortController().signal,'Private title');
  const original=browserHostedResults.list.bind(browserHostedResults);browserHostedResults.list=async()=>{browserHostedResults.list=original;(window as any).noticeListHeld=true;await new Promise<void>(resolve=>(window as any).releaseNoticeList=resolve);return original();};
  const notifications=new BrowserNotifications({listReminders:async()=>({reminders:[]})} as any,{listAlerts:async()=>({items:[]})} as any);
  (window as any).noticeList=notifications.list();
 });
 await expect.poll(()=>page.evaluate(()=>(window as any).noticeListHeld)).toBe(true);
 await page.evaluate(()=>{document.documentElement.dataset.devBackground='true';(window as any).releaseNoticeList();});
 const rows=await page.evaluate(async()=>(await (window as any).noticeList).items);
 expect(rows.find((row:any)=>row.id==='workflow:late-read')).toMatchObject({title:'Workflows',text:'',canOpen:false});
});

for(const change of ['disabled','preview-revoked'] as const)test(`a pending notice list rejects ${change} permissions`,async({page})=>{
 await page.evaluate(async()=>{
  const n=await import('/src/browser/workflow-notices.ts'),{BrowserNotifications}=await import('/src/browser/notifications.ts'),{browserHostedResults}=await import('/src/browser/hosted-results.ts');
  await n.publishWorkflowNotice('policy-change','Private result',new AbortController().signal);
  const original=browserHostedResults.list.bind(browserHostedResults);browserHostedResults.list=async()=>{browserHostedResults.list=original;(window as any).policyListHeld=true;await new Promise<void>(resolve=>(window as any).releasePolicyList=resolve);return original();};
  const notifications=new BrowserNotifications({listReminders:async()=>({reminders:[]})} as any,{listAlerts:async()=>({items:[]})} as any);
  (window as any).policyList=notifications.list().then(()=>false,error=>error.message==='Notification settings changed. Refresh notifications.');
 });
 await expect.poll(()=>page.evaluate(()=>(window as any).policyListHeld)).toBe(true);
 await page.evaluate(async change=>{await (await import('/src/browser/notification-store.ts')).notificationDocument.edit(state=>{if(change==='disabled')state.appEnabled=false;else state.apps=[{packageName:'browser.inbox',preview:false}];});(window as any).releasePolicyList();},change);
 expect(await page.evaluate(()=>(window as any).policyList)).toBe(true);
});
test('Home after notice commit preserves the receipt without late navigation',async({page})=>{
 await page.evaluate(async()=>{
  const n=await import('/src/browser/workflow-notices.ts'),row=await n.publishWorkflowNotice('committed-open','Saved notice',new AbortController().signal),edit=n.workflowNoticesDocument.edit.bind(n.workflowNoticesDocument);let navigated=0;
  window.addEventListener('alpha:browser-open-view',()=>navigated++);
  n.workflowNoticesDocument.edit=async(initial,prepare,signal)=>{const result=await edit(initial,prepare,signal);(window as any).noticeCommitted=true;await new Promise<void>(resolve=>(window as any).releaseCommittedNotice=resolve);return result;};
  (window as any).committedNotice=n.actOnWorkflowNotice(row,true).then(()=>navigated);
 });
 await expect.poll(()=>page.evaluate(()=>(window as any).noticeCommitted)).toBe(true);
 await page.evaluate(()=>{window.dispatchEvent(new Event('launcher-home'));(window as any).releaseCommittedNotice();});
 expect(await page.evaluate(()=>(window as any).committedNotice)).toBe(0);
 expect(await page.evaluate(async()=>JSON.parse(await(await import('/src/browser/workflow-notices.ts')).savedWorkflowNoticeHistory()).rows[0].phase)).toBe('opened');
});
