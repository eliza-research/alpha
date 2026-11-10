import {openConnectionDiagnostics} from './helpers/connection-diagnostics';
import {openCloudPlanFromSettings} from './helpers/cloud-plan-settings';
import {fenceNetwork,seedCompletedAccessSetup} from './flag-off-android';
import {observeCloudNotices} from './helpers/cloud-connection-notices';
import {test,expect,type Page} from '@playwright/test';
import {CREDENTIAL,entitlements,installNativeCloudPlanPorts,USER,type NativePlanFixture} from './helpers/native-cloud-plan-fixture';
import {createServer,type ViteDevServer} from 'vite';
import {resolve} from 'node:path';

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

// Synthetic, never a real grant code. 16 Crockford characters once normalized.
const CODE='synt-hetc-0de0-0001',NORMALIZED='SYNTHETC0DE00001';

async function boot(page:Page,initial:NativePlanFixture={}){
 page.on('pageerror',(error:Error)=>console.error('Composition page error:',error.message));
 await page.route('https://**',route=>route.abort());
 await installNativeCloudPlanPorts(page,initial);
 await page.goto(origin+(initial.fullApp?'/':'/subscription-composition'),{waitUntil:'commit'});
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
const accountPanel=(page:Page)=>page.getByRole('dialog',{name:/^Account$/});
const planDetails=(page:Page)=>accountPanel(page).getByRole('region',{name:'Balance and membership',exact:true});
const signInPage=(page:Page)=>page.locator('.alpha-cloud-sign-in[role="main"]');
async function openAccountPlan(page:Page){await page.evaluate(()=>(window as any).planController.openPlan());const panel=accountPanel(page);await expect(panel).toBeVisible();return panel;}
async function confirmBillingAccount(page:Page){
 await expect(page.getByRole('dialog',{name:'Review billing account',exact:true})).toHaveCount(0);
 await expect.poll(async()=>(await calls(page)).filter(c=>c.method==='openExternal').length).toBeGreaterThan(0);
}

async function confirmSignOut(page:Page){const dialog=page.getByRole('dialog',{name:'Sign out?',exact:true});await expect(dialog).toBeVisible();await dialog.getByRole('button',{name:'Sign out',exact:true}).click();}

/** No admissible plan: nothing opens by itself; the notice beside the running agent offers Redeem
 * code, which opens the plan panel (the notice's other action is Choose a plan). */
async function needsPlan(page:Page){
 const notice=page.getByRole('region',{name:'Eliza Cloud plan notice'});
 await expect(notice).toContainText('AI replies are off. Your agent is still running.');await expect(accountPanel(page)).toHaveCount(0);
 await expect(notice.getByRole('button',{name:'Choose a plan',exact:true})).toBeVisible();
 await notice.getByRole('button',{name:'Redeem code',exact:true}).click();
 const panel=accountPanel(page);await expect(panel).toBeVisible();return panel;
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
  await expect(page.getByRole('button',{name:'Manage plan',exact:true})).toBeVisible();
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
  await admitted(page);await openAccountPlan(page);await expect(planDetails(page).getByText('Synthetic plan',{exact:true})).toBeVisible();await expect(planDetails(page).getByText('Trial',{exact:true})).toBeVisible();await release(page);
 });

 test('a past-due plan is admitted with a clear warning and the hosted plan page',async({page},info)=>{
  await boot(page,{...await entitlements(),plan:'past_due'});
  await admitted(page);await openAccountPlan(page);
  await expect(planDetails(page).getByText('Synthetic plan',{exact:true})).toBeVisible();
  await expect(planDetails(page).getByText('Payment due',{exact:true})).toBeVisible();
  await expect(planDetails(page).getByText('Update your payment details in Eliza Cloud to keep your subscription active.',{exact:true})).toBeVisible();
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:info.outputPath('past-due-warning.png'),animations:'disabled'});
  await release(page);
  await page.getByRole('button',{name:'Manage plan',exact:true}).click();await confirmBillingAccount(page);
  await expect.poll(async()=>(await calls(page)).filter(c=>c.method==='openExternal').map(c=>c.url)).toEqual(['https://cloud.eliza.app/cloud/billing']);
 });

 for(const status of ['canceled','none'] as const)test(`a ${status} plan shows "needs plan" beside the running agent and binds no inference`,async({page},info)=>{
  await boot(page,{...await entitlements(),plan:status});
  await needsPlan(page);
  await expect(planDetails(page).getByText('No active subscription',{exact:true})).toBeVisible();
  await expect(planDetails(page).getByText('Active',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('textbox',{name:'Membership code'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Redeem',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Check plan again',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Use local apps without AI',exact:true})).toHaveCount(0);
  // The plan notice can be closed: it never withholds the agent (P-43).
  await expect(page.getByRole('button',{name:'Close Account',exact:true})).toBeVisible();
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
  await expect(planDetails(page).getByText('No active subscription',{exact:true})).toBeVisible();
  await expect(planDetails(page).getByText('Active',{exact:true})).toHaveCount(0);
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
  await expect(planDetails(page).getByText('Plus',{exact:true})).toBeVisible();
  if(limits==='past_due')await expect(planDetails(page).getByText('Payment due',{exact:true})).toBeVisible();
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
  const panel=accountPanel(page);await expect(panel).toBeVisible();
  await expect(planDetails(page).getByText('No active subscription',{exact:true})).toBeVisible();
  await expect(panel.getByRole('button',{name:'Choose a plan',exact:true})).toBeVisible();
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
  const panel=accountPanel(page);await expect(panel).toBeVisible();
  const before=await configured(page);
  await expect(panel.getByRole('button',{name:'Choose a plan',exact:true})).toBeVisible();
  await panel.getByRole('button',{name:'Use code',exact:true}).click();
  await panel.getByRole('textbox',{name:'Membership code'}).fill(CODE);
  await panel.getByRole('button',{name:'Redeem',exact:true}).click();
  await expect(panel.getByRole('alert')).toHaveText('This code could not be redeemed. Check the code and try again.');
  await expect(panel.getByRole('textbox',{name:'Membership code'})).toHaveValue(CODE);
  await expect(planDetails(page).getByText('No active subscription',{exact:true})).toBeVisible();
  expect(await configured(page)).toBe(before);
  const routes=(await calls(page)).filter(c=>c.method==='request');
  expect(routes.filter(c=>c.path==='/api/v1/subscription/redeem').map(c=>[c.httpMethod,c.url])).toEqual([['POST','https://api.eliza.app/api/v1/subscription/redeem']]);
  expect(routes.some(c=>c.path==='/api/signup-code/redeem'||c.path==='/api/v1/credits/balance')).toBe(false);
 });
 test('a valid signed allowance remains usable with zero USD without a cash preflight or automatic redemption',async({page})=>{
  await boot(page,{...await entitlements(),plan:'active',holdProvider:false,cashBalance:0});
  await expect.poll(()=>configured(page)).toBe(1);await idle(page);
  await page.evaluate(()=>(window as any).planController.openPlan());
  const panel=accountPanel(page);await expect(panel).toBeVisible();
  await expect(panel.getByText('Synthetic plan',{exact:true})).toBeVisible();
  await panel.getByRole('button',{name:'Use code',exact:true}).click();
  await expect(panel.getByRole('textbox',{name:'Membership code'})).toBeVisible();
  const routes=(await calls(page)).filter(c=>c.method==='request').map(c=>c.path);
  expect(routes).not.toContain('/api/v1/credits/balance');expect(routes).not.toContain('/api/v1/subscription/redeem');
  expect(await page.evaluate(()=>(window as any).planFixture.cashBalance)).toBe(0);
  expect(await page.evaluate(()=>(window as any).planController.getSnapshot().residentSubscription.kind)).toBe('active');
 });
 test('an active plan at zero credit balance shows one subscription and no cash or top-up controls',async({page})=>{
  await boot(page,{...await entitlements(),plan:'active',limits:'active',credits:'0',holdProvider:false});
  await expect.poll(()=>configured(page)).toBe(1);await idle(page);
  await expect.poll(()=>page.evaluate(()=>(window as any).planController.getSnapshot().membershipCredits?.usd)).toBe('0');
  await page.evaluate(()=>(window as any).planController.openPlan());
  const panel=accountPanel(page);await expect(panel).toBeVisible();
  const subscription=panel.getByRole('region',{name:'Balance and membership',exact:true});
  await expect(subscription.getByText('Synthetic plan',{exact:true})).toHaveCount(1);
  await expect(subscription.getByText('Active',{exact:true})).toBeVisible();
  await expect(subscription.getByRole('button',{name:'Manage plan',exact:true})).toBeVisible();
  await expect(panel).not.toContainText(/Available credits|Add credits|\$\d/);
  await expect(panel.locator('.alpha-membership-amount')).toHaveCount(0);
  await expect(panel.getByRole('region',{name:'Eliza Cloud plan',exact:true})).toHaveCount(0);
  await expect(panel.getByRole('heading',{name:'AI',exact:true})).toHaveCount(0);
  await expect(panel.getByText('Your agent uses Eliza Cloud for AI.',{exact:true})).toHaveCount(0);
  // An active plan admits the agent even though the backend reports zero cash balance.
  expect(await page.evaluate(()=>(window as any).planController.getSnapshot().membershipBalance)).toBe('member');
  const routes=(await calls(page)).filter(c=>c.method==='request').map(c=>c.path);
  expect(routes).toContain('/api/v1/billing/limits');expect(routes).not.toContain('/api/v1/credits/balance');
 });
 test('no plan source at all is unknown: needs plan with a retry, never admitted',async({page})=>{
  await boot(page,{route:'absent',limits:'absent'});
  await needsPlan(page);await idle(page);
  await expect(planDetails(page).getByText('Subscription not confirmed',{exact:true})).toBeVisible();
  await expect(planDetails(page).getByText('Subscription details could not be refreshed. Check again or manage your subscription.',{exact:true})).toBeVisible();
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
  // Cloud asks for a refresh 30 s out; the page clock runs past it instead of waiting.
  await page.clock.install();
  await boot(page,{...await entitlements({rfa:Math.floor(Date.now()/1000)+30}),holdProvider:false});
  await expect.poll(()=>configured(page)).toBe(1);await idle(page);
  const before=await page.evaluate(()=>localStorage.getItem('alpha.connection.plan-admission.v1'));
  await fixture(page,{route:'503'});
  await page.clock.runFor(30000);
  await expect.poll(()=>page.evaluate(()=>(window as any).planController.getSnapshot().residentSubscription?.refreshFailed)).toBe(true);
  expect(await page.evaluate(()=>localStorage.getItem('alpha.connection.plan-admission.v1'))).toBe(before);
 });
 test('a billing outage without a recent plan is "needs plan" with a retry',async({page})=>{
  await boot(page,{route:'503'});
  await needsPlan(page);await started(page);
  await expect(planDetails(page).getByText('Subscription not confirmed',{exact:true})).toBeVisible();
  await expect(planDetails(page).getByText('Subscription details could not be refreshed. Check again or manage your subscription.',{exact:true})).toBeVisible();
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
 // Owner, 2026-11-03: Cloud being unreachable shows no banner or status text.
 const noCloudNotice=async(page:Page)=>{
  await expect(page.getByRole('region',{name:'Eliza Cloud plan notice',exact:true})).toHaveCount(0);
  await expect(page.getByText(/Cloud cannot be reached/)).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).planController.getSnapshot().message)).toBe('');
 };
 test('offline with a recent plan: the resident runs and retains the saved sign-in without claiming verification',async({page},info)=>{
  const recent=JSON.stringify({version:1,environment:'production',credentialId:CREDENTIAL,userId:USER,organizationId:null,status:'active',planName:'Synthetic plan',verifiedAt:Date.now()-3600_000,endsAt:null});
  await boot(page,{identity:'offline',storage:{'alpha.connection.plan-admission.v1':recent}});
  await started(page);await idle(page);
  await expect.poll(()=>page.evaluate(()=>(window as any).planController.getSnapshot().residentPlanNotice)).toBe('offline');
  await noCloudNotice(page);
  await expect(signInPage(page)).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).planController.getSnapshot())).toMatchObject({cloudAccount:null,residentSavedCredential:true,residentPlanNotice:'offline',residentInference:'unknown'});
  expect((await calls(page)).filter(c=>c.method==='clearProvider'||c.plugin==='AlphaCloudSignIn'&&!['addListener','removeListener'].includes(c.method))).toEqual([]);
  expect(await configured(page)).toBe(0);
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:info.outputPath('offline-recent-plan.png'),animations:'disabled'});
 });
 for(const background of [false,true])test(`the network coming back${background?' while Alpha is in the background binds AI on the next return':' binds AI at once'}, with no Try again and inside the once-a-minute limit`,async({page})=>{
  const recent=JSON.stringify({version:1,environment:'production',credentialId:CREDENTIAL,userId:USER,organizationId:null,status:'active',planName:'Synthetic plan',verifiedAt:Date.now()-3600_000,endsAt:null});
  await boot(page,{...await entitlements(),identity:'offline',storage:{'alpha.connection.plan-admission.v1':recent}});
  await started(page);await idle(page);
  await expect.poll(()=>page.evaluate(()=>(window as any).planController.getSnapshot().residentPlanNotice)).toBe('offline');
  const identityReads=async()=>(await calls(page)).filter(c=>c.path==='/api/v1/user').length;
  // A return to the app while Cloud is unreachable checks once; a second return within a minute does not.
  const before=await identityReads();
  await page.evaluate(()=>(window as any).planController.recheckPlanOnReturn());
  await expect.poll(identityReads).toBe(before+1);
  await expect.poll(()=>page.evaluate(()=>(window as any).planController.getSnapshot().residentSubscription?.kind)).toBe('unavailable');
  await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));await idle(page);
  expect(await identityReads()).toBe(before+1);
  await noCloudNotice(page);
  await expect(page.getByRole('button',{name:'Try again',exact:true})).toHaveCount(0);
  expect(await configured(page)).toBe(0);
  // The network goes away and comes back while Cloud is still unreachable: one read, the plan stays
  // unknown with no notice or sign-in, and repeated online events read nothing more.
  await page.evaluate(()=>{for(const type of ['offline','online','online'])window.dispatchEvent(new Event(type));});
  await expect.poll(()=>page.evaluate(()=>(window as any).planController.getSnapshot().residentSubscription?.kind)).toBe('unavailable');
  expect(await identityReads()).toBe(before+2);
  await page.evaluate(()=>{window.dispatchEvent(new Event('online'));window.dispatchEvent(new Event('pageshow'));});await idle(page);
  expect(await identityReads()).toBe(before+2);
  expect(await page.evaluate(()=>(window as any).planController.getSnapshot().residentPlanNotice)).toBe('offline');
  await expect(signInPage(page)).toHaveCount(0);
  await noCloudNotice(page);
  // The network goes away and returns again: the plan is read again at once and Cloud AI is bound, with no tap.
  await fixture(page,{identity:'ok'});
  await page.evaluate(()=>window.dispatchEvent(new Event('offline')));
  if(background){
   // Wi-Fi and Airplane mode open Android Settings, so the network often returns while Alpha is hidden.
   await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});window.dispatchEvent(new Event('online'));});await idle(page);
   expect(await identityReads()).toBe(before+2);
   await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'));});
  }else await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  // Within the minute only the network's return could have read Cloud again (the rebind reads it once more).
  await admitted(page);
  expect(await identityReads()).toBeGreaterThan(before+2);
  await release(page);
  await noCloudNotice(page);
 });
 for(const age of ['stale','other-credential'] as const)test(`offline without a recent plan retains sign-in but unbinds inference (${age})`,async({page})=>{
  const record=JSON.stringify({version:1,environment:'production',credentialId:age==='other-credential'?'99999999-9999-4999-8999-999999999999':CREDENTIAL,userId:USER,organizationId:null,status:'active',planName:'Synthetic plan',verifiedAt:Date.now()-(age==='stale'?8:0)*24*3600_000,endsAt:null});
  await boot(page,{identity:'offline',storage:{'alpha.connection.plan-admission.v1':record}});
  await started(page);await idle(page);
  await expect.poll(()=>page.evaluate(()=>(window as any).planController.getSnapshot().residentPlanNotice)).toBe('offline');
  await noCloudNotice(page);
  await expect(signInPage(page)).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).planController.getSnapshot())).toMatchObject({cloudAccount:null,residentSavedCredential:true,residentPlanNotice:'offline',residentInference:'unavailable'});
  expect((await calls(page)).filter(c=>c.method==='clearProvider')).toHaveLength(1);
  expect((await calls(page)).filter(c=>c.plugin==='AlphaCloudSignIn'&&!['addListener','removeListener'].includes(c.method))).toEqual([]);
  expect(await configured(page)).toBe(0);
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
  // The membership refresh follows the actual provider binding. Complete the held native
  // promise instead of cancelling it, then verify the new subscription and its access window.
  await page.evaluate(()=>(window as any).planFixture.releaseProvider());await idle(page);
  await expect(planDetails(page).getByText('Active',{exact:true})).toBeVisible();
  await expect(planDetails(page).getByText(/^Access through /)).toBeVisible();
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
  await page.getByRole('button',{name:'Use code',exact:true}).click();
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
  const dialog=accountPanel(page);await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('region',{name:'Balance and membership',exact:true}).getByText('synthetic-plan@example.invalid',{exact:true})).toBeVisible();
  for(const name of ['Use code','Manage plan','Sign out'])await expect(dialog.getByRole('button',{name,exact:true})).toBeVisible();
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:info.outputPath('plan-panel.png'),animations:'disabled'});
  await dialog.getByRole('button',{name:'Sign out',exact:true}).click();await confirmSignOut(page);
  // Signed out, the dedicated page returns and the agent restarts without Cloud inference.
  await expect(signInPage(page)).toBeVisible();await expect(signInPage(page).getByRole('button',{name:'Email me a code',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem('alpha.connection.plan-admission.v1'))).toBeNull();
  expect(await page.evaluate(()=>(window as any).planController.residentPlanSettings())).toMatchObject({signedIn:false,plan:'Not signed in'});
 });

 test('a sign-in key that expires within 14 days is warned about and offers re-approval',async({page},info)=>{
  await boot(page,{...await entitlements(),expiresAt:Date.now()+5*24*3600_000});
  await admitted(page);await openAccountPlan(page);
  await expect(page.getByText(/Sign-in expires soon\./)).toBeVisible();
  expect(await page.evaluate(()=>(window as any).planController.residentPlanSettings().keyExpiring)).toBe(true);
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:info.outputPath('sign-in-expiry-warning.png'),animations:'disabled'});
  await release(page);
  await page.getByRole('button',{name:'Approve this phone again',exact:true}).click();
  // Re-approval opens the native email form without sending a code until explicitly requested.
  await expect(page.getByRole('textbox',{name:'Email',exact:true})).toBeVisible();
  expect((await calls(page)).some(c=>c.plugin==='AlphaCloudSignIn'&&c.method==='status')).toBe(true);
  expect((await calls(page)).filter(c=>c.path?.startsWith('/api/auth/cli-session')||c.method==='openExternal'||c.method==='startEmail')).toEqual([]);
 });

 // The warning starts at 14 days left: one hour either side of it, and the fixture's 60-day key.
 for(const [left,label,warned] of [[60*24*3600_000,'60 days',false],[14*24*3600_000+3600_000,'just over 14 days',false],[14*24*3600_000-3600_000,'just under 14 days',true]] as const)test(`a key with ${label} left ${warned?'shows an':'shows no'} expiry warning`,async({page})=>{
  await boot(page,{...await entitlements(),expiresAt:Date.now()+left});
  await admitted(page);await openAccountPlan(page);
  await expect(page.getByRole('button',{name:'Approve this phone again',exact:true})).toHaveCount(warned?1:0);
  expect(await page.evaluate(()=>(window as any).planController.residentPlanSettings().keyExpiring)).toBe(warned);
  await release(page);
 });
});

test('failed native provider binding reports unconfirmed inference and exposes the error before history',async({page})=>{
 const pageErrors:string[]=[];page.on('pageerror',error=>pageErrors.push(error.message));
 await boot(page,{...await entitlements(),holdProvider:false,providerFailure:'Synthetic account verification failure',fullApp:true});await started(page);await idle(page);
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await openConnectionDiagnostics(page);
 const settings=page.getByRole('region',{name:'Settings',exact:true});
 await expect(settings.getByText('AI status unconfirmed',{exact:true})).toBeVisible();
 const error=settings.getByText(/Synthetic account verification failure/);await expect(error).toBeVisible();
 await expect(error).toContainText('AI could not be confirmed off. Your agent is running; retry in Settings.');
 const history=settings.getByText('Conversation history',{exact:true});await expect(history).toBeVisible();
 expect(await error.evaluate((node,other)=>(node.compareDocumentPosition(other!)&Node.DOCUMENT_POSITION_FOLLOWING)!==0,await history.elementHandle())).toBe(true);
 expect(await configured(page)).toBe(1);
 // The configure call failed before returning a binding guard. The client cannot claim the
 // old provider was removed, and must not clear it with a fresh, unscoped mutation.
 expect(await page.evaluate(()=>(window as any).planController.getSnapshot().residentInference)).toBe('unknown');
 expect((await calls(page)).some(c=>c.plugin==='Agent'&&c.method==='clearProvider')).toBe(false);
 expect(await page.evaluate(()=>(window as any).residentAgent.state.unexpected)).toEqual([]);
 expect(pageErrors).toEqual([]);
});

// UI progress only: this feature fixture does not manufacture OS/provider grants.
test.beforeEach(async({page})=>seedCompletedAccessSetup(page));


test.describe('explicit membership code entry',()=>{
 async function notice(page:Page){
  await boot(page,{...await entitlements(),plan:'none',cashBalance:5,holdProvider:false});await started(page);await idle(page);
  const notice=page.getByRole('region',{name:'Eliza Cloud plan notice'});await expect(notice).toBeVisible();return notice;
 }
 // On the phone's own agent the plan action opens the resident account & plan panel, which carries
 // the Subscription controls (code entry included) beside the plan headline and actions.
 const sheet=accountPanel;
 async function noEffects(page:Page){expect((await calls(page)).filter(c=>c.path==='/api/v1/subscription/redeem'||c.method==='openExternal')).toEqual([]);}
 test('one explicit Redeem code click reveals and focuses the current account input',async({page},info)=>{
  const entry=await notice(page);await entry.getByRole('button',{name:'Redeem code',exact:true}).click();
  const input=sheet(page).getByRole('textbox',{name:'Membership code',exact:true});await expect(input).toBeVisible();await expect(input).toBeFocused();
  await page.screenshot({path:info.outputPath('explicit-code-mobile.png'),animations:'disabled'});await page.setViewportSize({width:1280,height:900});await expect(input).toBeVisible();await page.screenshot({path:info.outputPath('explicit-code-desktop.png'),animations:'disabled'});
  await input.fill('SYNTHETIC-UNSUBMITTED');await sheet(page).getByRole('button',{name:'Refresh account',exact:true}).click();await expect(input).toHaveValue('SYNTHETIC-UNSUBMITTED');
  await noEffects(page);
 });
 test('closing explicit entry retires its draft and ordinary plan entry stays collapsed',async({page})=>{
  const entry=await notice(page);await entry.getByRole('button',{name:'Redeem code',exact:true}).click();
  const input=sheet(page).getByRole('textbox',{name:'Membership code',exact:true});await expect(input).toBeFocused();await input.fill('SYNTHETIC-OLD-DRAFT');
  await sheet(page).getByRole('button',{name:'Close Account',exact:true}).click();
  await page.evaluate(()=>(window as any).planController.openPlan());await expect(sheet(page)).toBeVisible();await expect(sheet(page).getByRole('textbox',{name:'Membership code',exact:true})).toHaveCount(0);
  await sheet(page).getByRole('button',{name:'Use code',exact:true}).click();const fresh=sheet(page).getByRole('textbox',{name:'Membership code',exact:true});await expect(fresh).toHaveValue('');await expect(fresh).toBeFocused();await noEffects(page);
 });
 test('cancelling current controller work retires the explicit draft',async({page})=>{
  const entry=await notice(page);await entry.getByRole('button',{name:'Redeem code',exact:true}).click();
  const input=sheet(page).getByRole('textbox',{name:'Membership code',exact:true});await input.fill('SYNTHETIC-CANCELLED');
  await page.evaluate(()=>(window as any).planController.cancel());await expect(input).toHaveCount(0);
  await sheet(page).getByRole('button',{name:'Use code',exact:true}).click();await expect(input).toHaveValue('');await expect(input).toBeFocused();await noEffects(page);
 });
 test('Settings Redeem code opens the existing field directly',async({page})=>{
  await boot(page,{...await entitlements(),plan:'none',cashBalance:5,holdProvider:false,fullApp:true});await started(page);await idle(page);
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await openCloudPlanFromSettings(page);
  await sheet(page).getByRole('button',{name:'Use code',exact:true}).click();
  const input=sheet(page).getByRole('textbox',{name:'Membership code',exact:true});await expect(input).toBeVisible();await expect(input).toBeFocused();await noEffects(page);
 });
 test('changing account retires explicit entry without submitting or opening billing',async({page})=>{
  const entry=await notice(page);await entry.getByRole('button',{name:'Redeem code',exact:true}).click();
  const input=sheet(page).getByRole('textbox',{name:'Membership code',exact:true});await expect(input).toBeFocused();await input.fill('SYNTHETIC-OLD-ACCOUNT');
  await sheet(page).getByRole('button',{name:'Sign out',exact:true}).click();await confirmSignOut(page);await expect(input).toHaveCount(0);await expect.poll(()=>page.evaluate(()=>(window as any).planController.getSnapshot().membershipCodeEntry===true)).toBe(false);await noEffects(page);
 });
});

test('simultaneous plan and expiry notices keep their own actions after Settings', async ({page}) => {
  test.setTimeout(360_000);
  const foreign = await fenceNetwork(page);
  await boot(page, {...await entitlements(), plan:'none', expiresAt:Date.now()+5*24*3600_000,
    holdProvider:false, fullApp:true});
  const plan = page.getByRole('region', {name:'Eliza Cloud plan notice', exact:true});
  const expiry = page.getByRole('region', {name:'Eliza Cloud sign-in notice', exact:true});
  await expect(plan).toBeVisible({timeout:90_000});
  await expect(expiry).toBeVisible();
  const together = await observeCloudNotices(page);
  await page.getByRole('button', {name:'Settings', exact:true}).click();
  await expect(page.locator('[data-settings-page]:visible')).toHaveCount(1);
  const settings = await observeCloudNotices(page);
  expect(settings.notices.map(({kind,visible}) => [kind,visible])).toEqual([['plan',false],['sign-in',false]]);
  await page.evaluate(() => window.dispatchEvent(new Event('alpha-back', {cancelable:true})));
  await expect(plan).toBeVisible();
  await expect(expiry).toBeVisible();
  const returned = await observeCloudNotices(page);
  await expiry.getByRole('button', {name:'Dismiss sign-in notice', exact:true}).click();
  await expect(expiry).toHaveCount(0);
  await expect(plan).toBeVisible();
  expect((await observeCloudNotices(page)).notices.map(({kind}) => kind)).toEqual(['plan']);
  expect(foreign).toEqual([]);
  expect((await calls(page)).filter(call => call.method==='openExternal' || call.method==='startEmail' ||
    call.path?.endsWith('/redeem'))).toEqual([]);
  for (const state of [together,returned]) {
    expect(state.notices.map(({kind}) => kind)).toEqual(['plan','sign-in']);
    expect(state.notices.flatMap(({actions}) => actions.filter(({owned}) => !owned))).toEqual([]);
  }
});
