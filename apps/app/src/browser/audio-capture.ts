import {startRecordingMeter,recordingMetrics} from './audio-levels';
import {BrowserMicrophone} from './sensor-policy';
type Clip = {recordingId:string;durationMs:number};
/** One finished part of a segmented recording: a standalone file of `durationMs` recorded time. */
export type CaptureSegment = {index:number;blob:Blob;durationMs:number};
/** The recorder writing the current segment, alongside the whole-recording recorder. */
type SegmentPart = {recorder:MediaRecorder;started:number;pausedAt?:number;pausedTotal:number;flushed:Promise<void>};
type Session = {
 id:string;generation:number;stream:MediaStream;recorder:MediaRecorder;started:number;stopped?:number;
 done:Promise<Blob>;reject:(error:Error)=>void;timer?:ReturnType<typeof setTimeout>;pausedAt?:number;pausedTotal:number;
 releaseMeter?:()=>void;finishing?:Promise<Clip>;settled:boolean;failed?:boolean;
 segment?:SegmentPart;rollover?:ReturnType<typeof setInterval>;
};
const partMs=(part:SegmentPart,now=Date.now())=>Math.max(0,now-part.started-part.pausedTotal-(part.pausedAt!==undefined?now-part.pausedAt:0));
const cancelled=()=>new DOMException('Recording cancelled','AbortError');
/** Own each microphone stream, timer and stop promise independently of later sessions. */
export class BrowserAudioCapture {
 private microphone?:BrowserMicrophone;
 private generation=0;
 private current?:Session;
 private clips=new Map<string,{blob:Blob;durationMs:number}>();
 constructor(private stopped:(event:{recordingId:string;durationMs:number|null})=>void){}
 get(id:string){return this.clips.get(id);}
 metrics(id:string){if(this.current?.id!==id||this.current.settled)throw Error('Recording changed.');return {recordingId:id,...recordingMetrics(id)};}
 clear(){this.cancel();this.clips.clear();}
 cancel(){
  this.microphone?.close();this.microphone=undefined;
  ++this.generation;const session=this.current;this.current=undefined;
  if(!session)return;
  session.releaseMeter?.();clearTimeout(session.timer);clearInterval(session.rollover);session.settled=true;session.reject(cancelled());
  try{if(session.recorder.state!=='inactive')session.recorder.stop();}catch{}
  const part=session.segment;session.segment=undefined;try{if(part&&part.recorder.state!=='inactive')part.recorder.stop();}catch{}
  session.stream.getTracks().forEach(track=>track.stop());
 }
 /**
  * A clip is bounded (59 s by default); a Notes recording (`unlimited`) ends only at stop. With
  * `segmentMs`, the same stream is also written as standalone segments of at most that much
  * recorded time, each handed to `onSegment` as it finishes (the last one before stop resolves),
  * so every segment fits a transcription request while the recording goes on.
  */
 async start(input:{maxDurationMs?:number;unlimited?:boolean;segmentMs?:number;onSegment?:(segment:CaptureSegment)=>void}={}) {
  this.cancel();const generation=this.generation;
  const duration=input.unlimited?Infinity:input.maxDurationMs??59000;
  if(!input.unlimited&&(!Number.isFinite(duration)||duration<1||duration>59000))throw Error('Recording duration must be between 1 and 59000 milliseconds.');
  if(document.hidden)throw cancelled();
  const microphone=this.microphone=new BrowserMicrophone(()=>{const id=this.current?.id;this.cancel();if(id)this.stopped({recordingId:id,durationMs:null});});
  const stream=await microphone.open();
  if(generation!==this.generation||document.hidden){microphone.close();stream.getTracks().forEach(track=>track.stop());throw cancelled();}
  try {
   const mimeType=['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/mp4'].find(type=>MediaRecorder.isTypeSupported(type));
   const recorder=new MediaRecorder(stream,mimeType?{mimeType}:undefined),id=crypto.randomUUID();let resolve!:(blob:Blob)=>void,reject!:(error:Error)=>void;
   const done=new Promise<Blob>((yes,no)=>{resolve=yes;reject=no;});void done.catch(()=>{});
   const session:Session={id,generation,stream,recorder,started:Date.now(),done,reject,settled:false,pausedTotal:0};
   this.current=session;const chunks:Blob[]=[];let bytes=0;
   const finish=(error?:Error)=>{
    if(session.settled)return;session.settled=true;session.releaseMeter?.();clearTimeout(session.timer);
    microphone.close();stream.getTracks().forEach(track=>track.stop());
    if(!error&&!bytes)error=Error('Recording contains no audio.');
    if(error){session.failed=true;reject(error);if(this.current===session&&generation===this.generation)this.stopped({recordingId:id,durationMs:null});}
    else resolve(new Blob(chunks,{type:recorder.mimeType}));
   };
   recorder.ondataavailable=event=>{
    if(session.settled)return;bytes+=event.data.size;
    if(!input.unlimited&&bytes>16_000_000){finish(Error('Recording exceeded the local size limit.'));try{recorder.stop();}catch{};return;}
    chunks.push(event.data);
   };
   recorder.onerror=()=>{finish(Error('Recording interrupted.'));try{recorder.stop();}catch{}};
   const automatic=()=>{if(this.current!==session)return;void this.stop().then(clip=>{if(generation===this.generation)this.stopped(clip);}).catch(()=>{if(generation===this.generation)this.stopped({recordingId:id,durationMs:null});});};
   recorder.onstop=()=>{finish();if(session.stopped===undefined&&!session.failed)automatic();};
   recorder.start(250);
   if(input.segmentMs&&input.onSegment){
    const segmentMs=input.segmentMs,onSegment=input.onSegment;let index=0;
    const open=()=>{
     if(session.settled||session.stopped!==undefined)return;
     const part:SegmentPart={recorder:new MediaRecorder(stream,mimeType?{mimeType}:undefined),started:Date.now(),pausedTotal:0,flushed:Promise.resolve()};
     const parts:Blob[]=[];
     part.recorder.ondataavailable=event=>{if(event.data.size)parts.push(event.data);};
     part.flushed=new Promise<void>(done=>{part.recorder.onstop=()=>{const durationMs=Math.max(1,partMs(part,session.stopped??Date.now()));if(parts.length&&!session.failed&&this.current===session)onSegment({index:index++,blob:new Blob(parts,{type:part.recorder.mimeType}),durationMs});done();};});
     part.recorder.start(1000);
     if(session.pausedAt!==undefined){part.recorder.pause();part.pausedAt=Date.now();}
     session.segment=part;
    };
    open();
    session.rollover=setInterval(()=>{const part=session.segment;if(!part||session.stopped!==undefined||session.settled||partMs(part)<segmentMs)return;try{part.recorder.stop();}catch{}open();},250);
   }
   session.releaseMeter=startRecordingMeter(id,stream);
   if(Number.isFinite(duration))session.timer=setTimeout(automatic,duration);
   return {recordingId:id,maxDurationMs:duration};
  }catch(error){
   microphone.close();stream.getTracks().forEach(track=>track.stop());
   if(this.current?.generation===generation){this.current.releaseMeter?.();this.current.reject(error instanceof Error?error:Error('Recording failed.'));this.current=undefined;}
   throw error;
  }
 }
 pause(){
  const session=this.current;if(!session||session.settled||session.stopped!==undefined||session.recorder.state!=='recording')return;session.recorder.pause();session.pausedAt=Date.now();
  const part=session.segment;if(part&&part.recorder.state==='recording'){part.recorder.pause();part.pausedAt=session.pausedAt;}
 }
 resume(){
  const session=this.current;if(!session||session.settled||session.recorder.state!=='paused')return;session.recorder.resume();session.pausedTotal+=Date.now()-(session.pausedAt??Date.now());session.pausedAt=undefined;
  const part=session.segment;if(part&&part.recorder.state==='paused'){part.recorder.resume();part.pausedTotal+=Date.now()-(part.pausedAt??Date.now());part.pausedAt=undefined;}
 }
 /** Recorded time of the current session, without paused time. */
 elapsed(id:string){const session=this.current;if(!session||session.id!==id)return 0;const now=session.stopped??Date.now();return Math.max(0,now-session.started-session.pausedTotal-(session.pausedAt!==undefined?now-session.pausedAt:0));}
 async stop():Promise<Clip> {
  const session=this.current;if(!session)throw Error('Start a recording first.');
  if(session.finishing)return session.finishing;
  session.stopped=Date.now();clearTimeout(session.timer);clearInterval(session.rollover);if(session.pausedAt!==undefined){session.pausedTotal+=session.stopped-session.pausedAt;session.pausedAt=undefined;}
  const part=session.segment;session.segment=undefined;
  if(part){if(part.pausedAt!==undefined){part.pausedTotal+=session.stopped-part.pausedAt;part.pausedAt=undefined;}try{if(part.recorder.state!=='inactive')part.recorder.stop();}catch{}}
  session.finishing=(async()=>{
   try {
    if(session.recorder.state!=='inactive')session.recorder.stop();
    // The last segment is handed over before the recording counts as stopped.
    if(part)await Promise.race([part.flushed,new Promise(resolve=>setTimeout(resolve,5000))]);
    const deadline=setTimeout(()=>session.reject(Error('Recording did not finish. Try again.')),5000);
    let blob:Blob;try{blob=await session.done;}finally{clearTimeout(deadline);}
    if(this.current!==session||session.generation!==this.generation)throw cancelled();
    const durationMs=Math.max(0,session.stopped!-session.started-session.pausedTotal);
    this.clips.set(session.id,{blob,durationMs});
    while(this.clips.size>4)this.clips.delete(this.clips.keys().next().value!);
    return {recordingId:session.id,durationMs};
   }finally{session.releaseMeter?.();session.stream.getTracks().forEach(track=>track.stop());if(this.current===session){this.microphone?.close();this.current=undefined;}}
  })();
  return session.finishing;
 }
}
