import assert from 'node:assert/strict';

const noteId = 'notes-media-fixture-note';
const audioId = 'notes-media-fixture-audio';
export const noteMediaRecord = {
  id: noteId, title: 'Synthetic recording', body: '', color: 'yellow',
  createdAt: '2026-11-08T12:00:00.000Z', updatedAt: '2026-11-08T12:00:00.000Z',
  format: {kind: 'voice', data: {recordingId: audioId, audio: {audioId, durationMs: 1000}}},
};

async function installPorts({audioId, noteId}) {
  const {retainAudio} = await import('/src/browser/note-audio-store.ts');
  const {BrowserVoice} = await import('/src/browser/voice.ts');
  const {BrowserAudioCapture} = await import('/src/browser/audio-capture.ts');
  const {notesRecorderControl} = await import('/src/prototype/notes-recorder-control.ts');
  const {NoteRecorderSession} = await import('/src/prototype/note-recorder.ts');
  const {connectionController} = await import('/src/runtime/connection-ui.tsx');
  const shell = window.quintMountedCalendar;
  const events = [];
  let playback = 'idle', releaseStop, control = 'idle', controlAttempt = 0, forbidden = 0;
  let session, lastDrain = 0;
  const attempts = [], captures = [];
  const observed = new WeakSet();
  const begin = NoteRecorderSession.prototype.begin;
  NoteRecorderSession.prototype.begin = function () {
    const prepare = this.options.prepareCapture;
    if (prepare && !observed.has(this)) {
      observed.add(this);
      this.options.prepareCapture = () => {
        lastDrain = attempts.indexOf(this.epoch) + 1;
        events.push('drain-await');
        return prepare();
      };
    }
    const pending = begin.call(this);
    session = this;
    if (this.phase === 'starting' && attempts.at(-1) !== this.epoch) attempts.push(this.epoch);
    return pending;
  };
  // The real store and audio-selection logic see only a local synthetic blob.
  await retainAudio(audioId, noteId, '', {blob: new Blob(['synthetic'], {type: 'audio/wav'}), durationMs: 1000});
  navigator.mediaDevices.getUserMedia = async () => {
    forbidden++;
    throw Error('Physical media is closed');
  };
  HTMLMediaElement.prototype.play = async function () {
    Object.defineProperty(this, 'paused', {configurable: true, value: false});
    playback = 'playing';
    events.push('play');
  };
  HTMLMediaElement.prototype.pause = function () {
    Object.defineProperty(this, 'paused', {configurable: true, value: true});
  };
  const stop = BrowserVoice.prototype.stop;
  BrowserVoice.prototype.stop = async function () {
    playback = 'stopping';
    events.push('stop-request');
    await new Promise((resolve, reject) => {releaseStop = failure => failure ? reject(Error('Synthetic stop refusal')) : resolve();});
    await stop.call(this);
    playback = 'stopped';
    events.push('stop-confirmed');
  };
  BrowserAudioCapture.prototype.start = async function () {
    events.push('capture-start');
    captures.push({attempt: attempts.indexOf(session.epoch) + 1, playback});
    return {recordingId: crypto.randomUUID(), maxDurationMs: Infinity};
  };
  BrowserAudioCapture.prototype.elapsed = () => 0;
  BrowserAudioCapture.prototype.metrics = recordingId => ({recordingId, peak: 0});
  BrowserAudioCapture.prototype.pause = () => {};
  BrowserAudioCapture.prototype.cancel = () => {};
  window.quintNotesMedia = {
    invokeControl() {
      control = 'pending';
      const pending = notesRecorderControl().start();
      controlAttempt = attempts.length;
      void pending.then(result => {control = result;});
    },
    release(failure = false) {
      if (!releaseStop) throw Error('No saved audio stop is pending');
      const release = releaseStop;
      releaseStop = undefined;
      if (failure) {
        playback = 'unconfirmed';
        events.push('stop-refused');
      }
      release(failure);
    },
    snapshot: () => {
      const panel = document.querySelector('[data-alpha-subview="notes-recorder"]');
      return {view: shell.S().view || 'home', owner: connectionController.getAppRecordClient().identity.ownerId,
        playback, control, controlAttempt, forbidden, recorder: panel?.getAttribute('data-recorder-state') || 'closed',
        message: panel?.querySelector('[role="alert"]')?.textContent || '',
        attempts: attempts.length, active: session?.phase === 'starting' ? attempts.indexOf(session.epoch) + 1 : 0,
        drains: events.filter(event => event === 'drain-await').length, lastDrain,
        captures: captures.length, lastCapture: captures.at(-1)?.attempt || 0,
        unconfirmedCapture: captures.some(capture => !['idle', 'stopped'].includes(capture.playback)), events: [...events]};
    },
  };
}

export async function mountNotesRecorderMedia(f) {
  const {page} = f;
  await page.evaluate(installPorts, {audioId, noteId});
  const snapshot = () => page.evaluate(() => window.quintNotesMedia.snapshot());
  const wait = (field, value) => page.waitForFunction(({field, value}) =>
    window.quintNotesMedia.snapshot()[field] === value, {field, value});
  return {snapshot, wait,
    openNotes: () => f.button('Notes').click(),
    leaveNotes: () => page.evaluate(() => window.dispatchEvent(new Event('launcher-home'))),
    switchOwner: () => f.invoke('switchPort', 'owner-b', 'session-b'),
    async waitForAttempt(count = 1) {
      await page.waitForFunction(count => {
        const state = window.quintNotesMedia.snapshot();
        return state.drains >= count || state.captures >= count;
      }, count);
    },
    async play() {
      await f.button('Open Synthetic recording').click();
      await f.button('Play recording').click();
      await wait('playback', 'playing');
    },
    async closeRecording() {
      await f.button('Back to notes').click();
      await wait('playback', 'stopping');
    },
    async start(entry) {
      if (entry === 'button') await f.button('Record voice note').click();
      else if (entry === 'control') await page.evaluate(() => window.quintNotesMedia.invokeControl());
      else assert.fail('Unexpected recorder entry ' + entry);
    },
    release: failure => page.evaluate(failure => window.quintNotesMedia.release(failure), failure),
  };
}
