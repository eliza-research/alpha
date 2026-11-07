// Product recorder/Cloud-driver code with in-memory ports. No microphone, provider or playback.
import assert from 'node:assert/strict';
import {cloudVoiceViewFixture} from '../test/fixtures/cloud-voice-view.mjs';

const until = async check => {
  for (let count = 0; count < 200; count++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  assert.ok(check(), 'Synthetic recorder did not settle');
};

// Notes starts only on Record. Finished segments use the explicitly selected Cloud route.
// A failed note commit retains both the audio and transcript for a retry into the same note.
const cloud = cloudVoiceViewFixture({notes: true});
try {
  cloud.box.testMocksEnabled = true;
  cloud.shell.openView('notes');
  assert.equal(cloud.uploads, 0);
  cloud.render().record();
  await until(() => cloud.render().noteRecorder?.phase === 'recording');
  assert.equal(cloud.starts, 1);
  assert.equal(cloud.uploads, 0);
  cloud.shell.failPersistence = true;
  cloud.render().noteRecorder.done();
  await until(() => cloud.render().noteRecorder?.phase === 'stopped');
  assert.equal(cloud.uploads, 1);
  assert.equal(cloud.render().noteRecorder.transcript, 'Synthetic Cloud transcript');
  assert.equal(cloud.shell.notes.list.length, 0);
  assert.equal(cloud.recordingCancels.length, 0);
  cloud.shell.failPersistence = false;
  cloud.render().noteRecorder.done();
  await until(() => cloud.shell.notes.list.length === 1);
  assert.equal(cloud.shell.notes.list[0].body, 'Synthetic Cloud transcript');
  assert.equal(cloud.shell.notes.list[0].audio.transcript, 'Synthetic Cloud transcript');
  assert.equal(cloud.uploads, 1, 'retry reuses the journaled transcript');
  assert.equal(cloud.recordingCancels.length, 1, 'audio segments retire only after the note commit');
  assert.equal(cloud.sends, 0);
} finally {
  cloud.close();
}

// Without a Cloud account, Notes can retain audio locally. It performs no upload or chat send.
const signedOut = cloudVoiceViewFixture({notes: true, account: null});
try {
  signedOut.box.testMocksEnabled = true;
  signedOut.shell.openView('notes');
  signedOut.render().record();
  await until(() => signedOut.render().noteRecorder?.phase === 'recording');
  signedOut.render().noteRecorder.done();
  await until(() => signedOut.shell.notes.list.length === 1);
  assert.equal(signedOut.uploads, 0);
  assert.equal(signedOut.sends, 0);
  assert.equal(signedOut.shell.notes.list[0].body, '');
  assert.equal(signedOut.shell.notes.list[0].audio.durationMs, 1000);
} finally {
  signedOut.close();
}

// The retained dictation API edits an unsent chat draft. Notes editing uses the new recorder.
const dictation = cloudVoiceViewFixture({cloudProfile: true});
try {
  dictation.box.HTMLElement = class {};
  dictation.box.React = {createElement: () => null};
  dictation.box.VoiceActivity = () => null;
  dictation.box.nativeLiveVoiceReady = async () => false;
  dictation.shell.state.draft = 'Existing unsent text';
  dictation.shell.startTranscription();
  await until(() => dictation.renderChat()?.state === 'ready');
  assert.equal(dictation.uploads, 0);
  dictation.renderChat().stop();
  await until(() => dictation.renderChat()?.state === 'recording');
  assert.equal(dictation.uploads, 0);
  dictation.renderChat().stop();
  await until(() => dictation.renderChat()?.review && !dictation.renderChat().transcriptDisabled);
  assert.equal(dictation.uploads, 1);
  assert.equal(dictation.shell.state.draft, 'Existing unsent text');
  dictation.renderChat().onTranscript({target: {value: 'Edited owned transcript'}});
  dictation.renderChat().stop();
  await until(() => dictation.renderChat() === null);
  assert.equal(dictation.shell.state.draft, 'Existing unsent text\nEdited owned transcript');
  assert.equal(dictation.audioSaves, 0);
  assert.equal(dictation.sends, 0);
} finally {
  dictation.close();
}

// The explicit test-mocks manual route keeps authored text local and leaves Send to the user.
const manual = cloudVoiceViewFixture({account: null});
try {
  manual.box.testMocksEnabled = true;
  manual.box.HTMLElement = class {};
  manual.box.React = {createElement: () => null};
  manual.box.VoiceActivity = () => null;
  manual.box.createOnDeviceVoice = () => null;
  manual.shell.startTranscription();
  manual.renderChat().recordOnly();
  manual.renderChat().stop();
  await until(() => manual.renderChat()?.state === 'recording');
  manual.renderChat().stop();
  await until(() => manual.renderChat()?.review && !manual.renderChat().transcriptDisabled);
  manual.renderChat().onTranscript({target: {value: 'Explicit manual text'}});
  manual.renderChat().stop();
  await until(() => manual.renderChat() === null);
  assert.equal(manual.shell.state.draft, 'Explicit manual text');
  assert.equal(manual.uploads, 0);
  assert.equal(manual.sends, 0);
} finally {
  manual.close();
}
console.log('PASS recorder/Cloud protocol: explicit capture, failed-save retention, signed-out audio, reviewed and manual unsent dictation, and no automatic chat send. In-memory ports only.');
