import {test,expect} from '@playwright/test';
import {returnToApps} from './app-navigation';
async function setup(page:any,admitted:boolean){
 await page.addInitScript((admitted:boolean)=>{
  localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));const w=window as any;w.androidBridge={};w.contactAccess=false;w.contactRequests=0;w.contactReads=0;w.contactEdits=[];w.contactImage=admitted;
  const names=['AlphaContacts','DailyApps','AlphaBrowser','AlphaConnection','AlphaDevice','AlphaLocalAgent','AlphaHostedResults','AlphaVoiceCloud','AlphaNotifications','ElizaSystem','AlphaCalendar','AlphaNoteDocuments','AlphaNoteAudio','AlphaFiles','AlphaPhotos','DeviceApps','ElizaLocation','AlphaActionJournal'];
  const methods=['addListener','removeListener','surfaceInfo','readPending','readPendingResult','readDelegationCallback','readSecret','secureRead','secureWrite','secureRemove','get','status','getStatus','getState','state','permissionState','permissions','list','listCalendars','listEvents','listReminders','listBookmarks','getBookmarks','bookmarks','settings','getSettings','buildInfo','platformCapabilities','capabilities','query','read','readJournal','getPending','readSelection','requestPermissions','create','edit'];
  w.Capacitor={Plugins:{},PluginHeaders:names.map(name=>({name,methods:methods.map(name=>({name,rtype:name==='addListener'?'callback':'promise'}))})),nativeCallback:()=> 'fixture-callback',nativePromise:async(plugin:string,method:string,input:any)=>{
   if(plugin==='AlphaContacts'){
    if(method==='requestPermissions'){w.contactRequests++;w.contactAccess=true;}
    if(['status','requestPermissions'].includes(method))return {available:w.contactImage,readable:w.contactImage&&w.contactAccess};
    if(method==='list'){w.contactReads++;if(w.holdContacts)await new Promise(resolve=>w.releaseContacts=resolve);if(!w.contactAccess)throw Error('No access');return {contacts:[{id:'123',lookup:'synthetic-lookup',revision:'7',name:'Synthetic Contacts Person',phones:['+15550100200'],emails:['synthetic@example.invalid']}],more:false};}
    if(method==='edit'||method==='create'){w.contactEdits.push({method,input});return {status:'returned'};}
   }
   if(method==='surfaceInfo')return {topInset:0,bottomInset:0};if(method==='buildInfo')return {launcher:false};
   if(method==='platformCapabilities')return {aospImage:w.contactImage,contacts:w.contactImage,phone:false,sms:false};
   if(['secureRead','readSecret'].includes(method))return {value:null};
   return {apps:[],events:[],calendars:[],reminders:[],bookmarks:[],results:[],items:[],entries:[],pending:[],capabilities:[],available:false};
  }};
 },admitted);await page.goto('/');await expect(page.getByRole('button',{name:'Notes',exact:true})).toBeVisible();
}
test('ordinary APK presentation never admits Contacts or prompts permission',async({page})=>{
 await setup(page,false);await expect(page.getByRole('button',{name:'Contacts',exact:true})).toHaveCount(0);expect(await page.evaluate(()=>(window as any).contactRequests)).toBe(0);
});
test('admitted Contacts reads only after explicit access and edits the selected provider identity',async({page})=>{
 await setup(page,true);await page.getByRole('button',{name:'Contacts',exact:true}).click();await expect(page.getByRole('button',{name:'Allow Contacts access'})).toBeVisible();expect(await page.evaluate(()=>(window as any).contactRequests)).toBe(0);
 await page.getByRole('button',{name:'Allow Contacts access'}).click();await page.getByRole('button',{name:'S Synthetic Contacts Person',exact:true}).click();await expect(page.getByText('+15550100200',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Delete contact',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Edit contact',exact:true}).click();expect(await page.evaluate(()=>(window as any).contactEdits)).toEqual([{method:'edit',input:{id:'123',lookup:'synthetic-lookup',revision:'7'}}]);
 await page.evaluate(()=>{(window as any).contactAccess=false;window.dispatchEvent(new Event('focus'));});await expect(page.getByText('Synthetic Contacts Person',{exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>JSON.stringify({...localStorage}).includes('Synthetic Contacts Person'))).toBe(false);
});

test('already granted Contacts stays unread on Home and retires a pending read when leaving',async({page})=>{
 await setup(page,true);await page.evaluate(()=>{(window as any).contactAccess=true;window.dispatchEvent(new Event('focus'));});
 expect(await page.evaluate(()=>(window as any).contactReads)).toBe(0);
 await page.evaluate(()=>(window as any).holdContacts=true);await page.getByRole('button',{name:'Contacts',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).contactReads)).toBe(1);
 await returnToApps(page);
 await page.evaluate(()=>{(window as any).holdContacts=false;(window as any).releaseContacts();});
 await page.getByRole('button',{name:'Contacts',exact:true}).click();
 await expect(page.getByRole('button',{name:'S Synthetic Contacts Person',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).contactReads)).toBe(2);
});
