import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInputs, checkTraces} from '../specs/quint/refinement/check-traces.mjs';
import {app, directory, javaTraces} from '../specs/quint/refinement/native/java.mjs';
import {noteRecordingPlatform} from '../specs/quint/refinement/native/note-recording-platform.mjs';

const noteRecordingScenarios=['pause','rollover','resume-recovered','rollover-journal-failure','text-journal-failure','join-failure',
  'start-journal-failure','start-open-failure','short-stop','capture-error','stale-callback','next-started','next-journal-failure','wrong-id','corrupt-journal','missing-segment','legacy-binding','text-edit-failure'];
async function checkNativeNoteRecording(extraSources=[]) {
 const platform=noteRecordingPlatform(),state=mkdtempSync(join(tmpdir(),'quint-note-state-'));
 const compiled=[app+'AlphaNoteRecorder.java',directory+'/NoteRecordingPorts.java',
  'node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/JSObject.java'];
 const sources=[...compiled,directory+'/NoteRecordingTraces.java',directory+'/note-recording-platform.mjs',directory+'/Trace.java',directory+'/java.mjs',fileURLToPath(import.meta.url),...extraSources];
 try {
  const driverHashes=captureInputs(sources);
  const traces=javaTraces('NoteRecordingTraces.java',[...compiled,...platform.paths],[state,'campaign',...noteRecordingScenarios]);
  return await checkTraces({model:'NativeNoteRecording',sources,driverHashes,traces,scope:'bounded-orchestration',assumptions:[
   'Actual AlphaNoteRecorder public methods and registered MediaRecorder/timer callbacks execute. Durable journal JSON and recording files are real temporary filesystem observations.',
   'Two finished segments, two recording/owner identities and four created MediaRecorder instances bound this campaign. The clock uses exact virtual milliseconds. Codec bytes are synthetic.',
   'Restart reconstructs a fresh actual recorder from journal bytes after clearing process-owned timers and releasing primitive capture resources. Physical power loss and Android media encoders remain platform obligations.',
   'JSObject executes from the real Capacitor source. JSArray is a primitive JSON container port because its generic toList signature conflicts with the host org.json version. Only construction and inherited put are used.'
  ]});
 } finally {platform.close();rmSync(state,{recursive:true,force:true});}
}

const noteServiceScenarios=['old-owner','old-start','old-toggle','blank-open','discard-blank','discard-exact','current-stop','recreated','pause-resume','notification-stop','paused-notification-stop','old-notification-stop','blank-notification-stop','foreground-refused','fallback-old-owner','fallback-blank','fallback-current','fallback-pending','same-id-stop','same-id-fallback','same-id-stopped-fallback'];
async function checkNoteRecordingService(extraSources=[]) {
 const platform=noteRecordingPlatform(),state=mkdtempSync(join(tmpdir(),'quint-note-service-state-'));
 const compiled=[app+'AlphaNoteRecorder.java',app+'AlphaNoteRecordingService.java',directory+'/NoteRecordingPorts.java',
  'node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/JSObject.java'];
 const sources=[...compiled,...platform.paths,directory+'/NoteRecordingServiceTraces.java',directory+'/note-recording-platform.mjs',directory+'/Trace.java',directory+'/java.mjs',fileURLToPath(import.meta.url),...extraSources];
 try {
  const driverHashes=captureInputs(sources);
  const traces=javaTraces('NoteRecordingServiceTraces.java',[...compiled,...platform.paths],[state,'campaign',...noteServiceScenarios]);
  return await checkTraces({model:'NativeNoteRecordingService',sources,driverHashes,generatedSources:platform.paths,traces,scope:'bounded-orchestration',assumptions:[
   'Actual AlphaNoteRecorder and AlphaNoteRecordingService run with real temporary journal files and the real Capacitor JSObject null semantics.',
   'Android service commands and notifications are controlled primitive ports. MediaRecorder produces synthetic bytes; no microphone, audio codec or device notification is used.',
   'The service PendingIntent port keys component, action and API29 identifier, excluding extras; UPDATE_CURRENT replaces extras even for immutable tokens. Installed Binder identity and notification delivery remain external.',
   'Two recording-ID equality classes and serialized Android main-thread service callbacks bound ownership. Device process death and OS foreground eligibility remain platform obligations.'
  ]});
 } finally {platform.close();rmSync(state,{recursive:true,force:true});}
}

const sources=['test/quint-native-recording.test.mjs'];
test('actual native recorder preserves segmented journal and restart state', {timeout:300000}, async()=>{
  const receipt=await checkNativeNoteRecording(sources);
  assert.equal(receipt.passed,true);
  assert.equal(receipt.traces,noteRecordingScenarios.length);
  assert.equal(receipt.driverInputsBound,true);
  assert.equal(receipt.inputsUnchanged,true);
});
test('actual recording service preserves exact foreground owner', {timeout:300000}, async()=>{
  const receipt=await checkNoteRecordingService(sources);
  assert.equal(receipt.passed,true);
  assert.equal(receipt.traces,noteServiceScenarios.length);
  assert.equal(receipt.driverInputsBound,true);
  assert.equal(receipt.inputsUnchanged,true);
});
