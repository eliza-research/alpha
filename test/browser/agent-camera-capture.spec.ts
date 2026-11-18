import {openConnectionDiagnostics} from './helpers/connection-diagnostics';
import {test,expect} from '@playwright/test';
import {returnToApps} from './app-navigation';

// Actual shell, controller, navigation acknowledgement, action journal and camera adapter.
// HTTP provider and camera sensor are synthetic; this is not a device acceptance test.
// proposal-only: the agent proposes the photo without showing Camera. stop: the preview never starts and the owner stops the request.
// selfie: the proposal names the front camera, taken at once or (selfie-ask-first) after the owner approves its card.
// proposal-only-ask-first: the agent only proposes the photo on an ask-first phone; Camera still opens first and the card waits there.
// Every shutter is checked to fire on the live Camera viewfinder, never from Home.
for(const mode of ['capture','lost-ack','old-message','ask-first','proposal-only','proposal-only-ask-first','stop','selfie','selfie-ask-first'] as const)test(`Home camera request: ${mode}`,async({page})=>{
 await page.addInitScript(mode=>{
  const w=window as any,store=new Map(),agentId='12345678-1234-4234-8234-123456789abc',userMessageId='87654321-4321-4321-8321-cba987654321';
  const f=w.cameraRequestFixture={posts:0,captures:0,claims:0,acks:0,decisions:0,receipts:[],log:[] as string[],shutterViews:[] as string[],advertised:'',proposal:null as any,entry:null as any};
  const methods=(names:string[])=>names.map(name=>({name,rtype:'promise'}));
  w.Capacitor={PluginHeaders:[{name:'AlphaConnection',methods:methods(['request','cancel','secureRead','secureWrite','secureCompareExchange','secureRemove'])},{name:'AlphaActionJournal',methods:methods(['reserve','markApplying','finish','get','list'])}],nativePromise:async(plugin:string,method:string,input:any)=>{
   if(plugin==='AlphaActionJournal'){
    if(method==='reserve'){f.entry={...input,phase:'reserved'};return{created:true,entry:f.entry};}
    if(method==='markApplying'){Object.assign(f.entry,{phase:'applying',attemptId:input.attemptId});return{};}
    if(method==='finish'){Object.assign(f.entry,input,{phase:'terminal'});return{};}
    if(method==='get')return{entry:f.entry};
    if(method==='list')return{entries:f.entry?[f.entry]:[]};
   }
   if(plugin!=='AlphaConnection')throw Error('Unexpected native effect');
   if(method==='secureRead')return{value:store.get(input.slot)??null};
   if(method==='secureWrite'){store.set(input.slot,input.value);return{};}
   if(method==='secureRemove'){store.delete(input.slot);return{};}
   if(method==='secureCompareExchange'){if((store.get(input.slot)??null)!==input.expectedValue)return{status:'conflict'};if(input.value===null)store.delete(input.slot);else store.set(input.slot,input.value);return{status:'saved'};}
   if(method==='cancel')return{};
   const path=new URL(input.url).pathname,body=input.body?JSON.parse(input.body):{},ok=(data:any)=>({status:200,data});
   if(path==='/api/auth/status')return ok({required:true,authenticated:false,pairingEnabled:true,bootstrapRequired:false,instanceId:'camera-fixture',expiresAt:Date.now()+60000});
   if(path==='/api/auth/pair')return ok({token:'synthetic-session',identityId:'fixture-owner',access:'owner',instanceId:'camera-fixture'});
   if(path==='/api/auth/me')return ok({identity:{id:'fixture-owner',displayName:'Fixture',kind:'owner'},session:{id:'synthetic-session',kind:'machine',expiresAt:Date.now()+600000},access:{role:'OWNER',mode:'session'}});
   if(path==='/api/agents')return ok({agents:[{id:agentId,name:'Camera fixture',status:'running'}]});
   if(path==='/api/client-devices/register'){w.cameraInstallation=input.headers['X-Eliza-Device-Id'];return ok({installationId:w.cameraInstallation,enrollmentId:'camera-enrollment',capabilities:['camera.capture-photo.v1','camera.capture-lens.v1']});}
   if(path==='/api/workflow/status')return ok({});
   if(path==='/api/conversations'&&input.method==='POST')return ok({conversation:{id:'camera-chat',title:'Fixture'}});
   if(path==='/api/conversations/camera-chat/messages'&&input.method==='POST'){
    f.posts++;
    f.proposal={id:'camera-proposal',digest:'a'.repeat(64),state:'pending',expiresAt:new Date(Date.now()+600000).toISOString(),subjectUserId:'fixture-owner',requestedBy:agentId,action:'device_action',payload:{action:'device_action',version:1,installationId:w.cameraInstallation,enrollmentId:'camera-enrollment',operation:{type:'camera_capture_photo',...(mode.startsWith('selfie')?{lens:'front'}:{})},requestMessageId:mode==='old-message'?'old-message':userMessageId}};
    if(mode.startsWith('proposal-only'))return ok({text:'Taking the photo.',agentName:'Camera fixture',userMessageId});
    return ok({text:mode==='selfie'?'Opening Camera to take the photo.':'Opening Camera.',agentName:'Camera fixture',userMessageId,actionResults:[{actionName:'VIEWS_SHOW',success:true,values:{mode:'show',viewId:'camera',viewPath:'/camera',viewType:'gui',completedActionDelivered:false,completedActionHandoffId:'camera-handoff',navigationPrepared:true,navigationBinding:{requestId:'camera-handoff',clientId:body.metadata.viewClientId,viewId:'camera',viewType:'gui',installationId:w.cameraInstallation}}}]});
   }
   if(path==='/api/views/interact-claim'){f.claims++;return ok({claimId:'camera-owned-claim'});}
   if(path==='/api/views/interact-result'){f.acks++;return ok({accepted:mode!=='lost-ack'});}
   if(path==='/api/client-devices/proposals'){f.advertised=input.headers['X-Eliza-Device-Capabilities'];return ok({proposals:f.proposal?[f.proposal]:[]});}
   if(path.startsWith('/api/client-devices/proposals/camera-proposal/')){
    if(body.digest!==f.proposal.digest)throw Error('Digest changed');
    if(path.endsWith('/decision')){f.decisions++;f.proposal.state='approved';}
    if(path.endsWith('/claim')){f.proposal.state='executing';f.proposal.execution={attemptId:'camera-attempt'};}
    if(path.endsWith('/receipt')){f.receipts.push(body.receipt);f.proposal.state='succeeded';}
    return ok({proposal:f.proposal,digest:f.proposal.digest});
   }
   throw Error('Unexpected fixture route '+path);
  }};
 },mode);
 await page.goto('/');
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await openConnectionDiagnostics(page);
 await page.getByText('Local development agent',{exact:true}).click();
 const local=page.locator('.alpha-connection details').filter({has:page.getByText('Local development agent',{exact:true})});
 await local.getByLabel('Local agent address').fill('http://127.0.0.1:47842');
 await local.getByLabel('Pairing code',{exact:true}).fill('synthetic-code');
 await local.getByRole('button',{name:'Connect local agent',exact:true}).click();
 await page.locator('.alpha-connection-scrim').waitFor({state:'detached'});
 await page.evaluate(async mode=>{
  const {browserCamera,browserPhotoLibrary}=await import('/src/prototype/browser-camera.ts');
  browserCamera.startPreview=mode==='stop'?()=>new Promise(()=>{}):async()=>({width:16,height:16,deviceId:'fixture'});
  // The saved photo is larger than the frame the capture receipt carries.
  const saved=document.createElement('canvas');saved.width=saved.height=64;(window as any).cameraRequestFixture.saved=saved.toDataURL('image/jpeg');
  browserPhotoLibrary.read=async({id}:{id:string})=>{if(id!=='1792274767123123456789012')throw Error('Unknown photo');return{id,kind:'image',image:(window as any).cameraRequestFixture.saved,width:64,height:64,date:1,revision:'r',mutationRevision:'r',favorite:false,trashed:false} as any;};
  browserCamera.stopPreview=async()=>{};
  browserCamera.switchCamera=async({direction})=>{(window as any).cameraRequestFixture.log.push('switch:'+direction);return{width:16,height:16,deviceId:'fixture'} as any;};
  browserCamera.capturePhoto=async()=>{const f=(window as any).cameraRequestFixture;f.captures++;f.log.push('capture');
   // The shutter fires only with Camera active and its viewfinder on screen.
   const finder=document.querySelector('[data-alpha-camera="viewfinder"]');f.shutterViews.push(document.documentElement.getAttribute('data-active-view')+(finder&&finder.getBoundingClientRect().height>0?':viewfinder':':no-viewfinder'));const c=document.createElement('canvas');c.width=c.height=16;return{path:'browser-photo:///1792274767123123456789012',format:'jpeg',base64:c.toDataURL('image/jpeg').split(',')[1],width:16,height:16};};
  if(mode.endsWith('ask-first')){const {editDevicePreferences}=await import('/src/browser/device-preferences.ts');await editDevicePreferences(state=>{state.askBeforeAgentActions=true;});}
 },mode);
 await returnToApps(page);
 await expect(page.locator('html')).toHaveAttribute('data-active-view','home');
 const input=page.getByRole('textbox',{name:'Ask Alpha',exact:true});await input.fill('Take a photo');await input.press('Enter');
 const fixture=()=>page.evaluate(()=>(window as any).cameraRequestFixture);
 const notice=page.getByText('Take photo: Open Camera to take the requested photo.',{exact:true}),saved=page.locator('[data-alpha-message-text]').filter({hasText:/^Saved$/});
 if(mode.startsWith('proposal-only'))await expect.poll(async()=>(await fixture()).posts).toBe(1);
 else await expect.poll(async()=>(await fixture()).acks).toBe(1);
 if(mode==='stop'){
  // A photo waiting for its preview can be stopped: nothing is taken and the request ends as a failure.
  await page.getByRole('button',{name:'Stop reply',exact:true}).click();
  await expect(page.locator('[data-alpha-message-text]').filter({hasText:/^Cancelled\. No photo was taken\.$/})).toHaveCount(1);
  const f=await fixture();expect(f.captures).toBe(0);expect(f.receipts.map((receipt:any)=>receipt.outcome)).not.toContain('applied');
  await expect(page.getByRole('button',{name:'Stop reply',exact:true})).toHaveCount(0);
  return;
 }
 await expect(page.getByRole('button',{name:'Stop reply',exact:true})).toHaveCount(0);
 if(mode==='capture'||mode==='proposal-only'||mode==='selfie'){
  await expect.poll(async()=>(await fixture()).receipts.length).toBe(1);
  const f=await fixture();expect(f.captures).toBe(1);expect(f.receipts[0].outcome).toBe('applied');expect(f.receipts[0].result.mediaId).toBe('1792274767123123456789012');expect(JSON.stringify(f.receipts)).not.toContain('base64');
  await expect(saved).toHaveCount(1);
  await expect(notice).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-active-view','camera');
  // Camera was opened by the agent's navigation, or on this phone when the agent only proposed the photo.
  expect(f.claims).toBe(mode==='proposal-only'?0:1);
  expect(f.shutterViews).toEqual(['camera:viewfinder']);
  // A named camera is negotiated, switched to before the shutter, and never reviewed in direct mode; an unnamed one stays put.
  expect(f.advertised.split(',')).toContain('camera.capture-lens.v1');
  expect(f.log).toEqual(mode==='selfie'?['switch:front','capture']:['capture']);
  if(mode==='selfie'){await expect(page.getByText('Opening Camera to take the photo.',{exact:true}).first()).toBeVisible();await expect(page.getByRole('button',{name:/Approve$/})).toHaveCount(0);}
  // The saved photo, not the capture thumbnail, waits in the composer; the owner has not sent it.
  await expect(page.getByRole('button',{name:'Preview attached photo',exact:true}).getByRole('img')).toHaveAttribute('src',f.saved);
  expect((await fixture()).posts).toBe(1);
 }else{
  await expect(page.getByText(mode==='proposal-only-ask-first'?'Taking the photo.':'Opening Camera.',{exact:true}).first()).toBeVisible();
  const f=await fixture();expect(f.captures).toBe(0);expect(f.decisions).toBe(0);
  if(mode==='proposal-only-ask-first'){await expect(page.locator('html')).toHaveAttribute('data-active-view','camera');expect(f.claims).toBe(0);}
  if(mode==='lost-ack')return;
  // Camera is open, so the pending photo is its review card there, never "Open Camera".
  const approve=page.getByRole('button',{name:/^Take photo\b.*Approve$/s});
  await expect(approve).toHaveCount(1);
  await expect(notice).toHaveCount(0);
  if(!mode.endsWith('ask-first'))return;
  // The card names the camera the request asked for.
  await expect(approve).toContainText(mode==='selfie-ask-first'?'Use the front camera and save one photo in Photos.':'Use the current camera and save one photo in Photos.');
  await approve.click();
  await expect(saved).toHaveCount(1);
  const done=await fixture();expect(done.shutterViews).toEqual(['camera:viewfinder']);expect(done.log).toEqual(mode==='selfie-ask-first'?['switch:front','capture']:['capture']);expect(done.captures).toBe(1);expect(done.decisions).toBe(1);expect(done.receipts.map((receipt:any)=>receipt.outcome)).toEqual(['applied']);
 }
});

// The real shell, Camera adapter, browser camera and photo store over a synthetic stream.
async function openCamera(page:import('@playwright/test').Page){
 await page.addInitScript(()=>{
  const devices=navigator.mediaDevices;Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:devices});
  localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));
  const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;const ctx=canvas.getContext('2d')!;
  const paint=()=>{ctx.fillStyle='#c33';ctx.fillRect(0,0,640,480);};paint();
  (window as any).cameraDenied=false;
  navigator.mediaDevices.getUserMedia=async()=>{if((window as any).cameraDenied)throw new DOMException('Synthetic denial','NotAllowedError');const stream=canvas.captureStream(10);setInterval(paint,100);return stream;};
 });
 await page.goto('/');await page.getByRole('button',{name:'Camera',exact:true}).click();
 const video=page.locator('[data-alpha-camera="viewfinder"] video');await expect(video).toBeVisible();
 await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>v.readyState)).toBeGreaterThanOrEqual(2);
}

// The adapter's request port, called as the executor calls it, for the lens and failure cases a proposal does not reach.
test('a requested photo uses the named camera and words each failure',async({page})=>{
 await openCamera(page);
 const outcome=await page.evaluate(async()=>{
  const {browserCamera}=await import('/src/prototype/browser-camera.ts');
  const {captureAgentPhoto}=await import('/src/prototype/camera-adapter.ts');
  const log:string[]=[],switchCamera=browserCamera.switchCamera,capturePhoto=browserCamera.capturePhoto;
  browserCamera.switchCamera=async options=>{log.push('switch:'+options.direction);return switchCamera(options);};
  browserCamera.capturePhoto=async options=>{log.push('capture');return capturePhoto(options);};
  const ask=async(lens?:'front'|'back',current=()=>{},signal=new AbortController().signal)=>{const result=await captureAgentPhoto(crypto.randomUUID(),signal,current,lens);return [result.status,result.summary];};
  const front=await ask('front'),again=await ask('front'),unnamed=await ask();
  const taken=[...log];log.length=0;
  browserCamera.capturePhoto=async()=>{log.push('capture');throw Object.assign(Error('Synthetic native refusal'),{code:'CAPTURE_ERROR'});};
  const refused=await ask();
  const changed=await ask(undefined,()=>{throw Error('Synthetic screen change');});
  const stopped=new AbortController();stopped.abort();
  const cancelled=await ask(undefined,()=>{},stopped.signal);
  const before=[...log];log.length=0;
  browserCamera.switchCamera=async()=>{log.push('switch');throw Error('Synthetic lens failure');};
  const unswitched=await ask('back');
  return {front,again,unnamed,taken,refused,changed,cancelled,before,unswitched,after:[...log]};
 });
 expect(outcome.front).toEqual(['succeeded','Saved']);expect(outcome.again).toEqual(['succeeded','Saved']);expect(outcome.unnamed).toEqual(['succeeded','Saved']);
 // The lens changes once, before the first shutter; a request that names no lens keeps the current one.
 expect(outcome.taken).toEqual(['switch:front','capture','capture','capture']);
 expect(outcome.refused).toEqual(['failed','The photo couldn’t be taken. Try again.']);
 expect(outcome.changed).toEqual(['failed','The screen changed before the photo. Ask again.']);
 expect(outcome.cancelled).toEqual(['failed','Cancelled. No photo was taken.']);
 expect(outcome.before).toEqual(['capture']);
 expect(outcome.unswitched).toEqual(['failed','Couldn’t switch camera, so no photo was taken.']);expect(outcome.after).toEqual(['switch']);

 // Camera access is refused: the request says so instead of "Camera unavailable".
 await page.getByRole('button',{name:'Back to apps',exact:true}).click();
 await page.evaluate(()=>{(window as any).cameraDenied=true;});
 await page.getByRole('button',{name:'Camera',exact:true}).click();
 await expect(page.getByRole('alert',{name:'Camera off',exact:true})).toBeVisible();
 expect(await page.evaluate(async()=>{
  const {captureAgentPhoto}=await import('/src/prototype/camera-adapter.ts');
  const result=await captureAgentPhoto(crypto.randomUUID(),new AbortController().signal,()=>{});return [result.status,result.summary];
 })).toEqual(['failed','Camera access is off. Allow camera access, then ask again.']);
});
