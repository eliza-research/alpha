import {test,expect} from '@playwright/test';
// Stubbed Capacitor bridge (no device, Telecom or call log): the standalone shape registers no
// AlphaTelephony plugin and must expose no Phone route, prompt or permission request; the image
// shape registers it and shows bounded recents and a dial handoff that never reports a call.
async function setup(page:any,image:boolean){
 await page.addInitScript((image:boolean)=>{
  localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));const w=window as any;w.androidBridge={};w.telephonyCalls=[];w.callLogAccess='prompt';
  const names=['AlphaContacts','DailyApps','AlphaBrowser','AlphaConnection','AlphaDevice','AlphaLocalAgent','AlphaHostedResults','AlphaVoiceCloud','AlphaNotifications','ElizaSystem','AlphaCalendar','AlphaNoteDocuments','AlphaNoteAudio','AlphaFiles','AlphaPhotos','DeviceApps','ElizaLocation','AlphaActionJournal',...(image?['AlphaTelephony']:[])];
  const methods=['addListener','removeListener','surfaceInfo','readPending','readPendingResult','readDelegationCallback','readSecret','secureRead','secureWrite','secureRemove','get','status','getStatus','getState','state','permissionState','permissions','list','listCalendars','listEvents','listReminders','listBookmarks','getBookmarks','bookmarks','settings','getSettings','buildInfo','platformCapabilities','capabilities','query','read','readJournal','getPending','readSelection','requestPermissions','create','edit','imageCapability','requestAccess','listRecentCalls','dial','listThreads','observeMessages','smsSendHistory'];
  const status=()=>({version:2,voiceCapable:true,smsCapable:true,permissions:{contacts:'prompt',phoneState:'prompt',sms:'prompt',sendSms:'prompt',callLog:w.callLogAccess},sendMode:'handoff',mmsSend:false,roles:{dialer:{available:true,held:false,eligible:true},sms:{available:true,held:false,eligible:true}},defaultDialer:'com.android.dialer',defaultSms:null,subscriptions:null,defaultSmsSubscriptionId:null});
  w.Capacitor={Plugins:{},PluginHeaders:names.map(name=>({name,methods:methods.map(name=>({name,rtype:name==='addListener'?'callback':'promise'}))})),nativeCallback:()=> 'fixture-callback',nativePromise:async(plugin:string,method:string,input:any)=>{
   if(plugin==='AlphaTelephony'){
    w.telephonyCalls.push(method);
    if(method==='imageCapability')return {version:1,image:true,feature:'fixture.image'};
    if(method==='status')return status();
    if(method==='requestAccess'){if(input.access==='callLog')w.callLogAccess='granted';return status();}
    if(method==='listRecentCalls')return {calls:[{id:'9',number:'+15550100200',cachedName:'Synthetic Caller',date:1700000000000,durationSeconds:65,type:'missed',isNew:true}]};
    if(method==='dial')return {status:'handed-off',target:'dialer',handler:'com.android.dialer',message:'Your phone app is open with the number. Place the call there; this app does not know whether it connects.'};
    return {threads:[],messages:[],records:[]};
   }
   if(method==='surfaceInfo')return {topInset:0,bottomInset:0};if(method==='buildInfo')return {launcher:false};
   if(method==='platformCapabilities')return {aospImage:image,contacts:false,phone:false,sms:false};
   if(['secureRead','readSecret'].includes(method))return {value:null};
   return {apps:[],events:[],calendars:[],reminders:[],bookmarks:[],results:[],items:[],entries:[],pending:[],capabilities:[],available:false};
  }};
 },image);await page.goto('/');await expect(page.getByRole('button',{name:'Notes',exact:true})).toBeVisible();
}
test('standalone exposes no Phone route, call prompt or telephony request',async({page})=>{
 await setup(page,false);
 await expect(page.getByRole('button',{name:'Phone',exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).telephonyCalls)).toEqual([]);
});
test('the image shows recents only after explicit access and dials by handoff',async({page})=>{
 await setup(page,true);
 await page.getByRole('button',{name:'Phone',exact:true}).click();
 await expect(page.getByRole('button',{name:'Allow call history'})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).telephonyCalls)).not.toContain('listRecentCalls');
 await page.getByRole('button',{name:'Allow call history'}).click();
 const row=page.getByRole('button',{name:'Open Synthetic Caller in phone app'});
 await expect(row).toBeVisible();
 await row.click();
 await expect(page.getByText(/Place the call there/).first()).toBeVisible();
 const calls=await page.evaluate(()=>(window as any).telephonyCalls);
 expect(calls).toContain('dial');expect(calls).not.toContain('placeCall');
 expect(await page.evaluate(()=>JSON.stringify({...localStorage}).includes('Synthetic Caller'))).toBe(false);
});
