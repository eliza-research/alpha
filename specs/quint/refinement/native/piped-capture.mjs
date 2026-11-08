import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInputs,checkTraces} from '../check-traces.mjs';
import {directory,javaTraces} from './java.mjs';
import {liveCapturePlatform} from './live-capture-platform.mjs';
import {liveCaptureSources} from './live-capture.mjs';
import {nativePatchInputs} from './current-sources.mjs';
export const pipedCaptureScenarios=['normal','final','asr','pipe-error','owner-batch','owner-warm','warm-failure','pause-warm','destroy-warm','call-open','stop-discard','unconfirmed','pause-live','destroy-live'];
export async function checkPipedCapture(extraSources=[]){
 const platform=liveCapturePlatform(),state=mkdtempSync(join(tmpdir(),'quint-piped-capture-')),compiled=liveCaptureSources(platform);
 const sources=[...compiled,...nativePatchInputs,directory+'/PipedCaptureTraces.java',directory+'/live-capture-platform.mjs',directory+'/live-capture.mjs',directory+'/shared-recording-platform.mjs',directory+'/shared-recording.mjs',directory+'/note-bridge-platform.mjs',directory+'/note-recording-platform.mjs',directory+'/current-sources.mjs',directory+'/Trace.java',directory+'/java.mjs',fileURLToPath(import.meta.url),...extraSources];
 try{
  const driverHashes=captureInputs(sources);const traces=javaTraces('PipedCaptureTraces.java',compiled,[state,'campaign',...pipedCaptureScenarios]);
  return await checkTraces({model:'NativePipedCapture',sources,driverHashes,traces,scope:'bounded-orchestration',assumptions:[
   'Protected-screen state is fixed inactive in this projection; production protected-surface guards remain present.',
   'The real shared bridge, LiveCaptureController, LiveVoiceCapture and LiveSegmentPipe execute together against controlled Android audio and an owner-bound provider port.',
   'One piped reservation, two forwarded frame events and two transcript results bound this coordinator campaign. Standalone NativeAsrPipe covers its internal queue/cutoff/response partitions.',
   'Physical Android capture, actual resident credentials and IPC delivery remain separate integration obligations.'
  ]});
 }finally{platform.close();rmSync(state,{recursive:true,force:true});}
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await checkPipedCapture(),null,2));
