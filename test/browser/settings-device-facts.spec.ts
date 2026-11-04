import {test,expect,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
const upstreamPin=JSON.parse(readFileSync(new URL('../../upstream.lock.json',import.meta.url),'utf8')).commit;

// Real rendered Settings; only the Android IPC boundary is synthetic. These prove the renderer's
// contract (what it reads, shows and sends). Emulator readback lives in SettingsRolesInstrumentedTest.
// updates: AlphaDevice.checkForUpdate's answers in order: a manifest, null for a 404 (nothing published), or 'fail'.
type Options={launcher?:boolean;decline?:number;updates?:Array<object|null|'fail'>};
async function nativeStub(page:Page,options:Options={}){
 await page.addInitScript(({launcher,decline,updates,upstreamPin})=>{
  const w=window as any;w.androidBridge={};
  try{localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));}catch{/* covered elsewhere */}
  const now=Date.now(),store=new Map<string,string>();
  const roles:Record<string,{held:boolean;holders:string[]}>={home:{held:false,holders:['com.android.launcher3']},assistant:{held:false,holders:[]},dialer:{held:false,holders:[]},sms:{held:false,holders:[]}};
  let declines=decline;
  const answers=[...updates];
  const listeners:Array<{plugin:string;event:string;callback:(value:unknown)=>void}>=[];
  // Native events (appResumed) arrive through Capacitor's callback channel.
  w.settingsFixture={calls:[] as any[],shared:[] as string[],resume:()=>listeners.filter(l=>l.plugin==='DailyApps'&&l.event==='appResumed').forEach(l=>l.callback({}))};
  const methods=(names:string[])=>names.map(name=>({name,rtype:'promise'}));
  w.Capacitor={
   PluginHeaders:[
    {name:'AlphaNotifications',methods:methods(['status','crossAppStatus','addListener','removeListener'])},
    {name:'AlphaVoiceCloud',methods:methods(['checkPermissions'])},
    {name:'Agent',methods:methods(['getStatus'])},
    {name:'AlphaConnection',methods:methods(['secureRead','secureWrite','secureCompareExchange','secureRemove','addListener','removeListener'])},
    {name:'ElizaSystem',methods:methods(['getStatus','requestRole','getDeviceSettings','getBuildInfo'])},
    {name:'AlphaDevice',methods:methods(['snapshot','crashLog','clearCrashLog','recordRendererFailure','diagnosticsFacts','shareDiagnostics','openSettings','checkForUpdate','installUpdate'])},
    {name:'DailyApps',methods:[{name:'addListener',rtype:'callback'},{name:'removeListener',rtype:'callback'}]},
   ],
   nativeCallback:(plugin:string,method:string,options:any,callback:(value:unknown)=>void)=>{if(method==='addListener'){listeners.push({plugin,event:options?.eventName,callback});return String(listeners.length);}return '0';},
   nativePromise:async(plugin:string,method:string,input:any)=>{
    const f=w.settingsFixture;f.calls.push({plugin,method,input});
    if(plugin==='AlphaNotifications')return {permissionGranted:true,appEnabled:true};
    if(plugin==='AlphaVoiceCloud')return {microphone:'granted'};
    if(plugin==='Agent')return {packaged:true,state:'stopped'};
    if(plugin==='AlphaConnection'){
     if(method==='secureRead')return {value:store.get(input.slot)??null};
     if(method==='secureCompareExchange'){if((store.get(input.slot)??null)!==input.expectedValue)return {status:'conflict'};if(input.value===null)store.delete(input.slot);else store.set(input.slot,input.value);return {status:'saved'};}
     if(method==='secureWrite'){store.set(input.slot,input.value);return {};}
     return {};
    }
    if(plugin==='ElizaSystem'&&method==='getBuildInfo')return {launcher,version:'0.1.0'};
    if(plugin==='ElizaSystem'){
     if(method==='getStatus')return {packageName:'ai.elizaresearch.alphaphone',roles:Object.entries(roles).map(([role,r])=>({role,androidRole:'android.app.role.'+role.toUpperCase(),available:true,held:r.held,holders:r.held?['ai.elizaresearch.alphaphone']:r.holders}))};
     // Android's own dialog decides; the fixture declines first when asked to.
     if(method==='requestRole'){if(declines>0){declines--;return {role:input.role,held:false,resultCode:0};}roles[input.role]={held:true,holders:[]};return {role:input.role,held:true,resultCode:-1};}
     if(method==='getDeviceSettings')return {volumes:[]};
    }
    if(plugin==='AlphaDevice'){
     if(method==='snapshot')return {readAt:now,model:'Fixture phone',manufacturer:'Fixture',appVersion:'0.1.0',androidRelease:'16',build:'fixture',securityPatch:'2026-09-05',permissions:{Microphone:true,Location:false,Camera:false,Calendar:true},locationAccess:'denied',batteryPercent:64,charging:false,powerSave:false,wifiActive:true,cellularActive:false,...(updates.length?{appVersionCode:7,appSigner:'5c'.repeat(32)}:{})};
     // Each check settles after 300 ms, so a second start or resume can arrive while it runs.
     if(method==='checkForUpdate'){const next=answers.shift();await new Promise(settle=>setTimeout(settle,300));if(next===undefined||next==='fail')throw Error('Update unavailable');return next===null?{}:{manifest:JSON.stringify(next)};}
     if(method==='installUpdate')return undefined;
     if(method==='crashLog')return {exitHistory:true,entries:[{at:now-60_000,source:'uncaught',errorClass:'java.lang.IllegalStateException',thread:'main',process:'main'},{at:now-30_000,source:'exit',reason:'anr',process:'main'},{at:now-10_000,source:'exit',reason:'crash',process:'main',description:'Fixture note text should not appear'}]};
     if(method==='diagnosticsFacts')return {appVersion:'0.1.0',versionCode:1,variant:launcher?'launcher':'standalone',buildType:'release',testMocks:false,sdkInt:36,androidRelease:'16',securityPatch:'2026-09-05',upstreamPin,runtimeHashes:{'agent/alpha-source.json':'c'.repeat(64)},apiKey:'csk-synthetic-provider-key'};
     if(method==='shareDiagnostics'){f.shared.push(input.text);return {status:'opened'};}
     if(method==='clearCrashLog'||method==='recordRendererFailure')return {};
     if(method==='openSettings')return {status:'opened'};
    }
    throw Error('Unexpected native operation '+plugin+'.'+method);
   },
  };
 },{launcher:options.launcher??true,decline:options.decline??0,updates:options.updates??[],upstreamPin});
}
const settings=async(page:Page,query='')=>{await page.goto(`/${query}`);await page.getByRole('button',{name:'Settings',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-active-view','settings');};
const app=(page:Page)=>page.locator('[data-alpha-layer="app"]');
const calls=(page:Page,plugin:string,method:string)=>page.evaluate(([plugin,method])=>(window as any).settingsFixture.calls.filter((c:any)=>c.plugin===plugin&&c.method===method).length,[plugin,method]);

test('Settings shows HOME and assistant role state and reads it back after a declined then accepted request',async({page})=>{
 await nativeStub(page,{launcher:true,decline:1});
 await settings(page);
 await expect(app(page).getByText('Home app',{exact:true})).toBeVisible();
 await expect(app(page).getByText('Another app',{exact:true})).toBeVisible();
 await expect(app(page).getByText('Not Alpha Phone',{exact:true})).toBeVisible();
 const make=app(page).getByRole('button',{name:'Make Alpha your Home app',exact:true});
 const reads=await calls(page,'ElizaSystem','getStatus');
 await make.click();
 await expect(page.getByText('Home app not changed',{exact:true}).first()).toBeVisible();
 // The toast is the only notice; Settings keeps no "Last change" row.
 await expect(app(page).getByText('Last change',{exact:true})).toHaveCount(0);
 expect(await calls(page,'ElizaSystem','getStatus')).toBeGreaterThan(reads);
 await expect(make).toBeVisible();
 await make.click();
 await expect(page.getByText('Alpha Phone is your Home app',{exact:true}).first()).toBeVisible();
 await expect(app(page).getByText('Alpha Phone',{exact:true})).toBeVisible();
 await expect(make).toHaveCount(0);
 // A native resume re-reads Android's answer rather than trusting the earlier result.
 const before=await calls(page,'ElizaSystem','getStatus');
 await page.evaluate(()=>(window as any).settingsFixture.resume());
 await expect.poll(()=>calls(page,'ElizaSystem','getStatus')).toBeGreaterThan(before);
 await app(page).getByRole('button',{name:'Default apps in Android',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).settingsFixture.calls.some((c:any)=>c.method==='openSettings'&&c.input.page==='default-apps'))).toBe(true);
});

test('the standalone variant shows role state but never offers the HOME request',async({page})=>{
 await nativeStub(page,{launcher:false});
 await settings(page);
 await expect(app(page).getByText('Home app',{exact:true})).toBeVisible();
 await expect(app(page).getByRole('button',{name:'Make Alpha your Home app',exact:true})).toHaveCount(0);
 expect(await calls(page,'ElizaSystem','requestRole')).toBe(0);
});

test('Privacy shows Calendar and no Contacts, Developer has no NPU or uptime, and diagnostics are redacted',async({page})=>{
 await nativeStub(page);
 // Developer appears only behind the one gate: a development server opened with ?tools=1.
 await settings(page);
 await expect(app(page).getByRole('button',{name:'Developer',exact:true})).toHaveCount(0);
 await settings(page,'?tools=1');
 await app(page).getByRole('button',{name:'Privacy & data',exact:true}).click();
 await expect(app(page).getByText('Calendar',{exact:true}).first()).toBeVisible();
 await expect(app(page).getByText('Allowed for Alpha',{exact:true}).first()).toBeVisible();
 await expect(app(page).getByText('Contacts',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Back to Settings',exact:true}).click();
 await app(page).getByRole('button',{name:'Developer',exact:true}).click();
 const developer=await app(page).innerText();
 expect(developer).not.toMatch(/NPU|Device uptime|Uptime/);
 await page.getByRole('button',{name:'Back to Settings',exact:true}).click();

 await app(page).getByRole('button',{name:'About',exact:true}).click();
 await expect(app(page).getByText('3 recorded',{exact:true})).toBeVisible();
 await app(page).getByRole('button',{name:'Problem log',exact:true}).click();
 await expect(app(page).getByText(/App crashed · java\.lang\.IllegalStateException · main thread/)).toBeVisible();
 await expect(app(page).getByText(/App process stopped: anr/)).toBeVisible();
 expect(await app(page).innerText()).not.toContain('Fixture note text');
 await app(page).getByRole('button',{name:'Export diagnostics',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).settingsFixture.shared.length)).toBe(1);
 const shared=await page.evaluate(()=>(window as any).settingsFixture.shared[0]);
 const report=JSON.parse(shared);
 expect(report.format).toBe('alpha-diagnostics/v1');
 expect(report.upstreamPin).toBe(upstreamPin);
 expect(report.permissions).toEqual({Microphone:true,Location:false,Camera:false,Calendar:true,Notifications:true});
 expect(report.roles.find((r:any)=>r.role==='home')).toEqual({role:'home',held:false,available:true});
 expect(report.crashes.count).toBe(3);
 for(const leak of ['csk-synthetic','Fixture note text','com.android.launcher3','holders','Fixture phone'])expect(shared).not.toContain(leak);
});

// Software update: what the app start, resume and owner taps send to AlphaDevice, and the rows they leave.
const update={schema:'alpha-update/v1',versionCode:8,versionName:'0.1.1',variant:'launcher',signerSha256:'5c'.repeat(32),apkUrl:'https://github.com/eliza-research/alphaphone/releases/download/app-8/alpha-phone-8.apk',sha256:'0a'.repeat(32),sizeBytes:400_000_000,notes:'Faster Home'};
const saved=(page:Page)=>page.evaluate(()=>localStorage.getItem('alpha.app-update.v1'));

test('a failed update check stays due, one check runs at a time, and Install update sends the offered APK',async({page})=>{
 await nativeStub(page,{updates:['fail',update]});
 await settings(page);
 const install=app(page).getByRole('button',{name:'Install update',exact:true});
 // The check at app start fails quietly: nothing is offered or recorded, so the next resume checks again.
 await expect.poll(()=>calls(page,'AlphaDevice','checkForUpdate')).toBe(1);
 await page.waitForTimeout(500);
 expect(await saved(page)).toBeNull();
 await expect(install).toHaveCount(0);
 await expect(app(page).getByRole('button',{name:'Check for updates',exact:true})).toBeVisible();
 // Two resumes while that check runs share it.
 await page.evaluate(()=>{const f=(window as any).settingsFixture;f.resume();f.resume();});
 await expect(install).toBeVisible();
 await expect(app(page).getByText('0.1.1 (8)',{exact:true})).toBeVisible();
 await expect(app(page).getByText('Faster Home',{exact:true})).toBeVisible();
 expect(await calls(page,'AlphaDevice','checkForUpdate')).toBe(2);
 // Answered: later resumes that day do not check again.
 await page.evaluate(()=>(window as any).settingsFixture.resume());
 await page.waitForTimeout(500);
 expect(await calls(page,'AlphaDevice','checkForUpdate')).toBe(2);
 await install.click();
 await expect.poll(()=>calls(page,'AlphaDevice','installUpdate')).toBe(1);
 // Only what the native download reads: not versionName or notes.
 const {apkUrl,sha256,sizeBytes,versionCode}=update;
 expect(await page.evaluate(()=>(window as any).settingsFixture.calls.find((c:any)=>c.method==='installUpdate').input)).toEqual({apkUrl,sha256,sizeBytes,versionCode});
 // A restart offers the kept answer without checking again.
 await settings(page);
 await expect(install).toBeVisible();
 await page.waitForTimeout(500);
 expect(await calls(page,'AlphaDevice','checkForUpdate')).toBe(0);
 expect(await page.locator('body').innerText()).not.toMatch(/Up to date|Update failed|Update unavailable/);
});

test('an update whose versionName cannot be shown is still offered, under its versionCode',async({page})=>{
 await nativeStub(page,{updates:[{...update,versionName:'x'.repeat(65)}]});
 await settings(page);
 const row=app(page).getByRole('button',{name:'Install update',exact:true});
 await expect(row).toBeVisible();
 await expect(app(page).getByText('8',{exact:true})).toBeVisible();
 expect(await page.locator('body').innerText()).not.toContain('x'.repeat(65));
 await row.click();
 await expect.poll(()=>calls(page,'AlphaDevice','installUpdate')).toBe(1);
});

test('Install update appears only for a newer build of this flavor and signer, and a withdrawn release removes it',async({page})=>{
 await nativeStub(page,{updates:[{...update,versionCode:7},{...update,variant:'standalone'},{...update,signerSha256:'6d'.repeat(32)},update,null]});
 await settings(page);
 const install=app(page).getByRole('button',{name:'Install update',exact:true}),check=app(page).getByRole('button',{name:'Check for updates',exact:true});
 await expect.poll(()=>calls(page,'AlphaDevice','checkForUpdate')).toBe(1);
 for(const [count,offered] of [[2,false],[3,false],[4,true],[5,false]] as const){
  await check.click();
  await expect.poll(()=>calls(page,'AlphaDevice','checkForUpdate')).toBe(count);
  await expect(check).toBeVisible();
  await expect(install).toHaveCount(offered?1:0);
 }
 // The 404 is an answer: it is kept, so the withdrawn offer does not come back on restart.
 expect(JSON.parse((await saved(page))!).manifest).toBeNull();
 expect(await calls(page,'AlphaDevice','installUpdate')).toBe(0);
});

test('a browser build never checks for updates',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Settings',exact:true}).click();
 await expect(page.locator('html')).toHaveAttribute('data-active-view','settings');
 await page.waitForTimeout(500);
 expect(await saved(page)).toBeNull();
 await expect(app(page).getByRole('button',{name:'Check for updates',exact:true})).toHaveCount(0);
});
