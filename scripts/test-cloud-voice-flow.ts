// Actual segmented Notes renderer and Cloud speech driver, with in-memory native ports.
import assert from 'node:assert/strict';
import type {CloudVoiceFixture} from './cloud-voice-fixture-types.ts';
import {cloudVoiceViewFixture as createCloudVoiceFixture} from '../test/fixtures/cloud-voice-view.mjs';
const cloudVoiceViewFixture=(options:Parameters<typeof createCloudVoiceFixture>[0]={})=>createCloudVoiceFixture(options) as unknown as CloudVoiceFixture;

async function until(check: any) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (check()) return;
    await new Promise((resolve: any) => setTimeout(resolve, 2));
  }
  assert.ok(check(), 'Synthetic Notes recorder did not settle');
}

const recordingId = '11111111-2222-4333-8444-555555555555';
const segmentId = recordingId + '-s0';
let recording:{state:string;recordingId?:string;binding?:unknown;durationMs?:number;segments?:{segmentId:string;durationMs:number;text?:string}[]} = {state:'idle'};
const noteRecording = (driver: any) => ({
  async startNoteRecording(binding: any) {
    recording = {state:'recording', recordingId, binding, durationMs:1000, segments:[{segmentId,durationMs:1000}]};
    return structuredClone(recording);
  },
  async noteRecordingStatus() { return structuredClone(recording); },
  async stopNoteRecording(input: any) {
    assert.equal(input.recordingId, recordingId);
    recording.state = 'stopped';
    return structuredClone(recording);
  },
  async setNoteSegmentText(input: any) {
    assert.equal(input.recordingId, recordingId);
    assert.equal(input.segmentId, segmentId);
    recording.segments![0].text = input.text;
  },
  saveNoteRecording: (input: any) => driver.saveRecording(input),
  async discardNoteRecording() { recording = {state:'idle'}; return recording; },
});
const f = cloudVoiceViewFixture({cloudProfile:true,noteRecording});
try {
  f.shell.openView('notes');
  f.render().record();
  await until(() => f.render().noteRecorder?.phase === 'recording');
  assert.equal(f.render().noteRecorder.doneLabel, 'Stop recording');
  assert.equal(f.uploads, 0);
  // Production Stop saves audio locally. A failed local commit keeps the stopped recording.
  f.shell.failPersistence = true;
  assert.equal(await f.notesRecorderControl.stop(), 'failed');
  assert.equal(recording.state, 'stopped');
  assert.equal(f.render().noteRecorder.phase, 'stopped');
  assert.equal(f.render().noteRecorder.doneLabel, 'Save recording');
  assert.equal(f.render().noteRecorder.transcribe, undefined);
  assert.equal(f.uploads, 0);
  assert.equal(f.localFactories, 0);
  assert.equal(f.shell.notes.list.length, 0);

  f.shell.failPersistence = false;
  f.render().noteRecorder.done();
  await until(() => f.shell.notes.list.length === 1);
  assert.equal(f.shell.notes.list[0].body, '');
  assert.equal(f.shell.notes.list[0].audio.transcript, '');
  assert.equal(f.shell.notes.list[0].audio.audioId, recordingId);
  assert.equal(recording.state, 'idle', 'Confirmed local save releases the recorder journal');
  assert.equal(f.uploads, 0, 'Stop and local retries never authorize Cloud transcription');
  assert.equal(f.sends, 0);
} finally {
  f.close();
}
// Keep the explicit remote-transcription contract covered separately from the audio-only renderer.
// This is the actual session and actual Cloud driver, not a removed recorder UI control.
const consentFixture = cloudVoiceViewFixture({cloudProfile:true,noteRecording});
let consent;
try {
  consent = new consentFixture.box.NoteRecorderSession(consentFixture.box.createNoteRecorderDriver(), async () => {
    const route = await consentFixture.box.noteSegmentTranscriber(new AbortController().signal, 'cloud');
    assert.ok(route);
    return route.transcribe;
  }, () => {}, {pollMs:60_000,remoteTranscription:()=>true,owner:()=>({identity:'explicit-transcription-fixture',folderId:null,current:()=>true})});
  await consent.begin();
  assert.equal(consentFixture.uploads, 0);
  assert.equal(await consent.finish(async () => assert.fail('Stop must precede remote transcription'), true, true), false);
  assert.equal(await consent.stop(), true);
  assert.equal(consent.needsTranscriptionConsent, true);
  assert.equal(await consent.finish(async () => assert.fail('Remote consent is required')), false);
  assert.equal(consentFixture.uploads, 0);
  assert.equal(await consent.finish(async () => false, true, true), false, 'Failed local persistence retains the approved transcript');
  assert.equal(consentFixture.uploads, 1);
  assert.equal(consentFixture.transcribeInput.recordingId, segmentId);
  assert.equal(consentFixture.transcribeInput.credentialId, 'cloud-credential');
  assert.equal(consent.transcript(), 'Synthetic Cloud transcript');
  assert.equal(consent.phase, 'stopped');
  let saved!:{audio:{transcript:string};transcript:string};
  assert.equal(await consent.finish(async (audio: any, transcript: any) => {saved={audio,transcript};return true;}), true);
  assert.equal(saved.transcript, 'Synthetic Cloud transcript');
  assert.equal(saved.audio.transcript, 'Synthetic Cloud transcript');
  assert.equal(consentFixture.uploads, 1, 'Retrying a local save must send no additional audio');
  assert.equal(consentFixture.sends, 0);
} finally {
  consent?.close();
  consentFixture.close();
}
console.log('PASS Notes Stop saves audio locally; explicit Cloud transcription still requires consent after Stop and retries only local save.');
