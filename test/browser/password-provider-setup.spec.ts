import {test,expect} from '@playwright/test';

// Rendered shipping adapters with a controlled native metadata/handoff boundary.
// No vault, credentials, real provider selection or installed APK is accessed.
async function nativeFixture(page:any,installation='installed',selection='none') {
 await page.addInitScript(({installation,selection}:any)=>{
  const w=window as any;w.androidBridge={};localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));
  const f=w.passwordFixture={installation,selection,support:'available',calls:[] as string[],fail:false,unexpected:false,listeners:{} as any};
  const methods=(names:string[])=>names.map(name=>({name,rtype:'promise'}));
  w.Capacitor={PluginHeaders:[
   {name:'AlphaNotifications',methods:methods(['status','crossAppStatus','addListener','removeListener'])},
   {name:'AlphaVoiceCloud',methods:methods(['checkPermissions'])},
   {name:'AlphaDevice',methods:methods(['snapshot','openPasswordProvider'])},
   {name:'AlphaConnection',methods:methods(['secureRead','addListener','removeListener'])},
   {name:'AlphaHostedResults',methods:methods(['status','pendingResult','addListener','removeListener'])},
   {name:'Agent',methods:methods(['getStatus','setGoogleAgentAccess'])},
   {name:'ElizaSystem',methods:methods(['getBuildInfo'])},
   {name:'DailyApps',methods:[...methods(['surfaceInfo','removeListener']),{name:'addListener',rtype:'callback'}]},
  ],nativeCallback:(plugin:string,method:string,input:any,callback:any)=>{f.listeners[input.eventName]??=[];f.listeners[input.eventName].push(callback);return 'fixture-listener';},nativePromise:async(plugin:string,method:string,input:any)=>{
   if(plugin==='AlphaNotifications')return {permissionGranted:true,appEnabled:true};
   if(plugin==='AlphaVoiceCloud')return {microphone:'granted'};
   if(plugin==='AlphaDevice'&&method==='snapshot')return {passwordProvider:{installation:f.installation,selection:f.selection,support:f.support}};
   if(plugin==='AlphaDevice'&&method==='openPasswordProvider'){f.calls.push(input.action);if(f.fail)throw Error('no handler');return {status:f.unexpected?'unknown':'opened'};}
   if(method==='secureRead')return {value:null};
   if(plugin==='Agent'&&method==='setGoogleAgentAccess'){
    if(typeof input.gmailChanges!=='boolean'||typeof input.calendarEdits!=='boolean')throw Error('Invalid Google access fixture input');
    return {};
   }
   if(plugin==='Agent')return {packaged:false,state:'unavailable'};
   if(plugin==='ElizaSystem'&&method==='getBuildInfo')return {launcher:false,version:'fixture'};
   return {};
  }};
 },{installation,selection});
 await page.goto('/');
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('button',{name:'Apps',exact:true}).click();
 await page.getByRole('button',{name:'Passwords',exact:true}).click();
}
// The owner removed external-provider setup. Keep one local password manager in every
// reported Android provider state. Vault operations remain covered by password-manager.spec.ts.
for (const [installation, selection] of [
 ['installed', 'none'], ['installed', 'proton'], ['absent', 'none'],
 ['unrecognized-publisher', 'other'], ['unrecognized-publisher', 'proton'],
 ['unknown', 'unknown'], ['disabled', 'proton'],
]) test(`external provider ${installation}/${selection} does not add another manager`, async ({page}) => {
 await nativeFixture(page, installation, selection);
 await expect(page.getByRole('heading', {name:'Password manager', exact:true})).toBeVisible();
 await expect(page.getByRole('button', {name:/Proton|Choose password provider|Other password providers/})).toHaveCount(0);
 expect(await page.evaluate(() => (window as any).passwordFixture.calls)).toEqual([]);
});
const provider=(page:any)=>page.getByRole('button',{name:'Choose password provider in Android',exact:true});
test('a browser offers no Android password provider and simulates no installation',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Settings',exact:true}).click();
 await expect(page.getByRole('button',{name:'Passwords',exact:true})).toHaveCount(0);
 await expect(provider(page)).toHaveCount(0);
 await expect(page.getByRole('button',{name:/Proton Pass/})).toHaveCount(0);
});

test('browser menu opens the Passwords page with a working Settings back path',async({page},testInfo)=>{
 await page.goto('/');await page.getByRole('button',{name:'Browser',exact:true}).click();
 await page.getByRole('button',{name:'Menu',exact:true}).click();
 await page.getByRole('button',{name:'Password manager',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Password manager',exact:true})).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('password-provider-detail.png')});
 await page.getByRole('button',{name:'Back to Settings',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Password manager',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Passwords',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'General',exact:true})).toBeVisible();
});
