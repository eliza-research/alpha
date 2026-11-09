import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { loadBrowserModule } from './fixtures/browser-source.mjs';

const { startVoiceMicCapture } = await loadBrowserModule(
  '.eliza/client-features/packages/ui/src/voice/voice-session-mic-capture.ts',
);

function fixture({ initialState = 'running', endsOnSubscribe = false } = {}) {
  let hidden = false;
  let onVisibility;
  let resumes = 0;
  let stops = 0;
  let closes = 0;
  const errors = [];
  const frames = [];
  const node = { connect() { return node; }, disconnect() {} };
  const processor = { ...node, onaudioprocess: null };
  const audioEvents = new EventTarget();
  const trackEvents = new EventTarget();
  const audio = {
    state: initialState,
    sampleRate: 16_000,
    destination: node,
    createMediaStreamSource: () => node,
    createScriptProcessor: () => processor,
    addEventListener: (...args) => audioEvents.addEventListener(...args),
    removeEventListener: (...args) => audioEvents.removeEventListener(...args),
    async suspend() { this.state = 'suspended'; },
    async resume() { this.state = 'running'; },
    async close() { this.state = 'closed'; closes++; },
  };
  const track = {
    enabled: true,
    readyState: 'live',
    addEventListener(name, listener) {
      trackEvents.addEventListener(name, listener);
      if (endsOnSubscribe) endTrack();
    },
    removeEventListener: (...args) => trackEvents.removeEventListener(...args),
    stop() { this.readyState = 'ended'; stops++; },
  };

  function endTrack() {
    track.readyState = 'ended';
    trackEvents.dispatchEvent(new Event('ended'));
  }

  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const start = () => startVoiceMicCapture({
    getUserMedia: async () => stream,
    createAudioContext: () => audio,
    onFrame: frame => frames.push(frame),
    onError: error => errors.push(error),
    onResume: () => resumes++,
    visibility: {
      isHidden: () => hidden,
      addListener: listener => { onVisibility = listener; },
      removeListener: () => { onVisibility = undefined; },
    },
  });

  return {
    start, audio, track, processor, errors, frames, endTrack,
    get stops() { return stops; },
    get closes() { return closes; },
    get resumes() { return resumes; },
    get observesVisibility() { return Boolean(onVisibility); },
    setHidden(value) {
      hidden = value;
      onVisibility?.();
    },
    feedAudio() {
      processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array(1600) } });
    },
  };
}

test('a fulfilled resume that leaves the graph suspended refuses startup', async () => {
  const h = fixture({ initialState: 'suspended' });
  h.audio.resume = async () => {};
  await assert.rejects(h.start(), { code: 'start_failed' });
  assert.equal(h.stops, 1);
  assert.equal(h.closes, 1);
});

test('a rejected foreground resume retires capture and reports the failure', async () => {
  const h = fixture();
  const mic = await h.start();
  h.setHidden(true);
  h.audio.resume = async () => { throw Error('foreground resume denied'); };
  h.setHidden(false);
  await setImmediate();

  assert.equal(mic.active, false);
  assert.equal(h.resumes, 0);
  assert.equal(h.errors.length, 1);
  assert.equal(h.stops, 1);
});

test('foregrounding resumes delivery of actual PCM frames', async () => {
  const h = fixture();
  const mic = await h.start();
  try {
    h.setHidden(true);
    h.feedAudio();
    assert.equal(h.frames.length, 0);

    h.setHidden(false);
    await setImmediate();
    h.feedAudio();
    assert.equal(h.resumes, 1);
    assert.deepEqual(h.frames.map(frame => frame.byteLength), [3200]);
  } finally {
    await mic.stop();
  }
});

test('a resume completing after Stop cannot publish readiness', async () => {
  const h = fixture();
  const mic = await h.start();
  h.setHidden(true);
  const resume = Promise.withResolvers();
  h.audio.resume = () => resume.promise;
  h.setHidden(false);
  await mic.stop();
  resume.resolve();
  await setImmediate();

  assert.equal(h.resumes, 0);
  assert.equal(mic.active, false);
});

test('Mute keeps capture active and Stop retires it without reporting an error', async () => {
  const h = fixture();
  const mic = await h.start();
  mic.setMuted(true);
  assert.equal(h.track.enabled, false);
  assert.equal(mic.active, true);
  mic.setMuted(false);
  assert.equal(h.track.enabled, true);
  await mic.stop();

  h.endTrack();
  await setImmediate();
  assert.equal(h.errors.length, 0);
  assert.equal(h.observesVisibility, false);
  assert.equal(h.processor.onaudioprocess, null);
  assert.equal(h.stops, 1);
});

test('a track ending during listener attachment aborts startup and releases resources', async () => {
  const h = fixture({ endsOnSubscribe: true });
  await assert.rejects(h.start(), /ended during startup/);

  h.endTrack();
  assert.equal(h.observesVisibility, false);
  assert.equal(h.stops, 1);
  assert.equal(h.closes, 1);
  assert.equal(h.errors.length, 0);
});
