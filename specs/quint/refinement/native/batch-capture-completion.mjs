import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {transformSync} from 'esbuild';
import {captureInputs,checkTraces,qmap} from '../check-traces.mjs';

const model='BatchCaptureCompletion';
const modelPath='specs/quint/native/BatchCaptureCompletion.qnt';
const source='apps/app/src/prototype/voice-adapter.ts';
export const batchCaptureScenarios=[
 'manual','wrong-stop-owner','early-stop','early-call-and-stale','early-foreign','call-after-ready',
 'capture-failed','metrics-failed','stop-after-metrics-failure','abort-before-ack','abort-after-ack',
 'cancel-cleanup-failed','start-rejected','rejected-after-abort','terminal-duplicate'
];
const ids=[1,2];
const idOf=id=>id==='fixture-draft-a'?1:id==='fixture-draft-b'?2:0;
const token=id=>id===1?'fixture-draft-a':'fixture-draft-b';
function kind(failure){
 if(!failure)return 'none';
 if(failure.name==='AbortError')return 'aborted';
 if(failure.code==='capture-call-active')return 'call';
 if(failure.message==='Microphone capture was interrupted.')return 'microphone';
 if(failure.message==='Recording identity changed.')return 'identity';
 if(failure.message==='synthetic metric refusal')return 'metrics';
 if(failure.message==='synthetic cancellation refusal')return 'unconfirmed';
 return 'failed';
}
function terminal(id,event){
 const recordingId=token(id);
 if(event==='recorded')return {recordingId,durationMs:1000};
 if(event==='call')return {recordingId,durationMs:1000,interrupted:'call-active'};
 return {recordingId};
}
function terminalKind(event){
 if(!event)return 'none';
 if(event.interrupted==='call-active')return 'call';
 return 'durationMs' in event?'recorded':'microphone';
}
function extractImplementation(){
 const text=readFileSync(source,'utf8');
 const header=text.indexOf('const CALL_PAUSED = '),headerEnd=text.indexOf('const deviceVoice = registerPlugin',header);
 const start=text.indexOf('  async function captureConversationAudio(');
 const end=text.indexOf('  /** Holds a finished transcript',start);
 const seam='      const earlyStops=new Map<string,VoiceRecordingStopped>();';
 const implementation=text.slice(start,end);
 if(header<0||headerEnd<=header||start<0||end<=start||implementation.split(seam).length!==2)
  throw Error('Cannot bind the current renderer capture observer');
 const observed=implementation.replace(seam,seam+`
      fixture.observe=()=>({active, recording, id, ended, problem, stopSeen, earlyStops, handle,
        cancelling, published:clip, mediaUnconfirmed});
 `);
 const code=transformSync(text.slice(header,headerEnd)+observed,{loader:'ts',target:'es2022'}).code;
 return new Function('fixture',`
  let stopping=Promise.resolve(),mediaUnconfirmed,startingCapture,recordingId,started,conversationLevels,clip;
  const {setTimeout,clearTimeout,batchRecordingEnded,refresh}=fixture;
  ${code}
  return captureConversationAudio;
 `);
}
async function fixture(make){
 const timers=new Map(),callbacks=new Set(),endSignals=[];
 const owner=new AbortController();
 let nextTimer=1,marks=0,stops=0,cancels=0,resolveStart,rejectStart,capture,acquisition='pending';
 let metricsFail=false,cancelFail=false,stopMatch=true,stopOutcome='none',cancelOutcome='none',requestedId;
 const hooks={
  observe:null,
  refresh(){},
  setTimeout(callback){const id=nextTimer++;timers.set(id,callback);return id;},
  clearTimeout(id){timers.delete(id);},
  batchRecordingEnded(){marks++;}
 };
 const port={
  async addListener(name,callback){
   if(name!=='recordingStopped')throw Error('Unexpected event registration');
   callbacks.add(callback);return {async remove(){callbacks.delete(callback);}};
  },
  startRecording(){return new Promise((resolve,reject)=>{resolveStart=resolve;rejectStart=reject;});},
  async stopRecording(){stops++;return {recordingId:stopMatch?requestedId:'wrong-id',durationMs:1000};},
  async cancelRecording(){cancels++;if(cancelFail)throw Error('synthetic cancellation refusal');},
  async getRecordingMetrics(recordingId){
   if(recordingId!==requestedId)throw Error('Unexpected metric owner');
   if(metricsFail)throw Error('synthetic metric refusal');
   return {peak:.5};
  }
 };
 const acquiring=make(hooks)(port,()=>{},{
  signal:owner.signal,onActivity(){},onEnd(failure){endSignals.push(kind(failure));}
 }).then(value=>{capture=value;acquisition='acquired';},failure=>{acquisition=kind(failure);});
 const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
 await flush();
 if(!resolveStart||!hooks.observe||callbacks.size!==1)throw Error('Capture start was not held at the source boundary');
 function observe(){
  const value=hooks.observe();
  if(callbacks.size!==Number(!!value.handle))throw Error('Detached source listener still owns delivery');
  return {
   's.acquisition':acquisition,'s.active':value.active,'s.recording':value.recording,'s.owner':idOf(value.id),
   's.early':qmap(ids.map(id=>[id,terminalKind(value.earlyStops.get(token(id)))])),
   's.stopSeen':value.stopSeen,'s.ended':!!value.ended,'s.problem':kind(value.problem),
   's.listening':!!value.handle,'s.timer':timers.size>0,'s.aborted':owner.signal.aborted,
   's.cancelling':!!value.cancelling,'s.published':idOf(value.published?.recordingId),'s.stopOutcome':stopOutcome,
   's.cancelOutcome':cancelOutcome,'s.cleanupUnconfirmed':!!value.mediaUnconfirmed,
   's.nativeStops':stops,'s.nativeCancels':cancels,'s.endSignals':[...endSignals],'s.endMarks':marks
  };
 }
 return {
  observe,
  stopped(id,event){for(const callback of callbacks)callback(terminal(id,event));},
  async acknowledge(id){requestedId=token(id);resolveStart({recordingId:requestedId,maxDurationMs:59000});await acquiring;await flush();},
  async refuseStart(){rejectStart(Error('synthetic start refusal'));await acquiring;},
  async metricsFailed(){
   if(timers.size!==1)throw Error('Expected one source-owned sample timer');
   metricsFail=true;const [id,callback]=[...timers][0];timers.delete(id);callback();await flush();
  },
  async stop(matches){stopMatch=matches;try{await capture.stop();stopOutcome='recorded';}catch(failure){stopOutcome=kind(failure);}},
  abort(){owner.abort();},
  async cancel(ok){cancelFail=!ok;try{await capture.cancel();cancelOutcome='done';}catch(failure){cancelOutcome=kind(failure);}}
 };
}
async function generate(make,name){
 const actual=await fixture(make),steps=[];
 const expect=actual.observe();
 const step=async(action,...args)=>{await actual[action](...args);steps.push({label:action,action:{name:action,args},expect:actual.observe()});};
 switch(name){
  case 'manual': await step('acknowledge',1);await step('stop',true);break;
  case 'wrong-stop-owner': await step('acknowledge',2);await step('stop',false);break;
  case 'early-stop': await step('stopped',2,'recorded');await step('acknowledge',2);await step('stop',false);break;
  case 'early-call-and-stale':
   await step('stopped',1,'call');await step('stopped',2,'recorded');await step('acknowledge',1);await step('stop',true);await step('cancel',true);break;
  case 'early-foreign': await step('stopped',2,'microphone');await step('acknowledge',1);await step('stop',true);break;
  case 'call-after-ready':
   await step('acknowledge',1);await step('stopped',2,'call');await step('stopped',1,'call');await step('cancel',true);break;
  case 'capture-failed': await step('acknowledge',2);await step('stopped',2,'microphone');await step('stop',true);break;
  case 'metrics-failed': await step('acknowledge',1);await step('metricsFailed');await step('cancel',true);break;
  case 'stop-after-metrics-failure':
   await step('acknowledge',1);await step('metricsFailed');await step('stopped',1,'recorded');await step('stop',true);break;
  case 'abort-before-ack': await step('stopped',1,'recorded');await step('abort');await step('stopped',2,'call');await step('acknowledge',1);break;
  case 'abort-after-ack':
   await step('acknowledge',1);await step('abort');await step('stopped',1,'recorded');await step('cancel',true);break;
  case 'cancel-cleanup-failed': await step('acknowledge',2);await step('cancel',false);await step('stopped',2,'recorded');break;
  case 'start-rejected': await step('stopped',1,'recorded');await step('refuseStart');break;
  case 'rejected-after-abort': await step('abort');await step('refuseStart');break;
  case 'terminal-duplicate':
   await step('acknowledge',1);await step('stopped',1,'recorded');await step('stopped',1,'call');await step('stop',false);break;
  default: throw Error(name);
 }
 return {name,init:{name:'init'},expect,steps};
}
export async function checkBatchCaptureCompletion(extraSources=[]){
 const sources=[modelPath,source,'apps/app/src/runtime/cloud-voice.ts','bun.lock',fileURLToPath(import.meta.url),...extraSources];
 const driverHashes=captureInputs(sources);
 const make=extractImplementation(),traces=[];
 for(const name of batchCaptureScenarios)traces.push(await generate(make,name));
 return checkTraces({model,modelPath,sources,driverHashes,traces,scope:'bounded-orchestration',assumptions:[
  'The exact renderer captureConversationAudio closure and its clip guard execute with a read-only observer. Capacitor delivery, clock, native stop and cleanup are controlled ports.',
  'One held start, two distinguishable recording IDs and settled synchronous or promise effects bound this projection. The shared loop and actual JVM recorder are checked separately.',
  'Installed callback transport, concurrently pending detach/cleanup, PCM and media erasure remain external.'
 ]});
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await checkBatchCaptureCompletion(),null,2));
