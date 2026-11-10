import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInputs,checkTraces} from '../check-traces.mjs';
import {directory,javaTraces} from './java.mjs';
import {liveCapturePlatform} from './live-capture-platform.mjs';
import {currentNativeSource,nativePatchInputs,sharedRecordingSources} from './shared-recording.mjs';

export function liveCaptureSources(platform){
 const voice='vendor/eliza/plugins/plugin-local-inference/native/android/src/main/java/ai/eliza/voice/';
 return [...sharedRecordingSources(platform).map(path=>path.endsWith('/LiveCaptureAdmission.java')?currentNativeSource('LiveCaptureAdmission.java'):path),...['LiveCaptureController','LiveSegmentPipe','LiveVoiceCapture','LiveCaptureResource','LiveCaptureSource'].map(name=>['LiveCaptureController','LiveVoiceCapture','LiveSegmentPipe'].includes(name)?currentNativeSource(name+'.java'):voice+name+'.java'),directory+'/LiveCapturePorts.java'];
}
export function probeLiveCapture(mode='permission'){
 const platform=liveCapturePlatform(),state=mkdtempSync(join(tmpdir(),'quint-live-capture-'));
 try{return javaTraces('LiveCaptureProbe.java',liveCaptureSources(platform),[state,mode]);}
 finally{platform.close();rmSync(state,{recursive:true,force:true});}
}
export const liveCaptureScenarios=['permission','permission-call','permission-denied','permission-replaced','permission-pause','permission-resume','permission-destroy',
 'direct','opening-call','opening-call-release-failure','opening-stop','opening-replace','opening-pause','open-failure','active-call','active-pause','active-destroy','stop-tail','stop-discard','replace-active'];
export async function checkLiveCapture(extraSources=[]){
 const platform=liveCapturePlatform(),state=mkdtempSync(join(tmpdir(),'quint-live-capture-'));
 const compiled=liveCaptureSources(platform);
 const sources=[...compiled,...nativePatchInputs,directory+'/LiveCaptureTraces.java',directory+'/live-capture-platform.mjs',
  directory+'/shared-recording-platform.mjs',directory+'/shared-recording.mjs',directory+'/note-bridge-platform.mjs',
  directory+'/note-recording-platform.mjs',directory+'/Trace.java',directory+'/java.mjs',fileURLToPath(import.meta.url),...extraSources];
 try{
  const driverHashes=captureInputs(sources);
  const traces=javaTraces('LiveCaptureTraces.java',compiled,[state,'campaign',...liveCaptureScenarios]);
  return await checkTraces({model:'NativeLiveCapture',sources,driverHashes,generatedSources:platform.paths,traces,scope:'bounded-orchestration',assumptions:[
   'The complete shared parent, LiveCaptureController, LiveVoiceCapture and LiveCaptureResource execute. Primitive Android audio and VAD inputs are controlled ports.',
   'Two capture reservations and source instances bound the campaign. Native constructor suspension separates initial admission, late physical opening, publication and cleanup.',
   'This campaign executes non-piped capture. The actual LiveSegmentPipe class compiles but owner-bound provider warmup and transcript forwarding require additional schedules.',
   'Protected-screen state is fixed inactive in this projection; production protected-surface guards remain present.',
   'Physical permission enforcement, AudioRecord startup/stop/release and installed Android scheduling remain platform obligations.'
  ]});
 }finally{platform.close();rmSync(state,{recursive:true,force:true});}
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await checkLiveCapture(),null,2));
