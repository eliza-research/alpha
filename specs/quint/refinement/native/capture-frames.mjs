import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInputs,checkTraces} from '../check-traces.mjs';
import {directory,javaTraces} from './java.mjs';
import {liveCapturePlatform} from './live-capture-platform.mjs';
import {liveCaptureSources} from './live-capture.mjs';
import {nativePatchInputs} from './current-sources.mjs';
export const captureFrameScenarios=['stop-empty','silence','preroll','open-tail','close-edge','middle-reset','non-finite','missing-probability','partial-reads','read-failure','source-close-failure','detector-close-failure','interrupt'];
export async function checkCaptureFrames(extraSources=[]){
 const platform=liveCapturePlatform();
 writeFileSync(join(platform.directory,'android/util/Base64.java'),'package android.util;public class Base64 {public static final int NO_WRAP=2;public static String encodeToString(byte[] bytes,int flags){ai.elizaresearch.alphaphone.CaptureFrameTraces.encodedBuffer=bytes;return java.util.Base64.getEncoder().encodeToString(bytes);}}');
 const compiled=liveCaptureSources(platform);
 const sources=[...compiled,...nativePatchInputs,directory+'/CaptureFrameTraces.java',directory+'/live-capture-platform.mjs',directory+'/live-capture.mjs',directory+'/shared-recording-platform.mjs',directory+'/shared-recording.mjs',directory+'/note-bridge-platform.mjs',directory+'/note-recording-platform.mjs',directory+'/Trace.java',directory+'/java.mjs',fileURLToPath(import.meta.url),...extraSources];
 try{
  const driverHashes=captureInputs(sources);const traces=javaTraces('CaptureFrameTraces.java',compiled,['campaign',...captureFrameScenarios]);
  return await checkTraces({model:'NativeCaptureFrames',sources,driverHashes,generatedSources:platform.paths,traces,scope:'bounded-orchestration',assumptions:[
   'The real LiveVoiceCapture loop, LiveVadGate and LiveCaptureResource execute. PCM reads and detector outputs are controlled input ports.',
   'Forty windows bound the model. Each window carries a distinct constant PCM marker so emitted frame order, pre-roll and stop-tail contents can be observed exactly. Input history comes from actual detector calls.',
   'VAD and buffering locals are derived by a pure fold over that observed input history. No duplicate VAD algorithm is evaluated in the source adapter.',
   'The fixed physical clock, arbitrary audio, inference accuracy, native microphone and installed scheduling remain separate obligations.'
  ]});
 }finally{platform.close();}
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await checkCaptureFrames(),null,2));
