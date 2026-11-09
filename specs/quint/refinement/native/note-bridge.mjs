import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInputs,checkTraces} from '../check-traces.mjs';
import {app,directory,javaTraces} from './java.mjs';
import {noteBridgePlatform} from './note-bridge-platform.mjs';
import {readFileSync} from 'node:fs';
import {preparePatchedNative} from '../../../../scripts/prepare-patched-native.mjs';
const native = preparePatchedNative();
const nativePatchInputs = ['android/upstream-native-sources.json', 'scripts/prepare-patched-native.mjs',
 join(native.root, '.source.json'), ...JSON.parse(readFileSync('android/upstream-native-sources.json', 'utf8')).patches.map(row => 'patches/eliza/' + row.file)];

export const notePermissionScenarios=['direct','direct-call','permission-denied','permission-granted','permission-call',
 'permission-closed','permission-paused','queued-call','queued-paused','queued-closed','paused-resumed','start-failure',
 'resume-empty','resume-recording','resume-paused','resume-retired','resume-queued-call','resume-direct-call','resume-stopped',
 'resume-failure','second-start','discard-retry'];

function sourceFiles(platform){
 return [app+'AlphaVoiceCloudPlugin.java',app+'AlphaNoteRecorder.java',app+'AlphaNoteRecordingService.java',app+'CloudVoiceLimit.java',
  join(native.root, 'plugins/plugin-local-inference/native/android/src/main/java/ai/eliza/voice/LocalVoiceRecording.java'),join(native.root, 'plugins/plugin-local-inference/native/android/speech-bridge/src/main/java/ai/eliza/voice/CloudSpeechTimings.java'),directory+'/NoteBridgePorts.java',directory+'/NoteRecordingPorts.java',
  'node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/JSObject.java',...platform.paths];
}
export function probeNoteBridge(mode){
 const platform=noteBridgePlatform(),state=mkdtempSync(join(tmpdir(),'quint-note-bridge-'));
 try{return javaTraces('NoteBridgeSourceProbe.java',sourceFiles(platform),[state,mode||'resume-closed']);}
 finally{platform.close();rmSync(state,{recursive:true,force:true});}
}
export async function checkNotePermission(extraSources=[]){
 const platform=noteBridgePlatform(),state=mkdtempSync(join(tmpdir(),'quint-note-permission-'));
 const compiled=sourceFiles(platform);
 const sources=[...compiled,...nativePatchInputs,directory+'/NotePermissionTraces.java',directory+'/note-bridge-platform.mjs',
  directory+'/note-recording-platform.mjs',directory+'/Trace.java',directory+'/java.mjs',
  fileURLToPath(import.meta.url),...extraSources];
 try{
  const driverHashes=captureInputs(sources);
  const traces=javaTraces('NotePermissionTraces.java',compiled,[state,'campaign',...notePermissionScenarios]);
  return await checkTraces({model:'NativeNotePermission',sources,driverHashes,generatedSources:platform.paths,traces,scope:'bounded-orchestration',assumptions:[
   'The complete AlphaVoiceCloudPlugin executes its Notes recording methods, private permission callback, and product lifecycle overrides. The real AlphaNoteRecorder and staged shared LocalVoiceRecording execute under primitive Android ports.',
   'The shared parent lifecycle/permission interface is a controlled port. This receipt establishes the product Notes methods conditionally on those inputs; it does not execute the shared LocalSpeechBridgePlugin implementation.',
   'One pending Notes request, two successful recorder starts, and serialized main-queue callbacks bound the campaign. Recorder identity, segmented durability and service ownership have separate source receipts.',
   'Physical microphone consent enforcement, audio mode delivery and installed Android foreground eligibility require platform acceptance.'
  ]});
 }finally{platform.close();rmSync(state,{recursive:true,force:true});}
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await checkNotePermission(),null,2));
