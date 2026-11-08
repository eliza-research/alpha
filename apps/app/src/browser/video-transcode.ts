import type {VideoEdit} from './video-edit';

/** Encode media timestamps, independently of playback and the device audio clock. */
export async function transcodeVideo(source:string,edit:VideoEdit,dimensions:{width:number;height:number;sourceWidth:number;sourceHeight:number},signal:AbortSignal):Promise<Blob|null>{
 if(typeof VideoEncoder==='undefined'||typeof VideoDecoder==='undefined'||typeof AudioEncoder==='undefined'||typeof AudioDecoder==='undefined')return null;
 signal.throwIfAborted();
 const {Input,BlobSource,ALL_FORMATS,Output,WebMOutputFormat,BufferTarget,Conversion}=await import('mediabunny');
 signal.throwIfAborted();
 const input=new Input({source:new BlobSource(await(await fetch(source,{signal})).blob()),formats:ALL_FORMATS});
 const target=new BufferTarget(),output=new Output({target,format:new WebMOutputFormat()});
 let conversion:Awaited<ReturnType<typeof Conversion.init>>|undefined,retired=false,failure:unknown;
 let rejectAbort!:(error:unknown)=>void;
 const cancelled=new Promise<never>((_,reject)=>rejectAbort=reject);
 const cancel=(reason:unknown)=>{if(retired)return;retired=true;failure=reason;rejectAbort(reason);void conversion?.cancel().catch(()=>{});input.dispose();};
 const abort=()=>cancel(signal.reason||new DOMException('Video export cancelled','AbortError'));
 const timer=setTimeout(()=>cancel(Error('Video export timed out. Try a shorter clip.')),Math.max(30000,(edit.end-edit.start)*1000+15000));
 signal.addEventListener('abort',abort,{once:true});
 const removeSizeListener=target.on('write',({end})=>{if(end>100*1024*1024)cancel(Error('Edited video exceeds 100 MB.'));});
 const work=async()=>{
  if(signal.aborted){abort();throw failure;}
  const rotated=edit.rotation%180!==0,w=rotated?dimensions.sourceHeight:dimensions.sourceWidth,h=rotated?dimensions.sourceWidth:dimensions.sourceHeight;
  conversion=await Conversion.init({input,output,showWarnings:false,trim:{start:edit.start,end:edit.end},video:{codec:'vp8',forceTranscode:true,rotate:edit.rotation as 0|90|180|270,allowTransformationMetadata:false,width:dimensions.width,height:dimensions.height,fit:'fill',...(edit.crop?{crop:{left:Math.floor(w*(1-1/1.3)/2),top:Math.floor(h*(1-1/1.3)/2),width:Math.floor(w/1.3),height:Math.floor(h/1.3)}}:{})},audio:{codec:'opus',forceTranscode:true}});
  if(retired){await conversion.cancel();throw failure;}
  // Preserve every track. The established media-element path is the fallback
  // when the browser cannot decode/encode this particular source codec.
  if(!conversion.isValid||conversion.discardedTracks.length){await conversion.cancel();return null;}
  await conversion.execute();if(retired)throw failure;signal.throwIfAborted();
  if(!target.buffer?.byteLength||target.buffer.byteLength>100*1024*1024)throw Error('Edited video could not be saved.');
  return new Blob([target.buffer],{type:'video/webm'});
 };
 try{return await Promise.race([work(),cancelled]);}
 finally{retired=true;clearTimeout(timer);signal.removeEventListener('abort',abort);removeSizeListener();input.dispose();if(output.state!=='finalized')void output.cancel().catch(()=>{});}
}
