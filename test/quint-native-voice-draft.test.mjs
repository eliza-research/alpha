import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInputs, checkTraces} from '../specs/quint/refinement/check-traces.mjs';
import {directory, javaTraces} from '../specs/quint/refinement/native/java.mjs';
import {noteRecordingPlatform} from '../specs/quint/refinement/native/note-recording-platform.mjs';
import {preparePatchedNative} from '../scripts/prepare-patched-native.ts';

const native = preparePatchedNative();
const nativePatchInputs = ['android/upstream-native-sources.json', 'scripts/prepare-patched-native.ts',
 join(native.root, '.source.json'), ...JSON.parse(readFileSync('android/upstream-native-sources.json', 'utf8')).patches.map(row => 'patches/eliza/' + row.file)];

const voiceDraftScenarios=['manual','long','cancel','discard-wrong','mic-error','deadline','limit-info','consumer-failure',
 'stale-callback','metrics','external','recreate','empty','oversized','max-bytes','stop-failure','auto-stop-failure','open-failure','invalid-limit','constructor-failure','interrupt-release','interrupt-release-failure'];
async function checkVoiceDraft(extraSources=[]) {
 const platform=noteRecordingPlatform(),state=mkdtempSync(join(tmpdir(),'quint-voice-draft-'));
 const compiled=[join(native.root, 'plugins/plugin-local-inference/native/android/src/main/java/ai/eliza/voice/LocalVoiceRecording.java'),directory+'/NoteRecordingPorts.java'];
 const sources=[...compiled,...nativePatchInputs,directory+'/VoiceDraftTraces.java',directory+'/note-recording-platform.mjs',directory+'/Trace.java',directory+'/java.mjs',fileURLToPath(import.meta.url),...extraSources];
 try {
  const driverHashes=captureInputs(sources);
  const traces=javaTraces('VoiceDraftTraces.java',[...compiled,...platform.paths],[state,'campaign',...voiceDraftScenarios]);
  return await checkTraces({model:'NativeVoiceDraft',sources,driverHashes,traces,scope:'bounded-orchestration',assumptions:[
   'The current staged LocalVoiceRecording executes through its public methods and real registered timer/media callbacks. Cache files are real temporary files.',
   'Two draft IDs and three recorder instances bound identity. The exact 29/59-second limits and zero/valid/oversized files use controlled Android media and clock ports.',
   'The callback consumer can throw after receiving a recorded event. The source then emits a failed event while retaining the finished audio. The model preserves both effects.',
   'Call interruption immediately retires the exact draft. The release failure leaves its unusable recorder for a later cleanup attempt, and stale timers and media callbacks remain ineffective.',
   'Physical AAC encoding and permission/foreground admission in LocalSpeechBridgePlugin remain separate obligations.'
  ]});
 } finally {platform.close();rmSync(state,{recursive:true,force:true});}
}

test('shared native voice draft refines callbacks, selection and failed start cleanup', {timeout:300000}, async()=>{
 const receipt=await checkVoiceDraft(['test/quint-native-voice-draft.test.mjs']);
 assert.equal(receipt.passed,true);
 assert.equal(receipt.traces,voiceDraftScenarios.length);
 assert.equal(receipt.driverInputsBound,true);
 assert.equal(receipt.inputsUnchanged,true);
});
