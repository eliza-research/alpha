import assert from 'node:assert/strict';
import fs from 'node:fs';import vm from 'node:vm';import {stripTypeScriptTypes,createRequire} from 'node:module';
const require=createRequire(import.meta.url);const {JSDOM}=require('jsdom');
// The adapter's camera session (design/view-refresh-2026-11/tla/camera-session, Design.cfg) run against the real shared
// camera session (plugin-native-camera) with a synthetic camera bridge.
const source=fs.readFileSync(new URL('../apps/app/src/prototype/camera-adapter.ts',import.meta.url),'utf8');
const slice=(from,to)=>{const a=source.indexOf(from),b=source.indexOf(to,a);assert.ok(a>=0&&b>a,`camera-adapter.ts still has ${from} … ${to}`);return source.slice(a,b);};
const helpers=slice('const ZOOM_STOPS','/** Install after native').replace(/^export /gm,'');
const scanWords=slice('const SCAN_REQUEST','const browserMode').replace(/^export /gm,'');
const session=slice('  let requestedCaptureActive=false;','  function askCameraFrame(');
const syncCamera=source.match(/  const syncCamera = [^\n]+\n/)[0];
const sessionSource=fs.readFileSync(new URL('../.eliza/client-features/plugins/plugin-native-camera/src/session.ts',import.meta.url),'utf8');
const hostPorts=fs.readFileSync(new URL('../.eliza/client-features/plugins/plugin-native-camera/src/host-ports.ts',import.meta.url),'utf8');
const shared=stripTypeScriptTypes((hostPorts+sessionSource).replace(/^import[^;]*;$/gm,'').replace(/^export /gm,''),{mode:'transform'});
const settle=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fixture({permission=false,failing=true,receipt={width:1280,height:720,deviceId:'0',minZoom:0.5,maxZoom:10,hasFlash:true,zoom:1,flash:'off'}}={}){
 const env=new JSDOM('<div data-alpha-camera-root data-alpha-layer><button data-alpha-camera="viewfinder"></button></div>',{pretendToBeVisual:true});const timers=new Map();let timerId=0;
 env.window.setTimeout=(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;};env.window.clearTimeout=id=>timers.delete(id);
 const calls={starts:0,stops:0,masked:false,captures:[],focus:0,switches:[],recordings:0,list:[],scans:0};let failed=failing;
 const gates={start:undefined,capture:undefined};const clock={now:1000};
 let context;
 const camera={
  startPreview:async()=>{calls.starts++;if(gates.start)await gates.start.promise;if(failed)throw permission?Object.assign(Error('Camera permission denied'),{code:'CAMERA_PERMISSION_DENIED'}):Error('Camera in use');return receipt;},
  stopPreview:async()=>{calls.stops++;},
  capturePhoto:async options=>{calls.captures.push(options);if(gates.capture)await gates.capture.promise;return options.saveToGallery?{format:'jpeg',width:4000,height:3000,path:'content://media/external/images/media/'+(41+calls.captures.length),thumbnail:'AAAA'}:{format:'jpeg',width:4000,height:3000,base64:'AAAA'};},
  setFocusPoint:()=>{calls.focus++;return new Promise(()=>{});},// a focus that never settles
  switchCamera:async options=>{calls.switches.push({...options,flash:context.flashNow(),zoom:context.zoomNow()});return {...receipt,minZoom:1,maxZoom:4,hasFlash:false};},
  setZoom:async()=>{},setSettings:async()=>{},
  startRecording:async()=>{calls.recordings++;},stopRecording:async()=>({path:'content://media/external/video/media/9',duration:1,width:1,height:1,fileSize:1}),
 };
 const library={list:async options=>{calls.list.push(options);return {items:[]};},read:async({id})=>({id,image:'',width:1,height:1,date:0,revision:'r'})};
 let view={chat:'hidden',active:true};
 context=vm.createContext({window:env.window,document:env.window.document,console,camera,library,Date:{now:()=>clock.now},Uint8Array,atob,Blob:env.window.Blob,
  mask:enable=>calls.masked=enable,Capacitor:{isPluginAvailable:()=>true},validateCameraCaptureResult:value=>value,systemPickerActive:()=>false,device:{openSettings:async()=>({status:'opened'})},
  openScanReview:()=>{calls.scans++;return ()=>{};},createScanCapture:()=>({keep:async()=>undefined,close(){}}),ScanKeepError:Error,importBrowserPhoto:async()=>({}),browserCamera:{flashAvailable:()=>false},view:()=>view});
 const prelude=`let accessPanel,disposed=false,direction='back',flash=false,duration=0,loaded=true,captures=[],closeQuestion,closeScan,scanRequest;
  let lens={minZoom:1,maxZoom:1,hasFlash:false,zoom:1,flash:false},zoomRatio=1,lastCapture;let requestedPhoto;
  const browserMode=false,libraryAvailable=()=>true,normalize=row=>({...row,id:'native-camera-'+row.id}),nativeId=id=>id.replace(/^native-camera-/,''),cancelScan=()=>{};function schedule(){}
  const finder='[data-alpha-camera="viewfinder"]';let state={said:'',mode:'photo'};
  const api={S:{get chat(){return view().chat;}},isActive:()=>view().active,set:patch=>Object.assign(state,patch),get:()=>state,setView:()=>{},shell:patch=>{view().chat=patch.chat;}};`;
 vm.runInContext(shared+stripTypeScriptTypes(prelude+helpers+scanWords+session+syncCamera+`;globalThis.testCamera={start,stop,control,capture,record,focusAt,takeRequestedPhoto,zoomStops,lensFromReceipt,photoReceiptPath,cameraScanRequested,scanRequest:()=>scanRequest(),active,installViewPresence,syncCamera,CHAT_GRACE_MS,
  flip:()=>{const next=direction==='back'?'front':'back';return control(async()=>{flash=false;zoomRatio=1;return camera.switchCamera({direction:next});},r=>{direction=next;adoptLens(r);});},
  setFlash:on=>{flash=on;},setZoom:z=>{zoomRatio=z;},mode:m=>{state.mode=m;},
  state:()=>({phase:session.phase,denied:session.denied,said:state.said,capturing:session.capturing,recording:session.recording,flash,zoomRatio,lens,last:lastCapture,fl:state.fl})};
  globalThis.flashNow=()=>flash;globalThis.zoomNow=()=>zoomRatio;`,{mode:'transform'}),context);
 return {env,timers,calls,gates,clock,api:context.testCamera,recover:()=>failed=false,setView:v=>Object.assign(view,v)};
}
// Preview failure, permission denial and recovery.
{
 const f=fixture();await f.api.start();assert.equal(f.api.state().phase,'error');assert.equal(f.api.state().denied,undefined,'A hardware/start failure is not a permission denial');assert.equal(f.timers.size,0,'Unavailable panel cannot disappear with transient toast timer');
 const alert=f.env.window.document.querySelector('[role="alert"]');assert.equal(alert.getAttribute('aria-label'),'Camera unavailable');assert.equal(alert.textContent,'Camera unavailableTry again','No explanatory copy in the panel');
 await f.api.start();assert.equal(f.calls.starts,1,'No automatic retry loop');
 f.recover();f.env.window.document.querySelector('[role="alert"] button').click();await settle();assert.equal(f.calls.starts,2);assert.equal(f.api.state().phase,'ready');assert.equal(f.env.window.document.querySelector('[role="alert"]'),null);assert.equal(f.calls.masked,true);f.env.window.close();
}
{
 const f=fixture({permission:true});await f.api.start();assert.equal(f.api.state().denied,'camera');assert.equal(f.env.window.document.querySelector('[role="alert"]').getAttribute('aria-label'),'Camera access is off');assert.equal(f.timers.size,0);
 f.recover();[...f.env.window.document.querySelectorAll('[role="alert"] button')].find(b=>b.textContent==='Try again').click();await settle();assert.equal(f.api.state().denied,undefined);assert.equal(f.env.window.document.querySelector('[role="alert"]'),null);f.env.window.close();
}
{
 const f=fixture({failing:false});await f.api.start();assert.equal(f.api.state().said,'','No status pill while starting or after ready');
 await f.api.control(async()=>{throw Error('unsupported');},()=>{throw Error('must not complete');});const timer=[...f.timers.values()].find(t=>t.ms===5000);assert.ok(timer);assert.equal(f.api.state().said,'Not supported on this camera.');timer.fn();assert.equal(f.api.state().said,'');f.env.window.close();
}
// The bound lens decides zoom chips and flash; its receipt is read on first frame; the last tile reads one row.
{
 const f=fixture({failing:false});await f.api.start();await settle();
 assert.deepEqual(JSON.parse(JSON.stringify(f.api.state().lens)),{minZoom:0.5,maxZoom:10,hasFlash:true,zoom:1,flash:false});
 assert.deepEqual(JSON.parse(JSON.stringify(f.calls.list)),[{limit:1}],'The last-capture tile reads one library row after ready');
 assert.deepEqual(JSON.parse(JSON.stringify(f.api.zoomStops({minZoom:0.5,maxZoom:10}))).map(s=>s[1]),['.5','1×','2','5']);
 assert.deepEqual(JSON.parse(JSON.stringify(f.api.zoomStops({minZoom:1,maxZoom:4}))).map(s=>s[1]),['1×','2']);
 assert.deepEqual(JSON.parse(JSON.stringify(f.api.zoomStops({minZoom:1,maxZoom:1}))),[],'A fixed lens shows no chips');
 assert.equal(f.api.lensFromReceipt({minZoom:1,maxZoom:1,hasFlash:false,flash:'on'}).flash,false,'No flash without a flash unit');
 assert.equal(f.api.lensFromReceipt(null).hasFlash,false);
 assert.equal(f.api.photoReceiptPath('content://media/external/images/media/12',false),'content://media/external/images/media/12');
 assert.equal(f.api.photoReceiptPath('file:///sdcard/DCIM/Camera/x.jpg',false),undefined);
 f.env.window.close();
}
// FixLens: flip resets flash and zoom before the switch, then adopts the new lens.
{
 const f=fixture({failing:false});await f.api.start();f.api.setFlash(true);f.api.setZoom(0.5);await f.api.flip();
 assert.deepEqual(JSON.parse(JSON.stringify(f.calls.switches)),[{direction:'front',flash:false,zoom:1}]);assert.equal(f.api.state().lens.hasFlash,false);assert.equal(f.api.state().flash,false);f.env.window.close();
}
// FixFocus: a focus that never settles does not block the shutter.
{
 const f=fixture({failing:false});await f.api.start();f.api.focusAt(0.5,0.5);assert.equal(f.calls.focus,1);
 await f.api.capture();assert.equal(f.calls.captures.length,1,'Shutter after tap-to-focus captures');
 assert.equal(f.calls.captures[0].thumbnailOnly,true,'Native shutter returns a thumbnail, not the full JPEG');
 assert.equal(f.api.state().last.id,'native-camera-42','The capture becomes the last-capture tile');assert.equal(f.api.state().said,'','No "Saving photo" pill');
 assert.equal(f.api.state().fl,1,'Shutter flash');f.env.window.close();
}
// FixLeave: leaving during a capture waits for the native result before the preview is released, and clears capturing.
{
 const f=fixture({failing:false});await f.api.start();f.gates.capture=deferred();const shot=f.api.capture();await settle();assert.equal(f.api.state().capturing,true);
 f.setView({active:false});const leaving=f.api.stop();await settle();assert.equal(f.calls.stops,0,'The session stays bound until the photo is written');
 f.gates.capture.resolve();await shot;await leaving;assert.equal(f.calls.stops,1);assert.equal(f.api.state().capturing,false);assert.equal(f.api.state().last.id,'native-camera-42','A photo finished after leaving is still shown');f.env.window.close();
}
// FixAgentQueue: an agent capture during start waits for ready, then captures.
{
 const f=fixture({failing:false});f.gates.start=deferred();void f.api.start();await settle();assert.equal(f.api.state().phase,'starting');
 const request=f.api.takeRequestedPhoto('op-1',new AbortController().signal,()=>{});await settle();assert.equal(f.calls.captures.length,0);
 f.gates.start.resolve();const result=await request;assert.equal(result.status,'succeeded');assert.equal(result.cameraResult.mediaId,'42');assert.equal(f.calls.captures.length,1);f.env.window.close();
}
// Leaving while an agent capture is queued cancels it without a capture.
{
 const f=fixture({failing:false});f.gates.start=deferred();void f.api.start();await settle();
 const request=f.api.takeRequestedPhoto('op-2',new AbortController().signal,()=>{});await settle();f.setView({active:false});await f.api.stop();
 const result=await request;assert.equal(result.status,'failed');assert.match(result.summary,/No photo was taken/);assert.equal(f.calls.captures.length,0);f.gates.start.resolve();f.env.window.close();
}
// A start failure fails the queued agent capture for its real cause.
{
 const f=fixture();f.gates.start=deferred();void f.api.start();await settle();
 const request=f.api.takeRequestedPhoto('op-3',new AbortController().signal,()=>{});await settle();f.gates.start.resolve();const result=await request;
 assert.equal(result.status,'failed');assert.equal(f.api.state().phase,'error');assert.equal(f.calls.captures.length,0);f.env.window.close();
}
// Design rule: starting a recording refuses a queued agent capture instead of making it wait for the whole recording.
{
 const f=fixture({failing:false});f.api.mode('video');f.gates.start=deferred();void f.api.start();await settle();
 const request=f.api.takeRequestedPhoto('op-4',new AbortController().signal,()=>{});await settle();
 // The recording starts in the same turn as the first frame, before the queued request resumes.
 const started=f.api.start;f.gates.start.resolve();let recorded=false;
 for(let i=0;i<50&&!recorded;i++){await Promise.resolve();if(f.api.state().phase==='ready'){recorded=true;await f.api.record();}}
 assert.ok(recorded&&started);const result=await request;assert.equal(f.calls.recordings,1);
 assert.equal(result.status,'failed');assert.equal(result.summary,'Recording started, so no photo was taken.');assert.equal(f.calls.captures.length,0);f.env.window.close();
}
// Plan item 7: the chat sheet keeps the session bound for CHAT_GRACE_MS, then releases it; closing the chat restarts it.
{
 const f=fixture({failing:false});await f.api.start();assert.equal(f.api.state().phase,'ready');
 f.setView({chat:'sheet'});f.api.syncCamera();await settle();assert.equal(f.api.state().phase,'ready','Opening the chat keeps the preview');assert.equal(f.calls.stops,0);
 const grace=[...f.timers.values()].find(t=>t.ms===f.api.CHAT_GRACE_MS);assert.ok(grace,'A grace timer is armed');
 f.clock.now+=f.api.CHAT_GRACE_MS-1;f.api.syncCamera();await settle();assert.equal(f.api.state().phase,'ready','Still bound just before the grace ends');
 f.clock.now+=1;grace.fn();f.api.syncCamera();await settle();assert.equal(f.api.state().phase,'off','Released once the chat stays open');assert.equal(f.calls.stops,1);
 f.setView({chat:'hidden'});f.api.syncCamera();await settle();assert.equal(f.api.state().phase,'ready','Closing the chat restarts the preview');assert.equal(f.calls.starts,2);
 // A chat closed within the grace never restarts the camera.
 f.setView({chat:'sheet'});f.api.syncCamera();f.clock.now+=4000;f.setView({chat:'hidden'});f.api.syncCamera();await settle();assert.equal(f.calls.starts,2);assert.equal(f.calls.stops,1);
 f.env.window.close();
}
// An agent capture while the chat holds Camera past the grace starts the preview again and captures.
{
 const f=fixture({failing:false});await f.api.start();f.setView({chat:'sheet'});f.api.syncCamera();f.clock.now+=f.api.CHAT_GRACE_MS;f.api.syncCamera();await settle();assert.equal(f.api.state().phase,'off');
 const result=await f.api.takeRequestedPhoto('op-5',new AbortController().signal,()=>{});assert.equal(result.status,'succeeded');assert.equal(f.calls.starts,2);f.env.window.close();
}
// Asking to scan is recognised in chat text; ordinary questions are not. A scan request captures one in-memory frame into review.
{
 const f=fixture({failing:false});for(const text of['Scan this','scan the receipt','Can you scan this document?','scan that page'])assert.equal(f.api.cameraScanRequested(text),true,text);
 for(const text of['What am I looking at?','take a photo','scanner settings'])assert.equal(f.api.cameraScanRequested(text),false,text);
 f.setView({chat:'sheet'});assert.equal(f.api.scanRequest(),true);await settle();await settle();
 assert.equal(f.calls.scans,1);assert.deepEqual(JSON.parse(JSON.stringify(f.calls.captures)),[{format:'jpeg',quality:85,saveToGallery:false}],'Scanning never writes to the gallery');f.env.window.close();
}
// Plan item 8: view enter/leave comes from the shell's own commits and page visibility, with no document observer.
{
 const f=fixture();let calls=0;class Shell{componentDidMount(){this.mounted=true;}componentDidUpdate(){this.updated=(this.updated||0)+1;}}
 const remove=f.api.installViewPresence(Shell,()=>{calls++;});const shell=new Shell();shell.componentDidMount();shell.componentDidUpdate();
 assert.equal(shell.mounted,true);assert.equal(shell.updated,1,'The shell keeps its own commit work');assert.equal(calls,2);
 f.env.window.document.dispatchEvent(new f.env.window.Event('visibilitychange'));assert.equal(calls,3);
 remove();shell.componentDidUpdate();f.env.window.document.dispatchEvent(new f.env.window.Event('visibilitychange'));assert.equal(calls,3);assert.equal(Shell.prototype.componentDidUpdate.name,'componentDidUpdate','Uninstall restores the shell');
 assert.ok(!/new MutationObserver\(schedule\)|observe\(document\.body/.test(source),'No body-wide DOM observer drives the camera or Photos');f.env.window.close();
}
console.log('PASS camera session: preview recovery, lens-driven zoom/flash, flip reset, focus never blocks, leave settles capture, agent capture queue/cancel/fail/refuse, chat grace, scan request. Synthetic camera boundary; no camera frames/provider/native writes.');
