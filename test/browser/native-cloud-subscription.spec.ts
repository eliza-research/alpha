import {seedCompletedAccessSetup} from './flag-off-android';
import {test,expect,type Page} from '@playwright/test';
import {installResidentAgentPlugin} from './helpers/resident-agent-plugin';
import {completeAccessSetup} from './flag-off-android';
import {createServer,type ViteDevServer} from 'vite';
import {resolve} from 'node:path';
import {webcrypto} from 'node:crypto';

// Actual normal Android chooser/controller composition (flag-off build flags); only native ports are
// synthetic. No device, account, real code, provider, billing purchase, microphone or playback is
// used. Decision P-43: the on-device agent always runs; sign-in and plan state decide only whether
// Eliza Cloud inference is bound into it. Entitlements are signed here with a throwaway ES256 key; plan names, codes and allowance
// numbers are synthetic test data, not product prices, quotas or real grant codes.
let server:ViteDevServer,origin:string;
test.beforeAll(async()=>{
 const previous=process.env.ELIZA_DEV_ALLOW_TEST_MOCKS;process.env.ELIZA_DEV_ALLOW_TEST_MOCKS='';
 try{server=await createServer({configFile:resolve('vite.config.ts'),configLoader:'native',cacheDir:resolve('test-results/native-cloud-subscription/vite-cache'),server:{host:'127.0.0.1',port:0},define:{'import.meta.env.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS':JSON.stringify('')},plugins:[{name:'native-subscription-composition',resolveId(id){if(id==='/subscription-entry.tsx')return '\0subscription-entry';},load(id){if(id==='\0subscription-entry')return `
 import React,{useSyncExternalStore} from 'react';
 import {createRoot} from 'react-dom/client';
 import '/src/prototype/prototype.css';
 import {Capacitor} from '@capacitor/core';
 Capacitor.getPlatform=()=> 'android';Capacitor.isNativePlatform=()=>true;
 const {ConnectionChooser,connectionController,connectionChooserVisible}=await import('/src/runtime/connection-ui.tsx');
 const {StartupPermissions}=await import('/src/startup-permissions.tsx');
 const flags=await import('/src/build-flags.ts');window.planFlags={native:Capacitor.getPlatform(),mocks:flags.testMocksEnabled};
 window.planController=connectionController;
 document.body.insertAdjacentHTML('afterbegin','<div class="os" style="position:fixed;inset:0;background:var(--bg)" aria-hidden="true"></div>');
 function Composition(){const state=useSyncExternalStore(connectionController.subscribe,connectionController.getSnapshot);return React.createElement(React.Fragment,null,React.createElement(ConnectionChooser),!connectionChooserVisible(state)&&React.createElement(StartupPermissions));}
 createRoot(document.getElementById('root')).render(React.createElement(Composition));
 `;},configureServer(s){s.middlewares.use('/subscription-composition',async(_request,response)=>{response.setHeader('Content-Type','text/html');response.end(await s.transformIndexHtml('/subscription-composition','<div id="root"></div><script type="module" src="/subscription-entry.tsx"></script>'));});}}]});}finally{if(previous===undefined)delete process.env.ELIZA_DEV_ALLOW_TEST_MOCKS;else process.env.ELIZA_DEV_ALLOW_TEST_MOCKS=previous;}
 await server.listen();origin=`http://127.0.0.1:${(server.httpServer!.address()as {port:number}).port}`;
});
test.afterAll(async()=>{await server?.close();});

const USER='22222222-2222-4222-8222-222222222222';
const CREDENTIAL='11111111-1111-4111-8111-111111111111';
// Synthetic, never a real grant code. 16 Crockford characters once normalized.
const CODE='synt-hetc-0de0-0001',NORMALIZED='SYNTHETC0DE00001';
const b64=(bytes:Uint8Array)=>Buffer.from(bytes).toString('base64url');
async function signer(){
 const pair=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const jwk={...await webcrypto.subtle.exportKey('jwk',pair.publicKey),kid:'synthetic-key-1'};
 const sign=async(claims:Record<string,unknown>,kid='synthetic-key-1')=>{
  const input=`${b64(Buffer.from(JSON.stringify({alg:'ES256',typ:'eliza-entitlement+jwt',kid})))}.${b64(Buffer.from(JSON.stringify(claims)))}`;
  const signature=new Uint8Array(await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,Buffer.from(input)));
  return `${input}.${b64(signature)}`;
 };
 return {jwk,sign};
}
/** Tokens for every plan status, signed with one throwaway key. */
async function entitlements(overrides:Record<string,unknown>={}){
 const {jwk,sign}=await signer();const now=Math.floor(Date.now()/1000);
 const claims=(status:string)=>({iss:'https://api.eliza.app',aud:'eliza-alpha-phone',sub:USER,jti:'synthetic-entitlement-'+status,iat:now,exp:now+600,
  plan:{id:'synthetic-plan',name:'Synthetic plan',status},allowance:{unit:'requests',period:'month',limit:40,used:3},services:['inference'],...overrides});
 const tokens:Record<string,string>={};for(const status of ['active','trialing','past_due','canceled','none'])tokens[status]=await sign(claims(status));
 return {keys:[jwk],tokens};
}

type Fixture={plan?:string;route?:'signed'|'absent'|'503'|'401'|'offline';limits?:'active'|'none'|'canceled'|'absent'|'503';identity?:'ok'|'offline'|'401';
 redeem?:'ok'|'invalid'|'rate'|'already'|'transport-once';redeemPlan?:string;saved?:boolean;expiresAt?:number;holdProvider?:boolean;providerFailure?:string;cashBalance?:number;
 /** Exact USD organization credit balance in the billing snapshot (data.v2.balance); absent when unset. */
 credits?:string;storage?:Record<string,string>;fullApp?:boolean};
async function boot(page:Page,initial:Fixture&{tokens?:Record<string,string>;keys?:unknown[]}={}){
 page.on('pageerror',(error:Error)=>console.error('Composition page error:',error.message));
 await page.route('https://**',route=>route.abort());
 await installResidentAgentPlugin(page);
 await page.addInitScript(initial=>{
  const w=window as any;
  if(initial.fullApp)w.androidBridge={};
  if(!sessionStorage.getItem('plan-fixture-seeded')){sessionStorage.setItem('plan-fixture-seeded','1');for(const [key,value] of Object.entries(initial.storage||{}))localStorage.setItem(key,value as string);}
  const f=w.planFixture={plan:'active',route:'signed',limits:'absent',identity:'ok',redeem:'ok',redeemPlan:'active',saved:true,holdProvider:true,cashBalance:0,...initial,calls:[]as any[],bodies:[]as any[],releaseProvider:null as null|(()=>void)};
  const residentId='9f1dc45a-4011-4e44-947a-30d999d24fa5';
  const resident=w.residentAgent=w.createResidentAgentPlugin({owner:()=>residentId,agentId:residentId});
  const credential={credentialId:'11111111-1111-4111-8111-111111111111',token:'synthetic-plan-token',expiresAt:initial.expiresAt??Date.now()+60*24*3600*1000};
  const names={AlphaCloudSignIn:['status','startEmail','verifyEmail','cancel','addListener','removeListener'],AlphaConnection:['secureRead','secureWrite','secureRemove','request','cancel','openExternal','addListener','removeListener'],Agent:['stop','getStatus','configureCloudProvider','clearProvider','providerStatus','start','request'],AlphaHostedResults:['disableBackground','addListener','removeListener'],DailyApps:['addListener','removeListener'],AlphaNotifications:['status','addListener','removeListener'],AlphaVoiceCloud:['checkPermissions']};
  w.Capacitor={PluginHeaders:Object.entries(names).map(([name,methods])=>({name,methods:name==='Agent'?resident.methods(methods):methods.map(name=>({name,rtype:'promise'}))})),nativeCallback:resident.nativeCallback,nativePromise:async(plugin:string,method:string,input:any)=>{
   f.calls.push({plugin,method,path:input?.url?new URL(input.url).pathname:undefined,url:input?.url,httpMethod:input?.method});
   if(plugin==='AlphaCloudSignIn'){
    if(method==='status')return {active:false,inApp:true,email:true,google:false};
    if(method==='addListener'||method==='removeListener'||method==='cancel')return {};
    throw Error('Unexpected sign-in operation in plan fixture');
   }
   if(plugin==='Agent'){
    const owned=resident.answer(method,input);if(owned)return owned;
    if(method==='getStatus')return {packaged:true,state:'stopped',serviceActive:false,socketListening:false};
    if(method==='configureCloudProvider'){if(f.providerFailure)throw Error(f.providerFailure);if(f.holdProvider)await new Promise<void>(resolve=>f.releaseProvider=resolve);return {};}
    // Unbinding removes the stored provider; native confirms it (provider status reads unconfigured).
    if(method==='clearProvider')return {configured:false};
    if(method==='providerStatus')return {provider:'elizacloud',configured:false};
    // The always-running resident answers its owner and agent reads (P-43).
    if(method==='request'){const id=residentId;const body=input.path==='/api/auth/me'?{identity:{id,kind:'owner'},access:{role:'OWNER',mode:'local'}}:input.path==='/api/agents'?{agents:[{id,name:'Alpha',status:'running'}]}:input.path==='/api/conversations'?{conversations:[]}:{};return {status:200,body:JSON.stringify(body)};}
    return {};
   }
   if(plugin==='AlphaNotifications')return method==='status'?{permissionGranted:false,appEnabled:false}:{};
   // Retiring a running agent pauses its hosted background delivery.
   if(plugin==='AlphaHostedResults')return {};
   if(plugin==='AlphaVoiceCloud')return {microphone:'prompt'};
   if(plugin==='DailyApps')return {remove:async()=>{}};
   if(plugin!=='AlphaConnection')throw Error('Unexpected native plan fixture port');
   if(method==='secureRead')return {value:f.saved&&input.slot==='cloud:production'?JSON.stringify(credential):null};
   if(method==='secureRemove'){if(input.slot==='cloud:production')f.saved=false;return {};}
   if(method!=='request')return {};
   const path=new URL(input.url).pathname;
   if(path==='/api/v1/user'){if(f.identity==='offline')throw Error('Connection request failed');return f.identity==='401'?{status:401,data:{}}:{status:200,data:{success:true,data:{id:'22222222-2222-4222-8222-222222222222',email:'synthetic-plan@example.invalid'}}};}
   if(path==='/api/v1/credits/balance')return {status:200,data:{balance:f.cashBalance}};
   if(path==='/api/v1/subscription/entitlement-keys')return {status:200,data:{keys:f.keys??[]}};
   if(path==='/api/v1/subscription/entitlement'){
    if(f.route==='signed')return {status:200,data:{entitlement:f.tokens[f.plan]}};
    if(f.route==='401')return {status:401,data:{}};
    if(f.route==='503')return {status:503,data:{success:false,code:'service_unavailable'}};
    if(f.route==='offline')throw Error('Connection request failed');
    return {status:404,data:{}};
   }
   if(path==='/api/v1/billing/limits'){
    if(f.limits==='absent')return {status:404,data:{}};
    if(f.limits==='503')return {status:503,data:{}};
    const subscription=f.limits==='none'?{status:'not_applicable',reason:'no_organization_subscription'}:{status:'available',value:{planKey:'plus_monthly',state:f.limits,currentPeriodEnd:'2099-01-01T00:00:00.000Z'}};
    const balance=f.credits===undefined?{}:{balance:{status:'available',source:'organizations',observedAt:new Date().toISOString(),value:{balance:{value:f.credits,unit:'usd',currency:'USD'},revision:'1'}}};
    return {status:200,data:{success:true,data:{schemaVersion:2,v2:{subscription,...balance}}}};
   }
   if(path==='/api/v1/subscription/redeem'){
    const body=JSON.parse(input.body);f.bodies.push(body);
    if(f.redeem==='transport-once'&&f.bodies.length===1)throw Error('Connection request failed');
    if(f.redeem==='invalid')return {status:400,data:{success:false,error:'This subscription code cannot be redeemed.',code:'invalid_subscription_code'}};
    if(f.redeem==='rate')return {status:429,data:{success:false,code:'rate_limit_exceeded',retryAfterSeconds:840}};
    if(f.redeem==='already')return {status:409,data:{success:false,code:'subscription_grant_already_redeemed'}};
    f.plan=f.redeemPlan;f.route='signed';
    return {status:200,data:{success:true,replayed:f.bodies.length>1,grant:{id:'synthetic-grant',planKey:'plus_monthly',startsAt:'2026-10-13T00:00:00.000Z',endsAt:'2027-04-14T00:00:00.000Z',revoked:false,paidPlanTakesPrecedence:false},entitlement:{plan:{id:'plus_monthly',name:'Plus',status:'active'},source:'grant',effectiveUntil:'2027-04-14T00:00:00.000Z'}}};
   }
   if(path==='/api/auth/cli-session')return {status:503,data:{}};
   throw Error('Unexpected Cloud route '+path);
  }};
 },initial);
 await page.goto(origin+(initial.fullApp?'/':'/subscription-composition'));
 if(initial.fullApp)await page.evaluate(async()=>{
  const w=window as any;w.planController=(await import('/src/runtime/connection-ui.tsx')).connectionController;
  w.planFlags={native:(await import('/src/native.ts')).isAndroid?'android':'web',mocks:(await import('/src/build-flags.ts')).testMocksEnabled};
 });
 await expect.poll(()=>page.evaluate(()=>(window as any).planFlags)).toEqual({native:'android',mocks:false});
}
type Call={plugin:string;method:string;path?:string;url?:string;httpMethod?:string};
const calls=(page:Page)=>page.evaluate(()=>(window as any).planFixture.calls as Call[]);
const admitted=(page:Page)=>expect.poll(()=>page.evaluate(()=>typeof(window as any).planFixture.releaseProvider)).toBe('function');
const configured=async(page:Page)=>(await calls(page)).filter(c=>c.method==='configureCloudProvider').length;
const idle=(page:Page)=>expect.poll(()=>page.evaluate(()=>(window as any).planController.getSnapshot().busy)).toBe(false);
/** Ends the held admission (the fixture has no runnable agent) without leaving work behind. */
async function release(page:Page){await page.evaluate(()=>{const w=window as any;w.planController.cancel();w.planFixture.releaseProvider?.();});await idle(page);}
const fixture=(page:Page,patch:Record<string,unknown>)=>page.evaluate(patch=>Object.assign((window as any).planFixture,patch),patch);
const started=(page:Page)=>expect.poll(async()=>(await calls(page)).some(c=>c.plugin==='Agent'&&c.method==='start')).toBe(true);
/** This focused composition mounts account/plan UI. Agent controls themselves now live in
 * the actual Settings stack, covered by signed-out-page.production.spec.ts. */
const accountPanel=(page:Page)=>page.getByRole('dialog',{name:/^Eliza Cloud account(?: & plan)?$/});
const planDetails=(page:Page)=>accountPanel(page).getByRole('region',{name:'Eliza Cloud plan',exact:true});
const signInPage=(page:Page)=>page.locator('.alpha-cloud-sign-in[role="main"]');
async function openAccountPlan(page:Page){await page.evaluate(()=>(window as any).planController.openPlan());const panel=accountPanel(page);await expect(panel).toBeVisible();return panel;}
async function confirmBillingAccount(page:Page){
 const review=page.getByRole('dialog',{name:'Review billing account',exact:true});
 await expect(review).toBeVisible();
 await expect(review).toContainText('synthetic-plan@example.invalid');
 const open=review.getByRole('button',{name:'Open billing',exact:true});
 await expect(open).toBeDisabled();
 expect((await calls(page)).filter(c=>c.method==='openExternal')).toEqual([]);
 await review.getByRole('checkbox',{name:'I’ll check the account before paying.',exact:true}).check();
 await open.click();
 await expect(review).toHaveCount(0);
}

/** No admissible plan: nothing opens by itself; the notice beside the running agent offers Redeem
 * code, which opens the plan panel (the notice's other action is Choose a plan). */
async function needsPlan(page:Page){
 const notice=page.getByRole('region',{name:'Eliza Cloud plan notice'});
 await expect(notice).toContainText('AI replies aren’t available right now');await expect(accountPanel(page)).toHaveCount(0);
 await expect(notice.getByRole('button',{name:'Choose a plan',exact:true})).toBeVisible();
 // A fresh phone's startup access panel (a modal) is declined first; the notice stays beside the agent.
 const startup=page.locator('dialog.alpha-startup-permissions');
 if(await startup.isVisible().catch(()=>false))await completeAccessSetup(page);
 await notice.getByRole('button',{name:'Redeem code',exact:true}).click();
 const panel=page.getByRole('dialog',{name:'Eliza Cloud account & plan',exact:true});await expect(panel).toBeVisible();return panel;
}

test.describe('first run requires Eliza Cloud sign-in while the agent runs',()=>{
 test('a phone without a saved sign-in shows the dedicated sign-in page, no local-only bypass, and the agent runs',async({page},info)=>{
  await boot(page,{saved:false});
  const dialog=signInPage(page);await expect(dialog).toBeVisible();
  await started(page);
  await expect(signInPage(page).getByRole('button',{name:'Email me a code',exact:true})).toBeEnabled();
  await expect(dialog.getByRole('heading',{name:'Welcome to Alpha.',exact:true})).toBeVisible();
  await expect(dialog).not.toContainText('Reconnect agent');await expect(dialog).not.toContainText('Phone action history');
  await expect(page.getByRole('button',{name:'Use local apps without AI',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:/Close/})).toHaveCount(0);
  // Back and Escape cannot dismiss the sign-in.
  await page.keyboard.press('Escape');await expect(dialog).toBeVisible();
  await page.evaluate(()=>{(window as any).planController.close();(window as any).planController.offline();});
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem('alpha.connection.selection.v1')??'')).not.toContain('localApps');
  await expect(page.getByRole('dialog',{name:'Set up Alpha access'})).toHaveCount(0);
  // No Cloud request, provider binding or browser hand-off: the resident runs signed out.
  expect((await calls(page)).some(c=>(c.plugin==='AlphaConnection'&&c.method==='request')||c.method==='configureCloudProvider'||c.method==='openExternal')).toBe(false);
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:info.outputPath('first-run-sign-in-gate.png'),animations:'disabled'});
 });

 test('an earlier "local apps without AI" choice migrates to the always-running resident on the next launch and keeps local data',async({page})=>{
  const seeded={'alpha.connection.selection.v1':JSON.stringify({kind:'offline',localApps:true}),'alpha.synthetic.local-data':'kept'};
  await boot(page,{saved:false,storage:seeded});
  await expect(signInPage(page)).toBeVisible();
  await expect(page.getByRole('button',{name:'Use local apps without AI',exact:true})).toHaveCount(0);
  // P-43: the retired choice reads as the always-running resident.
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('alpha.connection.selection.v1')!))).toEqual({kind:'resident'});
  expect(await page.evaluate(()=>localStorage.getItem('alpha.synthetic.local-data'))).toBe('kept');
 });

 test('a migrated phone with a saved sign-in and an active plan starts the agent without the bypass',async({page})=>{
  const signed=await entitlements();
  await boot(page,{...signed,storage:{'alpha.connection.selection.v1':JSON.stringify({kind:'offline',localApps:true})}});
  await admitted(page);
  expect(await configured(page)).toBe(1);
  await expect(page.getByRole('button',{name:'Use local apps without AI',exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>localStorage.getItem('alpha.connection.selection.v1'))).not.toContain('localApps');
  await release(page);
 });

 test('an expired saved sign-in exposes the real sign-in action without a plan or permission bypass',async({page},info)=>{
  await boot(page,{identity:'401'});await expect(signInPage(page)).toBeVisible();await started(page);await expect(signInPage(page).getByRole('button',{name:'Email me a code',exact:true})).toBeEnabled();await expect(page.getByRole('alert')).toContainText('sign-in has expired');
  await expect(page.getByRole('button',{name:'Retry saved connection',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Continue',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Choose a plan',exact:true})).toHaveCount(0);await expect(page.getByRole('dialog',{name:'Set up Alpha access'})).toHaveCount(0);
  expect((await calls(page)).some(c=>c.method==='configureCloudProvider'||c.method==='openExternal')).toBe(false);await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:info.outputPath('expired-saved-sign-in.png'),animations:'disabled'});
 });
});

test.describe('plan state binds Cloud inference; the agent always runs',()=>{
 test('an active entitlement shows the plan and its Cloud allowance and admits the agent',async({page},info)=>{
  const signed=await entitlements();
  await page.setViewportSize({width:320,height:640});await boot(page,signed);
  await admitted(page);
  // Admission and the initial membership summary each verify the signed plan.
  await expect.poll(async()=>(await calls(page)).filter(c=>c.path==='/api/v1/subscription/entitlement').length).toBe(2);
  await expect.poll(()=>page.evaluate(()=>(window as any).planController.getSnapshot().membershipBalance)).not.toBe('checking');
  expect(await configured(page)).toBe(1);
  const initialKeyReads=(await calls(page)).filter(c=>c.path==='/api/v1/subscription/entitlement-keys').length;
  expect(initialKeyReads).toBeGreaterThanOrEqual(1);expect(initialKeyReads).toBeLessThanOrEqual(2);
  await openAccountPlan(page);
  await expect(planDetails(page).getByText('Synthetic plan',{exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>(window as any).planController.getSnapshot().membershipBalance)).not.toBe('checking');
  await expect(page.getByText(/3 of 40 requests used this month/)).toBeVisible();
  await expect(page.getByRole('button',{name:'Manage plan in Eliza Cloud',exact:true})).toBeVisible();
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:info.outputPath('signed-plan-resume.png'),animations:'disabled'});
  const routes=(await calls(page)).filter(c=>c.method==='request').map(c=>c.path);
  // Explicitly opening the plan panel adds one read, without another admission or mutation.
  expect(routes.filter(p=>p==='/api/v1/subscription/entitlement')).toHaveLength(3);
  expect(await configured(page)).toBe(1);
  expect((await calls(page)).filter(c=>c.plugin==='AlphaConnection'&&c.method==='request').every(c=>c.httpMethod==='GET')).toBe(true);
  // Concurrent initial checks may each fetch the key once; opening the panel reuses it.
  expect(routes.filter(p=>p==='/api/v1/subscription/entitlement-keys')).toHaveLength(initialKeyReads);
  expect(routes).not.toContain('/api/v1/credits/balance');
  expect((await calls(page)).filter(c=>c.path==='/api/v1/billing/limits').every(c=>c.httpMethod==='GET')).toBe(true);
  await release(page);
 });

 test('a format v2 entitlement shows the share of the period allowance left, not an amount of money',async({page})=>{
  const now=Math.floor(Date.now()/1000);
  // Synthetic micro-dollar figures (Cloud's allowance unit), not a product allowance.
  await boot(page,await entitlements({ver:2,allowance:undefined,plan_allowance:{unit:'usd_micros',granted:4_000_000,remaining:1_000_000,periodStart:now-86400,resetsAt:now+86400}}));
  await admitted(page);
  const panel=await openAccountPlan(page);
  await expect(panel.getByText(/25% of this billing period's plan allowance is left\. Resets /)).toBeVisible();
  await expect(planDetails(page)).not.toContainText('$');
  await release(page);
 });

 test('a trialing plan is admitted',async({page})=>{
  await boot(page,{...await entitlements(),plan:'trialing'});
  await admitted(page);await openAccountPlan(page);await expect(page.getByText('Synthetic plan · trial',{exact:true})).toBeVisible();await release(page);
 });

 test('a past-due plan is admitted with a clear warning and the hosted plan page',async({page},info)=>{
  await boot(page,{...await entitlements(),plan:'past_due'});
  await admitted(page);await openAccountPlan(page);
  await expect(page.getByText('Synthetic plan · payment due',{exact:true})).toBeVisible();
  await expect(page.getByText(/Payment is past due\. Update payment in Eliza Cloud to keep AI available\./)).toBeVisible();
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:info.outputPath('past-due-warning.png'),animations:'disabled'});
  await release(page);
  await page.getByRole('button',{name:'Manage plan in Eliza Cloud',exact:true}).click();await confirmBillingAccount(page);
  await expect.poll(async()=>(await calls(page)).filter(c=>c.method==='openExternal').map(c=>c.url)).toEqual(['https://cloud.eliza.app/cloud/billing']);
 });

 for(const [status,heading,headline] of [['canceled','Your plan has ended','Synthetic plan has ended'],['none','Choose a plan','No active plan']] as const)test(`a ${status} plan shows "needs plan" beside the running agent and binds no inference`,async({page},info)=>{
  await boot(page,{...await entitlements(),plan:status});
  await needsPlan(page);void heading;
  await expect(page.getByText(headline,{exact:true})).toBeVisible();
  await expect(page.getByRole('textbox',{name:'Membership code'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Redeem',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Check plan again',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Use local apps without AI',exact:true})).toHaveCount(0);
  // The plan notice can be closed: it never withholds the agent (P-43).
  await expect(page.getByRole('button',{name:'Close connection settings',exact:true})).toBeVisible();
  expect(await configured(page)).toBe(0);
  await started(page);
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:info.outputPath(`needs-plan-${status}.png`),animations:'disabled'});
  // Choose a plan opens exactly the allowlisted hosted page in the system browser.
  await page.getByRole('button',{name:'Choose a plan',exact:true}).click();await confirmBillingAccount(page);
  await expect.poll(async()=>(await calls(page)).filter(c=>c.method==='openExternal').map(c=>c.url)).toEqual(['https://cloud.eliza.app/cloud/billing']);
  expect(await configured(page)).toBe(0);
 });

 test('returning from Eliza Cloud checks the plan again and admits a plan chosen there',async({page})=>{
  await boot(page,{...await entitlements(),plan:'none'});
  await needsPlan(page);await idle(page);await started(page);
  await page.getByRole('button',{name:'Choose a plan',exact:true}).click();await confirmBillingAccount(page);await idle(page);
  await fixture(page,{plan:'active'});
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await admitted(page);expect(await configured(page)).toBe(1);await release(page);
 });

 test('a plan that ends while admitted unbinds inference on the next check; the agent keeps running',async({page})=>{
  await boot(page,{...await entitlements(),holdProvider:false});
  await expect.poll(()=>configured(page)).toBe(1);await idle(page);
  await fixture(page,{plan:'canceled'});
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await needsPlan(page);
  await expect(page.getByText('Synthetic plan has ended',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).planController.getSnapshot().residentPlanNotice)).toBe('needs-plan');
  expect((await calls(page)).filter(c=>c.plugin==='Agent'&&c.method==='start').length).toBeGreaterThanOrEqual(2);
 });

 test('an entitlement for another account is refused and binds no inference',async({page})=>{
  await boot(page,await entitlements({sub:'33333333-3333-4333-8333-333333333333'}));
  await idle(page);const panel=signInPage(page);await expect(panel).toBeVisible();await expect(panel.getByRole('alert')).toContainText('different account');await started(page);
  expect(await page.evaluate(()=>(window as any).planController.getSnapshot().cloudAccount)).toBeNull();
  expect(await configured(page)).toBe(0);
 });

 test('a tampered entitlement is never trusted: needs plan with a retry, no inference bound',async({page})=>{
  const signed=await entitlements(),other=await entitlements();
  await boot(page,{tokens:signed.tokens,keys:other.keys});
  await needsPlan(page);
  expect(await page.evaluate(()=>(window as any).planController.getSnapshot().residentSubscription)).toEqual({kind:'unavailable',reason:'invalid'});
  await expect(planDetails(page).getByText('Synthetic plan',{exact:true})).toHaveCount(0);
  expect(await configured(page)).toBe(0);
 });
});

test('signed no-subscription admits canonical credits, then an unconfirmed credit mode unbinds without offline grace',async({page})=>{
 await boot(page,{...await entitlements(),plan:'none',limits:'none',holdProvider:false});
 await expect.poll(()=>configured(page)).toBe(1);await idle(page);
 expect(await page.evaluate(()=>(window as any).planController.getSnapshot().residentSubscription)).toEqual({kind:'credits',source:'billing-limits'});
 const record=await page.evaluate(()=>JSON.parse(localStorage.getItem('alpha.connection.plan-admission.v1')||'null'));
 expect(record).toMatchObject({status:'credit-funded',credentialId:CREDENTIAL,userId:USER,endsAt:null});
 const clears=(await calls(page)).filter(c=>c.plugin==='Agent'&&c.method==='clearProvider').length;
 await fixture(page,{limits:'503'});
 await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
 await expect.poll(()=>page.evaluate(()=>(window as any).planController.getSnapshot().residentSubscription)).toEqual({kind:'inactive',planName:null,status:'none',source:'entitlement'});
 await expect.poll(async()=>(await calls(page)).filter(c=>c.plugin==='Agent'&&c.method==='clearProvider').length).toBeGreaterThan(clears);
 await idle(page);
 expect(await page.evaluate(()=>localStorage.getItem('alpha.connection.plan-admission.v1'))).toBeNull();
 expect(await configured(page)).toBe(1);
 expect((await calls(page)).filter(c=>c.plugin==='Agent'&&c.method==='start').length).toBeGreaterThanOrEqual(2);
 const routes=(await calls(page)).filter(c=>c.method==='request').map(c=>c.path);
 expect(routes).not.toContain('/api/v1/credits/balance');expect(routes).not.toContain('/api/v1/subscription/redeem');
});

test.describe('entitlement route unavailable: authenticated billing mode fallback',()=>{
 for(const limits of ['active','past_due'] as const)test(`a ${limits} billing snapshot admits the agent`,async({page})=>{
  await boot(page,{route:'absent',limits});
  await admitted(page);await openAccountPlan(page);
  await expect(page.getByText(limits==='active'?'Plus':'Plus · payment due',{exact:true})).toBeVisible();
  const routes=(await calls(page)).filter(c=>c.method==='request').map(c=>c.path);
  expect(routes).toEqual(expect.arrayContaining(['/api/v1/subscription/entitlement','/api/v1/billing/limits']));
  expect(routes).not.toContain('/api/v1/credits/balance');
  await release(page);
 });
 for(const [limits,heading] of [['canceled','Your plan has ended']] as const)test(`a billing snapshot with plan ${limits} needs a plan`,async({page})=>{
  await boot(page,{route:'absent',limits});void heading;
  await needsPlan(page);await started(page);expect(await configured(page)).toBe(0);
 });
 test('organization credits bind the verified account without inventing a subscription',async({page})=>{
  await boot(page,{route:'absent',limits:'none'});await admitted(page);
  await page.evaluate(()=>(window as any).planController.openPlan());
  const panel=page.getByRole('dialog',{name:'Eliza Cloud account',exact:true});await expect(panel).toBeVisible();
  await expect(panel.getByText('Eliza Cloud credits',{exact:true})).toBeVisible();
  await expect(panel.getByRole('button',{name:'Manage billing in Eliza Cloud',exact:true})).toBeVisible();
  // The code field stays collapsed until the owner asks for it (here: explicit code entry).
  await expect(panel.getByRole('textbox',{name:'Membership code'})).toHaveCount(0);
  await page.evaluate(()=>(window as any).planController.openPlan({codeEntry:true}));
  await expect(panel.getByRole('textbox',{name:'Membership code'})).toBeVisible();
  await expect(panel.getByRole('button',{name:'Redeem',exact:true})).toBeVisible();
  // Opening the existing field never redeems or changes the account's billing mode.
  expect((await calls(page)).filter(c=>c.path==='/api/v1/subscription/redeem')).toHaveLength(0);
  const routes=(await calls(page)).filter(c=>c.method==='request').map(c=>c.path);expect(routes).not.toContain('/api/v1/credits/balance');
  expect(await configured(page)).toBe(1);
  const record=await page.evaluate(()=>JSON.parse(localStorage.getItem('alpha.connection.plan-admission.v1')||'null'));
  expect(record.status).toBe('credit-funded');expect(record.userId).toBe(USER);await release(page);
 });
 test('credits-mode code entry uses the existing client and an invalid code leaves billing unchanged',async({page})=>{
  await boot(page,{route:'absent',limits:'none',holdProvider:false,redeem:'invalid',cashBalance:0});await expect.poll(()=>configured(page)).toBe(1);await idle(page);
  await page.evaluate(()=>(window as any).planController.openPlan());
  const panel=page.getByRole('dialog',{name:'Eliza Cloud account',exact:true});await expect(panel).toBeVisible();
  const before=await configured(page);
  await expect(panel.getByRole('button',{name:'Manage billing in Eliza Cloud',exact:true})).toBeVisible();
  await panel.getByRole('button',{name:'Enter membership code',exact:true}).click();
  await panel.getByRole('textbox',{name:'Membership code'}).fill(CODE);
  await panel.getByRole('button',{name:'Redeem',exact:true}).click();
  await expect(panel.getByRole('alert')).toHaveText('This code could not be redeemed. Check the code and try again.');
  await expect(panel.getByRole('textbox',{name:'Membership code'})).toHaveValue(CODE);
  await expect(panel.getByText('Eliza Cloud credits',{exact:true})).toBeVisible();
  expect(await configured(page)).toBe(before);
  const routes=(await calls(page)).filter(c=>c.method==='request');
  expect(routes.filter(c=>c.path==='/api/v1/subscription/redeem').map(c=>[c.httpMethod,c.url])).toEqual([['POST','https://api.eliza.app/api/v1/subscription/redeem']]);
  expect(routes.some(c=>c.path==='/api/signup-code/redeem'||c.path==='/api/v1/credits/balance')).toBe(false);
 });
 test('a valid signed allowance remains usable with zero USD without a cash preflight or automatic redemption',async({page})=>{
  await boot(page,{...await entitlements(),plan:'active',holdProvider:false,cashBalance:0});
  await expect.poll(()=>configured(page)).toBe(1);await idle(page);
  await page.evaluate(()=>(window as any).planController.openPlan());
  const panel=page.getByRole('dialog',{name:'Eliza Cloud account & plan',exact:true});await expect(panel).toBeVisible();
  await expect(panel.getByText('Synthetic plan',{exact:true})).toBeVisible();
  await panel.getByRole('button',{name:'Enter membership code',exact:true}).click();
  await expect(panel.getByRole('textbox',{name:'Membership code'})).toBeVisible();
  const routes=(await calls(page)).filter(c=>c.method==='request').map(c=>c.path);
  expect(routes).not.toContain('/api/v1/credits/balance');expect(routes).not.toContain('/api/v1/subscription/redeem');
  expect(await page.evaluate(()=>(window as any).planFixture.cashBalance)).toBe(0);
  expect(await page.evaluate(()=>(window as any).planController.getSnapshot().residentSubscription.kind)).toBe('active');
 });
 test('a zero credit balance from the billing snapshot renders as zero, never as unavailable',async({page})=>{
  await boot(page,{...await entitlements(),plan:'active',limits:'active',credits:'0',holdProvider:false});
  await expect.poll(()=>configured(page)).toBe(1);await idle(page);
  await expect.poll(()=>page.evaluate(()=>(window as any).planController.getSnapshot().membershipCredits?.usd)).toBe('0');
  await page.evaluate(()=>(window as any).planController.openPlan());
  const panel=page.getByRole('dialog',{name:'Eliza Cloud account & plan',exact:true});await expect(panel).toBeVisible();
  const credits=panel.getByRole('region',{name:'Membership and credits',exact:true});
  await expect(credits.locator('.alpha-membership-amount')).toHaveText('$0.00USD');
  await expect(credits.getByText('Not available',{exact:true})).toHaveCount(0);
  // An active plan is the membership: zero credits never block the agent or open a funding sheet.
  expect(await page.evaluate(()=>(window as any).planController.getSnapshot().membershipBalance)).toBe('member');
  const routes=(await calls(page)).filter(c=>c.method==='request').map(c=>c.path);
  expect(routes).toContain('/api/v1/billing/limits');expect(routes).not.toContain('/api/v1/credits/balance');
 });
 test('no plan source at all is unknown: needs plan with a retry, never admitted',async({page})=>{
  await boot(page,{route:'absent',limits:'absent'});
  await needsPlan(page);await idle(page);
  await expect(page.getByText('Plan status unavailable',{exact:true})).toBeVisible();
  await expect(page.getByText(/did not report a plan for this account/)).toBeVisible();
  expect(await configured(page)).toBe(0);
  // Check plan again reads Cloud again and admits once a plan is reported.
  await fixture(page,{limits:'active'});
  await page.getByRole('button',{name:'Check plan again',exact:true}).click();
  await admitted(page);await release(page);
 });
});

test.describe('outages and offline use',()=>{
 test('frequent Home returns are throttled but returning from plan management rechecks',async({page})=>{
  await boot(page,{...await entitlements(),plan:'none',holdProvider:false});await needsPlan(page);await idle(page);
  const checks=async()=>(await calls(page)).filter(c=>c.path==='/api/v1/subscription/entitlement').length;
  const before=await checks();
  await page.evaluate(()=>(window as any).planController.recheckPlanOnReturn());
  await expect.poll(checks).toBe(before+1);await idle(page);
  await page.evaluate(()=>(window as any).planController.recheckPlanOnReturn());await idle(page);
  expect(await checks()).toBe(before+1);
  await page.evaluate(()=>(window as any).planController.residentManagePlan());await confirmBillingAccount(page);await idle(page);
  await page.evaluate(()=>(window as any).planController.recheckPlanOnReturn());
  await expect.poll(checks).toBe(before+2);
 });
 test('billing refusals refresh plan state once per minute without stopping the resident',async({page})=>{
  await boot(page,{...await entitlements(),holdProvider:false});await expect.poll(()=>configured(page)).toBe(1);await idle(page);
  const checks=async()=>(await calls(page)).filter(c=>c.path==='/api/v1/subscription/entitlement').length;
  const before=await checks(),stops=(await calls(page)).filter(c=>c.method==='stop').length;
  await page.evaluate(()=>(window as any).planController.recheckPlanAfterRefusal());
  await expect.poll(checks).toBe(before+1);
  await expect.poll(()=>page.evaluate(()=>(window as any).planController.getSnapshot().residentSubscription?.kind)).toBe('active');
  await page.evaluate(()=>(window as any).planController.recheckPlanAfterRefusal());
  expect(await checks()).toBe(before+1);
  expect((await calls(page)).filter(c=>c.method==='stop')).toHaveLength(stops);
 });
 test('an ended cached plan window cannot keep the Cloud binding during an outage',async({page})=>{
  const record=JSON.stringify({version:1,environment:'production',credentialId:CREDENTIAL,userId:USER,organizationId:null,status:'active',planName:'Synthetic plan',verifiedAt:Date.now()-1000,endsAt:Date.now()-1});
  await boot(page,{identity:'offline',holdProvider:false,storage:{'alpha.connection.plan-admission.v1':record}});await started(page);await idle(page);
  expect((await calls(page)).some(c=>c.method==='clearProvider')).toBe(true);
  expect(await configured(page)).toBe(0);
 });
 test('a failed background refresh does not renew the verified plan timestamp',async({page})=>{
  await boot(page,{...await entitlements({rfa:Math.floor(Date.now()/1000)+4}),holdProvider:false});
  await expect.poll(()=>configured(page)).toBe(1);await idle(page);
  const before=await page.evaluate(()=>localStorage.getItem('alpha.connection.plan-admission.v1'));
  await fixture(page,{route:'503'});
  await expect.poll(()=>page.evaluate(()=>(window as any).planController.getSnapshot().residentSubscription?.refreshFailed),{timeout:10000}).toBe(true);
  expect(await page.evaluate(()=>localStorage.getItem('alpha.connection.plan-admission.v1'))).toBe(before);
 });
 test('a billing outage without a recent plan is "needs plan" with a retry',async({page})=>{
  await boot(page,{route:'503'});
  await needsPlan(page);await started(page);
  await expect(page.getByText(/could not confirm a plan for this account right now/)).toBeVisible();
  expect(await configured(page)).toBe(0);
 });
 test('a billing outage after a recent verified plan keeps the agent',async({page})=>{
  const signed=await entitlements();
  await boot(page,{...signed,holdProvider:false});
  await expect.poll(()=>configured(page)).toBe(1);await idle(page);
  const record=await page.evaluate(()=>JSON.parse(localStorage.getItem('alpha.connection.plan-admission.v1')!));
  expect(record).toMatchObject({version:1,environment:'production',credentialId:CREDENTIAL,userId:USER,status:'active',planName:'Synthetic plan'});
  await fixture(page,{route:'503',holdProvider:true});
  await page.evaluate(()=>{void (window as any).planController.startLocal();});
  await admitted(page);
  expect(await page.evaluate(()=>(window as any).planController.getSnapshot().residentSubscription)).toEqual({kind:'unavailable',reason:'outage'});
  await release(page);
 });
 test('offline with a recent plan: the resident runs and retains the saved sign-in without claiming verification',async({page},info)=>{
  const recent=JSON.stringify({version:1,environment:'production',credentialId:CREDENTIAL,userId:USER,organizationId:null,status:'active',planName:'Synthetic plan',verifiedAt:Date.now()-3600_000,endsAt:null});
  await boot(page,{identity:'offline',storage:{'alpha.connection.plan-admission.v1':recent}});
  await started(page);await idle(page);
  const notice=page.getByRole('region',{name:'Eliza Cloud plan notice',exact:true});
  await expect(notice).toContainText('Cloud cannot be reached right now.');
  await expect(notice.getByRole('button',{name:'Try again',exact:true})).toBeEnabled();
  await expect(signInPage(page)).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).planController.getSnapshot())).toMatchObject({cloudAccount:null,residentSavedCredential:true,residentPlanNotice:'offline',residentInference:'unknown'});
  expect((await calls(page)).filter(c=>c.method==='clearProvider'||c.plugin==='AlphaCloudSignIn'&&!['addListener','removeListener'].includes(c.method))).toEqual([]);
  await page.keyboard.press('Escape');await expect(notice).toBeVisible();expect(await configured(page)).toBe(0);
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:info.outputPath('offline-recent-plan.png'),animations:'disabled'});
 });
 for(const age of ['stale','other-credential'] as const)test(`offline without a recent plan retains sign-in but unbinds inference (${age})`,async({page})=>{
  const record=JSON.stringify({version:1,environment:'production',credentialId:age==='other-credential'?'99999999-9999-4999-8999-999999999999':CREDENTIAL,userId:USER,organizationId:null,status:'active',planName:'Synthetic plan',verifiedAt:Date.now()-(age==='stale'?8:0)*24*3600_000,endsAt:null});
  await boot(page,{identity:'offline',storage:{'alpha.connection.plan-admission.v1':record}});
  await started(page);await idle(page);
  const notice=page.getByRole('region',{name:'Eliza Cloud plan notice',exact:true});
  await expect(notice).toContainText('Cloud cannot be reached right now.');
  await expect(signInPage(page)).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).planController.getSnapshot())).toMatchObject({cloudAccount:null,residentSavedCredential:true,residentPlanNotice:'offline',residentInference:'unavailable'});
  expect((await calls(page)).filter(c=>c.method==='clearProvider')).toHaveLength(1);
  expect((await calls(page)).filter(c=>c.plugin==='AlphaCloudSignIn'&&!['addListener','removeListener'].includes(c.method))).toEqual([]);
  await page.keyboard.press('Escape');await expect(notice).toBeVisible();expect(await configured(page)).toBe(0);
 });
});

test.describe('redeem a subscription code',()=>{
 test('success redeems once with a fresh key, admits the verified grant at zero USD and refreshes the entitlement',async({page},info)=>{
  await boot(page,{...await entitlements(),plan:'none',cashBalance:0});
  await needsPlan(page);await idle(page);
  const beforeReads=(await calls(page)).filter(c=>c.path==='/api/v1/subscription/entitlement').length;
  await page.getByRole('textbox',{name:'Membership code'}).fill(CODE);
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:info.outputPath('redeem-code.png'),animations:'disabled'});
  await page.getByRole('button',{name:'Redeem',exact:true}).click();
  await admitted(page);
  const bodies=await page.evaluate(()=>(window as any).planFixture.bodies);
  expect(bodies).toHaveLength(1);
  expect(bodies[0].code).toBe(NORMALIZED);
  expect(bodies[0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  const redeem=(await calls(page)).filter(c=>c.path==='/api/v1/subscription/redeem');
  expect(redeem.map(c=>[c.httpMethod,c.url])).toEqual([['POST','https://api.eliza.app/api/v1/subscription/redeem']]);
  // The entitlement is read again after redemption.
  const reads=(await calls(page)).filter(c=>c.path==='/api/v1/subscription/entitlement');expect(reads.length).toBe(beforeReads+1);
  expect(await page.evaluate(()=>(window as any).planFixture.cashBalance)).toBe(0);
  expect((await calls(page)).some(c=>c.path==='/api/v1/credits/balance'||c.path==='/api/signup-code/redeem')).toBe(false);
  await expect(page.getByText(/^Code redeemed for Plus\. It runs until /)).toBeVisible();
  await expect(page.getByText(/Plan runs until/)).toBeVisible();
  // The code is not kept anywhere the renderer can read back.
  const stored=await page.evaluate(()=>JSON.stringify({...localStorage})+JSON.stringify({...sessionStorage})+document.body.innerText);
  expect(stored).not.toContain(NORMALIZED);expect(stored.toLowerCase()).not.toContain(CODE);
  await release(page);
 });

 test('an invalid code gets one generic answer, keeps the plan notice and is not retried',async({page})=>{
  await boot(page,{...await entitlements(),plan:'none',redeem:'invalid'});
  await needsPlan(page);await idle(page);
  await page.getByRole('textbox',{name:'Membership code'}).fill(CODE);
  await page.getByRole('button',{name:'Redeem',exact:true}).click();
  await expect(page.getByRole('alert')).toHaveText('This code could not be redeemed. Check the code and try again.');
  expect(await page.evaluate(()=>(window as any).planFixture.bodies.length)).toBe(1);
  await expect(page.getByRole('textbox',{name:'Membership code'})).toHaveValue(CODE);
  await expect(page.getByRole('textbox',{name:'Membership code'})).toHaveAttribute('aria-invalid','true');
  const errorId=await page.getByRole('alert').getAttribute('id');expect(errorId).toBeTruthy();
  await expect(page.getByRole('textbox',{name:'Membership code'})).toHaveAttribute('aria-describedby',errorId!);
  expect(await configured(page)).toBe(0);
  // Text that cannot be a code is refused locally with the same answer; nothing is sent.
  await page.getByRole('textbox',{name:'Membership code'}).fill('not-a-code');
  await page.getByRole('button',{name:'Redeem',exact:true}).click();
  await expect(page.getByRole('alert')).toHaveText('This code could not be redeemed. Check the code and try again.');
  expect(await page.evaluate(()=>(window as any).planFixture.bodies.length)).toBe(1);
 });

 test('a rate-limited redemption shows the Cloud retry time',async({page},info)=>{
  await boot(page,{...await entitlements(),plan:'none',redeem:'rate'});
  await needsPlan(page);await idle(page);
  await page.getByRole('textbox',{name:'Membership code'}).fill(CODE);
  await page.getByRole('button',{name:'Redeem',exact:true}).click();
  await expect(page.getByRole('alert')).toHaveText('Too many attempts. Try again in about 14 minutes.');
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:info.outputPath('redeem-rate-limited.png'),animations:'disabled'});
  expect(await configured(page)).toBe(0);
 });

 test('a lost response is replayed once with the same key; a new submission uses a new key',async({page})=>{
  await boot(page,{...await entitlements(),plan:'none',redeem:'transport-once'});
  await needsPlan(page);await idle(page);
  await page.getByRole('textbox',{name:'Membership code'}).fill(CODE);
  await page.getByRole('button',{name:'Redeem',exact:true}).click();
  await admitted(page);
  const bodies=await page.evaluate(()=>(window as any).planFixture.bodies);
  expect(bodies).toHaveLength(2);
  expect(bodies[1].idempotencyKey).toBe(bodies[0].idempotencyKey);
  await release(page);
  // A second owner submission (from the plan panel) is a new attempt with a new key.
  await page.evaluate(()=>(window as any).planController.openPlan());
  await page.getByRole('button',{name:'Enter membership code',exact:true}).click();
  await page.getByRole('textbox',{name:'Membership code'}).fill(CODE);
  await page.getByRole('button',{name:'Redeem',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).planFixture.bodies.length)).toBe(3);
  const all=await page.evaluate(()=>(window as any).planFixture.bodies);
  expect(all[2].idempotencyKey).not.toBe(all[0].idempotencyKey);
  await release(page);
 });

 test('an account that already holds the grant is told so without a new grant',async({page})=>{
  await boot(page,{...await entitlements(),plan:'none',redeem:'already'});
  await needsPlan(page);await idle(page);
  await page.getByRole('textbox',{name:'Membership code'}).fill(CODE);
  await page.getByRole('button',{name:'Redeem',exact:true}).click();
  await expect(page.getByRole('alert')).toHaveText('This account has already received this subscription. Check your plan again.');
 });
});

test.describe('account, plan and sign-in expiry',()=>{
 test('Settings data and the plan panel show account, plan, Redeem code, Manage plan and Sign out',async({page},info)=>{
  await boot(page,{...await entitlements(),holdProvider:false});
  await expect.poll(()=>configured(page)).toBe(1);await idle(page);
  const settings=await page.evaluate(()=>(window as any).planController.residentPlanSettings());
  expect(settings).toMatchObject({signedIn:true,account:'synthetic-plan@example.invalid',plan:'Synthetic plan',status:'active',keyExpiring:false});
  await page.evaluate(()=>(window as any).planController.openPlan());
  const dialog=page.getByRole('dialog',{name:'Eliza Cloud account & plan',exact:true});await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('region',{name:'Membership and credits',exact:true}).getByText('synthetic-plan@example.invalid',{exact:true})).toBeVisible();
  for(const name of ['Enter membership code','Manage plan in Eliza Cloud','Sign out'])await expect(dialog.getByRole('button',{name,exact:true})).toBeVisible();
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:info.outputPath('plan-panel.png'),animations:'disabled'});
  await dialog.getByRole('button',{name:'Sign out',exact:true}).click();
  // Signed out, the dedicated page returns and the agent restarts without Cloud inference.
  await expect(signInPage(page)).toBeVisible();await expect(signInPage(page).getByRole('button',{name:'Email me a code',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem('alpha.connection.plan-admission.v1'))).toBeNull();
  expect(await page.evaluate(()=>(window as any).planController.residentPlanSettings())).toMatchObject({signedIn:false,plan:'Not signed in'});
 });

 test('a sign-in key that expires within 14 days is warned about and offers re-approval',async({page},info)=>{
  await boot(page,{...await entitlements(),expiresAt:Date.now()+5*24*3600_000});
  await admitted(page);await openAccountPlan(page);
  await expect(page.getByText(/Your Eliza Cloud sign-in on this phone expires .*\. Approve this phone again to keep AI available\./)).toBeVisible();
  expect(await page.evaluate(()=>(window as any).planController.residentPlanSettings().keyExpiring)).toBe(true);
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:info.outputPath('sign-in-expiry-warning.png'),animations:'disabled'});
  await release(page);
  await page.getByRole('button',{name:'Approve this phone again',exact:true}).click();
  // Re-approval opens the native email form without sending a code until explicitly requested.
  await expect(page.getByRole('textbox',{name:'Email',exact:true})).toBeVisible();
  expect((await calls(page)).some(c=>c.plugin==='AlphaCloudSignIn'&&c.method==='status')).toBe(true);
  expect((await calls(page)).filter(c=>c.path?.startsWith('/api/auth/cli-session')||c.method==='openExternal'||c.method==='startEmail')).toEqual([]);
 });

 test('a key with more than 14 days left shows no expiry warning',async({page})=>{
  await boot(page,await entitlements());
  await admitted(page);
  await expect(page.getByRole('button',{name:'Approve this phone again',exact:true})).toHaveCount(0);
  await release(page);
 });
});

test('failed native provider binding reports AI off and exposes the error before history',async({page})=>{
 const pageErrors:string[]=[];page.on('pageerror',error=>pageErrors.push(error.message));
 await boot(page,{...await entitlements(),holdProvider:false,providerFailure:'Synthetic account verification failure',fullApp:true});await started(page);await idle(page);
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('button',{name:'Agent connection',exact:true}).click();
 const settings=page.getByRole('region',{name:'Settings',exact:true});
 await expect(settings.getByText('Not available',{exact:true})).toBeVisible();
 const error=settings.getByText(/Synthetic account verification failure/);await expect(error).toBeVisible();
 const history=settings.getByText('Conversation history',{exact:true});await expect(history).toBeVisible();
 expect(await error.evaluate((node,other)=>(node.compareDocumentPosition(other!)&Node.DOCUMENT_POSITION_FOLLOWING)!==0,await history.elementHandle())).toBe(true);
 expect(await configured(page)).toBe(1);
 expect(await page.evaluate(()=>(window as any).planController.getSnapshot().residentInference)).toBe('unavailable');
 expect(await page.evaluate(()=>(window as any).residentAgent.state.unexpected)).toEqual([]);
 expect(pageErrors).toEqual([]);
});

// UI progress only: this feature fixture does not manufacture OS/provider grants.
test.beforeEach(async({page})=>seedCompletedAccessSetup(page));


test.describe('explicit membership code entry',()=>{
 async function notice(page:Page){
  await boot(page,{...await entitlements(),plan:'none',cashBalance:5,holdProvider:false});await started(page);await idle(page);
  const startup=page.locator('dialog.alpha-startup-permissions');if(await startup.isVisible().catch(()=>false))await completeAccessSetup(page);
  const notice=page.getByRole('region',{name:'Eliza Cloud plan notice'});await expect(notice).toBeVisible();return notice;
 }
 // On the phone's own agent the plan action opens the resident account & plan panel, which carries
 // the Membership & credits controls (code entry included) beside the plan headline and actions.
 const sheet=(page:Page)=>page.getByRole('dialog',{name:'Eliza Cloud account & plan',exact:true});
 async function noEffects(page:Page){expect((await calls(page)).filter(c=>c.path==='/api/v1/subscription/redeem'||c.method==='openExternal')).toEqual([]);}
 test('one explicit Redeem code click reveals and focuses the current account input',async({page},info)=>{
  const entry=await notice(page);await entry.getByRole('button',{name:'Redeem code',exact:true}).click();
  const input=sheet(page).getByRole('textbox',{name:'Membership code',exact:true});await expect(input).toBeVisible();await expect(input).toBeFocused();
  await page.screenshot({path:info.outputPath('explicit-code-mobile.png'),animations:'disabled'});await page.setViewportSize({width:1280,height:900});await expect(input).toBeVisible();await page.screenshot({path:info.outputPath('explicit-code-desktop.png'),animations:'disabled'});
  await input.fill('SYNTHETIC-UNSUBMITTED');await sheet(page).getByRole('button',{name:'Refresh',exact:true}).click();await expect(input).toHaveValue('SYNTHETIC-UNSUBMITTED');
  await noEffects(page);
 });
 test('closing explicit entry retires its draft and ordinary plan entry stays collapsed',async({page})=>{
  const entry=await notice(page);await entry.getByRole('button',{name:'Redeem code',exact:true}).click();
  const input=sheet(page).getByRole('textbox',{name:'Membership code',exact:true});await expect(input).toBeFocused();await input.fill('SYNTHETIC-OLD-DRAFT');
  await sheet(page).getByRole('button',{name:'Close connection settings',exact:true}).click();
  await page.evaluate(()=>(window as any).planController.openPlan());await expect(sheet(page)).toBeVisible();await expect(sheet(page).getByRole('textbox',{name:'Membership code',exact:true})).toHaveCount(0);
  await sheet(page).getByRole('button',{name:'Enter membership code',exact:true}).click();const fresh=sheet(page).getByRole('textbox',{name:'Membership code',exact:true});await expect(fresh).toHaveValue('');await expect(fresh).toBeFocused();await noEffects(page);
 });
 test('cancelling current controller work retires the explicit draft',async({page})=>{
  const entry=await notice(page);await entry.getByRole('button',{name:'Redeem code',exact:true}).click();
  const input=sheet(page).getByRole('textbox',{name:'Membership code',exact:true});await input.fill('SYNTHETIC-CANCELLED');
  await page.evaluate(()=>(window as any).planController.cancel());await expect(input).toHaveCount(0);
  await sheet(page).getByRole('button',{name:'Enter membership code',exact:true}).click();await expect(input).toHaveValue('');await expect(input).toBeFocused();await noEffects(page);
 });
 test('Settings Redeem code opens the existing field directly',async({page})=>{
  await boot(page,{...await entitlements(),plan:'none',cashBalance:5,holdProvider:false,fullApp:true});await started(page);await idle(page);
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('button',{name:'Eliza Cloud account & plan',exact:true}).click();
  await page.getByRole('region',{name:'Settings',exact:true}).getByRole('button',{name:'Redeem code',exact:true}).click();
  const input=sheet(page).getByRole('textbox',{name:'Membership code',exact:true});await expect(input).toBeVisible();await expect(input).toBeFocused();await noEffects(page);
 });
 test('changing account retires explicit entry without submitting or opening billing',async({page})=>{
  const entry=await notice(page);await entry.getByRole('button',{name:'Redeem code',exact:true}).click();
  const input=sheet(page).getByRole('textbox',{name:'Membership code',exact:true});await expect(input).toBeFocused();await input.fill('SYNTHETIC-OLD-ACCOUNT');
  await sheet(page).getByRole('button',{name:'Sign out',exact:true}).click();await expect(input).toHaveCount(0);await expect.poll(()=>page.evaluate(()=>(window as any).planController.getSnapshot().membershipCodeEntry===true)).toBe(false);await noEffects(page);
 });
});
