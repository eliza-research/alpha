import {transcodeVideo} from './video-transcode';
import {videoRecorders} from './video-codecs';
export type VideoEdit={start:number;end:number;rotation:number;crop:boolean};
export function validateVideoEdit(edit:VideoEdit,duration:number){
 // Slider endpoints use subtraction; accept only its floating-point roundoff at the 0.1s boundary.
 const rangeTolerance=Number.EPSILON*Math.max(1,duration);
 if(!Number.isFinite(duration)||!Number.isFinite(edit.start)||!Number.isFinite(edit.end)||typeof edit.crop!=='boolean'||!videoEditValid(edit.start,edit.end,edit.rotation,duration,rangeTolerance))throw Error('Choose a valid video range of at least 0.1 seconds.');
}
/** The range and rotation rules of `validateVideoEdit` for finite numbers. Checked by LemmaScript:
 * a valid edit lies inside a source of at most 300 s and, for a tolerance under 0.1 s, is never empty. */
export function videoEditValid(start:number,end:number,rotation:number,duration:number,tolerance:number):boolean{
 //@ verify
 //@ type start real
 //@ type end real
 //@ type duration real
 //@ type tolerance real
 //@ ensures \result ==> 0 < duration && duration <= 300 && 0 <= start && end <= duration + 0.05
 //@ ensures \result ==> rotation === 0 || rotation === 90 || rotation === 180 || rotation === 270
 //@ ensures \result ==> end - start >= 0.1 - tolerance
 //@ ensures \result && tolerance < 0.1 ==> end - start > 0 && start < duration + 0.05
 //@ ensures \result <==> 0 < duration && duration <= 300 && 0 <= start && end <= duration + 0.05 && end - start >= 0.1 - tolerance && (rotation === 0 || rotation === 90 || rotation === 180 || rotation === 270)
 return duration>0&&duration<=300&&start>=0&&end<=duration+.05&&end-start>=.1-tolerance&&[0,90,180,270].includes(rotation);
}
/** Minutes and tenths of a second for the trim timeline. The value is rounded to tenths
 * before it is split, so the seconds field never shows 60.0. */
export function videoClock(value:number){
 const {minutes,remainder}=videoClockParts(Math.max(0,Math.round(value*10)));
 return `${minutes}:${(remainder/10).toFixed(1).padStart(4,'0')}`;
}
/** Whole minutes and the remaining tenths of a second. Checked by LemmaScript: the remainder is
 * under 600 tenths (60.0 s) and the two parts add back up to the input. */
export function videoClockParts(tenths:number):{minutes:number;remainder:number}{
 //@ verify
 //@ requires tenths >= 0
 //@ ensures 0 <= \result.remainder && \result.remainder < 600
 //@ ensures \result.minutes >= 0
 //@ ensures \result.minutes * 600 + \result.remainder === tenths
 return {minutes:Math.floor(tenths/600),remainder:tenths%600};
}
/** Duration recorded for an edited copy. `reached` is the source position where real-time
 * encoding stopped; a source that ends before the chosen end yields the shorter copy it
 * actually produced, never the requested range. */
export function editedVideoDuration(edit:Pick<VideoEdit,'start'|'end'>,reached?:number){
 const at=reached!==undefined&&Number.isFinite(reached)?reached:undefined;
 return videoDurationReached(edit.start,edit.end,at!==undefined,at??0);
}
/** `editedVideoDuration` for finite numbers; `known` is false when there is no usable stop position.
 * Checked by LemmaScript: always positive and never longer than the requested range. */
export function videoDurationReached(start:number,end:number,known:boolean,reached:number):number{
 //@ verify
 //@ type start real
 //@ type end real
 //@ type reached real
 //@ type \result real
 //@ ensures \result >= 0.001
 //@ ensures \result === 0.001 || \result <= end - start
 //@ ensures !known || reached >= end ==> \result === (end - start >= 0.001 ? end - start : 0.001)
 //@ ensures known && reached <= start ==> \result === 0.001
 //@ ensures known && start <= reached && reached <= end ==> \result === (reached - start >= 0.001 ? reached - start : 0.001)
 const from=reached>=start?reached:start,stop=known?(from<=end?from:end):end,length=stop-start;
 return length>=.001?length:.001;
}
/** Local timestamp-based encoding with a real-time fallback; audio comes from the file. */
export async function renderVideoEdit(source:{path:string;duration:number},edit:VideoEdit,signal:AbortSignal){
 validateVideoEdit(edit,source.duration);signal.throwIfAborted();
 if(source.path.length>140_000_000)throw Error('Choose a local video up to 100 MB.');
 // Older recordings could lose their MIME at stop time. Recover only recognized
 // local video containers; keep the stored original and the strict format gate.
 if(source.path.startsWith('data:application/octet-stream;base64,')){
  const payload=source.path.slice('data:application/octet-stream;base64,'.length);
  let header='';try{header=atob(payload.slice(0,16));}catch{}
  const mime=header.startsWith('\x1a\x45\xdf\xa3')?'video/webm':header.slice(4,8)==='ftyp'?'video/mp4':null;
  if(mime)source={...source,path:`data:${mime};base64,${payload}`};
 }
 if(!/^data:video\/(webm|mp4);base64,/.test(source.path))throw Error('Choose a local video up to 100 MB.');
 const video=document.createElement('video');video.playsInline=true;video.preload='auto';const sourceUrl=source.path.startsWith('data:video/webm;')?URL.createObjectURL(await(await fetch(source.path,{signal})).blob()):undefined;video.src=sourceUrl||source.path;
 let audio:AudioContext|undefined,output:MediaStream|undefined,recorder:MediaRecorder|undefined,timer:ReturnType<typeof setInterval>|undefined;
 const wait=(event:string,action:()=>void)=>new Promise<void>((resolve,reject)=>{const finish=(error?:unknown)=>{clearTimeout(timeout);video.removeEventListener(event,ok);video.removeEventListener('error',bad);signal.removeEventListener('abort',abort);error?reject(error):resolve();},ok=()=>finish(),bad=()=>finish(Error('Video could not decode.')),abort=()=>finish(signal.reason);const timeout=setTimeout(()=>finish(Error('Video decode timed out.')),15000);video.addEventListener(event,ok,{once:true});video.addEventListener('error',bad,{once:true});signal.addEventListener('abort',abort,{once:true});try{signal.throwIfAborted();action();}catch(error){finish(error);}});
 try{
  await wait('loadeddata',()=>video.load());signal.throwIfAborted();
  if(!video.videoWidth||!video.videoHeight||video.videoWidth*video.videoHeight>32000000)throw Error('Unsupported video dimensions.');
  if(edit.start>0)await wait('seeked',()=>{video.currentTime=edit.start;});signal.throwIfAborted();
  const canvas=drawEditedVideo(video,edit),draw=()=>{drawEditedVideo(video,edit,canvas);};const image=canvas.toDataURL('image/jpeg',.85);
  const timestamped=await transcodeVideo(source.path,edit,{width:canvas.width,height:canvas.height,sourceWidth:video.videoWidth,sourceHeight:video.videoHeight},signal);
  if(timestamped){const path=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(timestamped);});signal.throwIfAborted();return {path,image,width:canvas.width,height:canvas.height,duration:edit.end-edit.start};}
  output=canvas.captureStream(30);audio=new AudioContext();const sourceNode=audio.createMediaElementSource(video),destination=audio.createMediaStreamDestination();sourceNode.connect(destination);output.addTrack(destination.stream.getAudioTracks()[0]);await new Promise<void>((resolve,reject)=>{const finish=(error?:unknown)=>{clearTimeout(timeout);signal.removeEventListener('abort',abort);error?reject(error):resolve();},abort=()=>finish(signal.reason),timeout=setTimeout(()=>finish(Error('Video audio startup timed out.')),15000);signal.addEventListener('abort',abort,{once:true});if(signal.aborted){abort();return;}void audio!.resume().then(()=>finish(),finish);});signal.throwIfAborted();

  let reached:number|undefined;
  const blob=await new Promise<Blob>((resolve,reject)=>{
   const chunks:Blob[]=[];let bytes=0,settled=false;const finish=(error?:unknown)=>{if(settled)return;settled=true;clearTimeout(deadline);clearInterval(timer);signal.removeEventListener('abort',abort);video.pause();video.onended=null;video.onerror=null;if(recorder&&recorder.state!=='inactive')recorder.stop();error?reject(error):bytes?resolve(new Blob(chunks,{type:(recorder?.mimeType||chunks[0]?.type||'').split(';')[0]})):reject(Error('Edited video is empty.'));};
   const abort=()=>finish(signal.reason),stop=()=>{reached??=video.currentTime;video.pause();if(recorder!.state!=='inactive')recorder!.stop();};
   const deadline=setTimeout(()=>finish(Error('Video export timed out.')),(edit.end-edit.start)*1000+15000);signal.addEventListener('abort',abort,{once:true});
   const attach=()=>{recorder!.ondataavailable=e=>{if(settled)return;bytes+=e.data.size;if(bytes>100*1024*1024){finish(Error('Edited video exceeds 100 MB.'));return;}chunks.push(e.data);};recorder!.onstop=()=>finish();recorder!.onerror=()=>finish(Error('Video encoding interrupted.'));video.onerror=()=>finish(Error('Video decoding interrupted.'));video.onended=stop;};
   try{
    signal.throwIfAborted();let started=false;
    for(const candidate of videoRecorders(output!)){signal.throwIfAborted();recorder=candidate;attach();try{recorder.start(200);started=true;break;}catch{recorder.ondataavailable=null;recorder.onstop=null;recorder.onerror=null;if(recorder.state!=='inactive')recorder.stop();chunks.length=0;bytes=0;}}
    if(!started)throw Error('Video export could not start. Close other media and try again.');
    timer=setInterval(()=>{try{draw();if(video.currentTime>=edit.end)stop();}catch(error){finish(error);}},20);void video.play().catch(finish);
   }catch(error){finish(error);}
  });
  signal.throwIfAborted();const path=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});signal.throwIfAborted();return {path,image,width:canvas.width,height:canvas.height,duration:editedVideoDuration(edit,reached)};
 }finally{clearInterval(timer);if(recorder?.state==='recording')recorder.stop();output?.getTracks().forEach(t=>t.stop());await audio?.close().catch(()=>{});video.pause();video.removeAttribute('src');video.load();if(sourceUrl)URL.revokeObjectURL(sourceUrl);}
}

export function drawEditedVideo(video:HTMLVideoElement,edit:VideoEdit,canvas=document.createElement('canvas')){
 const factor=edit.crop?1.3:1,sw=video.videoWidth/factor,sh=video.videoHeight/factor,scale=Math.min(1,1920/Math.max(sw,sh)),rotated=edit.rotation%180!==0;
 const width=Math.max(2,Math.round((rotated?sh:sw)*scale/2)*2),height=Math.max(2,Math.round((rotated?sw:sh)*scale/2)*2);if(canvas.width!==width)canvas.width=width;if(canvas.height!==height)canvas.height=height;const ctx=canvas.getContext('2d');if(!ctx)throw Error('Video canvas could not open.');ctx.save();ctx.fillStyle='black';ctx.fillRect(0,0,width,height);ctx.translate(width/2,height/2);ctx.rotate(edit.rotation*Math.PI/180);ctx.drawImage(video,(video.videoWidth-sw)/2,(video.videoHeight-sh)/2,sw,sh,-sw*scale/2,-sh*scale/2,sw*scale,sh*scale);ctx.restore();return canvas;
}
