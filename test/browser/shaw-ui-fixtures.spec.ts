// Owner-review UI fixtures. All account/data ports are synthetic; no device or provider is used.
import {test,expect,type Page,type TestInfo} from '@playwright/test';
import {preloadPageModules} from './helpers/page-modules';
import {installHomeCalendar} from './helpers/home-calendar';
import {photosBridge} from './helpers/photos-bridge';
import {returnToApps} from './app-navigation';
import {settled} from './helpers/settled';
import {seedCompletedAccessSetup} from './flag-off-android';

async function capture(page:Page,info:TestInfo,name:string){
 if(name.startsWith('home-')){
  await page.locator('[data-mobile-shell-home]').evaluate(element=>{element.scrollTop=0;if(document.activeElement instanceof HTMLElement)document.activeElement.blur();});
  await expect(page.getByRole('button',{name:'Calendar',exact:true})).toBeInViewport({ratio:1});
 }
 await settled(page);
 // The synthetic Photos bridge has no secure reminder store; let its startup notice expire before the layout receipt.
 await expect(page.getByText('Reminders could not refresh. Previously loaded reminders may be out of date.',{exact:true})).toBeHidden();
 await page.evaluate(()=>{const badge=document.createElement('div');badge.textContent='UI FIXTURE · synthetic data';badge.style.cssText='position:fixed;right:4px;top:4px;z-index:2147483647;padding:3px 6px;background:#112b46;color:white;font:10px sans-serif;pointer-events:none';badge.setAttribute('aria-hidden','true');document.body.append(badge);});
 await page.screenshot({path:info.outputPath(`UI-FIXTURE-${name}.png`),animations:'disabled'});
}
async function emptyHome(page:Page){
 // A returning synthetic installation; no browser/native permission is granted.
 await seedCompletedAccessSetup(page);
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/');await preloadPageModules(page,['/src/runtime/connection-ui.tsx','/src/runtime/native-connection.ts']);
 await installHomeCalendar(page);
 await page.evaluate(async()=>{
  const {connectionController:c}=await import('/src/runtime/connection-ui.tsx'),{secureConnectionStore:s}=await import('/src/runtime/native-connection.ts');
  s.read=async()=>null;
  const f=(window as any).emptyHomeFixture={mailReads:0,metadataReads:0,writes:0};
  const client={gmailAccounts:async()=>[{connectionId:'fixture-grant',label:'Synthetic mailbox',connected:true,grantedCapabilities:['google.gmail.triage']}],gmailSearch:async()=>{f.mailReads++;return{messages:[],syncedAt:new Date().toISOString(),nextPageToken:null};},gmailRead:async()=>{throw Error('Fixture has no message bodies');},gmailInboxCapabilities:async()=>({send:false,providerDrafts:false,mailboxMutations:false})};
  c.getCloudClient=()=>({client,sessionId:'fixture-cloud',credentialId:'fixture-credential'} as any);
  const snapshot={...c.getSnapshot(),cloudAccount:{environment:'production',userId:'fixture-owner',organizationId:'fixture-org',sessionId:'fixture-cloud',credentialId:'fixture-credential'}};c.getSnapshot=()=>snapshot as any;
  c.getWorkflowClient=()=>({sessionId:'fixture-agent',client:{list:async()=>[],lifecycleSupported:async()=>false}} as any);
  c.getAutomationsClient=()=>({sessionId:'fixture-agent',request:async(path:string,method:string)=>{f.metadataReads++;if(method!=='GET'){f.writes++;throw Error('UI fixture forbids writes');}if(path==='/api/automations')return{automations:[]};if(path.includes('/scheduled-tasks'))return{tasks:[]};if(path.includes('/reminders'))return{reminders:[]};if(path==='/api/lifeops/definitions')return{definitions:[]};throw Error('Unexpected UI fixture metadata route');}});
  c.close();
 });
 await page.getByRole('button',{name:'Inbox',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).emptyHomeFixture.mailReads)).toBeGreaterThan(0);await returnToApps(page);
 await page.getByRole('button',{name:'Workflows',exact:true}).click();await expect(page.locator('[data-alpha-subview="workflows-list"]').getByText('No workflows yet',{exact:true})).toBeVisible();await returnToApps(page);
 await expect(page.locator('[data-alpha-home-calendar]')).toHaveCount(0);await expect(page.locator('[data-alpha-home-inbox]')).toHaveCount(0);await expect(page.locator('[data-alpha-home-workflows]')).toHaveCount(0);
 await expect(page.locator('[data-mobile-shell-cards]')).toBeHidden();await expect(page.getByRole('button',{name:'Calendar',exact:true})).toBeVisible();expect(await page.evaluate(()=>(window as any).emptyHomeFixture.writes)).toBe(0);
}
for(const [orientation,viewport] of [['portrait',{width:412,height:915}],['landscape',{width:915,height:412}]] as const)test.describe(orientation,()=>{
 test.use({viewport,hasTouch:true,isMobile:true});
 test.beforeEach(async({page})=>{await page.route(/^https?:\/\/(?!127\.0\.0\.1:|localhost:)/,route=>route.abort());});
 test('confirmed-empty Home collapses the rail and keeps every app entry',async({page},info)=>{await emptyHome(page);await capture(page,info,`home-confirmed-empty-${orientation}`);});
 test('unconnected Home keeps app entries without placeholder cards',async({page},info)=>{
  await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));await page.goto('/');
  for(const name of ['Calendar','Inbox','Workflows'])await expect(page.getByRole('button',{name,exact:true})).toBeVisible();
  for(const kind of ['calendar','inbox','workflows'])await expect(page.locator(`[data-alpha-home-${kind}]`)).toHaveCount(0);
  await capture(page,info,`home-unconnected-${orientation}`);
 });
 test('permitted Photos uses concise labels and inset thumbnails without requesting access',async({page},info)=>{
  await photosBridge(page,'selected');
  await page.evaluate(()=>{
   const w=window as any,base=w.Capacitor.nativePromise,f=w.mediaFixture;
   const items=Array.from({length:9},(_,index)=>({...f.row,id:`m:external_primary:i:${91+index}`,name:`Synthetic photo ${index+1}.jpg`,date:f.row.date-index*60000}));
   w.Capacitor.nativePromise=async(plugin:string,method:string,input:any)=>{
    if(plugin==='AlphaPhotos'&&method==='list')return {items,next:''};
    return base(plugin,method,input);
   };
   f.emit();
  });
  await expect(page.getByRole('button',{name:/^Photo,/})).toHaveCount(9);
  await expect(page.getByRole('button',{name:'Library',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Search photos',exact:true})).toHaveCount(0);
  await expect(page.getByText(/up to 240 loaded items/)).toHaveCount(0);
  const grid=page.locator('.photo-grid').filter({visible:true}).first();await expect(grid).toHaveCSS('margin-left','12px');await expect(grid).toHaveCSS('margin-right','12px');
  expect(await page.evaluate(()=>(window as any).mediaFixture.calls.filter((call:any)=>call.method==='requestLibraryAccess').length)).toBe(0);
  await capture(page,info,`photos-selected-access-${orientation}`);
 });
 test('empty Files stays quiet with existing entry controls',async({page},info)=>{
  await page.route(/\/src\/prototype\/fixtures\.js(\?.*)?$/,async route=>{const response=await route.fetch({url:route.request().url().replace('/fixtures.js','/fixtures.empty.js')});await route.fulfill({response});});
  await page.goto('/');await page.getByRole('button',{name:'Files',exact:true}).click();await expect(page.getByText(/No recent files/)).toHaveCount(0);await expect(page.getByRole('button',{name:'Internal storage',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Downloads',exact:true})).toBeVisible();await capture(page,info,`files-empty-${orientation}`);
 });
});
