import {openCloudPlanFromSettings} from './helpers/cloud-plan-settings';
import {seedCompletedAccessSetup} from './flag-off-android';
import {writeFileSync} from 'node:fs';
import {test,expect,type Page} from '@playwright/test';
import {installResidentAgentPlugin} from './helpers/resident-agent-plugin';
// Production lane only: the flag-off bundle that the APKs package, with only the Android IPC
// boundary replaced. These prove what the shipped renderer reads, shows and sends. They do not
// prove what a phone's Android Settings does; device qualification of each handoff is separate.
test.describe.configure({timeout:240_000});
test.beforeEach(async({},testInfo)=>{test.skip(testInfo.project.name!=='production','Production lane only (flag-off build)');});

type Fixture={snapshot?:Record<string,unknown>;drop?:string[];subscription?:'credits'|'active'|'canceled';agentStartFailure?:boolean;
 /** Exact USD organization credit balance in the billing snapshot (data.v2.balance); absent when unset. */
 credits?:string;
 /** The resident's providerStatus answer; tests change truth.state.provider to model a later binding. */
 provider?:Record<string,unknown>};
async function nativeStub(page:Page,fixture:Fixture={}){
 await installResidentAgentPlugin(page);
 await page.addInitScript(({snapshot,drop,subscription,agentStartFailure,credits,provider})=>{
  const w=window as any;w.androidBridge={};
  localStorage.setItem('alpha.startup-permissions.v1',JSON.stringify({dismissed:true,attempted:{}}));
  const now=Date.now(),store=new Map<string,string>();
  // A signed-in phone with finite Cloud identity and plan answers. No real key or provider is used.
  const credentialId='5c1f2a9e-3b4d-4e6f-8a7b-9c0d1e2f3a4b';
  store.set('cloud:production',JSON.stringify({token:'synthetic-settings-key',credentialId,expiresAt:now+60*24*3600_000}));
  try{localStorage.setItem('alpha.connection.plan-admission.v1',JSON.stringify({version:1,environment:'production',credentialId,userId:'9f1dc45a-4011-4e44-947a-30d999d24fa5',organizationId:null,status:'active',planName:'Synthetic plan',verifiedAt:now,endsAt:null}));}catch{/* covered elsewhere */}
  const listeners:Array<{plugin:string;event:string;callback:(value:unknown)=>void}>=[];
  const residentId='9f1dc45a-4011-4e44-947a-30d999d24fa5';
  const resident=w.residentAgent=w.createResidentAgentPlugin({owner:()=>residentId,agentId:residentId});
  const state={
   // Android's answers. Tests change these, then resume, to prove the renderer reads them again.
   snapshot:{readAt:now,model:'Stub phone',manufacturer:'Stub maker',appVersion:'0.1.0',appVersionCode:7,appUpdatedAt:Date.UTC(2026,8,1),androidRelease:'16',build:'stub-build',securityPatch:'2026-09-05',
    permissions:{Microphone:true,Location:false,Camera:false,Calendar:true},locationAccess:'denied',batteryPercent:64,charging:false,powerSave:false,
    wifiActive:true,cellularActive:false,wifiEnabled:true,bluetoothEnabled:false,airplaneMode:false,locationEnabled:true,mobileDataEnabled:true,interruptionFilter:'all',adaptiveBrightness:true,textScalePercent:100,...snapshot} as Record<string,unknown>,
   status:{permissionGranted:true,appEnabled:true,interruption:'all',scope:'alpha-phone',channels:[{id:'c-reminders',name:'Reminders',importance:4,blocked:false,groupBlocked:false},{id:'c-results',name:'Scheduled digest results',importance:3,blocked:false,groupBlocked:false}]} as Record<string,any>,
   cross:{revision:'r1',enabled:false,paused:false,accessGranted:false,connected:false,history:true,apps:[]} as Record<string,unknown>,
   history:[{appLabel:'Stub Mail',state:'posted',at:now-60_000}] as unknown[],
   items:[] as unknown[],openFails:false,unspecific:[] as string[],unavailable:[] as string[],torch:true,shadeOutcome:'opened' as string,provider:provider??{provider:'elizacloud',configured:false},
  };
  for(const key of drop)delete state.snapshot[key];
  w.truth={calls:[] as any[],shared:[] as string[],state,resume:()=>listeners.filter(l=>l.plugin==='DailyApps'&&l.event==='appResumed').forEach(l=>l.callback({}))};
  const methods=(names:string[])=>names.map(name=>({name,rtype:'promise'}));
  w.Capacitor={
   PluginHeaders:[
        { name: 'AlphaDeletions', methods: methods(['pending']) },
    {name:'AlphaNotifications',methods:methods(['pendingWorkflowTap','status','crossAppStatus','notificationHistory','list','open','dismiss','clear','openChannelSettings','openAppSettings','addListener','removeListener'])},
    {name:'AlphaVoiceCloud',methods:methods(['checkPermissions'])},
    {name:'Agent',methods:resident.methods(['getStatus','start','stop','providerStatus','configureCloudProvider','clearProvider','request'])},
    {name:'AlphaConnection',methods:methods(['secureRead','secureWrite','secureCompareExchange','secureRemove','request','cancel','addListener','removeListener'])},
    {name:'ElizaSystem',methods:methods(['getStatus','requestRole','getDeviceSettings','setFlashlight','getBuildInfo'])},
    {name:'AlphaDevice',methods:methods(['snapshot','crashLog','clearCrashLog','recordRendererFailure','diagnosticsFacts','shareDiagnostics','openSettings','openNotificationShade'])},
    {name:'DailyApps',methods:[{name:'addListener',rtype:'callback'},{name:'removeListener',rtype:'callback'}]},
   ],
   nativeCallback:(plugin:string,method:string,options:any,callback:(value:unknown)=>void)=>{if(plugin==='Agent')return resident.nativeCallback(plugin,method,options,callback);if(method==='addListener'){listeners.push({plugin,event:options?.eventName,callback});return String(listeners.length);}return '0';},
   nativePromise:async(plugin:string,method:string,input:any)=>{
        if (plugin === 'AlphaDeletions' && method === 'pending') return { deletions: [] };
    w.truth.calls.push({plugin,method,input});
    if(plugin==='AlphaNotifications'){
     if(method==='pendingWorkflowTap')return {};
     if(method==='status')return JSON.parse(JSON.stringify(state.status));
     if(method==='crossAppStatus')return state.cross;
     if(method==='notificationHistory')return {items:state.history};
     if(method==='list')return {items:state.items,scope:'alpha-phone'};
     if(method==='open'){if(state.openFails)throw Error('This notification is no longer available to open');return {};}
     if(method==='openChannelSettings'||method==='openAppSettings')return {status:'opened'};
     return {};
    }
    if(plugin==='AlphaVoiceCloud')return {microphone:'granted'};
    if(plugin==='Agent'){
     const owned=resident.answer(method,input);if(owned)return owned;
     if(agentStartFailure&&method==='start')throw Error('Synthetic resident startup failure');
     if(method==='request'){const id=residentId;return {status:200,body:JSON.stringify(input.path==='/api/auth/me'?{identity:{id,kind:'owner'},access:{role:'OWNER',mode:'local'}}:input.path==='/api/agents'?{agents:[{id,name:'Alpha',status:'running'}]}:input.path==='/api/conversations'?{conversations:[]}:{} )};}
     return method==='providerStatus'?state.provider:{packaged:true,state:'stopped',serviceActive:false,socketListening:false};
    }
    if(plugin==='AlphaConnection'){
     if(method==='secureRead')return {value:store.get(input.slot)??null};
     if(method==='secureCompareExchange'){if((store.get(input.slot)??null)!==input.expectedValue)return {status:'conflict'};if(input.value===null)store.delete(input.slot);else store.set(input.slot,input.value);return {status:'saved'};}
     if(method==='secureWrite'){store.set(input.slot,input.value);return {};}
     // Cloud answers are finite and every unlisted route is refused.
     if(method==='request'){
      const path=new URL(input.url).pathname;
      if(path==='/api/v1/user')return {status:200,data:{success:true,data:{id:'9f1dc45a-4011-4e44-947a-30d999d24fa5',email:'synthetic-settings@example.invalid'}}};
      if(path==='/api/v1/subscription/entitlement')return {status:404,data:{}};
      if(path==='/api/v1/billing/limits')return {status:200,data:{success:true,data:{schemaVersion:2,v2:{subscription:subscription==='credits'?{status:'not_applicable',reason:'no_organization_subscription'}:{status:'available',value:{planKey:'plus_monthly',state:subscription||'active',currentPeriodEnd:'2099-01-01T00:00:00.000Z'}},
       ...(credits===undefined?{}:{balance:{status:'available',source:'organizations',observedAt:new Date().toISOString(),value:{balance:{value:credits,unit:'usd',currency:'USD'},revision:'1'}}})}}}};
      return {status:404,data:{}};
     }
     return {};
    }
    if(plugin==='ElizaSystem'&&method==='getBuildInfo')return {launcher:true,version:'0.1.0'};
    if(plugin==='ElizaSystem'){
     if(method==='getStatus')return {packageName:'ai.elizaresearch.alphaphone',roles:['home','assistant'].map(role=>({role,androidRole:'android.app.role.'+role.toUpperCase(),available:true,held:false,holders:[]}))};
     if(method==='getDeviceSettings')return {volumes:[{stream:'music',current:6,max:15},{stream:'ring',current:7,max:7},{stream:'alarm',current:0,max:7}]};
     if(method==='setFlashlight'){if(!state.torch)return {available:false,enabled:false};return {available:true,enabled:input.enabled===true};}
     if(method==='requestRole')return {role:input.role,held:false,resultCode:0};
    }
    if(plugin==='AlphaDevice'){
     if(method==='snapshot')return {...state.snapshot};
     if(method==='crashLog')return {exitHistory:true,entries:[]};
     if(method==='diagnosticsFacts')return {appVersion:'0.1.0',versionCode:7,variant:'launcher',buildType:'release',testMocks:false,sdkInt:36,androidRelease:'16',securityPatch:'2026-09-05',runtimeHashes:{'agent/alpha-source.json':'c'.repeat(64)},apiKey:'csk-synthetic-provider-key'};
     if(method==='shareDiagnostics'){w.truth.shared.push(input.text);return {status:'opened'};}
     if(method==='clearCrashLog'||method==='recordRendererFailure')return {};
     // Android's answer to launcher Home asking for its shade (SystemShade.java); 'throw' stands for a lost bridge.
     if(method==='openNotificationShade'){if(state.shadeOutcome==='throw')throw Error('Bridge unavailable');return {status:state.shadeOutcome};}
     if(method==='openSettings'){if(state.unavailable.includes(input.page))throw Error('This Android settings page is unavailable');return {status:'opened',page:input.page,specific:!state.unspecific.includes(input.page)};}
    }
    throw Error('Unexpected native operation '+plugin+'.'+method);
   },
  };
 },{snapshot:fixture.snapshot??{},drop:fixture.drop??[],subscription:fixture.subscription,agentStartFailure:fixture.agentStartFailure,credits:fixture.credits,provider:fixture.provider});
}
const app=(page:Page)=>page.locator('[data-alpha-layer="app"]');
const current=(page:Page)=>page.locator('[data-settings-page]:not([inert])').last();
const set=(page:Page,patch:Record<string,unknown>)=>page.evaluate(patch=>{const state=(window as any).truth.state;for(const [key,value] of Object.entries(patch))if(value&&typeof value==='object'&&!Array.isArray(value)&&state[key]&&typeof state[key]==='object'&&!Array.isArray(state[key]))Object.assign(state[key],value);else state[key]=value;},patch);
const resume=(page:Page)=>page.evaluate(()=>(window as any).truth.resume());
const opened=(page:Page)=>page.evaluate(()=>(window as any).truth.calls.filter((c:any)=>c.plugin==='AlphaDevice'&&c.method==='openSettings').map((c:any)=>c.input.page as string));
const callNames=(page:Page)=>page.evaluate(()=>[...new Set((window as any).truth.calls.map((c:any)=>c.plugin+'.'+c.method))] as string[]);
/** Production Android starts the resident by itself (P-43). Offline with a saved sign-in, nothing gates it and no dialog opens. */
async function start(page:Page){
 await page.goto('/');
 if(await page.evaluate(()=>!!(window as any).truth)){
  await expect.poll(()=>page.evaluate(()=>(window as any).truth.calls.some((call:any)=>call.plugin==='Agent'&&call.method==='request'&&call.input.path==='/api/auth/me'))).toBe(true);
  await expect(page.locator('.alpha-cloud-sign-in')).toHaveCount(0);
  await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0);
 }
 await page.getByRole('button',{name:'Settings',exact:true}).waitFor({state:'visible'});
}
async function openSettings(page:Page){
 await start(page);
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await expect(page.locator('html')).toHaveAttribute('data-active-view','settings');
}
/** Android's shade is the one notification and quick-settings surface (#416, #417): no Alpha panel or tile exists. */
const alphaShade=(page:Page)=>page.locator('[data-alpha-layer="shade"]');
const shadeRequests=(page:Page)=>page.evaluate(()=>(window as any).truth.calls.filter((c:any)=>c.plugin==='AlphaDevice'&&c.method==='openNotificationShade').length as number);
/** A real pointer drag in the 412px phone canvas. */
async function drag(page:Page,from:{x:number;y:number},dy:number){
 const box=(await page.locator('[data-screen]').boundingBox())!,scale=box.width/412;
 await page.mouse.move(box.x+from.x*scale,box.y+from.y*scale);await page.mouse.down();
 await page.mouse.move(box.x+from.x*scale,box.y+(from.y+dy)*scale,{steps:10});await page.mouse.up();
}
/** Values that exist only in the reference fixtures or as prototype simulations. */
const fixtureValues=['you@gmail.example','you@alpha.example','Alpha Home','Studio 5G','Ritual Coffee','Neighbors_2.4','Pixel Buds Pro 2','Keyboard K3','Kitchen Speaker','Vision 2B','Core 7B','elizaOS 2.1','AC1.260915','Alpha Compute phone','Powered by elizaOS','Alpha Mobile','3.2 of 20 GB','2,418 items','About 1 day','Redaction on','Redaction receipt','Enclave lock','Memory wiped','Wipe memory','Up to date','Cloud fallback','Charge to 80%','Verbose logs','Agent summaries','Last sync','Export logs','Logs saved','Pair new device','Tap to pair','Hey Alpha','Speak replies','Proactive briefings','Roaming','This month','Device uptime','NPU'];
const noFixtures=(text:string,where:string)=>{for(const value of fixtureValues)expect(text,`${where} shows the fixture value "${value}"`).not.toContain(value);};

test('launcher Home asks Android for its own shade and draws no Alpha shade, tiles or brightness',async({page})=>{
 await nativeStub(page);
 await start(page);
 // The shipped renderer has no Alpha notification panel and no quick-settings tiles at all.
 await expect(alphaShade(page)).toHaveCount(0);
 for(const name of ['Wi-Fi','Bluetooth','Do not disturb','Agent can listen','Airplane mode','Flashlight','Display settings','Clear all'])
  await expect(page.getByRole('button',{name:new RegExp('^'+name+'(, |$)')}),name).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Open notifications',exact:true})).toHaveCount(0);
 // A pull down on empty Home asks Android. It accepted: no message, nothing else drawn.
 await drag(page,{x:206,y:420},240);
 await expect.poll(()=>shadeRequests(page)).toBe(1);
 await expect(alphaShade(page)).toHaveCount(0);
 await expect(page.getByText(/Swipe down from the top edge/)).toHaveCount(0);
 await expect(page.locator('html')).toHaveAttribute('data-active-view','home');
 // Asking again asks the same way.
 await drag(page,{x:206,y:420},240);
 await expect.poll(()=>shadeRequests(page)).toBe(2);
 // A pull with the composer focused (keyboard up) does not.
 await page.locator('textarea[data-alpha-composer]').focus();
 await drag(page,{x:206,y:420},240);
 await page.waitForTimeout(300);
 expect(await shadeRequests(page)).toBe(2);
 await page.locator('textarea[data-alpha-composer]').blur();
 // Every other outcome says how to reach Android's notifications and never claims they opened.
 const fallback:Record<string,string>={
  'permission-missing':'Android did not open its notifications from Alpha. Swipe down from the top edge of the screen instead.',
  'unsupported':'Android did not open its notifications from Alpha. Swipe down from the top edge of the screen instead.',
  'not-in-front':'Alpha is not in front. Swipe down from the top edge of the screen for Android notifications.',
  'throw':'Android did not open its notifications from Alpha. Swipe down from the top edge of the screen instead.',
 };
 for(const [outcome,text] of Object.entries(fallback)){
  await set(page,{shadeOutcome:outcome});
  const before=await shadeRequests(page);
  await drag(page,{x:206,y:420},240);
  await expect.poll(()=>shadeRequests(page)).toBe(before+1);
  await expect(page.getByText(text,{exact:true}).last()).toBeVisible();
  await expect(alphaShade(page)).toHaveCount(0);
 }
 // Nothing in the session asked Android to change a radio, sensor or sound switch.
 const names=await callNames(page);
 expect(names.filter(name=>/\.set|\.toggle|\.enable|\.disable/i.test(name))).toEqual([]);
});

// Settings holds controls Alpha can change (docs/ui-refresh-2026-11): Android's own Settings has the
// radios, sound, battery and display, reached through one row.
test('Settings shows no Android switch facts, and a broader Android page is named',async({page})=>{
 await nativeStub(page,{drop:['appVersionCode','appUpdatedAt']});
 await openSettings(page);
 for(const label of ['Wi-Fi','Bluetooth','Mobile data','Battery','Airplane mode','Sound & vibration','Display','Models','Privacy & data','Accounts','Connections'])await expect(current(page).getByRole('button',{name:label,exact:true}),label).toHaveCount(0);
 expect(await current(page).innerText()).not.toMatch(/Manage in Android|Not reported by Android|Not active|Home app|Assistant app/);
 // A Settings row that only reached a broader Android page says so.
 await set(page,{unspecific:['privacy']});
 await current(page).getByRole('button',{name:'App permissions',exact:true}).click();
 await expect(page.getByText('Opened a related Android settings page. This phone has no separate page for that setting.',{exact:true}).last()).toBeVisible();
 await current(page).getByRole('button',{name:'About',exact:true}).click();
 const about=await current(page).innerText();
 expect(about).toMatch(/Alpha Phone\s*0\.1\.0\s/);
 expect(about).not.toContain('Installed or last updated');
 expect(about).not.toMatch(/Updates|Alpha does not check for updates|Runtime/);
});

test('every Settings row shows a real value or an honest handoff, with no fixture value or simulated switch',async({page})=>{
 page.on('dialog',dialog=>void dialog.dismiss());
 await nativeStub(page);
 await openSettings(page);
 const top=await current(page).innerText();
 for(const [label,value] of [['Notifications','On'],['App permissions','2 not allowed'],['About','0.1.0 (7)'],['Agent connection','Running'],['AI','Cloud']] as const)
  await expect(current(page).getByRole('button',{name:label,exact:true}),label).toContainText(value);
 await expect(current(page).getByRole('button',{name:'Developer',exact:true})).toHaveCount(0);
 noFixtures(top,'Settings');
 // A switch must be backed by app-owned state.
 const switches=await current(page).locator('[role="switch"],[aria-pressed],[aria-checked],input[type="checkbox"],input[type="range"]').evaluateAll(list=>list.map(e=>e.getAttribute('aria-label')||e.textContent?.trim()||e.tagName));
 expect(switches.sort()).toEqual(['Ask before acting','Load images in email','Text size','Theme: Dark','Theme: Light','Theme: System']);
 // Each Android row and the page it must ask AlphaDevice.openSettings for.
 for(const [row,target] of [['Notifications','notifications'],['App permissions','privacy'],['Android settings','system']] as const){
  const before=(await opened(page)).length;
  await current(page).getByRole('button',{name:row,exact:true}).click();
  await expect.poll(async()=>(await opened(page)).slice(before),row).toEqual([target]);
 }
 expect(await opened(page)).toEqual(['notifications','privacy','system']);
 const report:string[]=[`Settings: ${top.replace(/\s+/g,' ')}`];
 const shown:Record<string,RegExp[]>={'About':[/Alpha Phone\s*0\.1\.0 \(7\)/,/Installed or last updated/,/Problem log/,/Export diagnostics/,/Open source licenses/,/Check for updates/],'Calendars':[/Google Calendar/],'Passwords':[/Password provider/]};
 const gone:Record<string,RegExp[]>={'About':[/Stub phone|Android\s*16|Security patch|Inference model|Updates|Alpha does not check for updates|Runtime|Android app/],'Calendars':[/Display only|Agent access is reviewed separately/]};
 for(const label of Object.keys(shown)){
  await openSettings(page);
  await current(page).getByRole('button',{name:label,exact:true}).click();
  await expect(page.getByRole('button',{name:'Back to Settings',exact:true})).toBeVisible();
  const text=await current(page).innerText();
  report.push(`${label}: ${text.replace(/\s+/g,' ')}`);noFixtures(text,label);
  for(const pattern of shown[label])expect(text,`${label} shows ${pattern}`).toMatch(pattern);
  for(const pattern of gone[label]||[])expect(text,`${label} no longer shows ${pattern}`).not.toMatch(pattern);
 }
 await test.info().attach('settings-rows',{body:report.join('\n\n'),contentType:'text/plain'});
 writeFileSync(test.info().outputPath('settings-rows.txt'),report.join('\n\n'));
 expect((await callNames(page)).filter(name=>/\.set(?!Flashlight)|\.perform$/i.test(name))).toEqual([]);
 // A page Android refuses to open says so; the row never reports success.
 await openSettings(page);
 await set(page,{unavailable:['notifications']});
 await current(page).getByRole('button',{name:'Notifications',exact:true}).click();
 await expect(page.getByText('This Android settings page is unavailable.',{exact:true})).toBeVisible();
});

test('the owned email image preference persists off and on across production reloads',async({page})=>{
 await nativeStub(page);
 const images=()=>current(page).getByRole('button',{name:'Load images in email',exact:true});
 // openSettings navigates afresh: this checks the durable document, not the prior renderer cache.
 await openSettings(page);await expect(images()).toHaveAttribute('aria-pressed','true');
 await images().click();await expect(images()).toHaveAttribute('aria-pressed','false');
 await openSettings(page);await expect(images()).toHaveAttribute('aria-pressed','false');
 await images().click();await expect(images()).toHaveAttribute('aria-pressed','true');
 await openSettings(page);await expect(images()).toHaveAttribute('aria-pressed','true');
 expect(await opened(page)).toEqual([]);
 expect((await callNames(page)).filter(name=>/\.set(?!Flashlight)|\.perform$/i.test(name))).toEqual([]);
});

test('unreadable email image preferences fail closed without overwriting recovery data',async({page})=>{
 await nativeStub(page);
 await page.addInitScript(()=>localStorage.setItem('alpha.browser.device.v1','{damaged settings'));
 await openSettings(page);
 const images=current(page).getByRole('button',{name:'Load images in email',exact:true});
 await expect(images).toHaveAttribute('aria-pressed','false');await images.click();
 await expect(page.getByText('Preference unavailable. Reopen Settings to try again.',{exact:true}).last()).toBeVisible();
 await expect(images).toHaveAttribute('aria-pressed','false');
 expect(await page.evaluate(()=>localStorage.getItem('alpha.browser.device.v1'))).toBe('{damaged settings');
});

test('notification denial and re-enable are read back from Android, and local history stays available',async({page})=>{
 page.on('dialog',dialog=>void dialog.dismiss());
 await nativeStub(page);
 await openSettings(page);
 const row=current(page).getByRole('button',{name:'Notifications',exact:true});
 await expect(row).toContainText('On');
 // The owner blocks one channel in Android. Alpha shows it only after reading Android again.
 await page.evaluate(()=>{(window as any).truth.state.status.channels[0].blocked=true;(window as any).truth.state.status.channels[0].importance=0;});
 await expect(row).not.toContainText('Some off');
 await resume(page);
 await expect(row).toContainText('Some off');
 // Android's own page for Alpha lists each channel; Alpha opens it and changes nothing until Android reports.
 await row.click();
 await expect.poll(()=>opened(page)).toEqual(['notifications']);
 await expect(row).toContainText('Some off');
 await page.evaluate(()=>{(window as any).truth.state.status.channels[0].blocked=false;(window as any).truth.state.status.channels[0].importance=4;});
 await resume(page);
 await expect(row).not.toContainText('Some off');
 // The whole app is denied, then the permission alone.
 await set(page,{status:{appEnabled:false}});
 await resume(page);
 await expect(row).toContainText('Off');
 await set(page,{status:{appEnabled:true,permissionGranted:false}});
 await resume(page);
 await expect(row).toContainText('Off');
 // Retained history does not depend on delivery: it is still listed while notifications are off.
 await current(page).getByRole('button',{name:'Notifications from other apps',exact:true}).click();
 await current(page).getByRole('button',{name:'Show history',exact:true}).click();
 await expect(current(page)).toContainText(/Stub Mail\s*·\s*posted/);
 await page.getByRole('button',{name:'Back to Settings',exact:true}).click();
 // Android cannot be read: the state is unavailable, never "On".
 await set(page,{status:{permissionGranted:true}});
 await page.evaluate(()=>{const truth=(window as any).truth,original=(window as any).Capacitor.nativePromise;(window as any).Capacitor.nativePromise=async(plugin:string,method:string,input:unknown)=>{if(plugin==='AlphaNotifications'&&method==='status'){truth.calls.push({plugin,method,input});throw Error('Notification delivery settings could not be read');}return original(plugin,method,input);};});
 await resume(page);
 await expect(row).not.toContainText(/On|Off/);
});

test('the flag-off build exports redacted diagnostics with the real version and no update claim',async({page})=>{
 await nativeStub(page);
 await openSettings(page);
 await current(page).getByRole('button',{name:'About',exact:true}).click();
 await current(page).getByRole('button',{name:'Export diagnostics',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).truth.shared.length)).toBe(1);
 const shared=await page.evaluate(()=>(window as any).truth.shared[0] as string);
 const report=JSON.parse(shared);
 expect(report.format).toBe('alpha-diagnostics/v1');
 expect(report.app).toEqual({version:'0.1.0',versionCode:7,variant:'launcher',buildType:'release',testMocks:false});
 expect(report.permissions).toEqual({Microphone:true,Location:false,Camera:false,Calendar:true,Notifications:true});
 expect(Object.keys(report).sort()).toEqual(['app','cloudPlan','connection','crashes','format','generatedAt','nativeVoiceTiming','os','permissions','platform','realtimeVoiceTiming','roles','runtimeHashes','upstreamPin','voiceTiming']);
 expect(report.cloudPlan).toEqual({view:'active',admission:'admit',source:'billing-limits',status:'active'});
 for(const leak of ['csk-synthetic','synthetic-settings-key','synthetic-settings@example.invalid','9f1dc45a-4011-4e44-947a-30d999d24fa5','5c1f2a9e-3b4d-4e6f-8a7b-9c0d1e2f3a4b','Stub phone','Stub maker','stub-build','Stub Mail','update','Update'])expect(shared).not.toContain(leak);
});

test('the browser build of Settings shows no fixture value and no radio or sensor switch',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await openSettings(page);
 const report:string[]=[`Settings: ${(await current(page).innerText()).replace(/\s+/g,' ')}`];
 noFixtures(report[0],'Settings');
 expect(report[0]).not.toMatch(/Wi-Fi|Bluetooth|Airplane mode|Battery|Models|Privacy & data/);
 const row=current(page).getByRole('button',{name:'Notifications',exact:true});
 await expect(row).toContainText('On');
 await expect(current(page).getByRole('button',{name:'Developer',exact:true})).toHaveCount(0);
 await expect(current(page).getByRole('button',{name:'Notifications from other apps',exact:true})).toHaveCount(0);
 for(const label of ['About','Calendars','Passwords']){
  await openSettings(page);
  await current(page).getByRole('button',{name:label,exact:true}).first().click();
  await expect(page.getByRole('button',{name:'Back to Settings',exact:true})).toBeVisible();
  const text=await current(page).innerText();
  report.push(`${label}: ${text.replace(/\s+/g,' ')}`);
  noFixtures(text,label);
  if(label==='Calendars')expect(text).not.toMatch(/Display only|Agent access is reviewed separately/);
 }
 // In-app alerts are this app's own setting, changed in its dialog and read back.
 await openSettings(page);
 await row.click();
 const dialog=page.getByRole('dialog',{name:'Alpha notifications',exact:true});
 await expect(dialog.getByRole('checkbox',{name:'Show Alpha notifications',exact:true})).toBeChecked();
 await dialog.getByRole('checkbox',{name:'Show Alpha notifications',exact:true}).uncheck();
 await dialog.getByRole('button',{name:'Done',exact:true}).click();
 await expect(dialog).toHaveCount(0);
 await expect(row).toContainText('Off');
 await test.info().attach('browser-settings-rows',{body:report.join('\n\n'),contentType:'text/plain'});
 const about=report.find(row=>row.startsWith('About: '))||'';
 expect(about).not.toMatch(/Updates|Alpha does not check for updates|Runtime|Check for updates/);
 expect(about).not.toContain('Installed or last updated');
 // The browser build is the standalone app: no Alpha shade, no tiles and no notifications button (#416, #417).
 await page.goto('/');
 await page.getByRole('button',{name:'Settings',exact:true}).waitFor({state:'visible'});
 await expect(page.locator('html')).toHaveAttribute('data-active-view','home');
 await expect(alphaShade(page)).toHaveCount(0);
 await expect(page.locator('[data-alpha-shade-handle]')).toHaveCount(0);
 await drag(page,{x:206,y:420},240);
 await expect(alphaShade(page)).toHaveCount(0);
 expect(await page.locator('[aria-pressed]').evaluateAll(list=>list.map(e=>e.getAttribute('aria-label')))).toEqual([]);
});

test('Settings › Eliza Cloud account & plan reports the verified plan and opens explicit code entry',async({page})=>{
 await nativeStub(page,{credits:'0'});
 await openSettings(page);
 await openCloudPlanFromSettings(page);
 const plan=current(page);
 await expect(plan.getByText('synthetic-settings@example.invalid',{exact:true})).toBeVisible();
 await expect(plan.getByText('Plus',{exact:true})).toBeVisible();
 await plan.getByRole('button',{name:'Redeem code',exact:true}).click();
 // On the phone's own agent Redeem code opens the resident account & plan panel at the code field of
 // its Subscription controls.
 const account=page.getByRole('dialog',{name:'Eliza Cloud account & plan',exact:true});
 const credits=account.getByRole('region',{name:'Subscription',exact:true});
 await expect(credits.getByRole('textbox',{name:'Membership code',exact:true})).toBeFocused();
 // Owner decision (2026-10-30): the plan sheet shows only account, plan and billing. Agent status,
 // conversation history and phone-action receipts stay in Settings › Agent connection.
 await expect(account.getByRole('region',{name:'Agent status',exact:true})).toHaveCount(0);
 for(const text of ['Running on this device','Reconnect agent','Conversation history','Phone action history'])await expect(account).not.toContainText(text);
 // The active subscription remains visible at zero balance; account cash and top-up controls stay hidden.
 await expect(credits.getByText('Plus',{exact:true})).toHaveCount(1);
 await expect(credits.getByRole('button',{name:'Manage subscription',exact:true})).toBeVisible();
 await expect(account).not.toContainText(/Available credits|Add credits|\$\d/);
 await expect(account.locator('.alpha-membership-amount')).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).truth.calls.filter((c:any)=>c.plugin==='AlphaConnection'&&c.method==='request'&&new URL(c.input.url).pathname==='/api/v1/subscription/redeem').length)).toBe(0);
 expect(await page.evaluate(()=>(window as any).truth.calls.some((c:any)=>c.plugin==='AlphaConnection'&&c.method==='request'&&new URL(c.input.url).pathname==='/api/v1/credits/balance'))).toBe(false);
});

for(const subscription of ['credits','active','canceled'] as const)test(`Settings redemption matches ${subscription} account controls`,async({page})=>{
 await nativeStub(page,{subscription});
 await page.goto('/');
 // Plan admission does not open an automatic account sheet.
 await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0);
 const notice=page.getByRole('region',{name:'Eliza Cloud plan notice',exact:true});
 if(subscription==='canceled')await expect(notice).toBeVisible();
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await expect(notice).toBeHidden();
 await openCloudPlanFromSettings(page);
 const plan=current(page),redeem=plan.getByRole('button',{name:'Redeem code',exact:true});
 if(subscription==='credits'){
  await expect(plan.getByText('No active subscription',{exact:true})).toBeVisible();
  await expect(plan.getByRole('button',{name:'Manage plan',exact:true})).toBeVisible();
 }
 // Legacy credit admission does not hide the subscription choices or explicit membership-code entry.
 await expect(redeem).toBeVisible();await redeem.click();
 await expect(page.getByLabel('Membership code',{exact:true})).toBeVisible();
 await expect(page.getByRole('dialog',{name:'Eliza Cloud account & plan',exact:true}).getByRole('region',{name:'Subscription',exact:true}).getByRole('button',{name:'Redeem',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).truth.calls.filter((c:any)=>c.plugin==='AlphaConnection'&&c.method==='request'&&new URL(c.input.url).pathname==='/api/v1/subscription/redeem').length)).toBe(0);
});

test('the flag-off Problem log renders and exports finite inference facts without provider content',async({page})=>{
 await nativeStub(page);
 await page.addInitScript(()=>{
  const at=Date.now();localStorage.setItem('alpha.crash-log.v1',JSON.stringify({version:1,entries:[{at,source:'inference',inference:{version:1,at,stage:'response-handler',status:400,reason:'unsupported-schema-keyword',parameter:'tools',keyword:'pattern',strictTools:['HANDLE_RESPONSE','private-tool-sentinel'],schemaKeywords:['pattern'],schemaScanTruncated:false,schemaDepth:4,schemaProperties:20,schemaEnumValues:30,schemaTextChars:120,message:'private-provider-message-sentinel',prompt:'private-note-sentinel',token:'private-token-sentinel'}}]}));
 });
 await openSettings(page);await current(page).getByRole('button',{name:'About',exact:true}).click();
 await current(page).getByRole('button',{name:'Problem log',exact:true}).click();
 await expect(current(page)).toContainText('Cloud AI request failed');await expect(current(page)).toContainText('HTTP 400');await expect(current(page)).toContainText('pattern');await expect(current(page)).toContainText('Properties 20');
 await expect(current(page).getByRole('button',{name:'Export diagnostics',exact:true})).toBeVisible();
 for(const value of ['private-provider-message-sentinel','private-note-sentinel','private-token-sentinel','private-tool-sentinel'])await expect(current(page)).not.toContainText(value);
 await page.screenshot({path:'test-results/inference-problem-log-render.png'});
 await current(page).getByRole('button',{name:'Export diagnostics',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).truth.shared.length)).toBe(1);
 const shared=await page.evaluate(()=>(window as any).truth.shared[0] as string);expect(JSON.parse(shared).crashes.recent[0].source).toBe('inference');
 for(const value of ['private-provider-message-sentinel','private-note-sentinel','private-token-sentinel','private-tool-sentinel'])expect(shared).not.toContain(value);
 page.once('dialog',dialog=>void dialog.accept());await current(page).getByRole('button',{name:'Clear problem log',exact:true}).click();await expect(current(page)).not.toContainText('Cloud AI request failed');await expect(current(page)).toContainText('No problems recorded');
 await current(page).getByRole('button',{name:'Back to About',exact:true}).click();await expect(current(page)).not.toContainText('Cloud AI request failed');await current(page).getByRole('button',{name:'Back to Settings',exact:true}).click();await expect(current(page).getByRole('button',{name:'About',exact:true})).toBeVisible();
});

// Rendered production Settings; only native transport and Cloud responses are finite fixtures.
for(const scenario of ['unbound','recovering','connected'] as const)test(`Cloud plan agent execution location is truthful: ${scenario}`,async({page})=>{
 await nativeStub(page,scenario==='unbound'?{subscription:'canceled'}:{subscription:'credits',agentStartFailure:scenario==='recovering'});
 await page.goto('/');
 if(scenario==='recovering'){
  await expect.poll(()=>page.evaluate(()=>(window as any).truth.calls.some((call:any)=>call.plugin==='Agent'&&call.method==='start'))).toBe(true);
  const close=page.getByRole('button',{name:'Close connection settings',exact:true});if(await close.isVisible())await close.click();
 }
 await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0);
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await openCloudPlanFromSettings(page);
 const plan=current(page);
 await expect(plan).not.toContainText('Running on this phone',{timeout:1000});
 await expect(plan).toContainText('Agent execution');
 await expect(plan.getByText(scenario==='recovering'?'Not connected':'On this device',{exact:true})).toBeVisible();
 await expect(plan).not.toContainText('On this computer');
 if(scenario==='connected')await expect(plan.getByText('Eliza Cloud',{exact:true})).toBeVisible();
});

test.beforeEach(async({page})=>seedCompletedAccessSetup(page));
