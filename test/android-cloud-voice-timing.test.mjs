import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeTurns, summarizeTurns, sanitizeNative, evaluate } from '../scripts/android-cloud-voice-timing.mjs';

const turn = { route: 'eliza-cloud', cold: false, entry: 'conversation', marks: {
  'recording-end': 0, 'transcript-ready': 2100, send: 2120,
  'first-token': 3855, 'final-reply': 4952, 'first-audio': 8283,
} };

test('device diagnostics isolate STT, agent and TTS without treating missing audio as zero', () => {
  assert.deepEqual(summarizeTurns([turn])[0], {
    route: 'eliza-cloud', cold: false, recordingStopToTranscriptMs: 2100,
    transcriptToSendMs: 20, sendToFirstTokenMs: 1735, sendToFinalReplyMs: 2832,
    finalReplyToPlaybackStartMs: 3331, recordingStopToPlaybackStartMs: 8283,
  });
  const missing = structuredClone(turn); delete missing.marks['first-audio']; missing.outcome = 'abandoned';
  const result = summarizeTurns([missing])[0];
  assert.equal(result.finalReplyToPlaybackStartMs, null);
  assert.equal(result.recordingStopToPlaybackStartMs, null);
  assert.equal(result.outcome, 'abandoned');
});

test('export excludes arbitrary strings and rejects invalid/non-monotonic timing', () => {
  const polluted = { ...turn, transcript: 'private phrase', credentialId: 'private credential', id: 'private identifier', marks: { ...turn.marks, secret: 'private header' } };
  assert.deepEqual(sanitizeTurns([polluted]), [turn]);
  assert.doesNotMatch(JSON.stringify(sanitizeTurns([polluted])), /private|secret/);
  assert.deepEqual(sanitizeTurns([{ ...turn, route: 'private' }, { ...turn, marks: { ...turn.marks, send: 1 } }, { ...turn, marks: { 'recording-end': -1 } }]), []);
  assert.equal(sanitizeTurns(Array.from({length: 250}, () => turn)).length, 200);
});

test('native diagnostic export permits only fixed labels and bounded numbers', () => {
  assert.equal(sanitizeNative(undefined), null, 'older APKs have no Cloud timing collector');
  assert.deepEqual(sanitizeNative({ format: 'alpha-cloud-speech-timing-v1', records: [{
    route: 'tts', outcome: 'completed', provider: 'cartesia', status: 200,
    requestId: 'private', headers: 'private', marks: { queued: 0, headers: 1500, 'playback-start': 2300, private: 1 },
    phases: { responseWaitMs: 1200, downloadMs: -1 }, server: { auth: 12, synthesis: 800, admission: Infinity, private: 1 },
  }] }), { format: 'alpha-cloud-speech-timing-v1', records: [{
    route: 'tts', outcome: 'completed', provider: 'cartesia', status: 200,
    marks: { queued: 0, headers: 1500, 'playback-start': 2300 }, phases: { responseWaitMs: 1200 }, server: { auth: 12, synthesis: 800 },
  }] });
});

test('debugger disconnect rejects promptly instead of waiting for the read deadline', async () => {
  const original = globalThis.WebSocket;
  globalThis.WebSocket = class {
    constructor() { queueMicrotask(() => this.onclose()); }
    close() {}
  };
  try { await assert.rejects(evaluate('ws://127.0.0.1/unused', '0', 10000), /closed during diagnostic read/); }
  finally { globalThis.WebSocket = original; }
});
