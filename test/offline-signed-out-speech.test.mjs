import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';

// Issue #397: speech is on-device with no network and no Eliza Cloud session. Real renderer sources
// evaluated with synthetic ports: routing and the speech bridge protocol only, not JNI or audio.
const offlineNetwork = () => {
  const attempts = [];
  const refuse = name => (...args) => { attempts.push([name, String(args[0] ?? '')]); throw new TypeError('Network is offline'); };
  return {attempts, fetch: refuse('fetch'), XMLHttpRequest: class { constructor() { attempts.push(['xhr', '']); throw new TypeError('Network is offline'); } }, WebSocket: class { constructor(url) { attempts.push(['websocket', url]); throw new TypeError('Network is offline'); } }, navigator: {onLine: false}};
};
const strip = (path, keep) => stripTypeScriptTypes(fs.readFileSync(path, 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, ''), {mode: 'transform'}) + `\nglobalThis.api={${keep}};`;

test('signed out and offline, every voice route request stays on this device', () => {
  const network = offlineNetwork(), bytes = new Map([['alphaphone:voice-route:v1', JSON.stringify({version: 1, route: 'cloud', disclosed: 'cloud-speech-uses-plan', chosenAt: 1})]]);
  const box = {
    ...network, cloudRuntimeEnabled: false, testMocksEnabled: false, browserDevProfile: false, Date, JSON, Number, Event: class { constructor(type) { this.type = type; } },
    localStorage: {getItem: key => bytes.get(key) ?? null, setItem: (key, value) => bytes.set(key, String(value)), removeItem: key => bytes.delete(key)},
    window: {dispatchEvent: () => true},
    // No Cloud environment, client or session: signed out.
    connectionController: {getCloudEnvironment: () => null, getCloudClient: () => null, getSnapshot: () => ({session: null, open: false})},
  };
  vm.runInNewContext(strip('apps/app/src/runtime/voice-selection.ts', 'selectVoiceRoute,voiceRoutePreference,cloudVoiceAvailable,chooseVoiceRoute'), box);
  const v = box.api;
  assert.equal(v.voiceRoutePreference(), 'device', 'a stored legacy Cloud choice reads as on-device');
  for (const requested of [undefined, 'default', 'device', 'agent', 'manual']) assert.equal(v.selectVoiceRoute(requested), 'device');
  assert.equal(v.cloudVoiceAvailable(), false);
  assert.equal(v.chooseVoiceRoute('cloud', {disclosed: 'cloud-speech-uses-plan'}), false);
  assert.deepEqual(network.attempts, []);
});

function nativeSpeech() {
  const f = {synthesized: [], plays: [], cancels: [], stops: [], listeners: new Map()};
  f.plugin = {
    addListener: async (event, callback) => { f.listeners.set(event, [...(f.listeners.get(event) ?? []), callback]); return {remove: async () => {}}; },
    // Streamed on-device synthesis (#397): resolves at the first chunk with a device execution.
    synthesizeLocal: async input => { f.synthesized.push(input); return {playbackId: `play-${f.synthesized.length}`, execution: 'device', streaming: true}; },
    play: async ({playbackId}) => { f.plays.push(playbackId); setTimeout(() => { for (const callback of f.listeners.get('playbackEnded') ?? []) callback({playbackId}); }, 1); },
    stopPlayback: async input => { f.stops.push(input); },
    cancel: async input => { f.cancels.push(input.requestId); },
  };
  return f;
}
function playbackSource(f, network, turn) {
  const box = {
    ...network, AbortController, DOMException, Error, Promise, Set, Array, Object, setTimeout, clearTimeout,
    crypto: {randomUUID: () => crypto.randomUUID()},
    Capacitor: {isNativePlatform: () => true},
    registerPlugin: name => { assert.equal(name, 'AlphaVoiceCloud'); return f.plugin; },
    planLocalSpeech: text => text.split(/(?<=\.)\s+/).filter(Boolean),
    nativeVoiceTurnId: () => turn,
  };
  vm.runInNewContext(strip('apps/app/src/local-speech-playback.ts', 'speakLocalText'), box);
  return box.api;
}

test('signed out and offline, a reply is synthesized and played on this device sentence by sentence', async () => {
  const network = offlineNetwork(), f = nativeSpeech(), turn = '7d3c1a52-6d5e-4e0f-9a43-5c1d2e3f4a5b';
  const {speakLocalText} = playbackSource(f, network, turn);
  let started = 0;
  await speakLocalText('It is sunny. Take a hat.', new AbortController().signal, () => started++, true, {execution: 'device', assertCurrent() {}});
  assert.deepEqual(f.synthesized.map(input => input.text), ['It is sunny.', 'Take a hat.']);
  assert.ok(f.synthesized.every(input => input.voiceTurnId === turn && input.replace === false), 'each sentence names its live latency turn');
  assert.deepEqual(f.plays, ['play-1', 'play-2']);
  assert.equal(started, 1);
  assert.deepEqual(network.attempts, [], 'no network request was attempted');
  // Outside a live turn nothing is attributed.
  const g = nativeSpeech();
  await playbackSource(g, network, undefined).speakLocalText('Plain read aloud.', new AbortController().signal);
  assert.equal('voiceTurnId' in g.synthesized[0], false);
});

test('a call stopping speech surfaces an honest status', async () => {
  const network = offlineNetwork(), f = nativeSpeech();
  f.plugin.play = async ({playbackId}) => { setTimeout(() => { for (const callback of f.listeners.get('playbackStopped') ?? []) callback({playbackId, reason: 'call-active'}); }, 1); };
  const {speakLocalText} = playbackSource(f, network, undefined);
  await assert.rejects(speakLocalText('Reply.', new AbortController().signal), /Speech stopped for a phone call\./);
  assert.deepEqual(network.attempts, []);
});

test('conversation stage marks reach the native collector with one linked turn id; Notes and failures never block a turn', async () => {
  const store = new Map();
  globalThis.localStorage = {getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k)};
  const timing = await import('../apps/app/src/runtime/voice-timing.ts');
  try {
    let clock = 0; timing.setVoiceTimingClock(() => clock); timing.clearVoiceTiming();
    const native = '9e2d1a52-6d5e-4e0f-9a43-5c1d2e3f4a5b', calls = [];
    timing.setNativeVoiceStageSink(async (stage, voiceTurnId) => { calls.push([stage, voiceTurnId]); return native; });
    timing.beginVoiceTurn({route: 'local-agent', cold: false, entry: 'conversation', policy: 'auto-send'});
    clock = 100; assert.equal(timing.markVoiceTiming('transcript-ready'), true);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(timing.nativeVoiceTurnId(), native);
    clock = 120; timing.markVoiceTiming('send'); clock = 900; timing.markVoiceTiming('first-token');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(calls, [['asr-final', undefined], ['request', native], ['first-token', native]]);
    assert.equal(JSON.parse(timing.exportVoiceTiming()).records[0].nativeTurn, native, 'the renderer record names its native turn');
    timing.finishVoiceTurn();
    // Notes dictation is not an assistant turn; a failing sink never fails a mark.
    calls.length = 0;
    timing.beginVoiceTurn({route: 'on-device', cold: false, entry: 'notes'});
    assert.equal(timing.markVoiceTiming('transcript-ready'), true);
    timing.setNativeVoiceStageSink(() => { throw Error('bridge down'); });
    timing.beginVoiceTurn({route: 'local-agent', cold: false, entry: 'conversation'});
    assert.equal(timing.markVoiceTiming('transcript-ready'), true);
    timing.setNativeVoiceStageSink(async () => 'not-a-turn-id');
    assert.equal(timing.markVoiceTiming('send'), true);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(calls, []);
    assert.equal(timing.nativeVoiceTurnId(), undefined, 'a malformed id is never adopted');
  } finally { timing.setNativeVoiceStageSink(undefined); timing.clearVoiceTiming(); delete globalThis.localStorage; }
});
