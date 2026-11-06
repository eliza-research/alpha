import {seedCompletedAccessSetup} from './flag-off-android';
import {writeFileSync} from 'node:fs';
import {test,expect,type Page} from '@playwright/test';
// Production lane only: the flag-off bundle that the APKs package, with only the Android IPC
// boundary replaced. These prove what the shipped renderer reads, shows and sends. They do not
// prove what a phone's Android Settings does; device qualification of each handoff is separate.
test.describe.configure({timeout:240_000});
test.beforeEach(async({},testInfo)=>{test.skip(testInfo.project.name!=='production','Production lane only (flag-off build)');});

type Fixture={snapshot?:Record<string,unknown>;drop?:string[];subscription?:'credits'|'active'|'canceled';agentStartFailure?:boolean};
async function nativeStub(page:Page,fixture:Fixture={}){
 await page.addInitScript(({snapshot,drop,subscription,agentStartFailure})=>{
  const w=window as any;w.androidBridge={};
  localStorage.setItem('alpha.startup-permissions.v1',JSON.stringify({dismissed:true,attempted:{}}));
  const now=Date.now(),store=new Map<string,string>();
  // A signed-in phone with finite Cloud identity and plan answers. No real key or provider is used.
  const credentialId='5c1f2a9e-3b4d-4e6f-8a7b-9c0d1e2f3a4b';
  store.set('cloud:production',JSON.stringify({token:'synthetic-settings-key',credentialId,expiresAt:now+60*24*3600_000}));
  try{localStorage.setItem('alpha.connection.plan-admission.v1',JSON.stringify({version:1,environment:'production',credentialId,userId:'9f1dc45a-4011-4e44-947a-30d999d24fa5',organizationId:null,status:'active',planName:'Synthetic plan',verifiedAt:now,endsAt:null}));}catch{/* covered elsewhere */}
  const listeners:Array<{plugin:string;event:string;callback:(value:unknown)=>void}>=[];
  const state={
   // Android's answers. Tests change these, then resume, to prove the renderer reads them again.
   snapshot:{readAt:now,model:'Stub phone',manufacturer:'Stub maker',appVersion:'0.1.0',appVersionCode:7,appUpdatedAt:Date.UTC(2026,8,1),androidRelease:'16',build:'stub-build',securityPatch:'2026-09-05',
    permissions:{Microphone:true,Location:false,Camera:false,Calendar:true},locationAccess:'denied',batteryPercent:64,charging:false,powerSave:false,
    wifiActive:true,cellularActive:false,wifiEnabled:true,bluetoothEnabled:false,airplaneMode:false,locationEnabled:true,mobileDataEnabled:true,interruptionFilter:'all',adaptiveBrightness:true,textScalePercent:100,...snapshot} as Record<string,unknown>,
   status:{permissionGranted:true,appEnabled:true,interruption:'all',scope:'alpha-phone',channels:[{id:'c-reminders',name:'Reminders',importance:4,blocked:false,groupBlocked:false},{id:'c-results',name:'Scheduled digest results',importance:3,blocked:false,groupBlocked:false}]} as Record<string,any>,
   cross:{revision:'r1',enabled:false,paused:false,accessGranted:false,connected:false,history:true,apps:[]} as Record<string,unknown>,
   history:[{appLabel:'Stub Mail',state:'posted',at:now-60_000}] as unknown[],
   items:[] as unknown[],openFails:false,unspecific:[] as string[],unavailable:[] as string[],torch:true,shadeOutcome:'opened' as string,
  };
  for(const key of drop)delete state.snapshot[key];
  w.truth={calls:[] as any[],shared:[] as string[],state,resume:()=>listeners.filter(l=>l.plugin==='DailyApps'&&l.event==='appResumed').forEach(l=>l.callback({}))};
  const methods=(names:string[])=>names.map(name=>({name,rtype:'promise'}));
  w.Capacitor={
   PluginHeaders:[
        { name: 'AlphaDeletions', methods: methods(['pending']) },
    {name:'AlphaNotifications',methods:methods(['pendingWorkflowTap','status','crossAppStatus','notificationHistory','list','open','dismiss','clear','openChannelSettings','openAppSettings','addListener','removeListener'])},
    {name:'AlphaVoiceCloud',methods:methods(['checkPermissions'])},
    {name:'Agent',methods:methods(['getStatus','start','stop','providerStatus','configureCloudProvider','clearProvider','request'])},
    {name:'AlphaConnection',methods:methods(['secureRead','secureWrite','secureCompareExchange','secureRemove','request','cancel','addListener','removeListener'])},
    {name:'DeviceApps',methods:methods(['buildInfo'])},
    {name:'ElizaSystem',methods:methods(['getStatus','requestRole','getDeviceSettings','setFlashlight'])},
    {name:'AlphaDevice',methods:methods(['snapshot','crashLog','clearCrashLog','recordRendererFailure','diagnosticsFacts','shareDiagnostics','openSettings','openNotificationShade'])},
    {name:'DailyApps',methods:[{name:'addListener',rtype:'callback'},{name:'removeListener',rtype:'callback'}]},
   ],
   nativeCallback:(plugin:string,method:string,options:any,callback:(value:unknown)=>void)=>{if(method==='addListener'){listeners.push({plugin,event:options?.eventName,callback});return String(listeners.length);}return '0';},
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
     if(agentStartFailure&&method==='start')throw Error('Synthetic resident startup failure');
     if(method==='request'){const id='9f1dc45a-4011-4e44-947a-30d999d24fa5';return {status:200,body:JSON.stringify(input.path==='/api/auth/me'?{identity:{id,kind:'owner'},access:{role:'OWNER',mode:'local'}}:input.path==='/api/agents'?{agents:[{id,name:'Alpha',status:'running'}]}:input.path==='/api/conversations'?{conversations:[]}:{} )};}
     return method==='providerStatus'?{configured:false}:{packaged:true,state:'stopped',serviceActive:false,socketListening:false};
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
      if(path==='/api/v1/billing/limits')return {status:200,data:{success:true,data:{schemaVersion:2,v2:{subscription:subscription==='credits'?{status:'not_applicable',reason:'no_organization_subscription'}:{status:'available',value:{planKey:'plus_monthly',state:subscription||'active',currentPeriodEnd:'2099-01-01T00:00:00.000Z'}}}}}};
      return {status:404,data:{}};
     }
     return {};
    }
    if(plugin==='DeviceApps')return {launcher:true,version:'0.1.0'};
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
 },{snapshot:fixture.snapshot??{},drop:fixture.drop??[],subscription:fixture.subscription,agentStartFailure:fixture.agentStartFailure});
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
 if(await page.evaluate(()=>!!(window as any).truth))await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0);
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
const fixtureValues=['you@gmail.example','you@alpha.example','Alpha Home','Studio 5G','Ritual Coffee','Neighbors_2.4','Pixel Buds Pro 2','Keyboard K3','Kitchen Speaker','Vision 2B','Core 7B','elizaOS 2.1','AC1.260915','Alpha Compute phone','Powered by elizaOS','Alpha Mobile','3.2 of 20 GB','2,418 items','About 1 day','Redaction on','Redaction receipt','Enclave lock','Memory wiped','Wipe memory','Up to date','Check for updates','Cloud fallback','Charge to 80%','Verbose logs','Agent summaries','Last sync','Export logs','Logs saved','Pair new device','Tap to pair','Hey Alpha','Speak replies','Proactive briefings','Roaming','This month','Device uptime','NPU'];
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

test('Android-owned settings are one named handoff each, and a refused page says so',async({page})=>{
 await nativeStub(page);
 await openSettings(page);
 // Radios, sound, battery and display belong to Android: one row opens its Settings.
 for(const gone of ['Wi-Fi','Bluetooth','Mobile data','Battery','Sound & vibration','Display'])await expect(current(page).getByRole('button',{name:gone,exact:true})).toHaveCount(0);
 const handoffs:Array<[string,string]>=[['Android settings','system'],['App permissions','privacy'],['Notifications','notifications']];
 for(const [row,target] of handoffs){
  const before=(await opened(page)).length;
  await current(page).getByRole('button',{name:row,exact:true}).click();
  await expect.poll(async()=>(await opened(page)).slice(before),row).toEqual([target]);
 }
 // Location and Camera are off in the stub: the summary counts them.
 await expect(current(page).getByRole('button',{name:'App permissions',exact:true})).toContainText('2 not allowed');
 await set(page,{unavailable:['system']});
 await current(page).getByRole('button',{name:'Android settings',exact:true}).click();
 await expect(page.getByText('This Android settings page is unavailable.',{exact:true})).toBeVisible();
 await current(page).getByRole('button',{name:'About',exact:true}).click();
 const about=await current(page).innerText();
 expect(about).toMatch(/Alpha Phone\s*0\.1\.0 \(7\)/);
 expect(about).not.toMatch(/Updates|Installed or last updated|Security patch|Inference model/);
});

test('every Settings row is a control backed by real state, with no fixture value',async({page})=>{
 page.on('dialog',dialog=>void dialog.dismiss());
 await nativeStub(page);
 await openSettings(page);
 const top=await current(page).innerText();
 noFixtures(top,'Settings');
 await expect(current(page).getByRole('button',{name:'Developer',exact:true})).toHaveCount(0);
 for(const [label,value] of [['Eliza Cloud','Plus'],['Notifications','On'],['About','0.1.0 (7)']] as const)await expect(current(page).getByRole('button',{name:label,exact:true})).toContainText(value);
 // Every switch is app-owned state.
 const switches=await current(page).locator('[role="switch"],[aria-pressed],[aria-checked],input[type="checkbox"],input[type="range"]').evaluateAll(list=>list.map(e=>e.getAttribute('aria-label')||e.textContent?.trim()||e.tagName));
 expect(switches.filter(name=>!['Ask before acting','Load images in email','Theme: System','Theme: Light','Theme: Dark','Text size'].includes(name))).toEqual([]);
 // No row only states a fact: each one opens, changes or hands off something.
 const report:string[]=[`Settings: ${top.replace(/\s+/g,' ')}`];
 for(const label of ['Calendars','Passwords','About','Notifications from other apps','Agent']){
  await openSettings(page);
  await current(page).getByRole('button',{name:label,exact:true}).click();
  await expect(page.getByRole('button',{name:'Back to Settings',exact:true})).toBeVisible();
  const text=await current(page).innerText();report.push(`${label}: ${text.replace(/\s+/g,' ')}`);
  noFixtures(text,label);
  expect(text,label).not.toMatch(/Not reported by agent|Managed by your agent|Not available in this version/);
 }
 await test.info().attach('settings-rows',{body:report.join('\n\n'),contentType:'text/plain'});
 writeFileSync(test.info().outputPath('settings-rows.txt'),report.join('\n\n'));
 // The email image switch persists both ways across a reload.
 await openSettings(page);
 const images=()=>current(page).getByRole('button',{name:'Load images in email',exact:true});
 await expect(images()).toHaveAttribute('aria-pressed','true');
 await images().click();await expect(images()).toHaveAttribute('aria-pressed','false');
 await openSettings(page);await expect(images()).toHaveAttribute('aria-pressed','false');
 await images().click();await expect(images()).toHaveAttribute('aria-pressed','true');
 expect((await callNames(page)).filter(name=>/\.set(?!Flashlight)|\.perform$/i.test(name))).toEqual([]);
});

test('the owned email image preference persists off and on across production reloads',async({page})=>{
 await nativeStub(page);
 // Settings › Apps holds the switch directly; the Connections page no longer exists.
 const images=()=>current(page).getByRole('button',{name:'Load images in email',exact:true});
 await openSettings(page);await expect(images()).toHaveAttribute('aria-pressed','true');
 await images().click();await expect(images()).toHaveAttribute('aria-pressed','false');
 // openSettings navigates afresh: this checks the durable document, not the prior renderer cache.
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
 // Errors are toasts, not rows (docs/ui-refresh-2026-11): the switch shows off and says why on use.
 await expect(images).toHaveAttribute('aria-pressed','false');await images.click();
 await expect(page.getByText('Preference unavailable. Reopen Settings to try again.',{exact:true})).toBeVisible();
 await expect(images).toHaveAttribute('aria-pressed','false');
 expect(await page.evaluate(()=>localStorage.getItem('alpha.browser.device.v1'))).toBe('{damaged settings');
});

test('notification state is read back from Android, and local history stays available',async({page})=>{
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
 await set(page,{status:{appEnabled:false}});
 await resume(page);
 await expect(row).toContainText('Off');
 // Android cannot be read: no state is claimed.
 await page.evaluate(()=>{const truth=(window as any).truth,original=(window as any).Capacitor.nativePromise;(window as any).Capacitor.nativePromise=async(plugin:string,method:string,input:unknown)=>{if(plugin==='AlphaNotifications'&&method==='status'){truth.calls.push({plugin,method,input});throw Error('Notification delivery status unavailable');}return original(plugin,method,input);};});
 await resume(page);
 await expect.poll(async()=>(await row.innerText()).replace(/\s+/g,' ').trim()).toBe('Notifications');
 // Retained history does not depend on delivery: it is still listed.
 await current(page).getByRole('button',{name:'Notifications from other apps',exact:true}).click();
 await current(page).getByRole('button',{name:'Show history',exact:true}).click();
 await expect(current(page)).toContainText(/Stub Mail · posted/);
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
 expect(Object.keys(report).sort()).toEqual(['app','cloudPlan','connection','crashes','format','generatedAt','nativeVoiceTiming','os','permissions','platform','roles','runtimeHashes','upstreamPin','voiceTiming']);
 expect(report.cloudPlan).toEqual({view:'active',admission:'admit',source:'billing-limits',status:'active'});
 for(const leak of ['csk-synthetic','synthetic-settings-key','synthetic-settings@example.invalid','9f1dc45a-4011-4e44-947a-30d999d24fa5','5c1f2a9e-3b4d-4e6f-8a7b-9c0d1e2f3a4b','Stub phone','Stub maker','stub-build','Stub Mail','update','Update'])expect(shared).not.toContain(leak);
});

test('the browser build of Settings shows no fixture value and no radio or sensor switch',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await openSettings(page);
 const report:string[]=[`Settings: ${(await current(page).innerText()).replace(/\s+/g,' ')}`];
 noFixtures(report[0],'Settings');
 expect(report[0]).not.toMatch(/Wi-Fi|Bluetooth|Airplane mode|Battery|Android settings|App permissions|Passwords/);
 await expect(current(page).getByRole('button',{name:'Developer',exact:true})).toHaveCount(0);
 const alerts=current(page).getByRole('button',{name:'In-app alerts',exact:true});
 await expect(alerts).toContainText('On');
 await alerts.click();
 const dialog=page.getByRole('dialog',{name:'Alpha notifications',exact:true});
 await expect(dialog.getByRole('checkbox',{name:'Show Alpha notifications',exact:true})).toBeChecked();
 await dialog.getByRole('checkbox',{name:'Show Alpha notifications',exact:true}).uncheck();
 await dialog.getByRole('button',{name:'Done',exact:true}).click();
 await expect(dialog).toHaveCount(0);
 await expect(alerts).toContainText('Off');
 for(const label of ['Calendars','About']){
  await openSettings(page);
  await current(page).getByRole('button',{name:label,exact:true}).click();
  await expect(page.getByRole('button',{name:'Back to Settings',exact:true})).toBeVisible();
  const text=await current(page).innerText();
  report.push(`${label}: ${text.replace(/\s+/g,' ')}`);
  noFixtures(text,label);
 }
 await test.info().attach('browser-settings-rows',{body:report.join('\n\n'),contentType:'text/plain'});
 const about=report.find(row=>row.startsWith('About: '))||'';
 expect(about).not.toMatch(/Updates|Installed or last updated/);
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

test('Settings › Eliza Cloud reports the verified plan without asking an admitted account for a code',async({page})=>{
 await nativeStub(page);
 await openSettings(page);
 const row=current(page).getByRole('button',{name:'Eliza Cloud',exact:true});
 await expect(row).toContainText('Plus');await row.click();
 const plan=current(page);
 await expect(plan.getByText('synthetic-settings@example.invalid',{exact:true})).toBeVisible();
 await expect(plan).toContainText('Plus');
 await expect(plan.getByRole('button',{name:'Sign out',exact:true})).toBeVisible();
 await expect(plan.getByRole('button',{name:'Redeem code',exact:true})).toHaveCount(0);
 await expect(plan.getByRole('button',{name:'Manage plan',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).truth.calls.filter((c:any)=>c.plugin==='AlphaConnection'&&c.method==='request'&&new URL(c.input.url).pathname==='/api/v1/subscription/redeem').length)).toBe(0);
});

for(const subscription of ['credits','active','canceled'] as const)test(`Settings redemption matches ${subscription} account controls`,async({page})=>{
 await nativeStub(page,{subscription});
 await page.goto('/');
 // Plan admission does not open an automatic account sheet.
 await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0);
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await current(page).getByRole('button',{name:'Eliza Cloud',exact:true}).click();
 const plan=current(page),redeem=plan.getByRole('button',{name:'Redeem code',exact:true});
 if(subscription!=='canceled'){
  // An account Cloud admitted (credits or an active plan) is not asked for a code.
  if(subscription==='credits')await expect(plan).toContainText('Eliza Cloud credits');
  await expect(redeem).toHaveCount(0);
  await expect(plan.getByRole('button',{name:'Manage plan',exact:true})).toBeVisible();
 }else{
  // The plan notice banner can sit over the top rows; activate by keyboard as assistive technology would.
  await expect(redeem).toBeVisible();await redeem.focus();await redeem.press('Enter');
  await expect(page.getByLabel('Subscription code',{exact:true})).toBeVisible();
  await expect(page.getByRole('dialog',{name:'Eliza Cloud account & plan',exact:true}).getByRole('button',{name:'Redeem code',exact:true})).toBeVisible();
 }
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
 for(const value of ['private-provider-message-sentinel','private-note-sentinel','private-token-sentinel','private-tool-sentinel'])await expect(current(page)).not.toContainText(value);
 await page.screenshot({path:'test-results/inference-problem-log-render.png'});
 // Export lives on About, one level up.
 await current(page).getByRole('button',{name:'Back to About',exact:true}).click();
 await current(page).getByRole('button',{name:'Export diagnostics',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).truth.shared.length)).toBe(1);
 const shared=await page.evaluate(()=>(window as any).truth.shared[0] as string);expect(JSON.parse(shared).crashes.recent[0].source).toBe('inference');
 for(const value of ['private-provider-message-sentinel','private-note-sentinel','private-token-sentinel','private-tool-sentinel'])expect(shared).not.toContain(value);
 await current(page).getByRole('button',{name:'Problem log',exact:true}).click();
 page.once('dialog',dialog=>void dialog.accept());await current(page).getByRole('button',{name:'Clear problem log',exact:true}).click();await expect(current(page)).not.toContainText('Cloud AI request failed');await expect(current(page)).toContainText('No problems recorded');
 await current(page).getByRole('button',{name:'Back to About',exact:true}).click();await current(page).getByRole('button',{name:'Back to Settings',exact:true}).click();await expect(current(page)).not.toContainText('Cloud AI request failed');await expect(current(page).getByRole('button',{name:'About',exact:true})).toBeVisible();
});

// Rendered production Settings; only native transport and Cloud responses are finite fixtures.
for(const scenario of ['unbound','recovering','connected'] as const)test(`Agent status is truthful: ${scenario}`,async({page})=>{
 await nativeStub(page,scenario==='unbound'?{subscription:'canceled'}:{subscription:'credits',agentStartFailure:scenario==='recovering'});
 await page.goto('/');
 if(scenario==='recovering'){
  await expect.poll(()=>page.evaluate(()=>(window as any).truth.calls.some((call:any)=>call.plugin==='Agent'&&call.method==='start'))).toBe(true);
  const close=page.getByRole('button',{name:'Close connection settings',exact:true});if(await close.isVisible())await close.click();
 }
 await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0);
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 const row=current(page).getByRole('button',{name:'Agent',exact:true});
 if(scenario==='recovering')await expect(row).not.toContainText('Running');
 await row.click();
 const agent=current(page);
 await expect(agent).not.toContainText('On this computer');
 await expect(agent).not.toContainText('Running on this phone');
 if(scenario==='recovering')await expect(agent).not.toContainText('Running on this device');
 if(scenario==='connected')await expect(agent).toContainText('AI: Eliza Cloud');
});

test.beforeEach(async({page})=>seedCompletedAccessSetup(page));
