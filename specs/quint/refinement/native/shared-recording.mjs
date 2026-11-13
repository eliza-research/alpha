import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInputs,checkTraces} from '../check-traces.mjs';
import {directory,javaTraces} from './java.mjs';
import {sharedRecordingPlatform} from './shared-recording-platform.mjs';
import {readFileSync} from 'node:fs';
import {preparePatchedNative} from '../../../../scripts/prepare-patched-native.ts';
const native=preparePatchedNative();
const nativePatchInputs=['android/upstream-native-sources.json','scripts/prepare-patched-native.ts',join(native.root,'.source.json'),...JSON.parse(readFileSync('android/upstream-native-sources.json','utf8')).patches.map(row=>'patches/eliza/'+row.file)];
export {nativePatchInputs};
export const currentNativeSource=name=>join(native.root,'plugins/plugin-local-inference/native/android',name==='LocalSpeechBridgePlugin.java'?'speech-bridge/src/main/java/ai/eliza/voice/':'src/main/java/ai/eliza/voice/',name);

const voice='vendor/eliza/plugins/plugin-local-inference/native/android/';
export function sharedRecordingSources(platform,source=currentNativeSource('LocalSpeechBridgePlugin.java')){
 return [source,
  ...['SpeechRequestGate','SpeechAudioFocusPolicy','LiveCaptureAdmission','LiveCaptureOptions','LiveVadGate','SpeechEngineHold','SpeechCores','LocalSpeechEngine','StreamingSpeechPlayback','SpeechPcmQueue','VoiceLatencyTrials'].map(name=>name==='LiveCaptureAdmission'?currentNativeSource(name+'.java'):voice+'src/main/java/ai/eliza/voice/'+name+'.java'),
  ...['LocalMicrophoneLease','LocalVoiceRecording','SpeechOutputWarmup','SpeechLeadTrim','FirstWriteSpeechOutput'].map(name=>currentNativeSource(name+'.java')),directory+'/NoteBridgePorts.java',directory+'/NoteRecordingPorts.java',
  'node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/JSObject.java',...platform.paths];
}
export function probeSharedRecording(source){
 const platform=sharedRecordingPlatform(),state=mkdtempSync(join(tmpdir(),'quint-shared-recording-'));
 try{return javaTraces('SharedRecordingProbe.java',sharedRecordingSources(platform,source),[state]);}
 finally{platform.close();rmSync(state,{recursive:true,force:true});}
}
export const sharedRecordingScenarios=['direct','call-direct','queued-call','queued-pause','queued-resume','queued-destroy',
 'open-failure','pause-active','call-active','call-release-failure','destroy-active','stop','second-start','permission-granted','permission-denied',
 'permission-call','permission-pause','permission-resume','permission-destroy','permission-cancel','two-prompts',
 'cancel-empty','cancel-live','cancel-queued','cancel-joined','cancel-timeout','cancel-start-during','cancel-retry',
 'cancel-release-failure','cancel-worker-refused','cancel-destroy'];
export async function checkSharedRecording(extraSources=[]){
 const platform=sharedRecordingPlatform(),state=mkdtempSync(join(tmpdir(),'quint-shared-recording-'));
 const compiled=sharedRecordingSources(platform);
 const sources=[...compiled,...nativePatchInputs,directory+'/SharedRecordingTraces.java',directory+'/shared-recording-platform.mjs',
  directory+'/note-bridge-platform.mjs',directory+'/note-recording-platform.mjs',directory+'/Trace.java',directory+'/java.mjs',
  fileURLToPath(import.meta.url),...extraSources];
 try{
  const driverHashes=captureInputs(sources);
  const traces=javaTraces('SharedRecordingTraces.java',compiled,[state,'campaign',...sharedRecordingScenarios]);
  return await checkTraces({model:'SharedRecordingAdmission',sources,driverHashes,generatedSources:platform.paths,traces,scope:'bounded-orchestration',assumptions:[
   'The complete staged LocalSpeechBridgePlugin executes public draft recording methods, private permission callback, host lifecycle callbacks and cancellation worker barrier. SpeechRequestGate, LocalVoiceRecording and the serial ThreadPoolExecutor execute their actual implementation.',
   'Two recording requests, two cancellation waiters and two successful starts bound the campaign. Exact permission epochs and waiter ownership are observed. Record and cancel main-queue tasks execute through their actual captured closures.',
   'Audio mode and permission state are primitive platform inputs. Live capture, physical audio output, inference and latency environment are explicitly unexercised ports.',
   'The synthetic live controller rejects every live acquisition. Its drain completes only the no-live-owner case; actual live-to-draft release and refusal remain outside this model.',
   'Protected-screen state is fixed inactive in this projection; production protected-surface guards remain present.',
   'A held real worker, rejected full queue and MediaRecorder release failure control interruption and cleanup schedules. An interrupted draft is unavailable while release is unresolved; the cancellation barrier can retry that release. Installed Android permission/call delivery and physical microphone state remain platform obligations.'
  ]});
 }finally{platform.close();rmSync(state,{recursive:true,force:true});}
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await checkSharedRecording(),null,2));
