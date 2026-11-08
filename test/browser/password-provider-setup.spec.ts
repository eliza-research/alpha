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
   {name:'Agent',methods:methods(['getStatus'])},
   {name:'ElizaSystem',methods:methods(['getBuildInfo'])},
   {name:'DailyApps',methods:[...methods(['surfaceInfo','removeListener']),{name:'addListener',rtype:'callback'}]},
  ],nativeCallback:(plugin:string,method:string,input:any,callback:any)=>{f.listeners[input.eventName]??=[];f.listeners[input.eventName].push(callback);return 'fixture-listener';},nativePromise:async(plugin:string,method:string,input:any)=>{
   if(plugin==='AlphaNotifications')return {permissionGranted:true,appEnabled:true};
   if(plugin==='AlphaVoiceCloud')return {microphone:'granted'};
   if(plugin==='AlphaDevice'&&method==='snapshot')return {passwordProvider:{installation:f.installation,selection:f.selection,support:f.support}};
   if(plugin==='AlphaDevice'&&method==='openPasswordProvider'){f.calls.push(input.action);if(f.fail)throw Error('no handler');return {status:f.unexpected?'unknown':'opened'};}
   if(method==='secureRead')return {value:null};
   if(plugin==='Agent')return {packaged:false,state:'unavailable'};
   if(plugin==='ElizaSystem'&&method==='getBuildInfo')return {launcher:false,version:'fixture'};
   return {};
  }};
 },{installation,selection});
 await page.goto('/');
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('button',{name:'Passwords',exact:true}).click();
}
// Settings › Passwords › Password provider: one row whose value is the selection Android reports
// (docs/ui-refresh-2026-11). Android's answer is read again when Alpha returns to the front.
const provider=(page:any)=>page.getByRole('button',{name:'Password provider',exact:true});
const resume=(page:any)=>page.evaluate(()=>{for(const callback of (window as any).passwordFixture.listeners.appResumed||[])callback({});});
test('setup handoff does not claim selected; return to Alpha observes the selection',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await nativeFixture(page);
 await expect(provider(page)).toContainText('No provider selected');
 await provider(page).click();
 await expect(provider(page)).toContainText('No provider selected');
 await resume(page);
 await expect(provider(page)).toContainText('No provider selected');
 await page.evaluate(()=>{(window as any).passwordFixture.selection='proton';});
 await resume(page);
 await expect(provider(page)).toContainText('Proton Pass selected');
 await page.getByRole('button',{name:'Open Proton Pass',exact:true}).click();
 expect(await page.evaluate(()=>(window as any).passwordFixture.calls)).toEqual(['settings','open']);expect(errors).toEqual([]);
});
test('absent provider offers official installation handoff and return discovers installation',async({page})=>{
 await nativeFixture(page,'absent');
 await page.getByRole('button',{name:'Get Proton Pass from Proton',exact:true}).click();
 await expect(page.getByRole('button',{name:'Open Proton Pass',exact:true})).toHaveCount(0);
 await page.evaluate(()=>{(window as any).passwordFixture.installation='installed';});
 await resume(page);
 await expect(page.getByRole('button',{name:'Open Proton Pass',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Get Proton Pass from Proton',exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).passwordFixture.calls)).toEqual(['install']);
});
test('unavailable handoff and unrecognized publisher never claim enablement or open provider',async({page})=>{
 await nativeFixture(page,'unrecognized-publisher','other');
 await expect(page.getByRole('button',{name:'Open Proton Pass',exact:true})).toHaveCount(0);
 await expect(provider(page)).toContainText('Another provider selected');
 await page.evaluate(()=>{(window as any).passwordFixture.fail=true;});
 await provider(page).click();
 await expect(page.getByText('Password provider setup is unavailable.',{exact:true})).toBeVisible();
});
test('a browser offers no Android password provider and simulates no installation',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Settings',exact:true}).click();
 await expect(page.getByRole('button',{name:'Passwords',exact:true})).toHaveCount(0);
 await expect(provider(page)).toHaveCount(0);
 await expect(page.getByRole('button',{name:/Proton Pass/})).toHaveCount(0);
});

test('return from Android refreshes status without inferring successful selection',async({page})=>{
 await nativeFixture(page);
 await expect(provider(page)).toContainText('No provider selected');
 await provider(page).click();
 await page.evaluate(()=>{(window as any).passwordFixture.selection='other';});
 await resume(page);
 await expect(provider(page)).toContainText('Another provider selected');
});
test('unknown and unavailable status offer recovery without a fabricated ready state',async({page})=>{
 await nativeFixture(page,'unknown','unknown');
 await expect(provider(page)).toContainText('Selection unavailable');
 await page.evaluate(()=>{(window as any).passwordFixture.support='unavailable';});
 await resume(page);
 await expect(provider(page)).toContainText('Autofill unavailable for this device or user');
 await expect(page.getByRole('button',{name:'Open Proton Pass',exact:true})).toHaveCount(0);
});

test('unverified publisher selection is never labeled verified Proton selection',async({page})=>{
 await nativeFixture(page,'unrecognized-publisher','proton');
 await expect(provider(page)).toContainText('Provider package selected · publisher not verified');
 await expect(page.getByText('Proton Pass selected',{exact:true})).toHaveCount(0);
});
test('browser menu opens the Passwords page with a working Settings back path',async({page},testInfo)=>{
 await page.goto('/');await page.getByRole('button',{name:'Browser',exact:true}).click();
 await page.getByRole('button',{name:'Menu',exact:true}).click();
 await page.getByRole('button',{name:'Password manager',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Passwords',exact:true})).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('password-provider-detail.png')});
 await page.getByRole('button',{name:'Back to Settings',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Passwords',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Passwords',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Agent',exact:true})).toBeVisible();
});

test('disabled verified provider stays unavailable to launch even when selected',async({page})=>{
 await nativeFixture(page,'disabled','proton');
 await expect(provider(page)).toContainText('Proton Pass selected · app disabled');
 await expect(page.getByRole('button',{name:'Open Proton Pass',exact:true})).toHaveCount(0);
});

test('unexpected resolved handoff status never reports opened',async({page})=>{
 await nativeFixture(page);
 await page.evaluate(()=>{(window as any).passwordFixture.unexpected=true;});
 await provider(page).click();
 await expect(page.getByText('Password provider setup is unavailable.',{exact:true})).toBeVisible();
 await expect(page.getByText(/Opened provider setup/)).toHaveCount(0);
 await expect(provider(page)).toContainText('No provider selected');
});
