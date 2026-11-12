import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const store = new Map();
globalThis.localStorage = {getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k)};
const timing = await import('../apps/app/src/runtime/voice-timing.ts');
const {aggregate, percentile} = await import('../scripts/aggregate-voice-latency.ts');
let now = 0;
timing.setVoiceTimingClock(() => now);

function turn({cold = false, route = 'on-device', recognition = 800, review = 3000, token = 600, reply = 1500, audio = 2100, speak = true} = {}) {
  now = 10_000;
  const id = timing.beginVoiceTurn({route, cold, entry: 'conversation'});
  now += recognition; assert.equal(timing.markVoiceTiming('transcript-ready'), true);
  now += review; assert.equal(timing.markVoiceTiming('send'), true);
  now += token; assert.equal(timing.markVoiceTiming('first-token'), true);
  now += reply - token; assert.equal(timing.markVoiceTiming('final-reply'), true);
  if (speak) { now += audio - reply; assert.equal(timing.markVoiceTiming('first-audio'), true); } else timing.finishVoiceTurn();
  return id;
}

test('a turn records ordered offsets once and never stores text or account identifiers', () => {
  timing.clearVoiceTiming();
  const id = turn();
  const [row] = timing.voiceTimingRecords();
  assert.equal(row.id, id);
  assert.deepEqual(row.marks, {'recording-end': 0, 'transcript-ready': 800, send: 3800, 'first-token': 4400, 'final-reply': 5300, 'first-audio': 5900});
  assert.deepEqual(Object.keys(row).sort(), ['cold', 'entry', 'id', 'marks', 'recordedAt', 'route', 'version']);
  // The turn ended at first audio: later marks are ignored.
  assert.equal(timing.markVoiceTiming('first-token'), false);
  const exported = JSON.parse(timing.exportVoiceTiming());
  assert.equal(exported.format, 'alpha-voice-timing-v1');
  assert.doesNotMatch(timing.exportVoiceTiming(), /session|credential|owner|text/i);
});

test('out-of-order and premature marks cannot shorten a phase', () => {
  timing.clearVoiceTiming();
  now = 0; timing.beginVoiceTurn({route: 'browser', cold: true});
  assert.equal(timing.markVoiceTiming('send'), false, 'send needs a ready transcript');
  assert.equal(timing.markVoiceTiming('first-token'), false, 'reply marks need send');
  now = 500; assert.equal(timing.markVoiceTiming('transcript-ready'), true);
  assert.equal(timing.markVoiceTiming('transcript-ready'), false, 'first mark wins');
  assert.equal(timing.markVoiceTiming('send', 'another-turn'), false);
  assert.equal(timing.beginVoiceTurn({route: 'unknown-route', cold: false}), undefined);
  // The unknown route abandoned the earlier turn without recording a new one.
  const rows = timing.voiceTimingRecords();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].outcome, 'abandoned');
});

test('legacy renderer samples remain diagnostic and cannot qualify native audio latency', () => {
  timing.clearVoiceTiming();
  for (let i = 0; i < 19; i++) turn({recognition: 700 + i, audio: 2000 + i});
  for (let i = 0; i < 5; i++) turn({cold: true, recognition: 4000 + i});
  turn({speak: false});
  now = 0; timing.beginVoiceTurn({route: 'on-device', cold: false, entry: 'conversation'}); timing.abandonVoiceTurn();
  const exported = JSON.parse(timing.exportVoiceTiming());
  const summary = aggregate([exported, exported]);
  assert.equal(summary.records, 26, 'duplicates across exports are counted once');
  assert.equal(summary.abandoned, 1);
  assert.equal(summary.cohorts.warm.samples, 20);
  assert.equal(summary.cohorts.cold.samples, 5);
  assert.equal(summary.sufficient, false);
  assert.equal(summary.legacyDiagnosticsSufficient, true);
  assert.equal(summary.cohorts.warm.withAudio, 19);
  assert.equal(summary.cohorts.cold.phases.recognition.p50, 4002);
  assert.equal(summary.cohorts.warm.phases.speechToAudioExcludingReview.n, 19);
  assert.equal(summary.cohorts.warm.phases.review.p50, 3000);
  assert.match(summary.targetSignOff, /Issue #395/);
  assert.equal(percentile([1, 2, 3, 4], 50), 2);
  // The command reports insufficiency with exit code 2.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-latency-'));
  try {
    const file = path.join(dir, 'export.json');
    fs.writeFileSync(file, JSON.stringify({...exported, records: exported.records.slice(0, 10)}));
    assert.throws(() => execFileSync(process.execPath, ['scripts/aggregate-voice-latency.ts', file], {stdio: 'pipe'}), error => error.status === 2);
    fs.writeFileSync(file, JSON.stringify(exported));
    assert.throws(() => execFileSync(process.execPath, ['scripts/aggregate-voice-latency.ts', file], {stdio: 'pipe'}), error => error.status === 2 && JSON.parse(error.stdout).legacyDiagnosticsSufficient === true);
    // The required counts can be raised but never lowered below 20 warm and 5 cold.
    assert.throws(() => execFileSync(process.execPath, ['scripts/aggregate-voice-latency.ts', file, '--warm', '1'], {stdio: 'pipe'}), error => error.status === 1);
    assert.throws(() => execFileSync(process.execPath, ['scripts/aggregate-voice-latency.ts', file, '--cold', '30'], {stdio: 'pipe'}), error => error.status === 2);
    assert.equal(aggregate([exported], {warm: 1, cold: 1}).cohorts.warm.required, 20);
    fs.writeFileSync(file, '{"format":"other"}');
    assert.throws(() => execFileSync(process.execPath, ['scripts/aggregate-voice-latency.ts', file], {stdio: 'pipe'}), error => error.status === 1);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});
