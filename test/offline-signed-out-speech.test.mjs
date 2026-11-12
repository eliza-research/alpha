import test from 'node:test';
import assert from 'node:assert/strict';

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
