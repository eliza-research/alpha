import {test,expect,type Page,type TestInfo} from '@playwright/test';
import {createServer,type ViteDevServer} from 'vite';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {recordStartupFrames,expectNoHomeBeforePrompt,startupLoading} from './helpers/startup-frames';

// The dev:cloud renderer (VITE_ALPHA_CLOUD_RESIDENT=1, test mocks off) after a brand-new account
// verifies its email code (owner report 2026-10-30): access setup opens at once while the resident
// agent restarts with the new key behind it, and nothing says AI is off or shows billing while it
// starts. Only the two development host bridges are synthetic (the Cloud sign-in/account host and the
// local agent host); no Steward, Eliza Cloud, agent, account or code is real.
let server:ViteDevServer,origin:string;
test.beforeAll(async()=>{
 const previous=process.env.ELIZA_DEV_ALLOW_TEST_MOCKS;process.env.ELIZA_DEV_ALLOW_TEST_MOCKS='';
 try{server=await createServer({configFile:resolve('vite.config.ts'),configLoader:'native',cacheDir:resolve('test-results/post-sign-in-setup/vite-cache'),server:{host:'127.0.0.1',port:0},define:{
  'import.meta.env.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS':JSON.stringify(''),'import.meta.env.VITE_ALPHA_CLOUD_RESIDENT':JSON.stringify('1'),
  'import.meta.env.VITE_ALPHA_CLOUD_ENVIRONMENT':JSON.stringify('production'),'import.meta.env.VITE_LOCAL_AGENT':JSON.stringify('1')}});}
 finally{if(previous===undefined)delete process.env.ELIZA_DEV_ALLOW_TEST_MOCKS;else process.env.ELIZA_DEV_ALLOW_TEST_MOCKS=previous;}
 await server.listen();origin=`http://127.0.0.1:${(server.httpServer!.address()as {port:number}).port}`;
});
test.afterAll(async()=>{await server?.close();});

const USER='22222222-2222-4222-8222-222222222222',ORG='66666666-6666-4666-8666-666666666666';
/** The development hosts as the renderer sees them. `hold` holds the next agent start until `release`;
 * `holdAdmission` holds the next identity read (the account admission after the code) until `admit`;
 * `holdStatus` holds the next sign-in readiness check until `releaseStatus`. */
async function hosts(page:Page){
 const host={stored:null as null|Record<string,unknown>,running:false,bound:false,starts:0,hold:false,release:null as null|(()=>void),holdAdmission:false,admit:null as null|(()=>void),holdStatus:false,releaseStatus:null as null|(()=>void),operations:[] as string[]};
 await page.route(/^https?:\/\/(?!127\.0\.0\.1:|localhost:)/,route=>route.abort());
 await page.route('**/__alpha-browser-cloud',async route=>{
  const data=route.request().postDataJSON(),json=(value:unknown,status=200)=>route.fulfill({status,json:value});host.operations.push(data.operation);
  if(data.operation==='secureRead')return json({value:data.slot==='cloud:production'&&host.stored?JSON.stringify(host.stored):null});
  if(data.operation==='signInStatus'){
   if(host.holdStatus){host.holdStatus=false;await new Promise<void>(resolve=>{host.releaseStatus=resolve;});}
   return json({active:false,inApp:true,google:false,email:true}).catch(()=>{});
  }
  // The real bridge rejects a key the host refuses with this text only; no provider text crosses.
  if(data.operation==='residentOwn')return json({error:'Cloud development request rejected'},400);
  if(data.operation==='signInServiceInfo'){const doc={revision:'fixture-1',sections:[{title:'Fixture',paragraphs:['Synthetic document.']}]};return json({success:true,version:1,service:{name:'Eliza Cloud',terms:{title:'Terms of Service',...doc},privacy:{title:'Privacy Policy',...doc}}});}
  if(data.operation==='signInStartEmail')return json({attemptId:'33333333-3333-4333-8333-333333333333',expiresAt:Date.now()+600000,resendAt:Date.now()+30000});
  if(data.operation==='signInVerifyEmail'){
   if(data.code!=='123456')return json({code:'invalid-code'},400);
   // The host stores the new key before it reports success; the page receives only a reference.
   host.stored={credentialReference:'browser-cloud-reference:'+randomUUID(),credentialId:randomUUID(),userId:USER,organizationId:ORG,expiresAt:Date.now()+30*86400000};
   return json({status:'authenticated',environment:'production',expiresAt:host.stored.expiresAt,accountCreated:true});
  }
  if(data.operation==='signInCancel'||data.operation==='cancel')return json({});
  if(data.operation==='residentStatus')return json({provider:'elizacloud',configured:host.bound,model:'cerebras/qwen-3.8-27b',attachable:false});
  // Binding the key replaces the running agent process, as the host does.
  if(data.operation==='residentBind'){host.bound=true;host.running=false;return json({provider:'elizacloud',configured:true,model:'cerebras/qwen-3.8-27b',attachable:false});}
  if(data.operation==='residentClear'){host.bound=false;host.running=false;return json({provider:'elizacloud',configured:false,model:'cerebras/qwen-3.8-27b',attachable:false});}
  if(data.operation==='residentStart'){host.starts++;if(host.hold){host.hold=false;await new Promise<void>(resolve=>{host.release=resolve;});}host.running=true;return json({state:'host-managed'});}
  if(data.operation==='request'){
   const path=new URL(data.input.url).pathname,reply=(status:number,value:unknown)=>json({status,data:value});
   if(path==='/api/v1/user'&&host.holdAdmission){host.holdAdmission=false;await new Promise<void>(resolve=>{host.admit=resolve;});}
   if(path==='/api/v1/user')return host.stored?reply(200,{success:true,data:{id:USER,organization_id:ORG,email:'new-owner@example.invalid'}}):reply(401,{});
   // A funded organization-credit account: no subscription, a positive balance.
   if(path==='/api/v1/billing/limits')return reply(200,{success:true,data:{schemaVersion:2,v2:{subscription:{status:'not_applicable',reason:'no_organization_subscription'},
    balance:{status:'available',source:'organizations',observedAt:new Date().toISOString(),value:{balance:{value:'5.00',unit:'usd',currency:'USD'},revision:'1'}}}}});
   return reply(404,{});
  }
  return json({error:'Unsupported fixture operation'},400);
 });
 await page.route('**/__alpha-local-agent',async route=>{
  const input=route.request().postDataJSON(),body=(status:number,value:unknown)=>route.fulfill({json:{status,body:JSON.stringify(value)}});
  if(!host.running)return body(503,{});
  if(input.path==='/api/auth/me')return body(200,{identity:{kind:'owner',id:'owner-1'},access:{role:'OWNER',mode:'local'}});
  if(input.path==='/api/agents')return body(200,{agents:[{id:'44444444-4444-4444-8444-444444444444',name:'Alpha',status:'running'}]});
  return body(404,{});
 });
 // Browser permission APIs answer from this page only; each Allow is read back before setup advances.
 await page.addInitScript(()=>{
  const states:Record<string,string>={notifications:'default',microphone:'prompt',camera:'prompt',location:'prompt'};
  Object.defineProperty(window,'Notification',{configurable:true,value:{get permission(){return states.notifications;},async requestPermission(){states.notifications='granted';return 'granted';}}});
  Object.defineProperty(navigator,'permissions',{configurable:true,value:{async query({name}:{name:string}){return {state:states[name==='geolocation'?'location':name]};}}});
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{async getUserMedia(input:{video?:unknown}){states[input.video?'camera':'microphone']='granted';return {getTracks:()=>[{readyState:'live',stop(){}}]};}}});
  Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition(_ok:unknown,fail:(error:{code:number})=>void){states.location='granted';fail({code:2});}}});
 });
 return host;
}
async function shot(page:Page,info:TestInfo,name:string){await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:info.outputPath(name+'.png'),animations:'disabled'});}
const snapshot=(page:Page)=>page.evaluate(async()=>{const s=(await import('/src/runtime/connection-ui.tsx')).connectionController.getSnapshot();return {busy:s.busy,open:s.open,session:!!s.session,kind:s.kind,message:s.message,inference:s.residentInference??null,account:s.cloudAccount?.userId??null};});
/** Starting-state copy the owner reported: none of it may show while the agent merely starts. */
const STARTING_SLOP=['AI is off','Checking your code','Checking code','Eliza Cloud credits','Manage billing','AI is not ready yet'];

test('a verified email code goes straight to access setup while the agent restarts behind it',async({page},info)=>{
 test.setTimeout(120_000);
 const host=await hosts(page);
 await page.goto(origin+'/');
 // Settled browser guests go straight to the approved Cloud sign-in: the same full page Android
 // shows while signed out, with no Back, never a dialog over Home (owner report 2026-11-01).
 const agentSheet=page.getByRole('dialog',{name:'Your agent',exact:true});
 const signIn=page.getByRole('main',{name:'Welcome to Alpha.',exact:true});
 await expect(signIn).toBeVisible({timeout:60_000});
 await expect(signIn.getByRole('button',{name:'Email me a code',exact:true})).toBeEnabled();
 await expect(page.locator('.alpha-auth-page')).toHaveCount(1);await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0);
 await expect(signIn.getByRole('button',{name:'Back',exact:true})).toHaveCount(0);
 await page.keyboard.press('Escape');await expect(signIn).toBeVisible();
 await expect(agentSheet).toHaveCount(0);
 expect(host.starts).toBe(1);
 await shot(page,info,'01-signed-out');
 await signIn.getByRole('textbox',{name:'Email',exact:true}).fill('new-owner@example.invalid');
 await signIn.getByRole('button',{name:'Email me a code',exact:true}).click();
 const code=page.getByRole('form',{name:'Enter your email code'});
 await expect(code).toBeVisible();
 // A wrong code reports inside the same page; the error never turns it into a dismissible dialog.
 await code.getByLabel('Six-digit code').fill('000000');await code.getByRole('button',{name:'Verify',exact:true}).click();
 const codePage=page.getByRole('main',{name:'Check your code.',exact:true});
 await expect(codePage.getByRole('alert')).toBeVisible();
 await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0);await expect(codePage.getByRole('button',{name:'Back',exact:true})).toHaveCount(0);
 // The agent's restart with the new key takes as long as a first boot; hold it there. The account
 // admission (identity and plan reads) is held too, to show what the verified step says meanwhile.
 host.hold=true;host.holdAdmission=true;
 await code.getByLabel('Six-digit code').fill('123456');await code.getByRole('button',{name:'Verify',exact:true}).click();
 // The code is verified: the code check has ended while the account is admitted.
 await expect.poll(()=>!!host.admit,{timeout:15_000}).toBe(true);
 await expect(code.getByRole('button',{name:'Signing in…',exact:true})).toBeDisabled();
 await shot(page,info,'02-code-verified-signing-in');
 expect(await page.locator('body').innerText()).not.toContain('Checking');
 expect(host.starts).toBe(1);
 host.admit!();
 await expect.poll(()=>host.starts,{timeout:15_000}).toBe(2);
 const setup=page.locator('dialog.alpha-startup-permissions');
 await setup.getByRole('heading',{name:'Notifications',exact:true}).waitFor({timeout:5_000}).catch(()=>{});
 await shot(page,info,'03-after-code-agent-starting');
 const starting=await page.locator('body').innerText();
 // Setup is shown while the agent is still starting; no sheet, busy code check or AI/billing claim.
 await expect(setup.getByRole('heading',{name:'Notifications',exact:true})).toBeVisible();
 expect(host.release).not.toBeNull();
 for(const text of STARTING_SLOP)expect(starting).not.toContain(text);
 await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0);
 expect(await snapshot(page)).toMatchObject({session:false,kind:'starting',inference:null,account:USER});
 for(const name of ['Notifications','Microphone','Camera','Location']){await expect(setup.getByRole('heading',{name,exact:true})).toBeVisible();await setup.getByRole('button',{name:'Allow',exact:true}).click();}
 await expect(setup.getByRole('heading',{name:'You’re all set',exact:true})).toBeVisible();
 await expect(setup.getByText('Account created: new-owner@example.invalid.',{exact:true})).toBeVisible();
 await shot(page,info,'04-all-set-agent-starting');
 for(const text of STARTING_SLOP)expect(await setup.innerText()).not.toContain(text);
 await setup.getByRole('button',{name:'Go to Alpha',exact:true}).click();
 await expect(setup).toHaveCount(0);
 // The owner may open the agent panel while it starts: a calm starting state, no AI or billing claim.
 await page.evaluate(async()=>(await import('/src/runtime/connection-ui.tsx')).connectionController.open());
 await expect(agentSheet.getByText('Starting…',{exact:true})).toBeVisible();
 await expect(agentSheet.getByText('Waiting for your agent to start.',{exact:true})).toBeVisible();
 await shot(page,info,'05-your-agent-while-starting');
 for(const text of STARTING_SLOP)expect(await agentSheet.innerText()).not.toContain(text);
 host.release!();
 // Connecting closes the panel (nothing opens by itself); reopened, it shows the running agent and its plan.
 await expect.poll(async()=>(await snapshot(page)).session,{timeout:30_000}).toBe(true);
 await expect(agentSheet).toHaveCount(0);
 await page.evaluate(async()=>(await import('/src/runtime/connection-ui.tsx')).connectionController.open());
 await expect(agentSheet.getByText('Running on this device',{exact:true})).toBeVisible();
 await expect(agentSheet.getByText('Your agent uses Eliza Cloud for AI.',{exact:true})).toBeVisible();
 await expect(agentSheet.getByText('No active subscription',{exact:true})).toBeVisible();
 await shot(page,info,'06-your-agent-running');
 expect(host.bound).toBe(true);expect(host.starts).toBe(2);
 expect(await snapshot(page)).toMatchObject({session:true,inference:'cloud',account:USER});
});

test('a first start shows a neutral loading screen, never Home, until the sign-in opens',async({page})=>{
 const host=await hosts(page);await recordStartupFrames(page);host.hold=true;
 await page.goto(origin+'/');
 // However long the agent takes to start, nothing usable is shown before the sign-in.
 await expect.poll(()=>!!host.release,{timeout:60_000}).toBe(true);
 await expect(startupLoading(page)).toBeVisible();await page.waitForTimeout(500);
 await expect(page.locator('[data-alpha-layer="home"]')).toHaveCount(0);
 host.release!();
 await expect(page.getByRole('main',{name:'Welcome to Alpha.',exact:true})).toBeVisible({timeout:30_000});
 await expect(startupLoading(page)).toHaveCount(0);await expect(page.locator('[data-alpha-layer="home"]')).toHaveCount(1);
 await expectNoHomeBeforePrompt(page);
});

test('a signed-in start opens access setup directly, with no Home while the account is checked',async({page})=>{
 const host=await hosts(page);await recordStartupFrames(page);
 host.stored={credentialReference:'browser-cloud-reference:'+randomUUID(),credentialId:randomUUID(),userId:USER,organizationId:ORG,expiresAt:Date.now()+30*86400000};host.holdAdmission=true;
 await page.goto(origin+'/');
 await expect.poll(()=>!!host.admit,{timeout:60_000}).toBe(true);
 await expect(startupLoading(page)).toBeVisible();await page.waitForTimeout(500);
 await expect(page.locator('[data-alpha-layer="home"]')).toHaveCount(0);
 host.admit!();
 await expect(page.locator('dialog.alpha-startup-permissions').getByRole('heading',{name:'Notifications',exact:true})).toBeFocused({timeout:30_000});
 await expect(startupLoading(page)).toHaveCount(0);
 await expectNoHomeBeforePrompt(page);
});

test('a start that has not decided in 60 s shows Home as before, and the sign-in still follows',async({page})=>{
 const host=await hosts(page);host.hold=true;await page.clock.install();
 await page.goto(origin+'/');
 await expect.poll(()=>!!host.release,{timeout:60_000}).toBe(true);
 await page.clock.fastForward(59_000);
 await expect(startupLoading(page)).toBeVisible();
 await page.clock.fastForward(2_000);
 await expect(page.getByRole('region',{name:'Home',exact:true})).toBeVisible();
 await expect(startupLoading(page)).toHaveCount(0);await expect(page.locator('.alpha-connection')).toHaveCount(0);
 host.release!();
 await expect(page.getByRole('main',{name:'Welcome to Alpha.',exact:true})).toBeVisible({timeout:30_000});
});

test('a cancelled check and a rejected own key keep the welcome page, with the rejection inside the own-key view',async({page},info)=>{
 test.setTimeout(90_000);
 const AI_KEY='synthetic-browser-own-cerebras-key',VOICE_KEY='synthetic-browser-own-cartesia-key';
 const host=await hosts(page);host.holdStatus=true;
 const logs:string[]=[];page.on('console',message=>logs.push(message.text()));
 await page.goto(origin+'/');
 const welcome=page.getByRole('main',{name:'Welcome to Alpha.',exact:true});
 await expect(welcome).toBeVisible({timeout:60_000});
 // The readiness check is held; after 4 s the owner cancels it, so no sign-in view is active.
 // While it runs, its Cancel stays in view: the switch to own keys waits for it.
 await expect(welcome.getByRole('button',{name:'Cancel sign-in',exact:true})).toBeEnabled({timeout:10_000});
 await expect(welcome.getByRole('button',{name:'Use your own API keys',exact:true})).toBeDisabled();
 await welcome.getByRole('button',{name:'Cancel sign-in',exact:true}).click({timeout:10_000});
 await expect(welcome.getByRole('button',{name:'Retry sign-in',exact:true})).toBeVisible();
 await welcome.getByRole('button',{name:'Use your own API keys',exact:true}).click();
 const own=welcome.getByRole('region',{name:'Own API keys',exact:true});
 await own.getByLabel('Cerebras API key',{exact:true}).fill(AI_KEY);
 await own.getByLabel('Cartesia API key (optional)',{exact:true}).fill(VOICE_KEY);
 await own.getByRole('button',{name:'Save and use own keys',exact:true}).click();
 // The rejection says what failed, inside the own-key view on the same page, as on Android.
 await expect(own.getByRole('alert')).toHaveText('Own API keys could not be set up. Check the keys and try again.');
 expect(host.operations.filter(operation=>operation==='residentOwn')).toHaveLength(1);
 await expect(own.getByLabel('Cerebras API key',{exact:true})).toHaveValue('');
 await expect(own.getByLabel('Cartesia API key (optional)',{exact:true})).toHaveValue('');
 await expect(page.locator('.alpha-auth-page')).toHaveCount(1);await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0);
 await expect(page.getByRole('dialog',{name:'Your agent',exact:true})).toHaveCount(0);
 await page.keyboard.press('Escape');await expect(own).toBeVisible();
 await shot(page,info,'own-key-rejected-after-cancelled-check');
 // Cloud sign-in never shows the key rejection as its own.
 await own.getByRole('button',{name:'Sign in with Cloud instead',exact:true}).click();
 await expect(welcome.getByRole('button',{name:'Retry sign-in',exact:true})).toBeVisible();
 await expect(welcome.getByRole('alert')).toHaveCount(0);
 const seen=await page.evaluate(()=>[...Object.values(localStorage),...Object.values(sessionStorage),document.body.innerText].join('\n'));
 for(const key of [AI_KEY,VOICE_KEY]){expect(seen).not.toContain(key);expect(logs.join('\n')).not.toContain(key);}
 host.releaseStatus?.();
});
