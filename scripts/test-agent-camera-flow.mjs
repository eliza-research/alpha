import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {DeviceActions} from '../apps/app/src/runtime/device-actions.ts';
import {validateCameraCaptureResult} from '../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/camera-contract.ts';

const source=readFileSync('apps/app/src/prototype/camera-adapter.ts','utf8');
const save=source.slice(source.indexOf('  async function saveCameraPhoto('),source.indexOf('  async function capture()'));
const request=source.slice(source.indexOf('  /** An agent capture asked for while Camera starts'),source.indexOf('  requestedPhoto=takeRequestedPhoto;'));
// A request made while the preview starts waits for it (the adapter's queue), then captures.
const queue=source.slice(source.indexOf('  const waiters = new Set'),source.indexOf('  /** Set when the native size'));
const receiptPath=source.slice(source.indexOf('/** A saved still'),source.indexOf('/** The chat sheet may cover Camera')).replace(/^export /gm,'');
// The capture lock is the shared camera session's (plugin-native-camera), run as-is.
const shared=stripTypeScriptTypes(['host-ports','session'].map(name=>readFileSync(`.eliza/client-features/plugins/plugin-native-camera/src/${name}.ts`,'utf8')).join('\n').replace(/^import[^;]*;$/gm,'').replace(/^export /gm,''),{mode:'transform'});
function cameraFixture(browser=false){
 let calls=0,mode='ok',release;
 const camera={startPreview:async()=>{},stopPreview:async()=>{},async capturePhoto(options){calls++;assert.equal(options.saveToGallery,true);if(mode==='hold')await new Promise(resolve=>{release=resolve});if(mode==='fail')throw Error('write unavailable');return {path:mode==='invalid'?'file:///tmp/45':browser?'browser-photo:///1792274767123123456789012':'content://media/external/images/media/45',format:'jpeg',base64:'jpeg-fixture',width:1280,height:720}}};
 const api={S:{chat:'hidden'},isActive:()=>true,set(){},setView(){throw Error('An agent capture must not change views')}};
 const context=vm.createContext({camera,api,validateCameraCaptureResult,nativeId:id=>id.replace('native-camera-',''),browserMode:browser,disposed:false,captures:[],loaded:true,requestedCaptureActive:false,document:{hidden:false,querySelector:()=>({})},finder:'#camera',schedule(){},message(){},Date});
 const visibility=source.slice(source.indexOf('  const cameraViewVisible'),source.indexOf('  /** The one photo being written natively'));
 vm.runInContext(shared+stripTypeScriptTypes(receiptPath+'const CHAT_GRACE_MS=10000;let lastCapture,photoWrite;const shutterFlash=()=>{};\n'+visibility+'\n'+queue+save+request+';globalThis.capture=takeRequestedPhoto;',{mode:'transform'}),context);
 vm.runInContext('globalThis.session=createCameraSession({camera,active:()=>true,preview:()=>({}),recording:()=>({}),hooks:{changed:()=>settle()}});var session=globalThis.session;',context);
 // The request starts the preview itself through the session, as on an agent request from another view.
 context.start=async retry=>{await context.session.start(retry);};
 return {capture:context.capture,context,get calls(){return calls},setMode:value=>{mode=value},release:()=>release?.()};
}
function flow(camera){
 let state='pending',receipt;const entries=new Map(),digest='b'.repeat(64),id='request-one',scope='c'.repeat(64);
 const proposal=()=>({id,digest,state,subjectUserId:'owner',requestedBy:'agent',action:'device_action',expiresAt:new Date(Date.now()+60000).toISOString(),payload:{version:1,action:'device_action',installationId:'device',enrollmentId:'enrollment',operation:{type:'camera_capture_photo'},requestMessageId:'message-one'},execution:state==='pending'?undefined:{attemptId:'attempt-one'}});
 const request=async(path,body)=>{if(body===undefined)return {proposals:[proposal()]};if(path.endsWith('/decision'))state='approved';if(path.endsWith('/claim'))state='executing';if(path.endsWith('/receipt')){receipt=body.receipt;state=receipt.outcome==='applied'?'done':'reconciliation_required';}return {proposal:proposal(),digest};};
 const journal={reserve:async input=>{if(entries.has(input.proposalId))return {created:false,entry:entries.get(input.proposalId)};const entry={...input,phase:'reserved'};entries.set(input.proposalId,entry);return {created:true,entry}},markApplying:async input=>Object.assign(entries.get(input.proposalId),{phase:'applying',attemptId:input.attemptId}),finish:async input=>Object.assign(entries.get(input.proposalId),input,{phase:'terminal'}),get:async input=>({entry:entries.get(input.proposalId)||null}),list:async()=>({entries:[...entries.values()]})};
 const make=(caps=['camera.capture-photo.v1'])=>new DeviceActions({ownerId:'owner',agentId:'agent',origin:'https://agent.invalid',sessionId:'session'},{installationId:'device',enrollmentId:'enrollment',key:'a'.repeat(64),capabilities:caps},scope,request,journal,async(_op,operationId,_context,signal)=>{assert.equal(entries.get(id).phase,'applying');return camera.capture(operationId,signal,()=>signal.throwIfAborted())});
 return {make,get receipt(){return receipt},get entry(){return entries.get(id)},lostReceipt(){state='executing'}};
}
const view={view:'camera',revision:1,sensitive:false},signal=()=>new AbortController().signal;
const camera=cameraFixture(),f=flow(camera),client=f.make();await client.pendingReview(view,signal());
assert.equal((await client.performRequested('other-message',view,signal(),async()=>true)).length,0);assert.equal(camera.calls,0);
const done=await client.performRequested('message-one',view,signal(),async()=>true);assert.equal(done[0].status,'succeeded');assert.equal(camera.calls,1);assert.equal(f.entry.result.cameraResult.mediaId,'45');assert.equal(f.receipt.result.mediaId,'45');assert(!JSON.stringify(f.receipt).includes('jpeg-fixture'));assert(!JSON.stringify(f.receipt).includes('content://'));
f.lostReceipt();await f.make().syncReceipts(signal());assert.equal(camera.calls,1,'lost server receipt resends evidence, never takes another photo');
const hidden=flow(cameraFixture());assert.equal((await hidden.make().pendingReview({...view,view:'home'},signal())).filter(row=>row.proposal).length,0);assert.equal((await hidden.make([]).pendingReview(view,signal())).filter(row=>row.proposal).length,0);
for(const mode of ['fail','invalid']){const camera=cameraFixture();camera.setMode(mode);const f=flow(camera),c=f.make();await c.pendingReview(view,signal());assert.equal((await c.performRequested('message-one',view,signal(),async()=>true))[0].status,'unknown');assert.equal(camera.calls,1);await c.pendingReview(view,signal());assert.equal((await c.performRequested('message-one',view,signal(),async()=>true)).length,0);assert.equal(camera.calls,1);}
const held=cameraFixture();held.setMode('hold');const first=held.capture('operation-one',signal(),()=>{});while(held.calls===0)await new Promise(resolve=>setTimeout(resolve,0));assert.equal(held.context.session.capturing,true);assert.equal((await held.capture('operation-two',signal(),()=>{})).status,'failed');assert.equal(held.context.session.capturing,true,'a refused concurrent capture cannot clear the active capture lock');while(held.calls===0)await new Promise(resolve=>setTimeout(resolve,0));held.release();assert.equal((await first).status,'succeeded');assert.equal(held.calls,1);
const browser=cameraFixture(true);assert.equal((await browser.capture('browser-operation',signal(),()=>{})).cameraResult.mediaId,'1792274767123123456789012');assert.equal(browser.calls,1);
const changed=cameraFixture();let checks=0;assert.equal((await changed.capture('changed',signal(),()=>{if(++checks===2)throw Error('owner changed')})).status,'failed');assert.equal(changed.calls,0);
const overlay=cameraFixture();overlay.context.api.S.chat='full';assert.equal((await overlay.capture('overlay-operation',signal(),()=>{})).status,'succeeded');assert.equal(overlay.context.requestedCaptureActive,false);assert.equal(overlay.calls,1);
const background=cameraFixture();background.context.document.hidden=true;assert.equal((await background.capture('background-operation',signal(),()=>{})).status,'failed');assert.equal(background.calls,0);
const cancelled=cameraFixture();const abort=new AbortController();abort.abort();assert.equal((await cancelled.capture('cancelled',abort.signal,()=>{})).status,'failed');assert.equal(cancelled.calls,0);
console.log('PASS: actual camera save/request code and DeviceActions journal/receipt flow; current-message binding, visible view, capability, cancellation, concurrency and lost-receipt non-replay. Synthetic camera boundary only.');

// Exercise the actual controller continuation, with navigation and preferences as boundaries.
const controllerSource=readFileSync('apps/app/src/runtime/connection-ui.tsx','utf8');
const start=controllerSource.indexOf('  async continueRequestedCamera('),end=controllerSource.indexOf('  voiceRendererClientId()',start);
assert(start>=0&&end>start);
function continuationFixture(){
 const camera=cameraFixture(),f=flow(camera),actions=f.make(),context={view:'camera',revision:2,sensitive:false};
 const session={sessionId:'session'},selected={actions},attempt={controller:new AbortController()};
 const state={session},pending={messageId:'message-one',selected,session,generation:7,conversationId:'conversation',client:{deliveredContext:()=>context},attempt,expiresAt:Date.now()+30000};
 const scope=vm.createContext({requestedCameraContinuation:pending,navigationContext:()=>context,document:{hidden:false},epoch:7,active:selected,state,conversationMemory:new Map([['key','conversation']]),conversationKey:()=> 'key',readDevicePreferences:async()=>({askBeforeAgentActions:false}),Date});
 vm.runInContext(stripTypeScriptTypes('globalThis.controller={'+controllerSource.slice(start,end)+'};',{mode:'transform'}),scope);
 return {scope,context,pending,session,state,attempt,camera,run:(message='message-one')=>scope.controller.continueRequestedCamera(message,signal())};
}
const continued=continuationFixture();assert.equal((await continued.run())[0].status,'succeeded');assert.equal(continued.camera.calls,1);assert.equal((await continued.run()).length,0);assert.equal(continued.camera.calls,1);
for(const reason of ['wrong-message','no-ack','different-view','hidden','owner','conversation','epoch','aborted-navigation','expired','ask-first','moved-after-ack']){
 const h=continuationFixture();
 if(reason==='no-ack')h.pending.client.deliveredContext=()=>undefined;
 if(reason==='different-view')h.context.view='photos';
 if(reason==='hidden')h.scope.document.hidden=true;
 if(reason==='owner')h.state.session={sessionId:'other'};
 if(reason==='conversation')h.scope.conversationMemory.set('key','other');
 if(reason==='epoch')h.scope.epoch=8;
 if(reason==='aborted-navigation')h.attempt.controller.abort();
 if(reason==='expired')h.pending.expiresAt=0;
 if(reason==='ask-first')h.scope.readDevicePreferences=async()=>({askBeforeAgentActions:true});
 if(reason==='moved-after-ack')h.scope.navigationContext=()=>({...h.context,revision:3});
 await h.run(reason==='wrong-message'?'old-message':'message-one').catch(()=>[]);
 assert.equal(h.camera.calls,0,reason+' must not capture');
}
console.log('PASS: Home continuation consumes only the current completed message after acknowledged Camera navigation; stale, lost acknowledgement, changed owner/view/preferences, expired and duplicate continuations cannot capture.');
