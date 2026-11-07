// Actual segmented Notes renderer and Cloud speech driver, with in-memory native ports.
import assert from 'node:assert/strict';
import {cloudVoiceViewFixture} from '../test/fixtures/cloud-voice-view.mjs';

async function until(check) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  assert.ok(check(), 'Synthetic Notes recorder did not settle');
}

const recordingId = '11111111-2222-4333-8444-555555555555';
const segmentId = recordingId + '-s0';
let recording = {state:'idle'};
const noteRecording = driver => ({
  async startNoteRecording(binding) {
    recording = {state:'recording', recordingId, binding, durationMs:1000, segments:[{segmentId,durationMs:1000}]};
    return structuredClone(recording);
  },
  async noteRecordingStatus() { return structuredClone(recording); },
  async stopNoteRecording(input) {
    assert.equal(input.recordingId, recordingId);
    recording.state = 'stopped';
    return structuredClone(recording);
  },
  async setNoteSegmentText(input) {
    assert.equal(input.recordingId, recordingId);
    assert.equal(input.segmentId, segmentId);
    recording.segments[0].text = input.text;
  },
  saveNoteRecording: input => driver.saveRecording(input),
  async discardNoteRecording() { recording = {state:'idle'}; return recording; },
});
const f = cloudVoiceViewFixture({cloudProfile:true,noteRecording});
try {
  f.shell.openView('notes');
  f.render().record();
  await until(() => f.render().noteRecorder?.phase === 'recording');
  assert.equal(f.render().noteRecorder.doneLabel, 'Stop recording');
  assert.equal(f.uploads, 0);
  assert.equal(await f.notesRecorderControl.stop(), 'retained');
  assert.equal(recording.state, 'stopped');
  assert.equal(f.render().noteRecorder.transcribeLabel, 'Transcribe with Eliza Cloud');
  assert.equal(f.uploads, 0);
  assert.equal(f.shell.notes.list.length, 0);

  f.shell.failPersistence = true;
  f.render().noteRecorder.transcribe();
  await until(() => f.render().noteRecorder?.phase === 'stopped' && f.render().noteRecorder.error);
  assert.equal(f.uploads, 1);
  assert.equal(f.transcribeInput.recordingId, segmentId);
  assert.equal(f.render().noteRecorder.transcript, 'Synthetic Cloud transcript');
  assert.equal(f.render().noteRecorder.doneLabel, 'Done');
  assert.equal(f.shell.notes.list.length, 0);

  f.shell.failPersistence = false;
  f.render().noteRecorder.done();
  await until(() => f.shell.notes.list.length === 1);
  assert.equal(f.shell.notes.list[0].body, 'Synthetic Cloud transcript');
  assert.equal(f.shell.notes.list[0].audio.transcript, 'Synthetic Cloud transcript');
  assert.equal(f.uploads, 1, 'Retrying a local save must send no additional audio');
  assert.equal(f.sends, 0);
} finally {
  f.close();
}
console.log('PASS Notes Cloud transcription requires a named choice after Stop and retries only local save.');
