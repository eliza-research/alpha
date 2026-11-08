import {openConnectionDiagnostics} from './helpers/connection-diagnostics';
// Hosted/CLI behavior is test-mocks-only diagnostic coverage. Enter that explicit controller
// route; the production sign-in button uses native email and never falls back to this route.
import { test, expect, type Page } from '@playwright/test';
import { preloadPageModules } from './helpers/page-modules';
// Modules the scenarios import inside page.evaluate (see helpers/page-modules.ts).
const setupModules=['/src/runtime/connection-ui.tsx','/src/runtime/cloud-personal-intent.ts','/src/runtime/cloud-personal-protocol.ts','/src/browser/documents.ts'];

async function intentSnapshot(page:Page){return page.evaluate(async()=>{const {personalIntentDocument}=await import('/src/runtime/cloud-personal-intent.ts');return (await personalIntentDocument({environment:'production',userId:'11111111-1111-4111-8111-111111111111',organizationId:'22222222-2222-4222-8222-222222222222',credentialId:'snapshot-only'})).capture();});}
// Actual connection UI/controller/Cloud protocol; only native HTTP and secure storage are synthetic.
// No live Cloud account, paid setup, mailbox access or Android permission is used.
for(const scenario of ['decline','accepted-reload','lost-activation','quote-change','storage-failure','account-switch','definitive-rejection','lost-cutover','stopped-resume','stopped-before-finalize','expired-poll','unavailable-poll','stale-status','unreadable-intent','cancel-after-admission'] as const){
 test(`personal Cloud setup: ${scenario}`,async({page})=>{
  await page.addInitScript((scenario)=>{
   const w=window as any;
   const user='11111111-1111-4111-8111-111111111111',org='22222222-2222-4222-8222-222222222222',agent='33333333-3333-4333-8333-333333333333',job='44444444-4444-4444-8444-444444444444',login='55555555-5555-4555-8555-555555555555',personal='personal:66666666-6666-5666-8666-666666666666';
   const key='fixture.cloud.setup',load=()=>JSON.parse(localStorage.getItem(key)||'{"activation":0,"cutover":0,"ready":false,"quote":0}'),save=(data:any)=>localStorage.setItem(key,JSON.stringify(data));
   const methods=(names:string[])=>names.map(name=>({name,rtype:'promise'}));
   w.Capacitor={PluginHeaders:[{name:'AlphaConnection',methods:methods(['request','cancel','secureRead','secureWrite','secureRemove','openExternal'])}],nativePromise:async(plugin:string,method:string,input:any)=>{
    if(plugin!=='AlphaConnection')throw Error('Unexpected native operation');
    if(method==='secureRead')return {value:sessionStorage.getItem('fixture.secure:'+input.slot)};
    if(method==='secureWrite'){sessionStorage.setItem('fixture.secure:'+input.slot,input.value);return {};}
    if(method==='secureRemove'){sessionStorage.removeItem('fixture.secure:'+input.slot);return {};}
    if(method==='cancel'||method==='openExternal')return {};
    const url=new URL(input.url),path=decodeURIComponent(url.pathname),state=load(),body=input.body?JSON.parse(input.body):null;
    const response=(data:any,status=200)=>({status,data}),ok=(data:any,status=200)=>response({success:true,data},status);
    if(path==='/api/auth/cli-session'){state.authFailure=0;save(state);return response({sessionId:login,expiresAt:new Date(Date.now()+60000).toISOString()});}
    if(path===`/api/auth/cli-session/${login}`)return response({status:'authenticated',token:'synthetic-cloud-token',expiresAt:new Date(Date.now()+600000).toISOString()});
    if(input.headers.Authorization!=='Bearer synthetic-cloud-token')throw Error('Unverified fixture request');
    if(path==='/api/v1/user'&&state.authFailure)return response({error:'fixture unavailable'},state.authFailure);
    if(path==='/api/v1/user')return ok({id:user,organization_id:org});
    if(path==='/api/v1/eliza/personal')return ok({identity:{id:personal,displayName:'Personal fixture',runtime:state.ready?'dedicated':'shared',...(state.ready?{activeAgentId:agent,apiBase:`https://${agent}.cloud.eliza.app`}:{})}});
    if(path===`/api/v1/eliza/agents/${agent}`)return ok({id:agent,agentName:'Personal fixture',status:state.stopped?'stopped':'running',executionTier:'dedicated-lazy',webUiUrl:`https://${agent}.cloud.eliza.app`});
    if(path===`/api/v1/jobs/${job}`)return ok({id:job,status:'completed'});
    if(path===`/api/v1/eliza/agents/${personal}/upgrade-tier`){
     if(input.method==='GET')return ok({sourceAgentId:personal,quoteId:(state.quote?'b':'a').repeat(64),requiresConfirmation:true,action:'activate_dedicated',canActivate:true,hourlyRateUsd:0.1,dailyRateUsd:2.4,minimumActivationChargeUsd:0.5,minimumBalanceUsd:1,minimumRunwayDays:1,balanceUsd:10,deficitUsd:0,activation:state.activation?{state:'in_progress',dedicatedAgentId:agent,status:state.stopped?'stopped':'running'}:{state:'available'}});
     if(body.action!=='activate_dedicated'||body.minimumActivationChargeUsd!==0.5)throw Error('Wrong review binding');
     if(scenario==='quote-change'&&!state.quote){state.quote=1;save(state);return response({success:false,code:'dedicated_quote_changed'},409);}
     if(scenario==='definitive-rejection')return response({success:false,code:'insufficient_balance'},402);
     state.activation++;state.stopped=false;save(state);
     if(scenario==='lost-activation')throw Error('Synthetic lost accepted response');
     return ok({dedicatedAgentId:agent,jobId:job},202);
    }
    if(path.endsWith('/adopt-existing'))return response({success:false,code:'dedicated_adoption_unavailable'},404);
    if(path.endsWith('/cutover')){state.cutover++;state.ready=scenario!=='lost-cutover';save(state);if(scenario==='lost-cutover')throw Error('Synthetic lost cutover response');return ok({personalElizaId:personal,activeAgentId:agent,runtime:'dedicated',apiBase:`https://${agent}.cloud.eliza.app`,importedMessages:0});}
    if(path==='/api/client-devices/capabilities')return response({},404);
    if(path.includes('/api/conversations'))return response({conversations:[]});
    if(path.includes('/workflow/'))return response({},404);
    throw Error('Unexpected Cloud fixture route '+path);
   }};
  },scenario);
  await page.goto('/');await page.getByRole('button',{name:'Settings',exact:true}).click();await openConnectionDiagnostics(page);await page.locator('summary').filter({hasText:/^Development Cloud agent infrastructure$/}).click();
  await preloadPageModules(page,setupModules);
  // Keep this trigger synchronous. Chromium may collect an inspector-awaited import Promise
  // even after its module has been preloaded; the retained namespace needs no new import.
  await page.evaluate(()=>{void (window as any).__alphaModules['/src/runtime/connection-ui.tsx'].connectionController.signInBrowser();});
  const review=page.getByRole('region',{name:'Dedicated hosting review'});
  // Section has an accessible name and is a region; display real reviewed price fields.
  await expect(review).toBeVisible();await expect(review).toContainText('$2.40/day');await expect(review).toContainText('Minimum charge per successful start: $0.50');
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('fixture.cloud.setup')||'{"activation":0}').activation)).toBe(0);
  await expect(page.getByRole('button',{name:'Create agent',exact:true})).toHaveCount(0);
  if(scenario==='decline'){await page.getByRole('button',{name:'Not now',exact:true}).click();await expect(page.getByText('Cloud account connected. Dedicated setup was not started.',{exact:true}).first()).toBeVisible();await expect(page.getByRole('alert')).toHaveCount(0);expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('fixture.cloud.setup')||'{"activation":0}').activation)).toBe(0);return;}
  if(scenario==='unreadable-intent'){
   await page.evaluate(async()=>{const {connectionController}=await import('/src/runtime/connection-ui.tsx'),{personalIntentKey}=await import('/src/runtime/cloud-personal-intent.ts');localStorage.setItem(personalIntentKey(connectionController.getSnapshot().cloudAccount as any),' {unreadable intent ');});await page.getByRole('button',{name:'Refresh agent status',exact:true}).click();await expect(page.getByRole('button',{name:'Start Dedicated',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Cloud setup intent recovery',exact:true}).click();const recovery=page.getByRole('dialog',{name:'Cloud setup intent recovery'});await expect(recovery.getByRole('button',{name:'Download Cloud setup intent backup',exact:true})).toBeEnabled();await expect(recovery).toContainText('may already have started hosting');await page.keyboard.press('Escape');await expect(recovery).toHaveCount(0);expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('fixture.cloud.setup')||'{"activation":0}').activation)).toBe(0);return;
  }
  if(scenario==='stale-status'){
   await page.evaluate(async()=>{const {CloudPersonalProtocol}=await import('/src/runtime/cloud-personal-protocol.ts'),inspect=CloudPersonalProtocol.prototype.inspect;let held=false;CloudPersonalProtocol.prototype.inspect=async function(...args){const result=await inspect.apply(this,args);if(!held){held=true;(window as any).statusQueued=true;await new Promise<void>(resolve=>(window as any).releaseStatus=resolve);}return result;};});await page.getByRole('button',{name:'Refresh agent status',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).statusQueued)).toBe(true);await page.evaluate(async()=>{const {connectionController}=await import('/src/runtime/connection-ui.tsx'),{savePersonalIntent}=await import('/src/runtime/cloud-personal-intent.ts');await savePersonalIntent(connectionController.getSnapshot().cloudAccount as any,{phase:'activation',personalElizaId:'personal:66666666-6666-5666-8666-666666666666',state:'attempting'},null);(window as any).releaseStatus();});await expect(page.getByRole('button',{name:'Start Dedicated',exact:true})).toHaveCount(0);expect(await page.evaluate(async()=>{const {connectionController}=await import('/src/runtime/connection-ui.tsx');return connectionController.getSnapshot().cloudPersonal?.blocked;})).toBe(true);expect(JSON.parse(JSON.parse((await intentSnapshot(page)).raw!).raw).state).toBe('attempting');expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('fixture.cloud.setup')||'{"activation":0}').activation)).toBe(0);return;
  }
  if(scenario==='cancel-after-admission'){
   await page.evaluate(async()=>{const {browserDocuments}=await import('/src/browser/documents.ts'),edit=browserDocuments.edit.bind(browserDocuments);let held=false;browserDocuments.edit=async(...args)=>{const result=await edit(...args);if(!held&&args[0].startsWith('alpha.cloud.personal-setup.v1:')){held=true;(window as any).admissionSaved=true;await new Promise<void>(resolve=>(window as any).releaseAdmission=resolve);}return result;};});await page.getByRole('button',{name:'Start Dedicated',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).admissionSaved)).toBe(true);await page.getByRole('button',{name:'Stop waiting',exact:true}).click();await page.evaluate(()=>(window as any).releaseAdmission());await expect.poll(async()=>JSON.parse((await intentSnapshot(page)).raw!)).toEqual({raw:null});expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('fixture.cloud.setup')||'{"activation":0}').activation)).toBe(0);return;
  }
  if(scenario==='storage-failure')await page.evaluate(()=>{const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){if(typeof key==='string'&&key.startsWith('alpha.cloud.personal-setup.v1:'))throw new DOMException('Fixture full','QuotaExceededError');return original.call(this,value,key);};});
  if(scenario==='account-switch'){await page.getByLabel('Environment',{exact:true}).selectOption('staging');await expect(review).toHaveCount(0);await expect(page.getByRole('button',{name:'Start Dedicated',exact:true})).toHaveCount(0);expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('fixture.cloud.setup')||'{"activation":0}').activation)).toBe(0);return;}
  await page.getByRole('button',{name:'Start Dedicated',exact:true}).click();
  if(scenario==='storage-failure'){await expect(page.getByRole('alert')).toBeVisible();expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('fixture.cloud.setup')||'{"activation":0}').activation)).toBe(0);return;}
  if(scenario==='definitive-rejection'){await expect(page.getByRole('alert')).toBeVisible();expect(JSON.parse((await intentSnapshot(page)).raw!)).toEqual({raw:null});await page.getByRole('button',{name:'Refresh agent status',exact:true}).click();await expect(page.getByRole('button',{name:'Start Dedicated',exact:true})).toBeEnabled();return;}
  if(scenario==='quote-change'){await expect(page.getByText('The hosting terms changed. Review the current quote before continuing.',{exact:true})).toBeVisible();expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('fixture.cloud.setup')!).activation)).toBe(0);await page.getByRole('button',{name:'Start Dedicated',exact:true}).click();}
  if(scenario==='lost-activation'){
   // Busy disables this button before durable admission and the synthetic POST.
   // Wait for the reconciled uncertain state before asserting its retained outcome.
   await expect(page.getByText('Setup could not be confirmed. Check status before taking another action.',{exact:true})).toBeVisible();
   await expect(page.getByRole('button',{name:'Start Dedicated',exact:true})).toBeDisabled();
  }
  else await expect(page.getByText('Dedicated setup accepted',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('fixture.cloud.setup')!).activation)).toBe(1);
  if(scenario==='expired-poll'||scenario==='unavailable-poll'){
   const before=await intentSnapshot(page);
   await page.evaluate(status=>{const s=JSON.parse(localStorage.getItem('fixture.cloud.setup')!);s.authFailure=status;localStorage.setItem('fixture.cloud.setup',JSON.stringify(s));},scenario==='expired-poll'?401:503);
   await page.getByRole('button',{name:'Check setup status',exact:true}).click();
   if(scenario==='expired-poll'){
    await expect(page.getByText('Signed in to Eliza Cloud',{exact:true})).toHaveCount(0);
    await expect(page.getByRole('alert')).toContainText('sign-in has expired');
    expect(await page.evaluate(async()=>{const c=(await import('/src/runtime/connection-ui.tsx')).connectionController;return {client:c.getCloudClient(),account:c.getSnapshot().cloudAccount};})).toEqual({client:null,account:null});
   }else await expect(page.getByText('Signed in to Eliza Cloud',{exact:true})).toBeVisible();
   expect(await intentSnapshot(page)).toEqual(before);
   await page.evaluate(()=>{void (window as any).__alphaModules['/src/runtime/connection-ui.tsx'].connectionController.signInBrowser();});
   await expect(page.getByText('Signed in to Eliza Cloud',{exact:true})).toBeVisible();
   await expect(page.getByText('Dedicated setup accepted',{exact:true})).toBeVisible();
   expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('fixture.cloud.setup')!))).toMatchObject({activation:1,cutover:0});return;
  }
  await page.reload();await preloadPageModules(page,setupModules);await page.getByRole('button',{name:'Settings',exact:true}).click();await openConnectionDiagnostics(page);await page.locator('summary').filter({hasText:/^Development Cloud agent infrastructure$/}).click();await page.getByRole('button',{name:'Refresh agent status',exact:true}).click();
  if(scenario==='stopped-resume'){await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('fixture.cloud.setup')!);s.stopped=true;s.quote=1;localStorage.setItem('fixture.cloud.setup',JSON.stringify(s));});await page.getByRole('button',{name:'Refresh agent status',exact:true}).click();await expect(page.getByRole('button',{name:'Start Dedicated',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Start Dedicated',exact:true}).click();await page.getByRole('button',{name:'Check setup status',exact:true}).click();}
  await expect(page.getByRole('button',{name:'Continue setup',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('fixture.cloud.setup')!))).toMatchObject({activation:scenario==='stopped-resume'?2:1,cutover:0});
  if(scenario==='stopped-before-finalize')await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('fixture.cloud.setup')!);s.stopped=true;s.quote=1;localStorage.setItem('fixture.cloud.setup',JSON.stringify(s));});
  await page.getByRole('button',{name:'Continue setup',exact:true}).click();
  if(scenario==='stopped-before-finalize'){await expect(page.getByRole('button',{name:'Start Dedicated',exact:true})).toBeEnabled();expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('fixture.cloud.setup')!).cutover)).toBe(0);return;}
  if(scenario==='lost-cutover'){await expect(page.getByRole('button',{name:'Continue setup',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Refresh agent status',exact:true}).click();await expect(page.getByRole('button',{name:'Continue setup',exact:true})).toHaveCount(0);expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('fixture.cloud.setup')!))).toMatchObject({activation:1,cutover:1,ready:false});return;}
  await expect(page.getByRole('button',{name:'Connect this agent',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('fixture.cloud.setup')!))).toMatchObject({activation:scenario==='stopped-resume'?2:1,cutover:1,ready:true});
  await page.getByRole('button',{name:'Connect this agent',exact:true}).click();await expect(page.getByRole('dialog',{name:'Your agent. Your phone.'})).toHaveCount(0);
  const selection=await page.evaluate(()=>JSON.parse(localStorage.getItem('alpha.connection.selection.v1')!));expect(selection).toMatchObject({kind:'cloud',agentId:'33333333-3333-4333-8333-333333333333',ownerId:'11111111-1111-4111-8111-111111111111'});
 });
}

for(const scenario of ['adopt-existing','owner-during-connect','organization-during-connect','credential-during-connect'] as const){
 test(`personal Cloud account boundary: ${scenario}`,async({page})=>{
  await page.addInitScript((scenario)=>{
   const w=window as any,user='11111111-1111-4111-8111-111111111111',org='22222222-2222-4222-8222-222222222222',agent='33333333-3333-4333-8333-333333333333',personal='personal:66666666-6666-5666-8666-666666666666',other='77777777-7777-4777-8777-777777777777';
   const fixture=w.personalBoundary={armed:false,switched:false,activationPosts:0,adoptionPosts:0,cutoverPosts:0,otherPosts:0,adopted:false,ready:scenario!=='adopt-existing',credential:{credentialId:'original-generation',token:'synthetic-cloud-token',expiresAt:Date.now()+600000},openUrls:[] as string[]};
   const methods=(names:string[])=>names.map(name=>({name,rtype:'promise'}));
   w.Capacitor={PluginHeaders:[{name:'AlphaConnection',methods:methods(['request','cancel','secureRead','secureWrite','secureRemove','openExternal'])}],nativePromise:async(plugin:string,method:string,input:any)=>{
    if(plugin!=='AlphaConnection')throw Error('Unexpected native operation');
    if(method==='secureRead')return {value:input.slot==='cloud:production'?JSON.stringify(fixture.credential):null};
    if(method==='secureWrite'||method==='secureRemove'||method==='cancel')return {};
    if(method==='openExternal'){fixture.openUrls.push(input.url);return {};}
    const path=decodeURIComponent(new URL(input.url).pathname),body=input.body?JSON.parse(input.body):null;
    const response=(data:any,status=200)=>({status,data}),ok=(data:any,status=200)=>response({success:true,data},status);
    if(input.headers.Authorization!=='Bearer synthetic-cloud-token')throw Error('Unverified fixture request');
    if(path==='/api/v1/user'){
     if(fixture.armed){fixture.armed=false;fixture.switched=true;if(scenario==='credential-during-connect')fixture.credential.credentialId='replacement-generation';}
     return ok({id:fixture.switched&&scenario==='owner-during-connect'?other:user,organization_id:fixture.switched&&scenario==='organization-during-connect'?other:org});
    }
    if(path==='/api/v1/eliza/personal')return ok({identity:{id:personal,displayName:'Existing personal Eliza',runtime:fixture.ready?'dedicated':'shared',...(fixture.ready?{activeAgentId:agent,apiBase:`https://${agent}.cloud.eliza.app`}:{})}});
    if(path===`/api/v1/eliza/agents/${agent}`)return ok({id:agent,agentName:'Existing personal Eliza',status:'running',executionTier:'dedicated-lazy',webUiUrl:`https://${agent}.cloud.eliza.app`});
    const rates={hourlyRateUsd:0.1,dailyRateUsd:2.4,minimumActivationChargeUsd:0.5,minimumBalanceUsd:1,minimumRunwayDays:1,balanceUsd:10,deficitUsd:0};
    if(path===`/api/v1/eliza/agents/${personal}/upgrade-tier`){
     if(input.method==='GET')return ok({...rates,sourceAgentId:personal,quoteId:'a'.repeat(64),requiresConfirmation:true,action:'activate_dedicated',canActivate:true,activation:fixture.adopted?{state:'in_progress',dedicatedAgentId:agent,status:'running'}:{state:'available'}});
     fixture.activationPosts++;if(body.action!=='activate_dedicated'||body.quoteId!=='a'.repeat(64))throw Error('Wrong activation quote');
     return response({success:false,code:'dedicated_adoption_selection_required'},409);
    }
    if(path.endsWith('/adopt-existing')){
     if(input.method==='GET')return ok({...rates,quoteId:'b'.repeat(64),requiresConfirmation:true,action:'adopt_existing_dedicated',canAdopt:true,dedicatedAgentId:agent,status:'running',adoptionState:'available',startsCompute:false,requiresCatalogRestore:false,stateDisposition:'verified_backup_present'});
     if(body.action!=='adopt_existing_dedicated'||body.quoteId!=='b'.repeat(64)||body.minimumActivationChargeUsd!==0.5)throw Error('Wrong adopted quote');fixture.adoptionPosts++;fixture.adopted=true;return ok({dedicatedAgentId:agent,runtime:'dedicated_pending_cutover'});
    }
    if(path.endsWith('/cutover')){if(body.dedicatedAgentId!==agent)throw Error('Wrong cutover target');fixture.cutoverPosts++;fixture.ready=true;return ok({personalElizaId:personal,activeAgentId:agent,runtime:'dedicated',apiBase:`https://${agent}.cloud.eliza.app`,importedMessages:3});}
    if(input.method==='POST')fixture.otherPosts++;
    if(path==='/api/client-devices/capabilities')return response({},404);
    if(path.includes('/api/conversations'))return response({conversations:[]});
    if(path.includes('/workflow/'))return response({},404);
    throw Error('Unexpected boundary fixture route '+path);
   }};
  },scenario);
  await page.goto('/');await page.getByRole('button',{name:'Settings',exact:true}).click();await openConnectionDiagnostics(page);await page.locator('summary').filter({hasText:/^Development Cloud agent infrastructure$/}).click();
  await page.getByRole('button',{name:'Refresh agent status',exact:true}).click();
  if(scenario==='adopt-existing'){
   await page.getByRole('button',{name:'Start Dedicated',exact:true}).click();
   const review=page.getByRole('region',{name:'Dedicated hosting review'});await expect(review).toContainText('This reuses the existing Dedicated instance selected for this account.');await expect(review).toContainText('Hosting is already active. This does not start another server.');
   expect(await page.evaluate(()=>({activation:(window as any).personalBoundary.activationPosts,adoption:(window as any).personalBoundary.adoptionPosts,cutover:(window as any).personalBoundary.cutoverPosts}))).toEqual({activation:1,adoption:0,cutover:0});
   // The old activation consent cannot silently authorize adoption or cutover.
   await page.getByRole('button',{name:'Use existing Dedicated',exact:true}).click();await expect(page.getByRole('button',{name:'Continue setup',exact:true})).toBeVisible();
   expect(await page.evaluate(()=>(window as any).personalBoundary.cutoverPosts)).toBe(0);
   await page.getByRole('button',{name:'Continue setup',exact:true}).click();await expect(page.getByRole('button',{name:'Connect this agent',exact:true})).toBeVisible();
   await page.getByRole('button',{name:'Connect this agent',exact:true}).click();await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0);
   expect(await page.evaluate(()=>({activation:(window as any).personalBoundary.activationPosts,adoption:(window as any).personalBoundary.adoptionPosts,cutover:(window as any).personalBoundary.cutoverPosts}))).toEqual({activation:1,adoption:1,cutover:1});
   expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('alpha.connection.selection.v1')!))).toMatchObject({kind:'cloud',agentId:'33333333-3333-4333-8333-333333333333',ownerId:'11111111-1111-4111-8111-111111111111'});return;
  }
  await expect(page.getByRole('button',{name:'Connect this agent',exact:true})).toBeVisible();
  await page.evaluate(()=>(window as any).personalBoundary.armed=true);
  await page.getByRole('button',{name:'Connect this agent',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).personalBoundary.switched)).toBe(true);
  await expect(page.locator('.alpha-connection-cancel')).toHaveCount(0);
  await expect(page.locator('.alpha-connection-scrim')).toBeVisible();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('alpha.connection.selection.v1')||'null')?.kind)).not.toBe('cloud');
  expect(await page.evaluate(async()=>{const {connectionController}=await import('/src/runtime/connection-ui.tsx');return connectionController.getSnapshot().session;})).toBeNull();
  expect(await page.evaluate(()=>({activation:(window as any).personalBoundary.activationPosts,adoption:(window as any).personalBoundary.adoptionPosts,cutover:(window as any).personalBoundary.cutoverPosts,other:(window as any).personalBoundary.otherPosts}))).toEqual({activation:0,adoption:0,cutover:0,other:0});
 });
}
