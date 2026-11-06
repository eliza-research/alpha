// Notes voice recorder (design/view-refresh-2026-11 PLAN.md section 3; spec
// artifacts/review-2026-11/specs/notes-view, Design.cfg: FixUnlimited, FixSegments, FixStreamAsr).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const {NoteRecorderSession, formatRecordingClock, noteRecorderError} = await import('../apps/app/src/prototype/note-recorder.ts');
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const native = path => read(`android/app/src/main/java/ai/elizaresearch/alphaphone/${path}`);
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const settle = async () => { for (let i = 0; i < 20; i++) await tick(); };

/** A recorder like AlphaNoteRecorder: finished segments, pause/resume, stop, repeatable save. */
function fakeDriver() {
  const id = '11111111-2222-4333-8444-555555555555';
  const state = {status: {state: 'idle'}, listeners: new Set(), texts: {}, saves: [], discarded: 0};
  const emit = () => { for (const listener of state.listeners) listener(structuredClone(state.status)); };
  const segments = () => state.status.segments || [];
  const driver = {
    state,
    async start() { state.status = {state: 'recording', recordingId: id, durationMs: 0, segments: [], peak: 0.5}; return structuredClone(state.status); },
    async status() { return structuredClone(state.status); },
    async pause(rid) { assert.equal(rid, id); state.status = {...state.status, state: 'paused', peak: 0}; return structuredClone(state.status); },
    async resume(rid) { assert.equal(rid, id); state.status = {...state.status, state: 'recording', stopReason: undefined}; return structuredClone(state.status); },
    async stop(rid) { assert.equal(rid, id); state.status = {...state.status, state: 'stopped', stopReason: 'user'}; return structuredClone(state.status); },
    async discard(rid) { if (rid === id) { state.discarded++; state.status = {state: 'idle'}; } return structuredClone(state.status); },
    async setText(rid, segmentId, text) { state.texts[segmentId] = text; },
    async save(input) { state.saves.push(input); return {audioId: input.recordingId, noteId: input.noteId, durationMs: state.status.durationMs, transcript: input.transcript}; },
    async listen(callback) { state.listeners.add(callback); return {remove() { state.listeners.delete(callback); }}; },
    /** One more finished segment (the recorder rolled over to the next file). */
    segment(durationMs = 25_000) { const list = segments(); state.status = {...state.status, durationMs: (state.status.durationMs || 0) + durationMs, segments: [...list, {segmentId: `${id}-s${list.length}`, durationMs}]}; emit(); },
    stopWith(reason) { state.status = {...state.status, state: 'stopped', stopReason: reason}; emit(); },
    id,
  };
  return driver;
}
const session = (driver, transcriber) => {
  const route = transcriber ?? (async segmentId => `text ${segmentId.slice(-2)}`);
  return new NoteRecorderSession(driver, async () => route, () => {}, {pollMs: 60_000});
};

test('a recording has no length limit: only Done, Discard, storage or an error end it', async () => {
  const driver = fakeDriver(), s = session(driver);
  await s.begin();
  assert.equal(s.phase, 'recording');
  // Two hours of 25 s segments: the session never stops on its own.
  for (let i = 0; i < 288; i++) driver.segment();
  await settle();
  assert.equal(s.phase, 'recording');
  assert.equal(formatRecordingClock(s.durationMs), '2:00:00');
  driver.stopWith('storage');
  assert.equal(s.phase, 'stopped');
  assert.equal(s.error, noteRecorderError('storage'));
  assert.equal(s.error, 'Storage is full.');
  s.close();
});

test('finished segments are transcribed in order while recording, and journaled with the segment', async () => {
  const driver = fakeDriver(), order = [];
  const s = session(driver, async segmentId => { order.push(segmentId); return `part ${order.length}`; });
  await s.begin();
  driver.segment(); driver.segment(); driver.segment();
  await settle();
  assert.equal(s.phase, 'recording', 'transcription does not wait for Stop');
  assert.deepEqual(order, [`${driver.id}-s0`, `${driver.id}-s1`, `${driver.id}-s2`]);
  assert.equal(s.transcript(), 'part 1 part 2 part 3');
  assert.deepEqual(Object.values(driver.state.texts), ['part 1', 'part 2', 'part 3']);
  s.close();
});

test('the transcript is a prefix of the audio: a later segment never shows before an earlier one', async () => {
  const driver = fakeDriver();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const s = session(driver, async segmentId => { if (segmentId.endsWith('-s0')) await gate; return segmentId.slice(-2); });
  await s.begin();
  driver.segment(); driver.segment();
  await settle();
  assert.equal(s.transcript(), '', 'segment 1 waits for segment 0');
  release();
  await settle();
  assert.equal(s.transcript(), 's0 s1');
  s.close();
});

test('pause and resume keep the same recording; the waveform follows native peaks', async () => {
  const driver = fakeDriver(), s = session(driver);
  await s.begin();
  driver.state.status.peak = 0.8; driver.segment();
  assert.ok(s.levels.length >= 1 && s.levels.at(-1) === 0.8);
  await s.togglePause();
  assert.equal(s.phase, 'paused');
  await s.togglePause();
  assert.equal(s.phase, 'recording');
  assert.equal(s.recordingId, driver.id);
  s.close();
});

test('Done stops, catches the transcript up, saves one voice note and only then discards the segments', async () => {
  const driver = fakeDriver(), s = session(driver), persisted = [];
  await s.begin();
  driver.segment(); driver.segment(10_000);
  const saved = await s.finish(async (audio, transcript) => { persisted.push({audio, transcript}); assert.equal(driver.state.discarded, 0, 'segments kept until the note is saved'); return true; });
  assert.equal(saved, true);
  assert.equal(driver.state.saves.length, 1);
  assert.equal(persisted[0].transcript, 'text s0 text s1');
  assert.equal(persisted[0].audio.audioId, driver.id);
  assert.equal(persisted[0].audio.durationMs, 35_000);
  await settle();
  assert.equal(driver.state.discarded, 1);
  assert.equal(s.phase, 'closed');
});

test('a failed note save keeps the recording so Done can be retried into the same note', async () => {
  const driver = fakeDriver(), s = session(driver);
  await s.begin();
  driver.segment();
  assert.equal(await s.finish(async () => false), false);
  assert.equal(s.phase, 'stopped');
  assert.equal(s.error, noteRecorderError('save'));
  assert.equal(driver.state.discarded, 0);
  assert.equal(await s.finish(async () => true), true);
  assert.equal(driver.state.saves.length, 2);
  assert.equal(driver.state.saves[0].noteId, driver.state.saves[1].noteId);
});

test('Discard asks once for a recording longer than a second, then deletes every segment', async () => {
  const driver = fakeDriver(), s = session(driver);
  await s.begin();
  driver.segment();
  await s.discard();
  assert.equal(s.confirmingDiscard, true);
  assert.equal(driver.state.discarded, 0);
  s.keep();
  assert.equal(s.confirmingDiscard, false);
  await s.discard(true);
  assert.equal(driver.state.discarded, 1);
  assert.equal(s.phase, 'closed');
});

test('a recording left by a crash comes back with its finished segments and journaled text', async () => {
  const driver = fakeDriver();
  driver.state.status = {state: 'paused', recordingId: driver.id, recovered: true, durationMs: 50_000, segments: [{segmentId: `${driver.id}-s0`, durationMs: 25_000, text: 'kept'}, {segmentId: `${driver.id}-s1`, durationMs: 25_000}]};
  const calls = [];
  const s = session(driver, async segmentId => { calls.push(segmentId); return 'after'; });
  assert.equal(await s.adopt(), true);
  await settle();
  assert.equal(s.phase, 'paused');
  assert.deepEqual(calls, [`${driver.id}-s1`], 'journaled text is not transcribed again');
  assert.equal(s.transcript(), 'kept after');
  s.close();
});

test('a transcription failure keeps recording and the audio, with one short line', async () => {
  const driver = fakeDriver(), s = session(driver, async () => { throw new Error('route down'); });
  await s.begin();
  driver.segment();
  await settle();
  assert.equal(s.phase, 'recording');
  assert.equal(s.error, 'Transcription stopped. The audio is kept.');
  s.close();
});

test('a microphone that does not start leaves the recorder open with one line and a retry', async () => {
  const driver = fakeDriver();
  let refuse = true;
  const start = driver.start;
  driver.start = async () => { if (refuse) throw Object.assign(new Error('Microphone permission denied'), {code: 'permission-denied'}); return start(); };
  const s = session(driver);
  await assert.rejects(s.begin());
  assert.equal(s.phase, 'failed');
  assert.equal(s.error, 'Allow the microphone in Settings.');
  refuse = false;
  await s.togglePause();
  assert.equal(s.phase, 'recording');
  s.close();
});

test('the renderer and native recorder carry no duration cap and no status narration for Notes', () => {
  const adapter = read('apps/app/src/prototype/voice-adapter.ts');
  assert.doesNotMatch(adapter, /Record up to \d+ seconds/);
  assert.doesNotMatch(adapter, /Waveform levels are unavailable/);
  const recorder = native('AlphaNoteRecorder.java');
  assert.match(recorder, /setNextOutputFile/, 'segments roll over without a gap');
  assert.match(recorder, /static final long SEGMENT_MS=(\d+)_?(\d+)?;/);
  const segmentMs = Number(recorder.match(/static final long SEGMENT_MS=([\d_]+);/)[1].replaceAll('_', ''));
  assert.ok(segmentMs < 30_000, 'every segment fits the on-device 30 s window and the 60 s request bound');
  assert.doesNotMatch(recorder, /setMaxDuration\(/);
  assert.match(recorder, /MIN_FREE_BYTES/, 'low storage ends a recording, keeping finished segments');
  const plugin = native('AlphaVoiceCloudPlugin.java');
  assert.match(plugin, /@PluginMethod public void startNoteRecording/);
  assert.match(plugin, /AlphaNoteRecordingService\.start/);
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  assert.match(manifest, /AlphaNoteRecordingService" android:exported="false" android:foregroundServiceType="microphone"/);
  assert.match(manifest, /FOREGROUND_SERVICE_MICROPHONE/);
  const store = native('AlphaNoteAudioPlugin.java');
  assert.match(store, /JSObject retainNoteRecording\(/, 'a Notes recording is retained without the 4 MiB clip bound');
});

test('a Cloud route without an account records anyway and asks for sign-in once', async () => {
  const driver = fakeDriver();
  const s = new NoteRecorderSession(driver, async () => { throw Object.assign(new Error('no account'), {code: 'sign-in'}); }, () => {}, {pollMs: 60_000});
  await s.begin();
  driver.segment();
  await settle();
  assert.equal(s.phase, 'recording');
  assert.equal(s.error, 'Sign in to transcribe. The audio is kept.');
  assert.equal(await s.finish(async (audio, transcript) => transcript === '' && audio.audioId === driver.id), true, 'saved with its audio only');
});

/** A live transcription stream like openNativeLiveStream: speech start, interim words, finals. */
function fakeLive() {
  const live = {opened: 0, closed: 0, handlers: null, port: async handlers => { live.opened++; live.handlers = handlers; return {close() { live.closed++; live.handlers = null; }}; }};
  return live;
}
const liveSession = (driver, live, transcriber) => new NoteRecorderSession(driver, async () => transcriber ?? (async () => 'committed words'), () => {}, {pollMs: 60_000, live: live.port});

test('live words show while recording and drop out once a transcribed segment covers them; only segment text is saved', async () => {
  const driver = fakeDriver(), live = fakeLive();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const s = liveSession(driver, live, async () => { await gate; return 'hello there general'; });
  await s.begin(); await settle();
  assert.equal(live.opened, 1, 'the live stream opens with the recording');
  live.handlers.speechStart(); live.handlers.interim('hello');
  assert.equal(s.displayTranscript(), 'hello', 'a word appears before any segment finishes');
  live.handlers.interim('hello there');
  assert.equal(s.displayTranscript(), 'hello there');
  live.handlers.final('hello there general');
  assert.equal(s.displayTranscript(), 'hello there general');
  assert.equal(s.transcript(), '', 'live text is never the committed transcript');
  // The segment holding that speech finishes; until it is transcribed the live words stay.
  driver.segment(); await settle();
  assert.equal(s.displayTranscript(), 'hello there general');
  // Speech in the next segment, then the first segment's transcript commits.
  live.handlers.speechStart(); live.handlers.interim('kenobi');
  release(); await settle();
  assert.equal(s.transcript(), 'hello there general');
  assert.equal(s.displayTranscript(), 'hello there general kenobi', 'covered live words are replaced by the segment text, newer ones stay');
  assert.deepEqual(Object.values(driver.state.texts), ['hello there general'], 'only segment text is journaled');
  live.handlers.final('kenobi');
  assert.ok(await s.finish(async () => true));
  assert.equal(driver.state.saves.at(-1).transcript, 'hello there general', 'the saved transcript is the committed prefix of the audio');
  assert.equal(live.closed, 1, 'Done closes the live stream');
});

test('the live stream follows pause and resume, is not reopened after it is lost until the next resume, and is optional', async () => {
  const driver = fakeDriver(), live = fakeLive(), s = liveSession(driver, live);
  await s.begin(); await settle();
  assert.equal(live.opened, 1);
  await s.pause(); await settle();
  assert.equal(live.closed, 1, 'paused: the microphone is only the recorder');
  await s.resume(); await settle();
  assert.equal(live.opened, 2);
  live.handlers.lost();
  driver.segment(); await settle();
  assert.equal(live.opened, 2, 'a lost stream is not reopened on every status');
  assert.equal(s.phase, 'recording', 'losing live words never stops the recording');
  await s.pause(); await s.resume(); await settle();
  assert.equal(live.opened, 3);
  s.close(); await settle();
  assert.equal(live.closed, 2);
  // No live route (browser, or no on-device ASR): the recorder works as before.
  const none = new NoteRecorderSession(fakeDriver(), async () => async () => 'x', () => {}, {pollMs: 60_000, live: async () => null});
  await none.begin(); await settle();
  assert.equal(none.phase, 'recording');
  assert.equal(none.displayTranscript(), '');
  none.close();
});
