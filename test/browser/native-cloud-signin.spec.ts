import {seedCompletedAccessSetup} from './flag-off-android';
import {test,expect,type Page} from '@playwright/test';
import {createServer,type ViteDevServer} from 'vite';
import {resolve} from 'node:path';
import {webcrypto} from 'node:crypto';

// In-app Eliza Cloud sign-in (owner directive 2026-10-14) on the actual flag-off Android chooser and
// controller composition. Only native ports are synthetic: AlphaCloudSignIn stands in for the native
// Steward + mobile App Auth client and "stores" a synthetic key the way the plugin does. No device,
// account, browser, Google consent, App Link verification, Cloud request or real code is involved.
let server:ViteDevServer,origin:string;
test.beforeAll(async()=>{
 const previous=process.env.ELIZA_DEV_ALLOW_TEST_MOCKS;process.env.ELIZA_DEV_ALLOW_TEST_MOCKS='';
 try{server=await createServer({configFile:resolve('vite.config.ts'),configLoader:'native',cacheDir:resolve('test-results/native-cloud-signin/vite-cache'),server:{host:'127.0.0.1',port:0},define:{'import.meta.env.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS':JSON.stringify('')},plugins:[{name:'native-signin-composition',resolveId(id){if(id==='/subscription-entry.tsx')return '\0subscription-entry';},load(id){if(id==='\0subscription-entry')return `
 import React,{useSyncExternalStore} from 'react';
 import {createRoot} from 'react-dom/client';
 import '/src/prototype/prototype.css';
 import {Capacitor} from '@capacitor/core';
 Capacitor.getPlatform=()=> 'android';Capacitor.isNativePlatform=()=>true;
 const {ConnectionChooser,connectionController}=await import('/src/runtime/connection-ui.tsx');
 const {StartupPermissions}=await import('/src/startup-permissions.tsx');
 const flags=await import('/src/build-flags.ts');window.planFlags={native:Capacitor.getPlatform(),mocks:flags.testMocksEnabled};
 window.planController=connectionController;
 document.body.insertAdjacentHTML('afterbegin','<div class="os" style="position:fixed;inset:0;background:var(--bg)" aria-hidden="true"></div>');
 function Composition(){const state=useSyncExternalStore(connectionController.subscribe,connectionController.getSnapshot);return React.createElement(React.Fragment,null,React.createElement(ConnectionChooser),!state.open&&React.createElement(StartupPermissions));}
 createRoot(document.getElementById('root')).render(React.createElement(Composition));
 `;},configureServer(s){s.middlewares.use('/subscription-composition',async(_request,response)=>{response.setHeader('Content-Type','text/html');response.end(await s.transformIndexHtml('/subscription-composition','<div id="root"></div><script type="module" src="/subscription-entry.tsx"></script>'));});}}]});}finally{if(previous===undefined)delete process.env.ELIZA_DEV_ALLOW_TEST_MOCKS;else process.env.ELIZA_DEV_ALLOW_TEST_MOCKS=previous;}
 await server.listen();origin=`http://127.0.0.1:${(server.httpServer!.address()as {port:number}).port}`;
});
test.afterAll(async()=>{await server?.close();});

const USER='22222222-2222-4222-8222-222222222222';
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


type SignInMode='ok'|'created'|'mfa'|'hold'|'offline'|'readiness-hold'|'not-ready';
async function boot(page:Page,initial:{signIn?:SignInMode;tokens?:Record<string,string>;keys?:unknown[];serviceName?:string;legalParagraphs?:string[];keyLifetimeMs?:number;methods?:{email:boolean;phone:boolean;google:boolean}}={}){
 page.on('pageerror',(error:Error)=>console.error('Composition page error:',error.message));
 await page.route('https://**',route=>route.abort());
 await page.addInitScript(initial=>{
  const w=window as any;
  if(!sessionStorage.getItem('signin-fixture-seeded')){sessionStorage.setItem('signin-fixture-seeded','1');localStorage.setItem('alpha.startup-permissions.v1',JSON.stringify({dismissed:true,attempted:{}}));}
  const f=w.signInFixture={signIn:'ok',...initial,saved:false as boolean,credential:null as any,running:false,bound:false,calls:[] as any[],release:null as null|((error:unknown)=>void)};
  const names={AlphaConnection:['secureRead','secureWrite','secureRemove','request','cancel','openExternal'],AlphaCloudSignIn:['serviceInfo','startPhone','verifyPhone','startGoogle','startEmail','verifyEmail','verifyMfa','cancel','status','addListener','removeListener'],Agent:['start','stop','getStatus','configureCloudProvider','clearProvider','providerStatus','residentAttachment','request','addListener','requestStream','cancelStream'],DailyApps:['addListener','removeListener'],AlphaNotifications:['status'],AlphaVoiceCloud:['checkPermissions'],AlphaHostedResults:['disableBackground']};
  const fail=(code:string)=>Object.assign(new Error(code),{code});
  // The native host stores the key before reporting success and returns only non-secret fields.
  const store=()=>{f.saved=true;f.credential={credentialId:crypto.randomUUID(),token:'synthetic-mobile-key',expiresAt:Date.now()+((f as any).keyLifetimeMs??30*24*3600*1000),serverCredentialId:'55555555-5555-4555-8555-555555555555'};return {status:'authenticated',environment:'production',expiresAt:f.credential.expiresAt,accountCreated:f.signIn==='created'};};
  const reply=(status:number,body:unknown)=>({status,body:JSON.stringify(body)});
  w.Capacitor={PluginHeaders:Object.entries(names).map(([name,methods])=>({name,methods:methods.map(name=>({name,rtype:'promise'}))})),nativePromise:async(plugin:string,method:string,input:any)=>{
   f.calls.push({plugin,method,path:input?.url?new URL(input.url).pathname:input?.path,email:input?.email,phone:input?.phone,environment:input?.environment,refreshNegative:input?.refreshNegative});
   if(plugin==='AlphaCloudSignIn'){
    if(method==='addListener'||method==='removeListener')return {};
    if(method==='serviceInfo'){const doc={title:'Terms of Service',revision:'fixture-v1',sections:[{title:'Provider terms',paragraphs:f.legalParagraphs||['<img src=x onerror=alert(1)> is plain text.','Synthetic provider document.']}]};return {success:true,version:1,service:{name:f.serviceName||'Eliza Cloud',terms:doc,privacy:{...doc,title:'Privacy Policy'}}};}
    if(method==='cancel'){f.release?.(fail('cancelled'));f.release=null;return {};}
    if(method==='status'&&f.signIn==='readiness-hold')return new Promise(resolve=>{(f as any).releaseReadiness=()=>resolve({active:false,inApp:true,google:true,email:true,phone:true});});
    if(method==='status'&&f.methods)return {active:false,inApp:Object.values(f.methods).some(Boolean),methodsKnown:true,...f.methods};
    if(method==='status')return f.signIn==='not-ready'?{active:false,inApp:false,google:false,email:false}:{active:false,inApp:true,google:true,email:true,phone:true};
    if(method==='startGoogle'){if(f.signIn==='hold')return new Promise((_,reject)=>{f.release=reject;});return store();}
    if(method==='startEmail'||method==='startPhone'){if(f.signIn==='offline')throw fail('offline');return {attemptId:'33333333-3333-4333-8333-333333333333',expiresAt:Date.now()+600000,resendAt:Date.now()+60000};}
    if(method==='verifyEmail'||method==='verifyPhone'){if(input.code!=='123456')throw fail('invalid-code');if(f.signIn==='mfa')return {status:'mfa',method:'totp',expiresAt:Date.now()+300000};return store();}
    if(method==='verifyMfa'){if(input.code!=='654321')throw fail('invalid-code');return store();}
   }
   if(plugin==='Agent'){
    if(method==='getStatus')return {packaged:true,state:f.running?'listening':'stopped',serviceActive:f.running,socketListening:f.running};
    if(method==='start'){f.running=true;return {state:'ready'};}
    if(method==='stop'){f.running=false;return {};}
    if(method==='configureCloudProvider'){f.running=false;f.bound=true;return {configured:true};}
    if(method==='clearProvider'){if(f.bound)f.running=false;f.bound=false;return {configured:false};}
    if(method==='providerStatus')return {provider:'elizacloud',configured:f.bound,...(f.bound?{model:'cerebras/qwen-3.8-27b'}:{})};
    if(method==='residentAttachment')return {attachable:false,reason:'not-enrolled'};
    if(method==='addListener')return {remove:async()=>{}};
    if(method==='requestStream')throw Error('Native stream unavailable');
    if(method==='request'){
     if(!f.running)return reply(503,{});
     if(input.path==='/api/auth/me')return reply(200,{identity:{kind:'owner',id:'owner-1'},access:{role:'OWNER',mode:'local'}});
     if(input.path==='/api/agents')return reply(200,{agents:[{id:'44444444-4444-4444-8444-444444444444',name:'Alpha',status:'running'}]});
     return reply(404,{});
    }
    return {};
   }
   if(plugin==='AlphaNotifications')return {permissionGranted:false,appEnabled:false};
   if(plugin==='AlphaVoiceCloud')return {microphone:'prompt'};
   if(plugin==='DailyApps')return {remove:async()=>{}};
   if(plugin==='AlphaHostedResults')return {};
   if(plugin!=='AlphaConnection')throw Error('Unexpected native sign-in fixture port');
   if(method==='secureRead')return {value:f.saved&&input.slot==='cloud:production'?JSON.stringify(f.credential):null};
   if(method==='secureRemove'){if(input.slot==='cloud:production'){f.saved=false;f.credential=null;}return {};}
   if(method==='openExternal'){if(f.signIn==='not-ready'||f.signIn==='readiness-hold')return {};throw Error('In-app sign-in opens no page');}
   if(method!=='request')return {};
   const path=new URL(input.url).pathname;
   if(path==='/api/auth/cli-session')return {status:200,data:{sessionId:'b7a2c1d0-5e4f-4a3b-8c2d-1e0f9a8b7c6d',status:'pending',expiresAt:new Date(Date.now()+600000).toISOString()}};
   if(path==='/api/auth/cli-session/b7a2c1d0-5e4f-4a3b-8c2d-1e0f9a8b7c6d')return {status:200,data:{status:'pending'}};
   if(path==='/api/v1/user')return {status:200,data:{success:true,data:{id:'22222222-2222-4222-8222-222222222222',email:'synthetic-signin@example.invalid'}}};
   if(path==='/api/v1/subscription/entitlement-keys')return {status:200,data:{keys:f.keys??[]}};
   if(path==='/api/v1/subscription/entitlement')return {status:200,data:{entitlement:f.tokens[(f as any).entitlementStatus??'active']}};
   if(path==='/api/v1/billing/limits')return {status:404,data:{}};
   throw Error('Unexpected Cloud route '+path);
  }};
 },initial);
 await page.goto(origin+'/subscription-composition');
 // The composition imports the complete runtime before publishing its readiness marker.
 await expect.poll(()=>page.evaluate(()=>(window as any).planFlags),{timeout:30000}).toEqual({native:'android',mocks:false});
}
type Call={refreshNegative?:boolean;plugin:string;method:string;path?:string;email?:string;phone?:string;environment?:string};
const calls=(page:Page)=>page.evaluate(()=>(window as any).signInFixture.calls as Call[]);
const snapshot=(page:Page)=>page.evaluate(()=>(window as any).planController.getSnapshot());
const fixture=(page:Page)=>page.evaluate(()=>{const f=(window as any).signInFixture;return {saved:f.saved,bound:f.bound,running:f.running};});
async function agent(page:Page,inference:'cloud'|'unavailable'){
 await expect.poll(async()=>{const s=await snapshot(page);return {kind:s.kind,session:!!s.session,inference:s.residentInference};},{timeout:15000}).toEqual({kind:'resident',session:true,inference});
}
async function noHandOff(page:Page){
 const all=await calls(page);
 expect(all.filter(c=>c.method==='openExternal')).toEqual([]);
 expect(all.filter(c=>c.path?.startsWith('/api/auth/cli-session')||c.path?.startsWith('/steward/')||c.path?.startsWith('/api/v1/app-auth/'))).toEqual([]);
}
// The same sign-in surface keeps its identity as its heading changes for codes and legal text.
const signInDialog=(page:Page)=>page.locator('.alpha-cloud-sign-in');
async function readySignIn(page:Page){
 await expect.poll(async()=>(await snapshot(page)).signIn?.step).toBe('choose');
 await expect(signInDialog(page)).toBeVisible();
}

async function revealOtherMethods(page:Page){
 const toggle=signInDialog(page).getByRole('button',{name:'Other sign-in methods',exact:true});
 if(await toggle.isVisible())await toggle.click();
}

test.describe('in-app Eliza Cloud sign-in on the production Android composition',()=>{
 test('email code sign-in stays in Alpha, retries a wrong code, waits out resend and binds Cloud AI',async({page},info)=>{
  await boot(page,await entitlements());
  await expect(signInDialog(page).getByRole('heading',{name:'Welcome to Alpha.',exact:true})).toBeVisible();
  await agent(page,'unavailable');
  await readySignIn(page);
  const dialog=signInDialog(page);await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Continue with Google',exact:true})).toBeVisible();
  await expect(dialog.getByText(/in your browser/)).toHaveCount(0);
  // The chooser shows Google, email and phone together (#651 removed the "Other sign-in methods" disclosure).
  await expect(dialog.getByRole('button',{name:'Other sign-in methods',exact:true})).toHaveCount(0);
  await expect(dialog.getByRole('textbox',{name:'Email',exact:true})).toBeVisible();
  await expect(dialog.getByLabel('Phone number with country code')).toBeVisible();
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:info.outputPath('sign-in-choose.png'),animations:'disabled'});
 await revealOtherMethods(page);
  await dialog.getByRole('textbox',{name:'Email',exact:true}).fill('not-an-address');await dialog.getByRole('button',{name:'Email me a code',exact:true}).click();
  expect((await calls(page)).filter(c=>c.method==='startEmail')).toHaveLength(0);
 await revealOtherMethods(page);
  await dialog.getByRole('textbox',{name:'Email',exact:true}).fill('  synthetic-signin@example.invalid ');
  await dialog.getByRole('button',{name:'Email me a code',exact:true}).click();
  await expect(dialog.getByRole('form',{name:'Enter your email code'})).toBeVisible();
  await expect(dialog.getByText('synthetic-signin@example.invalid',{exact:true})).toBeVisible();
  await expect(dialog.getByRole('button',{name:/^Resend code in \d+s$/})).toBeDisabled();
  expect((await calls(page)).find(c=>c.method==='startEmail')).toMatchObject({email:'synthetic-signin@example.invalid',environment:'production'});
  await dialog.getByLabel('Six-digit code').fill('000000');await dialog.getByRole('button',{name:'Verify',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('That code did not work');
  // A rejected code stays editable for correction; it is never stored as a credential.
  await expect(dialog.getByLabel('Six-digit code')).toHaveValue('000000');
  await expect(dialog.getByLabel('Six-digit code')).toBeFocused();
  expect((await fixture(page)).saved).toBe(false);
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:info.outputPath('sign-in-code.png'),animations:'disabled'});
  await dialog.getByLabel('Six-digit code').fill('123 456');await dialog.getByRole('button',{name:'Verify',exact:true}).click();
  await agent(page,'cloud');
  await expect.poll(async()=>(await fixture(page)).bound).toBe(true);
  await expect(signInDialog(page)).toHaveCount(0);
  await noHandOff(page);
  const snap=await snapshot(page);expect(snap.cloudAccount?.userId).toBe(USER);expect(JSON.stringify(snap)).not.toContain('synthetic-mobile-key');
 });

 test('email cooldown starts when the host sends the code, even after time spent entering an address',async({page})=>{
  await page.clock.install();
  await boot(page,await entitlements());
  await agent(page,'unavailable');
  await readySignIn(page);
  const dialog=signInDialog(page);
  // Change wall time without a timer tick: the host's new cooldown must not use panel-mount time.
  const later=await page.evaluate(()=>Date.now()+120000);
  await page.clock.setSystemTime(later);
 await revealOtherMethods(page);
  await dialog.getByRole('textbox',{name:'Email',exact:true}).fill('synthetic-signin@example.invalid');
  await dialog.getByRole('button',{name:'Email me a code',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Resend code in 60s',exact:true})).toBeDisabled();
  await page.clock.runFor(60000);
  await expect(dialog.getByRole('button',{name:'Resend code',exact:true})).toBeEnabled();
  await noHandOff(page);
 });

 test('Google readiness can be retried after Android finishes verifying the return link',async({page})=>{
  await boot(page,{...await entitlements(),methods:{email:true,phone:true,google:false}});
  await agent(page,'unavailable');
  await readySignIn(page);
  const dialog=signInDialog(page);
  await expect(dialog.getByRole('button',{name:'Continue with Google',exact:true})).toBeDisabled();
  const retry=dialog.getByRole('button',{name:'Retry sign-in options',exact:true});
  await expect(retry).toBeEnabled();
  await page.evaluate(()=>{(window as any).signInFixture.methods.google=true;});
  await retry.click();
  await expect(dialog.getByRole('button',{name:'Continue with Google',exact:true})).toBeEnabled();
  expect((await calls(page)).filter(c=>c.plugin==='AlphaCloudSignIn'&&c.method==='status').at(-1)?.refreshNegative).toBe(true);
  await noHandOff(page);
 });

 test('a slow sign-in readiness check shows progress, prevents repeated taps and respects Cancel',async({page})=>{
  await boot(page,{...await entitlements(),signIn:'readiness-hold'});
  await agent(page,'unavailable');
  const welcome=signInDialog(page);
  const google=welcome.getByRole('button',{name:'Continue with Google',exact:true});
  await expect(google).toBeDisabled({timeout:2000});
  await expect(welcome.getByText('Checking Eliza Cloud sign-in…',{exact:true})).toBeVisible();
  await welcome.getByRole('button',{name:'Cancel sign-in',exact:true}).click();
  const retry=welcome.getByRole('button',{name:'Retry sign-in',exact:true});
  await expect(retry).toBeEnabled({timeout:2000});
  // A late readiness result cannot admit the cancelled attempt or open a browser hand-off.
  await page.evaluate(()=>(window as any).signInFixture.releaseReadiness());
  await expect(retry).toBeEnabled();
  await expect(google).toBeDisabled();
  expect((await snapshot(page)).signIn).toBeNull();
  expect((await calls(page)).filter(c=>c.method==='status'&&c.plugin==='AlphaCloudSignIn')).toHaveLength(1);
  await noHandOff(page);
  await agent(page,'unavailable');
 });

 test('a plan ending during readiness still rebinds inference and keeps the requested sign-in screen',async({page})=>{
  await boot(page,{...await entitlements(),keyLifetimeMs:3600000});
  await agent(page,'unavailable');
  await readySignIn(page);
  await signInDialog(page).getByRole('button',{name:'Continue with Google',exact:true}).click();
  await agent(page,'cloud');
  await page.evaluate(()=>{(window as any).signInFixture.signIn='readiness-hold';(window as any).planController.openPlan();});
  await page.getByRole('button',{name:'Approve this phone again',exact:true}).click();
  await expect(page.getByText('Checking Eliza Cloud sign-in…',{exact:true})).toBeVisible();
  await page.evaluate(()=>{(window as any).signInFixture.entitlementStatus='none';(window as any).planController.recheckPlanAfterRefusal();});
  await expect.poll(async()=>(await snapshot(page)).residentPlanNotice).toBe('needs-plan');
  expect((await snapshot(page)).busy).toBe(true);
  await page.evaluate(()=>(window as any).signInFixture.releaseReadiness());
  await agent(page,'unavailable');
  await expect(signInDialog(page)).toBeVisible();
  await expect(signInDialog(page).getByRole('button',{name:'Continue with Google',exact:true})).toBeEnabled();
  expect(await fixture(page)).toMatchObject({saved:true,bound:false,running:true});
  expect((await calls(page)).filter(c=>c.method==='startGoogle')).toHaveLength(1);
  await noHandOff(page);
 });

 for(const mode of ['not-ready','readiness-hold'] as const){
  test(`${mode==='not-ready'?'Unavailable':'Timed-out'} readiness keeps email sign-in in Alpha without Google`,async({page})=>{
   if(mode==='readiness-hold')await page.clock.install();
   await boot(page,{...await entitlements(),signIn:mode});
   await agent(page,'unavailable');
   if(mode==='readiness-hold'){
    await expect(page.getByText('Checking Eliza Cloud sign-in…',{exact:true})).toBeVisible();
    await page.clock.runFor(6000);
   }
   await readySignIn(page);
   const dialog=signInDialog(page);
   await expect(dialog).toBeVisible();
   await expect(dialog.getByRole('button',{name:'Continue with Google',exact:true})).toBeDisabled();
   expect(await fixture(page)).toMatchObject({saved:false,bound:false,running:true});
   if(mode==='readiness-hold'){
    // A validated late answer updates only the same still-current chooser (cloud-sign-in-late-readiness).
    await page.evaluate(()=>(window as any).signInFixture.releaseReadiness());
    await expect(dialog.getByRole('button',{name:'Continue with Google',exact:true})).toBeEnabled();
   }else await expect(dialog.getByRole('button',{name:'Continue with Google',exact:true})).toBeDisabled();
   await dialog.getByRole('textbox',{name:'Email',exact:true}).fill('synthetic-signin@example.invalid');
   await dialog.getByRole('button',{name:'Email me a code',exact:true}).click();
   await dialog.getByLabel('Six-digit code').fill('123456');
   await dialog.getByRole('button',{name:'Verify',exact:true}).click();
   await agent(page,'cloud');
   expect(await fixture(page)).toMatchObject({saved:true,bound:true,running:true});
   await noHandOff(page);
  });
 }

 test('Continue with Google returns through the native host and an unexpected new account is said out loud',async({page},info)=>{
  await boot(page,{...await entitlements(),signIn:'created'});
  await agent(page,'unavailable');
  await readySignIn(page);
  await signInDialog(page).getByRole('button',{name:'Continue with Google',exact:true}).click();
  await agent(page,'cloud');
  await expect(page.getByText(/This sign-in created a new Eliza Cloud account \(synthetic-signin@example\.invalid\)/)).toBeVisible();
  expect((await calls(page)).filter(c=>c.method==='startGoogle').map(c=>c.environment)).toEqual(['production']);
  await noHandOff(page);
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:info.outputPath('sign-in-account-created.png'),animations:'disabled'});
 });

 test('cancelling a Google sign-in burns the pending attempt, stores nothing and keeps the agent running',async({page})=>{
  await boot(page,{...await entitlements(),signIn:'hold'});
  await agent(page,'unavailable');
  await readySignIn(page);
  const dialog=signInDialog(page);
  await dialog.getByRole('button',{name:'Continue with Google',exact:true}).click();
  await expect(dialog.getByText('Continue with Google in your browser. You’ll return to Alpha to finish signing in.',{exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Cancel sign-in',exact:true}).click();
  await expect.poll(async()=>(await calls(page)).some(c=>c.plugin==='AlphaCloudSignIn'&&c.method==='cancel')).toBe(true);
  await expect(dialog.getByRole('button',{name:'Continue with Google',exact:true})).toBeEnabled();
  expect(await fixture(page)).toMatchObject({saved:false,bound:false});
  await agent(page,'unavailable');
  // Required sign-in returns to the usable chooser and still cannot be dismissed.
  await expect(dialog.getByRole('heading',{name:'Welcome to Alpha.',exact:true})).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Back',exact:true})).toHaveCount(0);
  await noHandOff(page);
 });

 test('a second verification step is completed in Alpha',async({page})=>{
  await boot(page,{...await entitlements(),signIn:'mfa'});
  await agent(page,'unavailable');
  await readySignIn(page);
  const dialog=signInDialog(page);
 await revealOtherMethods(page);
  await dialog.getByRole('textbox',{name:'Email',exact:true}).fill('synthetic-signin@example.invalid');await dialog.getByRole('button',{name:'Email me a code',exact:true}).click();
  await dialog.getByLabel('Six-digit code').fill('123456');await dialog.getByRole('button',{name:'Verify',exact:true}).click();
  await expect(dialog.getByRole('form',{name:'Enter your verification code'})).toBeVisible();
  await expect(dialog.getByText('This account uses an authenticator app. Enter its six-digit code.',{exact:true})).toBeVisible();
  expect((await fixture(page)).saved).toBe(false);
  await dialog.getByLabel('Six-digit code').fill('654321');await dialog.getByRole('button',{name:'Verify',exact:true}).click();
  await agent(page,'cloud');
  await noHandOff(page);
 });

 test('offline sign-in explains itself and stores nothing',async({page})=>{
  await boot(page,{...await entitlements(),signIn:'offline'});
  await agent(page,'unavailable');
  await readySignIn(page);
  const dialog=signInDialog(page);
 await revealOtherMethods(page);
  await dialog.getByRole('textbox',{name:'Email',exact:true}).fill('synthetic-signin@example.invalid');await dialog.getByRole('button',{name:'Email me a code',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('Alpha could not reach Eliza Cloud');
  await expect(dialog.getByRole('form',{name:'Sign in with email'})).toBeVisible();
  expect(await fixture(page)).toMatchObject({saved:false,bound:false});
  await noHandOff(page);
 });
});

test.beforeEach(async({page})=>seedCompletedAccessSetup(page));

for (const mode of ['ok','mfa'] as const) test(`phone code stays inside Alpha through ${mode === 'mfa' ? 'MFA' : 'verification'}`,async({page})=>{
 await boot(page,{...await entitlements(),signIn:mode});
 await agent(page,'unavailable');
 await readySignIn(page);
 const dialog=signInDialog(page);
 await revealOtherMethods(page);
 await dialog.getByLabel('Phone number with country code').fill('+14155550100');
 await dialog.getByRole('button',{name:'Text me a code',exact:true}).click();
 await expect(dialog.getByRole('form',{name:'Enter your phone code'})).toBeVisible();
 await expect(dialog.getByRole('button',{name:/Resend code in/})).toBeDisabled();
 await dialog.getByLabel('Six-digit code').fill('000000');await dialog.getByRole('button',{name:'Verify',exact:true}).click();
 await expect(dialog.getByRole('alert')).toContainText('That code did not work');
 // A rejected code stays editable for correction; it is never stored as a credential.
  await expect(dialog.getByLabel('Six-digit code')).toHaveValue('000000');
 expect((await fixture(page)).saved).toBe(false);
 await dialog.getByLabel('Six-digit code').fill('123456');await dialog.getByRole('button',{name:'Verify',exact:true}).click();
 if(mode==='mfa'){
  await expect(dialog.getByRole('form',{name:'Enter your verification code'})).toBeVisible();
  expect((await fixture(page)).saved).toBe(false);
  await dialog.getByLabel('Six-digit code').fill('654321');await dialog.getByRole('button',{name:'Verify',exact:true}).click();
 }
 await agent(page,'cloud');await noHandOff(page);
 expect((await calls(page)).filter(c=>c.method==='startPhone')).toMatchObject([{phone:'+14155550100',environment:'production'}]);
 expect((await calls(page)).filter(c=>c.method==='verifyEmail'||c.method==='startEmail')).toEqual([]);
});

test('phone code cancellation discards the in-app step without a credential',async({page})=>{
 await boot(page,await entitlements());await agent(page,'unavailable');
 await readySignIn(page);
 const dialog=signInDialog(page);
 await revealOtherMethods(page);
 await dialog.getByLabel('Phone number with country code').fill('+14155550100');
 await dialog.getByRole('button',{name:'Text me a code',exact:true}).click();
 await expect(dialog.getByRole('form',{name:'Enter your phone code'})).toBeVisible();
 await dialog.getByRole('button',{name:'Cancel sign-in',exact:true}).click();
 await expect(dialog.getByRole('form',{name:'Enter your phone code'})).toHaveCount(0);
 await expect(dialog.getByRole('heading',{name:'Welcome to Alpha.',exact:true})).toBeVisible();
 expect((await fixture(page)).saved).toBe(false);
 expect((await calls(page)).some(c=>c.plugin==='AlphaCloudSignIn'&&c.method==='cancel')).toBe(true);
 await noHandOff(page);
});

for(const phone of [true,false]) test(`tenant method discovery ${phone?'offers phone without email':'offers no supported method'}`,async({page})=>{
 await boot(page,{...await entitlements(),methods:{phone,email:false,google:false}});await agent(page,'unavailable');
 await readySignIn(page);
 const dialog=signInDialog(page);await expect(dialog).toBeVisible();
 await expect(dialog.getByRole('button',{name:'Email me a code',exact:true})).toHaveCount(0);
 await expect(dialog.getByRole('button',{name:'Continue with Google',exact:true})).toBeDisabled();
 await expect(dialog.getByRole('button',{name:'Text me a code',exact:true})).toHaveCount(phone?1:0);
 if(!phone)await expect(dialog.getByText('This service offers no sign-in method supported by this app. Contact the service administrator.',{exact:true})).toBeVisible();
 expect((await calls(page)).filter(c=>['startPhone','startEmail','startGoogle'].includes(c.method))).toEqual([]);
 await noHandOff(page);
});

test('provider legal text stays inside Alpha and returning preserves phone entry and the code attempt',async({page},info)=>{
 await page.setViewportSize({width:390,height:844});
 await boot(page,await entitlements());await agent(page,'unavailable');
 await readySignIn(page);
 const dialog=signInDialog(page);
 await revealOtherMethods(page);
 await dialog.getByLabel('Phone number with country code').fill('+14155550100');
 await dialog.getByRole('button',{name:'Terms of Service',exact:true}).click();
 await expect(dialog.getByRole('heading',{name:'Terms of Service',exact:true})).toBeFocused();
 await expect(dialog.getByText('<img src=x onerror=alert(1)> is plain text.',{exact:true})).toBeVisible();
 await expect(dialog.locator('.alpha-cloud-legal img')).toHaveCount(0);
 await page.screenshot({path:info.outputPath('native-legal-mobile.png'),animations:'disabled'});
 await dialog.getByRole('button',{name:'Back to sign-in',exact:true}).click();
 await expect(dialog.getByRole('button',{name:'Terms of Service',exact:true})).toBeFocused();
 await expect(dialog.getByLabel('Phone number with country code')).toHaveValue('+14155550100');
 await dialog.getByRole('button',{name:'Text me a code',exact:true}).click();
 await dialog.getByLabel('Six-digit code').fill('123');
 await dialog.getByRole('button',{name:'Privacy Policy',exact:true}).click();
 await expect(dialog.getByRole('heading',{name:'Privacy Policy',exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'Back to sign-in',exact:true}).click();
 await expect(dialog.getByLabel('Six-digit code')).toHaveValue('123');
 expect((await calls(page)).filter(c=>c.method==='startPhone')).toHaveLength(1);
 expect((await calls(page)).filter(c=>c.method==='verifyPhone')).toHaveLength(0);
 await noHandOff(page);
});

test('configured provider name is shown in the app-owned sign-in view',async({page})=>{
 await boot(page,{...await entitlements(),serviceName:'Example Service'});await agent(page,'unavailable');
 await readySignIn(page);
 await expect(signInDialog(page).getByRole('heading',{name:'Welcome to Alpha.',exact:true})).toBeVisible();
 await expect(signInDialog(page)).toContainText('Use your Example Service account to sign in.');
 await noHandOff(page);
});


test('long provider documents scroll to the end and return to an unfinished sign-in on a small phone',async({page})=>{
 await page.setViewportSize({width:320,height:568});
 const paragraphs=Array.from({length:40},(_,i)=>`Section ${i+1}. ${'Provider document text with readable wrapping. '.repeat(12)}`);
 paragraphs.push('End of the provider document.');
 await boot(page,{...await entitlements(),legalParagraphs:paragraphs});await agent(page,'unavailable');
 await readySignIn(page);
 const dialog=signInDialog(page);
 await revealOtherMethods(page);
 await dialog.getByLabel('Email',{exact:true}).fill('unfinished@example.invalid');
 await dialog.getByRole('button',{name:'Terms of Service',exact:true}).click();
 await expect(dialog.getByRole('heading',{name:'Terms of Service',exact:true})).toBeInViewport();
 const end=dialog.getByText('End of the provider document.',{exact:true});
 await end.scrollIntoViewIfNeeded();await expect(end).toBeInViewport();
 const back=dialog.getByRole('button',{name:'Return to sign-in',exact:true});
 await back.scrollIntoViewIfNeeded();await expect(back).toBeInViewport();await back.click();
 await expect(dialog.getByRole('button',{name:'Terms of Service',exact:true})).toBeFocused();
 await expect(dialog.getByLabel('Email',{exact:true})).toHaveValue('unfinished@example.invalid');
 expect((await calls(page)).filter(c=>['startEmail','startPhone','startGoogle'].includes(c.method))).toEqual([]);
 await noHandOff(page);
});
