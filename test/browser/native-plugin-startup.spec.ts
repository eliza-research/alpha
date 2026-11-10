import {test,expect} from '@playwright/test';
// Android injects legacy synchronous listener handles before modern core loads.
// This fixture exercises the production entrypoint with that native shape; no device effects.
test('Android legacy plugin injection is wrapped before renderer startup and listener cleanup',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));
  const w=window as any;w.nativeCalls=[];w.androidBridge={};
  const names=['DailyApps','AlphaBrowser','AlphaConnection','AlphaDevice','Agent','AlphaHostedResults','AlphaVoiceCloud','AlphaNotifications','ElizaSystem','AlphaCalendar','AlphaNoteDocuments','AlphaNoteAudio','AlphaFiles','AlphaPhotos','DeviceApps','ElizaLocation','AlphaActionJournal'];
  const methods=['addListener','removeListener','surfaceInfo','readPending','readPendingResult','readDelegationCallback','readSecret','get','status','getStatus','getState','state','permissionState','permissions','list','listCalendars','listEvents','listReminders','listBookmarks','getBookmarks','settings','getSettings','buildInfo','capabilities','query','read','readJournal','getPending','readSelection','setGoogleAgentAccess'];
  const cap:any=w.Capacitor={Plugins:{},PluginHeaders:names.map(name=>({name,methods:methods.map(name=>({name,rtype:name==='addListener'?'callback':'promise'}))})),nativeCallback:(plugin:string,method:string,options:any)=>{w.nativeCalls.push({plugin,method,options});return 'fixture-callback';},nativePromise:async(plugin:string,method:string,options:any)=>{w.nativeCalls.push({plugin,method,options});if(method==='readSecret')return {value:null};if(method==='surfaceInfo')return {topInset:0};return {apps:[],events:[],calendars:[],reminders:[],bookmarks:[],results:[],items:[],entries:[],pending:[],capabilities:[],available:false};}};
  for(const name of names)cap.Plugins[name]={addListener:()=>({remove:async()=>{}})};
  cap.PluginHeaders.push({name:'Agent',methods:[{name:'setGoogleAgentAccess',rtype:'promise'}]});
  cap.Plugins.Agent={setGoogleAgentAccess:async()=>{}};
 });
 await page.goto('/');await expect(page.getByRole('textbox',{name:'Ask Alpha',exact:true})).toBeVisible();
 const result=await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');const {DailyApps}=await import('/src/daily.ts');const port=registerPlugin<any>('DailyApps');const handlePromise=port.addListener('fixture-event',()=>{});const promise=typeof handlePromise.then==='function';await(await handlePromise).remove();return {same:port===DailyApps,promise,calls:(window as any).nativeCalls};});
 expect(result.same).toBe(true);expect(result.promise).toBe(true);expect(result.calls).toEqual(expect.arrayContaining([expect.objectContaining({plugin:'DailyApps',method:'addListener',options:{eventName:'appResumed'}}),expect.objectContaining({plugin:'DailyApps',method:'removeListener',options:{eventName:'fixture-event',callbackId:'fixture-callback'}}),expect.objectContaining({plugin:'Agent',method:'setGoogleAgentAccess',options:{gmailChanges:true,calendarEdits:true}})]));expect(errors).toEqual([]);
});
test('browser registration keeps the first implementation and shared listener identity',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await page.goto('/');await expect(page.getByRole('textbox',{name:'Ask Alpha',exact:true})).toBeVisible();
 const result=await page.evaluate(async()=>{const {registerPlugin}=await import('/src/platform-plugins.ts');let first=0,second=0,removed=0;const a=registerPlugin<any>('RegistrationOrderingFixture',{web:()=>{first++;return{async value(){return 'first';},async addListener(){return{async remove(){removed++;}};}};}});const b=registerPlugin<any>('RegistrationOrderingFixture',{web:()=>{second++;return{async value(){return 'second';}};}});const c=registerPlugin<any>('RegistrationOrderingFixture');const value=await c.value();await(await b.addListener('event',()=>{})).remove();return {same:a===b&&b===c,value,first,second,removed};});expect(result).toEqual({same:true,value:'first',first:1,second:0,removed:1});
});
