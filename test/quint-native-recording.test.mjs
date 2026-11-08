import test from 'node:test';
import assert from 'node:assert/strict';
import {checkNativeNoteRecording,noteRecordingScenarios} from '../specs/quint/refinement/native/note-recording.mjs';
import {checkNoteRecordingService,noteServiceScenarios} from '../specs/quint/refinement/native/note-recording-service.mjs';

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
