import {seedCompletedAccessSetup} from './flag-off-android';
import {test,expect} from '@playwright/test';
import {completeAccessSetup} from './flag-off-android';
import {createServer} from 'vite';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {cloudStorageNamespace} from '../../apps/app/src/runtime/cloud-deployment.generated';
import {createBrowserCloudDevHandler} from '../../scripts/browser-cloud-dev-bridge';
import {createLocalAgentDevHandler} from '../../scripts/local-agent-dev-bridge';

// Closed Cloud/media fixture: normal production adapters, no external request or media device.
test('browser restores an existing host Cloud account, uses canonical voice and preserves explicit logout',async({page},info)=>{
 test.setTimeout(45000);
 const profile=await mkdtemp(join(tmpdir(),'alpha-browser-cloud-ui-')),secret='synthetic-cloud-ui-credential',owner='11111111-1111-4111-8111-111111111111',organizationId='22222222-2222-4222-8222-222222222222',credentialId='33333333-3333-4333-8333-333333333333',reference='browser-cloud-reference:44444444-4444-4444-8444-444444444444',session=randomUUID(),calls:string[]=[];
 const deploymentProfile=join(profile,cloudStorageNamespace.replaceAll(':','-'));
 await mkdir(deploymentProfile,{recursive:true,mode:0o700});
 await writeFile(join(profile,'credential'),secret,{mode:0o600});await writeFile(join(deploymentProfile,'initial-credential.json'),JSON.stringify({environment:'production',credentialFile:join(profile,'credential'),credentialSha256:createHash('sha256').update(secret).digest('hex'),userId:owner,organizationId,credentialReference:reference,credentialId}),{mode:0o600});
 const handler=createBrowserCloudDevHandler({profile,request:async(url,input={})=>{
  const path=new URL(String(url)).pathname;calls.push(path);
  if(path==='/api/auth/cli-session')return Response.json({sessionId:session,expiresAt:new Date(Date.now()+60000).toISOString()});
  if(path==='/api/auth/cli-session/'+session)return Response.json({status:'authenticated',apiKey:secret});
  expect(new Headers(input.headers).get('Authorization')).toBe('Bearer '+secret);
  if(path==='/api/v1/user')return Response.json({success:true,data:{id:owner,organization_id:organizationId,email:'owned@example.invalid'}});
  if(path==='/api/v1/api-keys/current'){expect(input.method).toBe('DELETE');return Response.json({success:true,status:'revoked',credentialId:'server-key',revokedAt:'2026-10-22T00:00:00Z'});}
  if(path==='/api/v1/billing/limits')return Response.json({success:true,data:{v2:{subscription:{status:'available',value:{planKey:'plus_monthly',state:'active'}}}}});
  if(path==='/api/v1/eliza/google/accounts')return Response.json([]);
  if(path==='/api/v1/voice/stt'){expect(input.body).toBeInstanceOf(FormData);expect((input.body as FormData).get('audio')).toBeInstanceOf(File);expect((input.body as FormData).get('provider')).toBe('cartesia');return Response.json({transcript:'Closed fixture transcript'},{headers:{'X-Eliza-STT-Provider':'cartesia'}});}
  if(path==='/api/v1/voice/tts'){expect(JSON.parse(String(input.body))).toEqual({text:'Closed fixture text',format:'mp3'});return new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'audio/mpeg'}});}
  throw Error('Unexpected closed fixture Cloud route');
 }});
 const server=await createServer({configFile:resolve('vite.config.ts'),cacheDir:resolve('test-results/browser-cloud-dev/vite-cache'),server:{host:'127.0.0.1',port:0,strictPort:false},plugins:[{name:'owned-closed-cloud-fixture',enforce:'pre',configureServer(server){server.middlewares.use('/__alpha-browser-cloud',(req,res)=>{void handler(req,res);});}}]});
 try{
  await server.listen();const address=server.httpServer!.address()as {port:number};
  await page.addInitScript(()=>{localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'none'}));(window as any).openedCloudURLs=[];window.open=((url:string)=>{(window as any).openedCloudURLs.push(url);return {opener:null};})as typeof window.open;});
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await expect.poll(()=>page.evaluate(async()=>{const c=(await import('/src/runtime/connection-ui.tsx')).connectionController;return c.getSnapshot().cloudAccount?.userId;})).toBe(owner);
  expect(calls.filter(p=>p.startsWith('/api/auth/cli-session'))).toEqual([]);
  const setup=page.locator('dialog.alpha-startup-permissions');
  await expect(setup).toHaveCount(0);
  await completeAccessSetup(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Inbox',exact:true})).toBeVisible();
  expect(await page.evaluate(async()=>(await import('/src/runtime/connection-ui.tsx')).connectionController.getSnapshot().open)).toBe(false);
  const voice=await page.evaluate(async()=>{
   const {connectionController:c}=await import('/src/runtime/connection-ui.tsx'),binding=c.getCloudClient()!,{BrowserVoice}=await import('/src/browser/voice.ts'),v=new BrowserVoice();
   (v as any).transcribeLocalRecording=()=>{throw Error('Local speech must not run');};
   (v as any).capture.clips.set('closed-fixture',{blob:new Blob(['closed fixture'],{type:'audio/webm'}),durationMs:10});
   const options={environment:'production',credentialId:binding.credentialId,requestId:crypto.randomUUID()};
   const transcript=await v.transcribeRecording({...options,recordingId:'closed-fixture'});const prepared=await v.synthesize({...options,requestId:crypto.randomUUID(),text:'Closed fixture text'});
   const plan=await binding.client.billingFallbackPlan(new AbortController().signal);await binding.client.openSubscriptionManagement(new AbortController().signal);await v.releaseLocalSpeech();
   return {transcript,prepared:!!prepared.playbackId,plan:plan?.status,publicStorage:JSON.stringify(localStorage),opened:(window as any).openedCloudURLs};
  });
  expect(voice.transcript).toEqual({text:'Closed fixture transcript',local:false});expect(voice.prepared).toBe(true);expect(voice.plan).toBe('active');expect(voice.publicStorage).not.toContain(secret);expect(voice.opened).toEqual(['https://cloud.eliza.app/cloud/billing']);
  await page.evaluate(async()=>{const c=(await import('/src/runtime/connection-ui.tsx')).connectionController;c.openCloudAccount();});
  const account=page.getByRole('dialog',{name:'Subscription',exact:true});await expect(account.getByRole('region',{name:'Subscription',exact:true}).getByText('owned@example.invalid',{exact:true})).toBeVisible();await page.screenshot({path:info.outputPath('existing-cloud-account.png'),animations:'disabled'});
  // Signed in, the account dialog is the Subscription sheet; its footer signs out.
  await account.getByRole('button',{name:'Use another account',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'This sign-in was revoked.'})).toBeVisible();
  // Reload only after sign-out has removed the host credential, not its earlier in-memory detach.
  await expect.poll(async()=>{
   try{return JSON.parse(await readFile(join(deploymentProfile,'credentials.json'),'utf8'));}
   catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
  }).toEqual({});
  await expect.poll(()=>page.evaluate(async()=>{const state=(await import('/src/runtime/connection-ui.tsx')).connectionController.getSnapshot();return !state.busy&&state.cloudAccount===null;})).toBe(true);
  await page.reload();
  expect(calls.filter(p=>p==='/api/v1/api-keys/current')).toHaveLength(1);
  await expect.poll(()=>page.evaluate(async()=>{const state=(await import('/src/runtime/connection-ui.tsx')).connectionController.getSnapshot();return state.startupResolved===true&&!state.busy&&state.cloudAccount===null;})).toBe(true);
  // An existing account signing in again from Settings keeps the completed install: no Ready popup
  // (only a newly created account gets one; startup-permission-completion.test.mjs).
  await page.evaluate(()=>window.dispatchEvent(new Event('alpha:agent-settings')));
  await page.evaluate(async()=>(await import('/src/runtime/connection-ui.tsx')).connectionController.openCloudAccount());
  // This test-mocks host's account button retains the diagnostic browser route. Exercise the
  // shared in-app entry explicitly before that handoff; native production uses this entry.
  await page.evaluate(async()=>(await import('/src/runtime/connection-ui.tsx')).connectionController.beginSignIn('production'));
  const signIn=page.getByRole('dialog',{name:'Welcome to Alpha.',exact:true});
  await expect(signIn.getByRole('form',{name:'Sign in with email'})).toBeVisible();
  await expect(signIn.getByRole('button',{name:'Continue with Google',exact:true})).toBeDisabled();
  await expect(signIn.getByText('Google sign-in is unavailable. Use another sign-in method below.',{exact:true})).toBeVisible();
  await signIn.getByRole('button',{name:'Browser sign-in (diagnostic)',exact:true}).click();
  await expect.poll(()=>page.evaluate(async()=>(await import('/src/runtime/connection-ui.tsx')).connectionController.getSnapshot().cloudAccount?.userId)).toBe(owner);
  await expect(page.getByRole('dialog',{name:'Eliza Cloud',exact:true})).toHaveCount(0);
  await expect(signIn).toHaveCount(0);
  await expect(page.locator('dialog.alpha-startup-permissions')).toHaveCount(0);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('alpha:startup-permission-walkthrough:v1')!).status)).toBe('completed');
  await completeAccessSetup(page);
  await expect(page.getByRole('button',{name:'Inbox',exact:true})).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate(async()=>(await import('/src/runtime/connection-ui.tsx')).connectionController.openCloudAccount());
  await expect(page.getByRole('dialog',{name:'Subscription',exact:true}).getByRole('region',{name:'Subscription',exact:true}).getByText('owned@example.invalid',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).openedCloudURLs)).toContain(`https://eliza.app/auth/cli-login?session=${session}&app=alpha`);
  await page.evaluate(async()=>(await import('/src/runtime/connection-ui.tsx')).connectionController.close());
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await expect.poll(()=>page.evaluate(async()=>(await import('/src/runtime/connection-ui.tsx')).connectionController.getSnapshot().cloudAccount?.userId)).toBe(owner);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(calls.filter(p=>p.startsWith('/api/auth/cli-session'))).toHaveLength(2);
  await info.attach('closed-cloud-requests',{body:JSON.stringify({calls,mediaCapture:false,playback:false,providerRequests:false}),contentType:'application/json'});
 }finally{await server.close();await rm(profile,{recursive:true,force:true});}
});


test('flag-off real resident reads Notes through its owner-bound verified Cloud speech route',async({page})=>{
 const directory=await mkdtemp(join(tmpdir(),'alpha-resident-speech-')),tokenFile=join(directory,'owner-token'),owner='11111111-1111-4111-8111-111111111111',paired='closed-owner-session',calls:string[]=[];
 await writeFile(tokenFile,'1'.repeat(64),{mode:0o600});let provider='cartesia';
 const handler=createLocalAgentDevHandler({origin:'http://127.0.0.1:9',tokenFile,cloudVoiceEnabled:true,request:async(url,input={})=>{
  const path=new URL(String(url)).pathname;calls.push(path);
  if(path==='/api/auth/status')return Response.json({instanceId:'closed-resident'});
  if(path==='/api/auth/pair-code')return Response.json({code:'closed-pair'});
  if(path==='/api/auth/pair')return Response.json({access:'owner',token:paired,instanceId:'closed-resident',identityId:owner});
  expect(new Headers(input.headers).get('Authorization')).toBe('Bearer '+paired);
  if(path==='/api/auth/me')return Response.json({identity:{id:owner,kind:'owner'},access:{role:'OWNER',mode:'local'},session:{id:paired,expiresAt:Date.now()+600000}});
  if(path==='/api/agents')return Response.json({agents:[{id:'closed-agent',status:'running'}]});
  expect(path).toBe('/api/tts/cloud');expect(JSON.parse(String(input.body))).toEqual({text:'QA test note. The recovery test phrase is silver maple.'});
  return new Response(new Uint8Array([73,68,51,1]),{headers:{'Content-Type':'audio/mpeg','X-Eliza-Speech-Provider':provider,'X-Eliza-Speech-Route':'cloud'}});
 }});
 const server=await createServer({configFile:resolve('vite.config.ts'),cacheDir:resolve('test-results/resident-speech/vite-cache'),server:{host:'127.0.0.1',port:0,strictPort:false},define:{'import.meta.env.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS':JSON.stringify(''),'import.meta.env.VITE_ALPHA_CLOUD_RESIDENT':JSON.stringify('1'),'import.meta.env.VITE_LOCAL_AGENT':JSON.stringify('1'),'import.meta.env.VITE_ELIZA_RUNTIME_PROFILE':JSON.stringify('cloud')},plugins:[{name:'closed-owned-resident-speech',enforce:'pre',configureServer(server){server.middlewares.use('/__alpha-local-agent',(req,res)=>{void handler(req,res);});server.middlewares.use('/__alpha-browser-cloud',async(req,res)=>{const parts=[];for await(const part of req)parts.push(part);const data=JSON.parse(Buffer.concat(parts).toString());res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data.operation==='secureRead'?{value:null}:{state:'host-managed'}));});}}]});
 const foreign:string[]=[];await page.route(/^https?:\/\/(?!127\.0\.0\.1:|localhost:)/,async route=>{foreign.push(route.request().url());await route.abort();});
 try{
  await server.listen();const address=server.httpServer!.address()as {port:number};await page.goto(`http://127.0.0.1:${address.port}/`);
  const flags=await page.evaluate(async()=>({...(await import('/src/build-flags.ts')),speech:(await import('/src/runtime/development-cloud-voice.ts')).developmentCloudVoiceEnabled}));expect(flags.testMocksEnabled).toBe(false);expect(flags.devSurfacesEnabled).toBe(false);
  await page.evaluate(async()=>{
   const {connectionController:c}=await import('/src/runtime/connection-ui.tsx'),{LocalAgentProtocol}=await import('/src/runtime/local-agent.ts'),{bindBrowserSpeechConnection}=await import('/src/browser/agent-speech.ts');
   const agent=new LocalAgentProtocol();await agent.connect(new AbortController().signal);c.getBrowserSpeechAgent=()=>agent;c.getCloudEnvironment=()=> 'production';const binding={sessionId:'closed-cloud-session',credentialId:'closed-cloud-generation'}as any;c.getCloudClient=()=>binding;const snapshot={...c.getSnapshot(),open:false};c.getSnapshot=()=>snapshot;bindBrowserSpeechConnection(c);
   const proof=(window as any).residentSpeech={plays:0,outcome:null};Object.defineProperty(window,'Audio',{configurable:true,value:class{src:string;volume=1;paused=true;onended=null;onerror=null;constructor(src:string){this.src=src;}play(){this.paused=false;proof.plays++;return Promise.resolve();}pause(){this.paused=true;}removeAttribute(){this.src='';}load(){}}});
   const {speakNote}=await import('/src/prototype/local-speech-playback.ts');void speakNote('QA test note. The recovery test phrase is silver maple.').then(outcome=>proof.outcome=outcome);
  });
  await expect.poll(()=>page.evaluate(()=>(window as any).residentSpeech.plays)).toBe(1);expect(calls.filter(p=>p==='/api/tts/cloud')).toHaveLength(1);
  await expect.poll(()=>page.evaluate(async()=>(await import('/src/prototype/local-speech-playback.ts')).currentNoteReading()?.state)).toBe('reading');
  await page.evaluate(async()=>(await import('/src/prototype/local-speech-playback.ts')).stopSpeaking());await expect.poll(()=>page.evaluate(()=>(window as any).residentSpeech.outcome)).toBe('stopped');
  provider='wrong-provider';await page.evaluate(async()=>{(window as any).residentSpeech.outcome=await(await import('/src/prototype/local-speech-playback.ts')).speakNote('QA test note. The recovery test phrase is silver maple.');});expect(await page.evaluate(()=>(window as any).residentSpeech.outcome)).toBe('failed');expect(await page.evaluate(()=>(window as any).residentSpeech.plays)).toBe(1);expect(calls.filter(p=>p==='/api/tts/cloud')).toHaveLength(2);expect(foreign).toEqual([]);
 }finally{handler.closeVoice();await server.close();await rm(directory,{recursive:true,force:true});}
});

// UI progress only: this feature fixture does not manufacture OS/provider grants.
test.beforeEach(async({page})=>seedCompletedAccessSetup(page));
