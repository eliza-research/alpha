import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {build} from 'esbuild';

// Real capture, microphone lease and shared session; only browser primitives and
// the local preference read are closed ports. No camera, microphone or codec runs.
const root=process.cwd(), directory=path.join(root,'apps/app/src/browser');
const file=path.join(directory,'video-capture.ts');
const code=(await build({stdin:{contents:readFileSync(file,'utf8')+`
 export {createCameraSession} from ${JSON.stringify(path.join(root,'.eliza/client-features/plugins/plugin-native-camera/src/session.ts'))};
 export {cameraAccessDenied} from ${JSON.stringify(path.join(root,'.eliza/client-features/plugins/plugin-native-camera/src/host-ports.ts'))};`,resolveDir:directory,sourcefile:'video-capture.ts',loader:'ts'},
 bundle:true,format:'cjs',platform:'node',write:false,plugins:[{name:'closed-microphone-ports',setup(builder){
  builder.onResolve({filter:/^\.\/device-preferences$/},args=>args.importer.endsWith('/sensor-policy.ts')?{path:'preferences',namespace:'ports'}:undefined);
  builder.onResolve({filter:/^\.\/camera-frame$/},()=>({path:'frame',namespace:'ports'}));
  builder.onLoad({filter:/.*/,namespace:'ports'},args=>({contents:args.path==='preferences'
   ? 'export const cachedDevicePreferences=()=>({microphoneEnabled:true});export const readDevicePreferences=async()=>({microphoneEnabled:true});export function initializeDevicePreferences(){};'
   : 'export const drawCameraFrame=()=>({toDataURL:()=>"data:image/jpeg;base64,AA=="});'}));
 }}]})).outputFiles[0].text;

function fixture(reason){
 let requests=0;const clones=[];
 class Track extends EventTarget{kind='video';readyState='live';clone(){const value=new Track();clones.push(value);return value;}stop(){this.readyState='ended';}}
 class Stream{constructor(tracks){this.tracks=tracks;}getTracks(){return this.tracks;}getVideoTracks(){return this.tracks.filter(track=>track.kind==='video');}getAudioTracks(){return this.tracks.filter(track=>track.kind==='audio');}}
 class Recorder{state='inactive';mimeType='video/webm';constructor(stream){this.stream=stream;}start(){this.state='recording';}stop(){if(this.state==='inactive')return;this.state='inactive';this.ondataavailable({data:new Blob([new Uint8Array(8)],{type:'video/webm'})});queueMicrotask(()=>this.onstop());}}
 const source=new Track(),video={srcObject:new Stream([source]),readyState:4,videoWidth:640,videoHeight:480};
 const context=vm.createContext({module:{exports:{}},console,Event,EventTarget,DOMException,AbortController,AbortSignal,Blob,performance,setTimeout,clearTimeout,setInterval,clearInterval,
  window:new EventTarget(),document:{hidden:false},navigator:{mediaDevices:{async getUserMedia(constraints){requests++;assert.equal(constraints.audio,true);assert.equal(constraints.video,false);throw reason;}}},MediaStream:Stream,MediaRecorder:Recorder});
 vm.runInContext(code,context);
 const {BrowserVideoCapture,createCameraSession,cameraAccessDenied}=context.module.exports;
 const capture=new BrowserVideoCapture(),options={audio:true,maxDuration:1,maxFileSize:1000};
 const session=createCameraSession({active:()=>true,available:()=>true,preview:()=>({direction:'back'}),recording:()=>options,camera:{startPreview:async()=>({}),stopPreview:async()=>source.stop(),startRecording:input=>capture.start(video,input),stopRecording:async()=>{const clip=await capture.stop();return {...clip,path:'closed-video-fixture',fileSize:clip.blob.size};}}});
 return {capture,session,video,context,cameraAccessDenied,requests:()=>requests,clones,options};
}

test('real microphone permission errors offer the shared session soundless path',async()=>{
 for(const name of ['NotAllowedError','PermissionDeniedError']){
  const original=new DOMException('Synthetic microphone denial',name),f=fixture(original);
  try{
   assert.equal((await f.session.start()).status,'ready');
   assert.equal(await f.session.startRecording(),'denied',name);
   assert.equal(f.session.snapshot().denied,'microphone',name);
   assert.equal(f.requests(),1,name);assert.equal(f.capture.state().isRecording,false);
  }finally{await f.session.stop();f.capture.cancel();}
 }
});
test('microphone denial normalization retains the original exception and exact classification',async()=>{
 const original=new DOMException('Denied','NotAllowedError'),f=fixture(original);
 try{await assert.rejects(f.capture.start(f.video,f.options),error=>error.code==='MICROPHONE_DENIED'&&error.cause===original&&f.cameraAccessDenied(error)==='microphone');assert.equal(f.requests(),1);}
 finally{f.capture.cancel();}
});
test('microphone cancellation, device loss and other errors retain their original identity',async()=>{
 for(const reason of [new DOMException('Cancelled','AbortError'),new DOMException('Absent','NotFoundError'),new DOMException('Busy','NotReadableError'),new TypeError('Invalid request')]){
  const f=fixture(reason);try{await assert.rejects(f.capture.start(f.video,f.options),error=>error===reason);assert.equal(f.requests(),1);}finally{f.capture.cancel();}
 }
});
test('soundless recording makes no microphone request and later recorder denials are not relabeled',async()=>{
 const f=fixture(new Error('Microphone must not be requested'));
 try{await f.capture.start(f.video,{...f.options,audio:false});assert.equal(f.capture.state().isRecording,true);assert.equal(f.requests(),0);const clip=await f.capture.stop();assert.equal(clip.blob.size,8);}finally{f.capture.cancel();}
 const other=fixture(new Error('Microphone must not be requested')),denied=new DOMException('Recorder refused','NotAllowedError');
 other.context.MediaRecorder=class{constructor(){throw denied;}};
 try{await assert.rejects(other.capture.start(other.video,{...other.options,audio:false}),error=>error===denied&&error.code!=='MICROPHONE_DENIED');assert.equal(other.requests(),0);assert.ok(other.clones.every(track=>track.readyState==='ended'));}finally{other.capture.cancel();}
});
