import assert from 'node:assert/strict';
import fs from 'node:fs';import vm from 'node:vm';import {createRequire} from 'node:module';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
const require=createRequire(import.meta.url);const {JSDOM}=require('jsdom');
// The adapter's camera session run against the real shared
// camera session (plugin-native-camera) with a synthetic camera bridge.
const source=fs.readFileSync(new URL('../apps/app/src/prototype/camera-adapter.ts',import.meta.url),'utf8');
const slice=(from,to)=>{const a=source.indexOf(from),b=source.indexOf(to,a);assert.ok(a>=0&&b>a,`camera-adapter.ts still has ${from} … ${to}`);return source.slice(a,b);};
const helpers=slice('const ZOOM_STOPS','/** Install after native').replace(/^export /gm,'');
const scanWords=slice('const SCAN_REQUEST','const browserMode').replace(/^export /gm,'');
const lastTile=slice('  let lastCapture:', '  let accessPanel:');
const session=slice('  let requestedCaptureHolds=0;','  function askCameraFrame(');
const frameAsk=slice('  function askCameraFrame(','  /** The reviewed item is still');
const syncCamera=source.match(/  const syncCamera = [^\n]+\n/)[0];
const sessionSource=fs.readFileSync(new URL('../.eliza/client-features/plugins/plugin-native-camera/src/session.ts',import.meta.url),'utf8');
const hostPorts=fs.readFileSync(new URL('../.eliza/client-features/plugins/plugin-native-camera/src/host-ports.ts',import.meta.url),'utf8');
const shared=stripTypeScriptTypes((hostPorts+sessionSource).replace(/^import[^;]*;$/gm,'').replace(/^export /gm,''),{mode:'transform'});
const focusUI=stripTypeScriptTypes(fs.readFileSync(new URL('../apps/app/src/browser/camera-focus.ts',import.meta.url),'utf8').split('/** Owns')[0].replace(/^export /gm,''));
const settle=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fixture({permission=false,failing=true,navigateAfterPhoto=false,browser=false,receipt={width:1280,height:720,deviceId:'0',minZoom:0.5,maxZoom:10,hasFlash:true,zoom:1,flash:'off'}}={}){
 const env=new JSDOM('<div data-alpha-camera-root data-alpha-layer><button data-alpha-camera="viewfinder"></button></div>',{pretendToBeVisual:true});const timers=new Map();let timerId=0;
 env.window.setTimeout=(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;};env.window.clearTimeout=id=>timers.delete(id);
 const calls={starts:0,stops:0,masked:false,captures:[],focus:0,switches:[],recordings:0,list:[],scans:0,questions:[],views:[],modes:[],native:{flash:"on",zoom:0.5}};let failed=failing;
 const gates={start:undefined,capture:undefined,mode:undefined,switchError:undefined};const clock={now:1000};
 let context;
 const camera={
  startPreview:async()=>{calls.starts++;if(gates.start)await gates.start.promise;if(failed)throw permission?Object.assign(Error('Camera permission denied'),{code:'CAMERA_PERMISSION_DENIED'}):Error('Camera in use');return receipt;},
  stopPreview:async()=>{calls.stops++;},
  capturePhoto:async options=>{calls.captures.push(options);if(gates.capture)await gates.capture.promise;return options.saveToGallery?{format:'jpeg',width:4000,height:3000,path:'content://media/external/images/media/'+(41+calls.captures.length),thumbnail:'AAAA'}:{format:'jpeg',width:4000,height:3000,base64:'AAAA'};},
  setFocusPoint:()=>{calls.focus++;return new Promise(()=>{});},// a focus that never settles
  switchCamera:async options=>{calls.switches.push({...options,flash:context.flashNow(),zoom:context.zoomNow()});if(gates.switchError)throw gates.switchError;return {...receipt,minZoom:1,maxZoom:4,hasFlash:false};},
  setZoom:async o=>{calls.native.zoom=o.zoom;},setSettings:async o=>{calls.native.flash=o.settings.flash;},
  setCaptureMode:async o=>{calls.modes.push(o);if(globalThis.__modeImpl)return globalThis.__modeImpl(o);if(gates.mode)await gates.mode.promise;},
  startRecording:async()=>{calls.recordings++;},stopRecording:async()=>({path:'content://media/external/video/media/9',duration:1,width:1,height:1,fileSize:1}),
 };
 const rows={camera:[]};const library={list:async options=>{calls.list.push(options);return {items:options.album==='camera'?rows.camera:[]};},read:async({id})=>({id,image:'',width:1,height:1,date:0,revision:'r'})};
 let view={chat:'hidden',active:true};
 context=vm.createContext({window:env.window,document:env.window.document,console,camera,library,Date:{now:()=>clock.now},Uint8Array,atob,Blob:env.window.Blob,
  mask:enable=>calls.masked=enable,Capacitor:{isPluginAvailable:()=>true},validateCameraCaptureResult:value=>value,systemPickerActive:()=>false,device:{openSettings:async()=>({status:'opened'})},
  openScanReview:()=>{calls.scans++;return ()=>{};},reviewContentQuestion:input=>{calls.questions.push(input);return ()=>{};},createScanCapture:()=>({keep:async()=>undefined,close(){}}),ScanKeepError:Error,importBrowserPhoto:async()=>({}),browserCamera:{flashAvailable:()=>false},onBrowserPreviewEnded:listener=>{calls.previewEnded=listener;},view:()=>view,calls,navigateAfterPhoto});
 const prelude=`let accessPanel,disposed=false,direction='back',flash=false,duration=0,loaded=true,captures=[],closeQuestion,closeScan,scanRequest,frameQuestion;
  let lens={minZoom:1,maxZoom:1,hasFlash:false,zoom:1,flash:false},zoomRatio=1;let requestedPhoto;
  const browserMode=${browser},libraryAvailable=()=>true,normalize=row=>({...row,id:'native-camera-'+row.id}),nativeId=id=>id.replace(/^native-camera-/,''),cancelScan=()=>{};function schedule(){}
  const finder='[data-alpha-camera="viewfinder"]';let state={said:'',mode:'photo'};
  const api={S:{get chat(){return view().chat;}},isActive:()=>view().active,set:patch=>Object.assign(state,patch),get:()=>state,setView:name=>{calls.views.push(name);if(navigateAfterPhoto&&name==='photos')view().active=false;},shell:patch=>{view().chat=patch.chat;}};`;
 vm.runInContext(shared+focusUI+stripTypeScriptTypes(prelude+helpers+scanWords+lastTile+session+frameAsk+syncCamera+`;globalThis.testCamera={cameraFrameQuestionRequested,askAboutCameraFrame,recordingOptions:()=>RECORDING,bindMode,modeSettled:()=>modeChange,start,stop,control,capture,record,focusAt,takeRequestedPhoto,zoomStops,lensFromReceipt,photoReceiptPath,cameraScanRequested,scanRequest:()=>scanRequest(),active,installViewPresence,syncCamera,CHAT_GRACE_MS,
  flip:()=>flipLens(api),
  setFlash:on=>{flash=on;},setZoom:z=>{zoomRatio=z;},mode:m=>{state.mode=m;},
  state:()=>({phase:session.phase,denied:session.denied,said:state.said,capturing:session.capturing,recording:session.recording,flash,zoomRatio,lens,last:lastCapture,fl:state.fl})};
  globalThis.flashNow=()=>flash;globalThis.zoomNow=()=>zoomRatio;`,{mode:'transform'}),context);
 return {env,timers,calls,gates,clock,rows,camera,api:context.testCamera,recover:()=>failed=false,setView:v=>Object.assign(view,v)};
}
// Video mode pre-binds VideoCapture for the quality every recording asks for, so starting one does not rebind;
// when native could bind neither mode it released the preview, which shows as unavailable.
{
 const f=fixture({failing:false});const modes=[];
 await f.api.start();await settle();
 globalThis.__modeImpl=async o=>{modes.push(o);};
 f.api.bindMode('video');await f.api.modeSettled();
 assert.equal(modes.length,1);assert.equal(modes[0].mode,'video');assert.equal(modes[0].quality,f.api.recordingOptions().quality,'Video mode binds the recording quality');
 globalThis.__modeImpl=async()=>{throw Object.assign(Error('Camera preview stopped'),{code:'PREVIEW_STOPPED'});};
 f.api.bindMode('photo');await f.api.modeSettled();await settle();
 assert.equal(f.api.state().phase,'off','A released preview ends the session');
 assert.equal(f.env.window.document.querySelector('[role="alert"]').getAttribute('aria-label'),'Camera unavailable');
 const starts=f.calls.starts;
 f.api.syncCamera();await settle();f.api.syncCamera();await settle();
 assert.equal(f.calls.starts,starts,'Native preview refusal remains latched');
 globalThis.__modeImpl=undefined;
 f.env.window.document.querySelector('[role="alert"] button').click();await settle();
 assert.equal(f.calls.starts,starts+1);assert.equal(f.api.state().phase,'ready');
 globalThis.__modeImpl=async()=>{throw Object.assign(Error('Camera preview stopped'),{code:'PREVIEW_STOPPED'});};
 f.api.bindMode('photo');await f.api.modeSettled();await settle();
 assert.equal(f.api.state().phase,'off');
 globalThis.__modeImpl=undefined;
 f.setView({active:false});f.api.syncCamera();await settle();
 f.setView({active:true});f.api.syncCamera();await settle();
 assert.equal(f.calls.starts,starts+2,'A new visit can bind the preview');
 f.env.window.close();
}
// A question about what the camera sees opens the reviewed question on one unsaved frame, with the asked text.
{
 const f=fixture({failing:false});await f.api.start();await settle();
 for(const text of['What am I looking at?','what’s this','Describe what you see','What does this say?'])assert.equal(f.api.cameraFrameQuestionRequested(text),true,text);
 for(const text of['Scan this','take a photo','what am I doing tomorrow','Tell me what is this week',"What is this week's forecast?",'what’s that song called','What is that restaurant near me','read this article later','describe this to my sister','What do you see in the news today?', 'what is this?'+ ' '.repeat(200)+'another request'])assert.equal(f.api.cameraFrameQuestionRequested(text),false,text);
 for(const text of['Hey Alpha, what is this?','what is that, please?','Read this to me','what do you see right now?'])assert.equal(f.api.cameraFrameQuestionRequested(text),true,text);
 assert.equal(f.api.cameraFrameQuestionRequested({toString(){throw Error('Do not coerce arbitrary input');}}),false);
 f.setView({chat:'sheet'});
 assert.equal(f.api.askAboutCameraFrame('What am I looking at?'),true);
 assert.equal(f.calls.questions.length,1);assert.equal(f.setView({}).chat,'hidden','The chat closes so the review is visible');assert.equal(f.calls.questions[0].question,'What am I looking at?');assert.equal(f.calls.questions[0].name,'Camera frame');
 const frame=await f.calls.questions[0].image(new AbortController().signal);assert.equal(frame.type,'image/jpeg');
 assert.equal(f.calls.captures.at(-1).saveToGallery,false,'The frame is never written to the gallery');
 f.env.window.close();
}
// NoLostShutter: a shutter press while the session is busy (the previous photo's write, a lens control)
// is kept as one pending shot and taken when the session is free.
{
 const f=fixture({failing:false});await f.api.start();await settle();
 f.gates.capture=deferred();const first=f.api.capture();await settle();assert.equal(f.calls.captures.length,1);assert.equal(f.api.state().capturing,true);
 await f.api.capture();await f.api.capture();assert.equal(f.calls.captures.length,1,'Still writing the first photo');
 f.gates.capture.resolve();f.gates.capture=undefined;await first;await settle();await settle();
 assert.equal(f.calls.captures.length,2,'The press during the write is taken once, not dropped and not doubled');
 const gate=deferred();const zoom=f.api.control(()=>gate.promise,()=>{});await settle();
 await f.api.capture();assert.equal(f.calls.captures.length,2,'Busy with a zoom change');
 gate.resolve();await zoom;await settle();await settle();
 assert.equal(f.calls.captures.length,3,'The press during the zoom change is taken after it');
 const gate2=deferred();const flash=f.api.control(()=>gate2.promise,()=>{});await settle();
 await f.api.capture();f.api.mode('video');gate2.resolve();await flash;await settle();await settle();
 assert.equal(f.calls.captures.length,3,'A pending shot is not taken after switching to Video');assert.equal(f.calls.recordings,0);
 f.env.window.close();
}
// SavedIsShown: the last-capture tile is the Camera album's newest row each time the preview is ready, so a
// photo trashed or deleted since (in Photos or by another app) is no longer shown.
{
 const f=fixture({failing:false});f.rows.camera=[{id:'7',image:'data:image/jpeg;base64,BBBB',width:1,height:1,date:1,revision:'r'}];
 await f.api.start();await settle();assert.equal(f.api.state().last.id,'native-camera-7');
 await f.api.capture();await settle();assert.equal(f.api.state().last.id,'native-camera-42','A capture made here is shown at once');
 await f.api.stop();f.rows.camera=[];await f.api.start();await settle();
 assert.equal(f.api.state().last,undefined,'The trashed capture is not shown after Camera is ready again');
 f.env.window.close();
}
// An agent capture queued past the chat grace keeps Camera active even when a scan request finishes first.
{
 const f=fixture({failing:false});await f.api.start();f.setView({chat:'sheet'});f.api.syncCamera();f.clock.now+=f.api.CHAT_GRACE_MS;f.api.syncCamera();await settle();assert.equal(f.api.state().phase,'off');
 f.gates.start=deferred();
 const request=f.api.takeRequestedPhoto('op-hold',new AbortController().signal,()=>{});await settle();
 assert.equal(f.api.scanRequest(),true);await settle();
 // The scan closes the chat; reopen it so only the agent request's hold keeps Camera active.
 f.setView({chat:'sheet'});
 f.gates.capture=deferred();f.gates.start.resolve();f.gates.start=undefined;await settle();await settle();await settle();
 assert.equal(f.calls.captures.length,1,'The agent photo is being written');
 f.api.syncCamera();await settle();
 assert.equal(f.api.state().phase,'ready','The scan request ending does not release the hold of the agent capture still being written');
 f.gates.capture.resolve();f.gates.capture=undefined;
 const result=await request;assert.equal(result.status,'succeeded',result.summary);
 f.env.window.close();
}
// Preview failure, permission denial and recovery.
{
 const f=fixture();await f.api.start();assert.equal(f.api.state().phase,'error');assert.equal(f.api.state().denied,undefined,'A hardware/start failure is not a permission denial');assert.equal(f.timers.size,0,'Unavailable panel cannot disappear with transient toast timer');
 const alert=f.env.window.document.querySelector('[role="alert"]');assert.equal(alert.getAttribute('aria-label'),'Camera unavailable');assert.match(alert.textContent,/Camera unavailable.*The camera could not start.*Try again/,'Explain the failure and recovery without implying a permission denial');
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
// The Video preview and recording must use the same quality. A released preview cannot start recording.
{
 const f=fixture({failing:false});await f.api.start();await f.api.modeSettled();
 f.api.mode('video');f.api.bindMode('video');await f.api.modeSettled();
 assert.deepEqual(JSON.parse(JSON.stringify(f.calls.modes.at(-1))),{mode:'video',quality:'medium'});
 f.gates.mode=deferred();f.api.bindMode('video');await settle();const recording=f.api.record();await settle();
 f.gates.mode.reject(Object.assign(Error('Camera preview stopped'),{code:'PREVIEW_STOPPED'}));
 await recording;await f.api.modeSettled();await settle();
 assert.equal(f.calls.recordings,0,'A recording waiting on a released preview must not reach native');
 assert.equal(f.api.state().phase,'off');
 assert.equal(f.env.window.document.querySelector('[role="alert"]').getAttribute('aria-label'),'Camera unavailable');
 f.env.window.close();
}
// The bound lens decides zoom chips and flash; its receipt is read on first frame; the last tile reads one row.
{
 const f=fixture({failing:false});await f.api.start();await settle();
 assert.deepEqual(JSON.parse(JSON.stringify(f.api.state().lens)),{minZoom:0.5,maxZoom:10,hasFlash:true,zoom:1,flash:false});
 assert.deepEqual(JSON.parse(JSON.stringify(f.calls.list)),[{album:'camera',limit:1}],'The last-capture tile reads the newest Camera-album row after ready');
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
// When switching lenses fails, the UI and native old lens still agree on their reset controls.
{
 const f=fixture({failing:false});await f.api.start();f.api.setFlash(true);f.api.setZoom(0.5);
 f.gates.switchError=Error('Switch unavailable');await f.api.flip();
 assert.deepEqual({...f.calls.native},{flash:'off',zoom:1});
 assert.equal(f.api.state().flash,false);assert.equal(f.api.state().zoomRatio,1);
 assert.equal(f.api.state().said,'Not supported on this camera.');f.env.window.close();
}
// The browser ends the running preview before it starts the other camera: a failed switch leaves
// none, so the preview is released and the view offers a restart instead of a dead shutter.
{
 const f=fixture({failing:false,browser:true});await f.api.start();assert.equal(f.api.state().phase,'ready');
 f.gates.switchError=Error('No second camera');await f.api.flip();await settle();
 assert.equal(f.api.state().phase,'off');assert.equal(f.calls.stops,1,'the dead preview is released');
 const panel=f.env.window.document.querySelector('[role="alert"]');assert.equal(panel?.getAttribute('aria-label'),'Camera unavailable');
 f.api.syncCamera();await settle();assert.equal(f.calls.starts,1,'no restart without the person asking');
 f.gates.switchError=undefined;[...panel.querySelectorAll('button')].find(button=>button.textContent==='Try again').click();await settle();
 assert.equal(f.calls.starts,2);assert.equal(f.api.state().phase,'ready');assert.equal(f.env.window.document.querySelector('[role="alert"]'),null);f.env.window.close();
}
// A browser camera track that ends on its own while ready does the same; one that ends after the
// view already stopped changes nothing.
{
 const f=fixture({failing:false,browser:true});assert.equal(typeof f.calls.previewEnded,'function','the view listens for the track ending');
 f.calls.previewEnded();await settle();assert.equal(f.calls.stops,0,'nothing to release before a preview is ready');
 await f.api.start();f.calls.previewEnded();await settle();
 assert.equal(f.api.state().phase,'off');assert.equal(f.calls.stops,1);
 assert.equal(f.env.window.document.querySelector('[role="alert"]')?.getAttribute('aria-label'),'Camera unavailable');
 f.calls.previewEnded();await settle();assert.equal(f.calls.stops,1,'a second report releases nothing more');f.env.window.close();
}
// FixFocus: a focus that never settles does not block the shutter.
{
 const f=fixture({failing:false});await f.api.start();f.api.focusAt(0.5,0.5);assert.equal(f.calls.focus,1);
 assert.equal(f.env.window.document.querySelectorAll('[data-alpha-camera-focus]').length,1,'Native tap shows a local focus target without waiting for autofocus');
 await f.api.capture();assert.equal(f.calls.captures.length,1,'Shutter after tap-to-focus captures');
 assert.equal(f.calls.captures[0].thumbnailOnly,true,'Native shutter returns a thumbnail, not the full JPEG');
 assert.equal(f.api.state().last.id,'native-camera-42','The capture becomes the last-capture tile');assert.equal(f.api.state().said,'','No "Saving photo" pill');
 assert.equal(f.api.state().fl,1,'Shutter flash');f.env.window.close();
}
// The Pixel's real minimum is about .556, so a .5 chip must not be offered.
{
 const f=fixture({failing:false,receipt:{width:1280,height:720,deviceId:'0',minZoom:.55577338,maxZoom:8}});await f.api.start();
 assert.deepEqual(JSON.parse(JSON.stringify(f.api.zoomStops(f.api.state().lens))),[[1,'1×'],[2,'2'],[5,'5']]);
 assert.deepEqual(JSON.parse(JSON.stringify(f.api.zoomStops({minZoom:.5001,maxZoom:2}))),[[1,'1×'],[2,'2']]);
 await f.api.stop();assert.equal(f.env.window.document.querySelectorAll('[data-alpha-camera-focus]').length,0);f.env.window.close();
}
// A tap during the first gallery write survives until the last queued shot opens Photos.
{
 const f=fixture({failing:false,navigateAfterPhoto:true});await f.api.start();await settle();
 f.gates.capture=deferred();const first=f.api.capture();await settle();
 await f.api.capture();await f.api.capture();assert.equal(f.calls.captures.length,1);
 f.gates.capture.resolve();f.gates.capture=undefined;await first;await settle();await settle();
 assert.equal(f.calls.captures.length,2,'One pending shutter press is retained until the current photo finishes');
 assert.deepEqual(f.calls.views,['photos'],'Photos opens once after both captures');
 f.env.window.close();
}
// A busy lens retains one pending shot, but a mode change or leaving clears the intent.
{
 const f=fixture({failing:false});await f.api.start();await settle();
 const gate=deferred();const zoom=f.api.control(()=>gate.promise,()=>{});await settle();
 await f.api.capture();assert.equal(f.calls.captures.length,0);
 gate.resolve();await zoom;await settle();await settle();assert.equal(f.calls.captures.length,1);
 const modeGate=deferred();const flash=f.api.control(()=>modeGate.promise,()=>{});await settle();
 await f.api.capture();f.api.mode('video');modeGate.resolve();await flash;await settle();await settle();
 assert.equal(f.calls.captures.length,1);assert.equal(f.calls.recordings,0);
 f.api.mode('photo');const leaveGate=deferred();const control=f.api.control(()=>leaveGate.promise,()=>{});await settle();
 await f.api.capture();f.setView({active:false});leaveGate.resolve();await control;await settle();await settle();
 assert.equal(f.calls.captures.length,1,'A pending shot is never taken after leaving Camera');
 f.env.window.close();
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
// An agent capture queued past the chat grace keeps Camera active even when a scan request finishes first.
{
 const f=fixture({failing:false});await f.api.start();f.setView({chat:'sheet'});f.api.syncCamera();f.clock.now+=f.api.CHAT_GRACE_MS;f.api.syncCamera();await settle();assert.equal(f.api.state().phase,'off');
 f.gates.start=deferred();
 const request=f.api.takeRequestedPhoto('op-hold',new AbortController().signal,()=>{});await settle();
 assert.equal(f.api.scanRequest(),true);await settle();
 // The scan closes the chat; reopen it so only the agent request's hold keeps Camera active.
 f.setView({chat:'sheet'});
 f.gates.capture=deferred();f.gates.start.resolve();f.gates.start=undefined;await settle();await settle();await settle();
 assert.equal(f.calls.captures.length,1,'The agent photo is being written');
 f.api.syncCamera();await settle();
 assert.equal(f.api.state().phase,'ready','The scan request ending does not release the hold of the agent capture still being written');
 f.gates.capture.resolve();f.gates.capture=undefined;
 const result=await request;assert.equal(result.status,'succeeded',result.summary);
 f.env.window.close();
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
// ChatGraceReleases: the grace timer ends the grace even if the wall clock was set back meanwhile.
{
 const f=fixture({failing:false});await f.api.start();f.setView({chat:'sheet'});f.api.syncCamera();await settle();
 const grace=[...f.timers.values()].find(t=>t.ms===f.api.CHAT_GRACE_MS);f.clock.now-=60000;grace.fn();f.api.syncCamera();await settle();
 assert.equal(f.api.state().phase,'off','Released when the timer fires, whatever the wall clock says');f.env.window.close();
}
// An agent capture while the chat holds Camera past the grace starts the preview again and captures.
{
 const f=fixture({failing:false});await f.api.start();f.setView({chat:'sheet'});f.api.syncCamera();f.clock.now+=f.api.CHAT_GRACE_MS;f.api.syncCamera();await settle();assert.equal(f.api.state().phase,'off');
 const result=await f.api.takeRequestedPhoto('op-5',new AbortController().signal,()=>{});assert.equal(result.status,'succeeded');assert.equal(f.calls.starts,2);f.env.window.close();
}
// Asking to scan is recognised in chat text; ordinary questions are not. A scan request captures one in-memory frame into review.
{
 const f=fixture({failing:false});for(const text of['Scan this','scan the receipt','Can you scan this document?','scan that page','scan','scan my passport','digitize this whiteboard'])assert.equal(f.api.cameraScanRequested(text),true,text);
 for(const text of['What am I looking at?','take a photo','scanner settings',"don't scan this yet",'can you scan a document later?','scan this after I leave','tell me how to scan a document','scan this, but not now','scan this '+ ' '.repeat(200)+'later'])assert.equal(f.api.cameraScanRequested(text),false,text);
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
