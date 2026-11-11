import {BrowserMicrophone} from './sensor-policy';
import {drawCameraFrame,type CameraTransform} from './camera-frame';
type Capture={blob:Blob;duration:number;width:number;height:number;image:string};
type Session={generation:number;stream:MediaStream;recorder:MediaRecorder;started:number;ended?:number;bytes:number;done:Promise<Capture>;reject:(error:Error)=>void;settled:boolean;cleanup:()=>void;timer?:ReturnType<typeof setTimeout>;deadline?:ReturnType<typeof setTimeout>;stopping?:Promise<Capture>};
const cancelled=()=>new DOMException('Video recording cancelled.','AbortError');
/** Size accounting for one recorded chunk. A chunk that would pass the limit is left out and
 * recording stops with the chunks already collected, so reaching the limit shortens the video
 * instead of discarding it. Reaching the limit exactly keeps the chunk and stops. */
export function admitVideoChunk(bytes:number,chunk:number,max:number):{keep:boolean;stop:boolean;bytes:number}{
 //@ verify
 //@ requires chunk >= 0 && bytes <= max
 //@ ensures \result.bytes <= max
 //@ ensures \result.keep <==> bytes + chunk <= max
 //@ ensures \result.keep ==> \result.bytes === bytes + chunk
 //@ ensures !\result.keep ==> \result.bytes === bytes && \result.stop
 //@ ensures \result.stop <==> bytes + chunk >= max
 //@ ensures \result.bytes >= bytes
 if(bytes+chunk>max)return {keep:false,stop:true,bytes};
 return {keep:true,stop:bytes+chunk===max,bytes:bytes+chunk};
}
/** Recording owns cloned camera tracks and a separately requested microphone. */
export class BrowserVideoCapture {
 private microphone?:BrowserMicrophone;
 private generation=0;
 private current?:Session;
 cancel(){
  this.microphone?.close();this.microphone=undefined;
  this.generation++;const session=this.current;this.current=undefined;if(!session)return;
  session.settled=true;session.cleanup();clearTimeout(session.timer);clearTimeout(session.deadline);session.reject(cancelled());
  try{if(session.recorder.state!=='inactive')session.recorder.stop();}catch{}
  session.stream.getTracks().forEach(track=>track.stop());
 }
 async start(video:HTMLVideoElement,input:{audio?:boolean;maxDuration:number;maxFileSize:number},transform:CameraTransform={zoom:1,mirror:false}){
  this.cancel();const generation=this.generation;
  if(!Number.isFinite(input.maxDuration)||input.maxDuration<=0||input.maxDuration>300||!Number.isSafeInteger(input.maxFileSize)||input.maxFileSize<=0||input.maxFileSize>104857600)throw Error('Choose video limits up to 5 minutes and 100 MB.');
  const source=video.srcObject as MediaStream|null,track=source?.getVideoTracks()[0];
  if(document.hidden||!track||track.readyState!=='live'||video.readyState<2)throw Error('Start the camera before recording.');
  const width=video.videoWidth,height=video.videoHeight;
  if(width<=0||height<=0||width*height>32_000_000)throw Error('Unsupported video dimensions.');
  let microphoneOwner:BrowserMicrophone|undefined;let microphone:MediaStream|undefined,owned:MediaStream|undefined;let cleanup=()=>{};
  try{
   if(input.audio!==false){const lease=microphoneOwner=this.microphone=new BrowserMicrophone(()=>this.cancel());microphone=await lease.open();if(!microphone.getAudioTracks().some(t=>t.readyState==='live'))throw Error('Microphone did not provide audio.');}
   if(generation!==this.generation||document.hidden||track.readyState!=='live')throw cancelled();
   let output=track.clone();let transformed:HTMLCanvasElement|undefined;
   if(transform.zoom!==1||transform.mirror){
    output.stop();transformed=drawCameraFrame(video,transform);output=transformed.captureStream(30).getVideoTracks()[0];
   }
   owned=new MediaStream([output,...(microphone?.getAudioTracks()||[])]);
   const recorder=new MediaRecorder(owned);let resolve!:(capture:Capture)=>void,reject!:(error:Error)=>void;
   const done=new Promise<Capture>((yes,no)=>{resolve=yes;reject=no;});void done.catch(()=>{});
   const session:Session={generation,stream:owned,recorder,started:performance.now(),bytes:0,done,reject,settled:false,cleanup:()=>cleanup()};this.current=session;
   const chunks:Blob[]=[];
   // Once the limit stops the recording every later chunk is left out too: the saved video never has a gap.
   let full=false;
   const finish=(error?:Error)=>{
    if(session.settled)return;session.settled=true;microphoneOwner?.close();session.cleanup();session.ended??=performance.now();clearTimeout(session.timer);clearTimeout(session.deadline);
    session.stream.getTracks().forEach(t=>t.stop());
    if(!error&&!session.bytes)error=Error(full?'Video exceeded the size limit.':'Recording contains no video.');
    if(error){chunks.length=0;reject(error);return;}
    try{
     const canvas=drawCameraFrame(video,transform);
     // Codec lists contain commas; retaining them in a FileReader data URL
     // would turn part of its media type into payload before the base64 marker.
     // Some recorders clear mimeType when they stop; emitted chunks retain it.
     const mime=(recorder.mimeType||chunks.find(chunk=>chunk.type)?.type||'').split(';')[0].trim().toLowerCase();
     if(!['video/webm','video/mp4'].includes(mime))throw Error('Video format could not be confirmed. Try recording again.');
     resolve({blob:new Blob(chunks,{type:mime}),duration:Math.max(.001,(session.ended-session.started)/1000),width,height,image:canvas.toDataURL('image/jpeg',.85)});chunks.length=0;
    }catch(e){reject(e instanceof Error?e:Error('Video could not finish.'));}
   };
   const stop=()=>{if(session.settled)return;session.ended??=performance.now();clearTimeout(session.timer);session.deadline??=setTimeout(()=>finish(Error('Video did not finish. Try again.')),5000);try{if(recorder.state!=='inactive')recorder.stop();}catch(e){finish(e instanceof Error?e:Error('Video could not stop.'));}};
   recorder.ondataavailable=event=>{if(session.settled||full)return;const admitted=admitVideoChunk(session.bytes,event.data.size,input.maxFileSize);session.bytes=admitted.bytes;if(admitted.keep)chunks.push(event.data);if(admitted.stop){full=true;stop();}};
   recorder.onstop=()=>finish();recorder.onerror=()=>{finish(Error('Video recording interrupted.'));try{recorder.stop();}catch{}};
   let frameTimer:ReturnType<typeof setInterval>|undefined;cleanup=()=>{microphoneOwner?.close();clearInterval(frameTimer);track.removeEventListener('ended',stop);};track.addEventListener('ended',stop,{once:true});
   if(transformed){const canvas=transformed;frameTimer=setInterval(()=>{try{drawCameraFrame(video,transform,canvas);}catch(e){finish(e instanceof Error?e:Error('Camera frame failed.'));try{recorder.stop();}catch{}}},33);}
   recorder.start(250);session.timer=setTimeout(stop,input.maxDuration*1000);
  }catch(error){microphoneOwner?.close();cleanup();microphone?.getTracks().forEach(t=>t.stop());owned?.getTracks().forEach(t=>t.stop());if(this.current?.generation===generation)this.cancel();throw error;}
 }
 async stop():Promise<Capture>{
  const session=this.current;if(!session){this.cancel();throw Error('No recording.');}if(session.stopping)return session.stopping;
  session.ended??=performance.now();clearTimeout(session.timer);
  session.stopping=(async()=>{
   try{
    if(!session.settled){session.deadline??=setTimeout(()=>{session.settled=true;session.cleanup();session.reject(Error('Video did not finish. Try again.'));session.stream.getTracks().forEach(t=>t.stop());},5000);if(session.recorder.state!=='inactive')session.recorder.stop();}
    const result=await session.done;if(this.current!==session||session.generation!==this.generation)throw cancelled();return result;
   }finally{session.cleanup();clearTimeout(session.deadline);session.stream.getTracks().forEach(t=>t.stop());}
  })();return session.stopping;
 }
 state(){const session=this.current;return {isRecording:!!session&&!session.settled&&session.ended===undefined&&session.recorder.state==='recording',duration:session?Math.max(0,((session.ended??performance.now())-session.started)/1000):0,fileSize:session?.bytes||0};}
}
