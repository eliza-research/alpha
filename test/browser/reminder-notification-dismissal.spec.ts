import {expect,test} from '@playwright/test';

test.beforeEach(async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/?mode=dev');
});

for(const mode of ['single','batch'])for(const change of ['lock','same-occurrence edit','new occurrence','source reset','alerts disabled'])test(`a held ${mode} reminder dismissal rejects after ${change}`,async({page})=>{
 const result=await page.evaluate(async({change,mode})=>{
  const {BrowserDaily}=await import('/src/browser/daily.ts');
  const {BrowserNotifications}=await import('/src/browser/notifications.ts');
  const {reminderDocument}=await import('/src/browser/reminder-store.ts');
  const initial=()=>({sourceRevision:'source-one',reminders:[{id:'reminder',occurrenceId:'occurrence-one',revision:'row-one',status:'posted',title:'Reviewed reminder',body:'',at:Date.now()}]});
  await reminderDocument.edit(initial,()=>{});
  const daily=new BrowserDaily(undefined as any),notices=new BrowserNotifications(daily,{listAlerts:async()=>({items:[]})} as any);
  const old=(await notices.list()).items[0];
  let release!:()=>void,entered!:()=>void;
  const waiting=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  const method=mode==='batch'?'dismissReminderNotices':'dismissReminderNotice';
  const original=daily[method]?.bind(daily);
  // Pause after the exact list check, before admission to the authoritative reminder transaction.
  if(original)(daily as any)[method]=async(...args:any[])=>{entered();await gate;return (original as any)(...args);};
  else{
   const {notificationDocument}=await import('/src/browser/notification-store.ts');
   const edit=notificationDocument.edit.bind(notificationDocument);
   notificationDocument.edit=async(...args)=>{notificationDocument.edit=edit;entered();await gate;return edit(...args);};
  }
  const dismiss=mode==='batch'?notices.clear({items:[old]}).then(result=>result.outcomes[0].status==='requested',()=>false):notices.dismiss(old).then(()=>true,()=>false);
  // Old source never reaches the guard. Race its settlement so the regression fails promptly there.
  const held=await Promise.race([waiting.then(()=>true),dismiss.then(()=>false)]);
  if(!held)return {held,accepted:await dismiss};
  if(change==='lock'){
   document.documentElement.dataset.devBackground='true';
   window.dispatchEvent(new Event('alpha:device-state'));
   delete document.documentElement.dataset.devBackground;
  }else if(change==='alerts disabled')await notices.setAlertPreferences({channelId:'reminders',enabled:false});
  else await reminderDocument.edit(initial,data=>{
   if(change==='source reset')data.sourceRevision='source-two';
   else{
    data.reminders[0].title='Changed reminder';
    data.reminders[0].revision='row-two';
    if(change==='new occurrence')data.reminders[0].occurrenceId='occurrence-two';
   }
  });
  release();
  const accepted=await dismiss;
  const after=await reminderDocument.read(initial);
  if(change==='alerts disabled')await notices.setAlertPreferences({channelId:'reminders',enabled:true});
  const current=(await notices.list()).items[0];
  await notices.dismiss(current);
  const stored=await reminderDocument.read(initial);
  return {held,accepted,hadMarker:!!(after.reminders[0] as any).noticeDismissedOccurrence,stillVisible:!!current,visibleAfter:(await notices.list()).items.length,retainedStatus:stored.reminders[0].status};
 },{change,mode});
 expect(result).toEqual({held:true,accepted:false,hadMarker:false,stillVisible:true,visibleAfter:0,retainedStatus:'posted'});
});

test('a dismissal survives reload and leaves a later occurrence visible',async({page})=>{
 const seed=async()=>{
  const {reminderDocument}=await import('/src/browser/reminder-store.ts');
  const {notificationDocument}=await import('/src/browser/notification-store.ts');
  const posted=(id:string,occurrenceId:string)=>({id,occurrenceId,revision:'one',status:'posted',title:id,body:'',at:Date.now()});
  await reminderDocument.edit(()=>({sourceRevision:'source',reminders:[] as ReturnType<typeof posted>[]}),data=>{
   data.reminders.push(posted('legacy','legacy-occurrence'),posted('current','first-occurrence'));
  });
  await notificationDocument.edit(state=>{state.dismissed.push('legacy-occurrence');});
  const {registerPlugin}=await import('/src/platform-plugins.ts');
  const notices=registerPlugin<any>('AlphaNotifications');
  const rows=(await notices.list()).items;
  await notices.dismiss(rows[0]);
  return rows.map((row:any)=>row.id);
 };
 expect(await page.evaluate(seed)).toEqual(['current']);
 await page.reload();
 const result=await page.evaluate(async()=>{
  const {registerPlugin}=await import('/src/platform-plugins.ts');
  const notices=registerPlugin<any>('AlphaNotifications');
  const {reminderDocument}=await import('/src/browser/reminder-store.ts');
  const before=(await notices.list()).items.length;
  await reminderDocument.edit(()=>({reminders:[] as Array<{id:string;occurrenceId:string;revision:string}>}),data=>{
   const row=data.reminders.find(row=>row.id==='current')!;
   row.occurrenceId='second-occurrence';row.revision='two';
  });
  return {before,after:(await notices.list()).items.map((row:any)=>row.id)};
 });
 expect(result).toEqual({before:0,after:['current']});
});
