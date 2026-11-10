import {openCloudPlanFromSettings} from './helpers/cloud-plan-settings';
import {seedCompletedAccessSetup} from './flag-off-android';
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
   status:{permissionGranted:true,appEnabled:true,interruption:'all',scope:'alpha-phone',channels:[{id:'c-reminders',name:'Reminders',importance:4,blocked:false,groupBlocked:false},{id:'c-results',name:'Daily briefs',importance:3,blocked:false,groupBlocked:false}]} as Record<string,any>,
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
     if(method==='getStatus')return {packageName:'ai.alphacompute.alphaphone',roles:['home','assistant'].map(role=>({role,androidRole:'android.app.role.'+role.toUpperCase(),available:true,held:false,holders:[]}))};
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
async function openSettings(page:Page,...route:string[]){
 await start(page);
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await expect(page.locator('html')).toHaveAttribute('data-active-view','settings');
 for(const label of route)await current(page).getByRole('button',{name:label,exact:true}).click();
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

test('Android permission and notification handoffs use their displayed controls and report refusal',async({page})=>{
 await nativeStub(page);
 await openSettings(page,'Privacy','App permissions');
 await expect(current(page).getByRole('button',{name:'Location',exact:true})).toContainText('Not allowed');
 await expect(current(page).getByRole('button',{name:'Camera',exact:true})).toContainText('Not allowed');
 const privacy=(await opened(page)).length;
 await current(page).getByRole('button',{name:'Location',exact:true}).click();
 await expect.poll(async()=>(await opened(page)).slice(privacy)).toEqual(['privacy']);
 await set(page,{unavailable:['privacy']});await current(page).getByRole('button',{name:'Location',exact:true}).click();
 await expect(page.getByText('This Android settings page is unavailable.',{exact:true})).toBeVisible();
 await openSettings(page,'General','Notifications');
 await current(page).getByRole('button',{name:'Manage Alpha notifications',exact:true}).click();
 await expect.poll(()=>opened(page)).toEqual(['notifications']);
 await openSettings(page,'About');
 await expect(current(page)).toContainText('0.1.0 (7)');
 await expect(current(page)).not.toContainText('Security patch');
});

test('every Settings row is a control backed by real state, with no fixture value',async({page})=>{
 await nativeStub(page);
 for(const route of [[],['General'],['Privacy'],['Apps'],['About'],['Account']]){
  await openSettings(page,...route);noFixtures(await current(page).innerText(),route.join(' > ')||'Settings');
  await expect(current(page).getByRole('button',{name:'Developer',exact:true})).toHaveCount(0);
 }
 await openSettings(page,'Privacy');
 const review=()=>current(page).getByRole('button',{name:'Ask before taking actions',exact:true});
 await expect(review()).toHaveAttribute('aria-pressed','false');
 await review().click();await expect(review()).toHaveAttribute('aria-pressed','true');
 await openSettings(page,'Privacy');await expect(review()).toHaveAttribute('aria-pressed','true');
 await review().click();await expect(review()).toHaveAttribute('aria-pressed','false');
 expect((await callNames(page)).filter(name=>/\.set(?!Flashlight)|\.perform$/i.test(name))).toEqual([]);
});





test('an unreadable action preference keeps review enabled and offers recovery without overwriting data',async({page})=>{
 await nativeStub(page);
 await page.addInitScript(()=>localStorage.setItem('alpha.browser.device.v1','{damaged settings'));
 await openSettings(page,'Privacy');
 const review=current(page).getByRole('button',{name:'Ask before taking actions',exact:true});
 await expect(review).toHaveAttribute('aria-pressed','true');await expect(review).toBeDisabled();
 await expect(current(page)).toContainText('Unavailable. Alpha asks before every action.');
 await openSettings(page,'General');
 await current(page).getByRole('button',{name:'Recover device settings',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Device settings recovery'})).toBeVisible();
 expect(await page.evaluate(()=>localStorage.getItem('alpha.browser.device.v1'))).toBe('{damaged settings');
});


test('notification state is read back from Android, and local history stays available',async({page})=>{
 await nativeStub(page);
 await openSettings(page,'General','Notifications');
 const state=current(page).getByText('Alpha notifications',{exact:true}).locator('..');
 await expect(state).toContainText('On');
 await page.evaluate(()=>{(window as any).truth.state.status.channels[0].blocked=true;(window as any).truth.state.status.channels[0].importance=0;});
 await expect(state).not.toContainText('Some channels blocked');await resume(page);
 await expect(state).toContainText('Some channels blocked');
 await set(page,{status:{appEnabled:false}});await resume(page);await expect(state).toContainText('App notifications off');
 await current(page).getByRole('button',{name:'View local metadata history',exact:true}).click();
 await expect(current(page)).toContainText(/Stub Mail\s*posted/);
 await page.evaluate(()=>{const truth=(window as any).truth,original=(window as any).Capacitor.nativePromise;(window as any).Capacitor.nativePromise=async(plugin:string,method:string,input:unknown)=>{if(plugin==='AlphaNotifications'&&method==='status'){truth.calls.push({plugin,method,input});throw Error('Notification delivery status unavailable');}return original(plugin,method,input);};});
 await resume(page);await expect(state).toContainText('Unavailable');
});



test('the browser build of Settings shows no fixture value and no radio or sensor switch',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await openSettings(page);noFixtures(await current(page).innerText(),'Settings');
 for(const name of ['Wi-Fi','Bluetooth','Airplane mode','Battery','Android settings'])await expect(current(page).getByRole('button',{name,exact:true})).toHaveCount(0);
 await openSettings(page,'General','Notifications');
 const allow=current(page).getByRole('button',{name:'Allow alerts',exact:true});
 await expect(allow).toHaveAttribute('aria-pressed','true');await allow.click();await expect(allow).toHaveAttribute('aria-pressed','false');
 await openSettings(page,'About');
 for(const name of ['Problem log','Export diagnostics'])await expect(current(page).getByRole('button',{name,exact:true})).toHaveCount(0);
 await expect(current(page).getByRole('button',{name:'Open source licenses',exact:true})).toBeVisible();
 await page.goto('/');await page.getByRole('button',{name:'Settings',exact:true}).waitFor({state:'visible'});
 await expect(alphaShade(page)).toHaveCount(0);await expect(page.locator('[data-alpha-shade-handle]')).toHaveCount(0);
 await drag(page,{x:206,y:420},240);await expect(alphaShade(page)).toHaveCount(0);
});

test('Settings › Eliza Cloud reports the verified plan without automatically opening code entry',async({page})=>{
 await nativeStub(page);
 await openSettings(page);
 await openCloudPlanFromSettings(page);
 const plan=current(page);
 await expect(plan.getByText('synthetic-settings@example.invalid',{exact:true})).toBeVisible();
 await expect(plan).toContainText('Plus');
 await expect(plan.getByRole('button',{name:'Sign out of Eliza Cloud',exact:true})).toBeVisible();
 await expect(plan.getByRole('button',{name:'Redeem code',exact:true})).toBeVisible();
 await expect(page.getByLabel('Membership code',{exact:true})).toHaveCount(0);
 await expect(plan.getByRole('button',{name:'Manage plan',exact:true})).toBeVisible();
 const iconPaths=await Promise.all(['Redeem code','Manage plan','Sign out of Eliza Cloud'].map(name=>plan.getByRole('button',{name,exact:true}).locator('span[aria-hidden="true"]').first().getAttribute('style')));
 expect(new Set(iconPaths).size).toBe(3);
 await plan.getByRole('button',{name:'Sign out of Eliza Cloud',exact:true}).click();
 const signOut=page.getByRole('dialog',{name:'Sign out?',exact:true});await expect(signOut).toBeVisible();
 await signOut.getByRole('button',{name:'Cancel',exact:true}).click();await expect(signOut).toHaveCount(0);
 await expect(plan.getByText('synthetic-settings@example.invalid',{exact:true})).toBeVisible();

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
 await openCloudPlanFromSettings(page);
 const plan=current(page),redeem=plan.getByRole('button',{name:'Redeem code',exact:true});
 if(subscription==='credits')await expect(plan).toContainText('No active subscription');
 await expect(plan.getByRole('button',{name:'Manage plan',exact:true})).toBeVisible();
 await expect(page.getByLabel('Membership code',{exact:true})).toHaveCount(0);
 // A signed-in owner may open code entry without changing current plan admission.
 // Focus activation also works when the cancellation notice occupies the top edge.
 await expect(redeem).toBeVisible();await redeem.focus();await redeem.press('Enter');
 await expect(page.getByLabel('Membership code',{exact:true})).toBeVisible();
 await expect(page.getByRole('dialog',{name:'Eliza Cloud account & plan',exact:true}).getByRole('region',{name:'Subscription',exact:true}).getByRole('button',{name:'Redeem',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).truth.calls.filter((c:any)=>c.plugin==='AlphaConnection'&&c.method==='request'&&new URL(c.input.url).pathname==='/api/v1/subscription/redeem').length)).toBe(0);
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
 await openCloudPlanFromSettings(page);
 const account=current(page);await expect(account.getByText('AI connection',{exact:true})).toBeVisible();
 await expect(account).not.toContainText('On this computer');
 await expect(account).not.toContainText('Running on this phone');
 if(scenario==='recovering')await expect(account).not.toContainText('Running on this device');
 if(scenario==='connected')await expect(account).toContainText('Eliza Cloud');
});

test.beforeEach(async({page})=>seedCompletedAccessSetup(page));

test('a delayed browser permission read preserves the focused Settings action',async({page})=>{
 await seedCompletedAccessSetup(page);
 await page.addInitScript(()=>{
  localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));
  let release!:()=>void;
  const pending=new Promise<void>(resolve=>{release=resolve;});
  (window as any).releaseSettingsPermissions=release;
  Object.defineProperty(navigator,'permissions',{configurable:true,value:{
   query:async()=>{await pending;(window as any).settingsPermissionReads=((window as any).settingsPermissionReads||0)+1;return {state:'prompt',onchange:null,addEventListener(){},removeEventListener(){}};},
  }});
 });
 await page.goto('/');
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 const about=current(page).getByRole('button',{name:'About',exact:true});
 await expect(about).toBeVisible();
 await expect(current(page).getByRole('button',{name:'General',exact:true})).toBeVisible();
 await about.focus();
 await page.evaluate(()=>(window as any).releaseSettingsPermissions());
 await expect.poll(()=>page.evaluate(()=>(window as any).settingsPermissionReads||0)).toBeGreaterThan(0);
 await expect(about).toBeFocused();
 await about.press('Enter');
 await expect(page.getByRole('heading',{name:'About',exact:true})).toBeVisible();
});
