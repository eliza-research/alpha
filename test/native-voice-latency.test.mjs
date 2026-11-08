import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { aggregateNativeVoice, nativeTimingFormat, legacyNativeTimingFormat, rejection } from '../scripts/native-voice-latency.mjs';
import { aggregate, nativeTable } from '../scripts/aggregate-voice-latency.mjs';

const identity = { sourceCommit: 'a'.repeat(40), sourceDirty: false, engineSha256: 'b'.repeat(64), modelSha256: 'c'.repeat(64), device: 'Google Pixel 10a', environment: 'device', abi: 'arm64-v8a', build: 'standalone-release' };
function trial(index, duration = 5900) {
  return {
    id: `trial-${index}`, turnId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, pipeline: 'live-voice', clock: 'native-monotonic-ms', captureClock: 'audiorecord-timestamp', audibleClock: 'audiotrack-timestamp',
    cold: index < 5, outcome: 'passed', network: 'wifi', thermal: 'none', identity: { ...identity },
    marks: { 'last-user-audio': 1000, endpoint: 1550, 'asr-final': 1700, request: 1720, 'first-token': 2900, 'tts-start': 3300, 'tts-ready': 4000, 'first-pcm': 4100, 'audible-playback': 1000 + duration },
  };
}
const document = records => ({ format: nativeTimingFormat, records });
const samples = () => Array.from({ length: 50 }, (_, i) => trial(i));

test('native latency is the full last-speech to audible interval, with cold/warm p50/p95', () => {
  const rows = samples(), summary = aggregate([document(rows)]);
  assert.equal(summary.sufficient, true);
  assert.equal(summary.native.withinBudget, true);
  const cohort = summary.native.cohorts[0];
  assert.equal(cohort.class, 'acceptance-candidate');
  assert.equal(cohort.warm.p95, 5900);
  assert.equal(cohort.cold.p50, 5900);
  assert.equal(cohort.warm.samples, 45);
  // Stage spans are reported and never summed into the result.
  assert.equal(cohort.stagesDiagnosticOnly.endpointDetection.p50, 550);
  assert.equal(cohort.stagesDiagnosticOnly.outputLatency.p50, 1000 + 5900 - 4100);
  assert.equal(cohort.stagesDiagnosticOnly.requestToFirstToken.p50, 1180);
  assert.equal(cohort.stagesDiagnosticOnly.transcriptToRequest.p50, 20);
  assert.equal(cohort.linked, 50);
  assert.equal(aggregateNativeVoice([document(rows.slice(1))]).sufficient, false);
  assert.equal(aggregateNativeVoice([document(rows)], { warm: 46, cold: 5 }).sufficient, false);
  assert.equal(aggregateNativeVoice([document(rows.map((row, i) => trial(i, 7000)))]).withinBudget, false);
});

test('emulator, harness, x86_64, debug, dirty and read-return cohorts are diagnostic and never sufficient', () => {
  for (const mutate of [row => (row.identity.environment = 'emulator'), row => (row.pipeline = 'harness-no-inference'), row => (row.captureClock = 'read-return'),
    row => (row.identity.abi = 'x86_64'), row => (row.identity.build = 'standalone-debug'), row => (row.identity.sourceDirty = true)]) {
    const rows = samples(); rows.forEach(mutate);
    const summary = aggregateNativeVoice([document(rows)]);
    assert.equal(summary.invalid, 0);
    assert.equal(summary.cohorts[0].sampleSufficient, true, 'the sample counts are still reported');
    assert.equal(summary.cohorts[0].sufficient, false);
    assert.equal(summary.sufficient, false);
    assert.equal(summary.withinBudget, false);
  }
  const rows = samples(); rows.forEach(row => (row.identity.environment = 'emulator'));
  assert.equal(aggregateNativeVoice([document(rows)]).cohorts[0].class, 'emulator-diagnostic');
  // A harness export is harness evidence even if its rows claim the live pipeline.
  const harness = aggregateNativeVoice([{ ...document(samples()), harness: { pipeline: 'harness-no-inference' } }]);
  assert.equal(harness.cohorts[0].pipeline, 'harness-no-inference');
  assert.equal(harness.sufficient, false);
});

test('incompatible source, engine, model, device, ABI, environment and network cohorts never pool trials', () => {
  for (const key of [...Object.keys(identity), 'network']) {
    const rows = samples();
    if (key === 'network') rows[0].network = 'offline';
    else if (key === 'sourceDirty') rows[0].identity[key] = true;
    else rows[0].identity[key] = key === 'sourceCommit' ? 'd'.repeat(40) : key.endsWith('Sha256') ? 'd'.repeat(64) : key === 'abi' ? 'x86_64' : key === 'environment' ? 'emulator' : 'different';
    const summary = aggregateNativeVoice([document(rows)]);
    assert.equal(summary.sufficient, false, key);
    assert.equal(summary.cohorts.length, 2, key);
  }
});

test('missing, renderer, out-of-order and unidentified timestamps cannot qualify audio evidence', () => {
  for (const mutate of [
    row => delete row.marks['audible-playback'], row => delete row.audibleClock, row => (row.clock = 'renderer-performance-now'),
    row => (row.pipeline = 'dictation'), row => (row.marks.endpoint = 0), row => (row.marks['tts-ready'] = 3000),
    row => (row.identity.modelSha256 = 'unknown'), row => (row.identity.sourceCommit = 'b'.repeat(64)), row => (row.marks['first-token'] = 3500),
    row => (row.thermal = 'hot'), row => (row.captureClock = 'renderer'), row => delete row.marks['tts-start'], row => delete row.identity.sourceDirty,
  ]) {
    const rows = samples(); mutate(rows[0]);
    assert.ok(rejection(rows[0]));
    const summary = aggregateNativeVoice([document(rows)]);
    assert.equal(summary.invalid, 1); assert.equal(summary.sufficient, false);
  }
});

test('failures stay visible; abandoned turns are counted apart; conflicting duplicates fail closed', () => {
  const rows = samples(), failed = trial(50); failed.outcome = 'failed'; failed.reason = 'no-audible-time'; delete failed.marks['audible-playback'];
  const abandoned = trial(51); abandoned.outcome = 'abandoned'; abandoned.reason = 'superseded'; delete abandoned.marks['first-pcm']; delete abandoned.marks['audible-playback'];
  const summary = aggregateNativeVoice([document([...rows, failed, abandoned]), document(rows)]);
  const cohort = summary.cohorts[0];
  assert.equal(cohort.trials, 52); assert.equal(cohort.failures, 1); assert.equal(cohort.abandoned, 1);
  assert.deepEqual(cohort.failureReasons, { 'no-audible-time': 1 });
  assert.equal(summary.sufficient, true); assert.equal(summary.withinBudget, false);
  assert.equal(aggregateNativeVoice([document([...rows, abandoned])]).withinBudget, true, 'a superseded turn without a reply is not a latency failure');
  const waited = { ...abandoned, id: 'trial-52', reason: 'no-response' };
  const silent = aggregateNativeVoice([document([...rows, waited])]);
  assert.equal(silent.cohorts[0].noResponse, 1);
  assert.equal(silent.withinBudget, false, 'a turn that never got a response fails reliability');
  const conflict = aggregateNativeVoice([document(rows), document([trial(0, 7000)])]);
  assert.equal(conflict.conflictingTrials, 1); assert.equal(conflict.sufficient, false);
});

test('severe thermal state fails the budget even when the timing passes', () => {
  const rows = samples(); rows[3].thermal = 'severe';
  const summary = aggregateNativeVoice([document(rows)]);
  assert.equal(summary.sufficient, true); assert.equal(summary.withinBudget, false);
  assert.equal(summary.cohorts[0].thermal.severe, 1);
});

test('the six-second upper budget rejects a single slow outlier even when p95 passes', () => {
  const rows = samples(); rows[49] = trial(49, 60000);
  const summary = aggregateNativeVoice([document(rows)]);
  assert.equal(summary.sufficient, true);
  assert.equal(summary.cohorts[0].warm.p95, 5900);
  assert.equal(summary.cohorts[0].warm.max, 60000);
  assert.equal(summary.withinBudget, false);
});

test('CLI distinguishes insufficient samples, failed budgets and measured timing passes, and prints cohort lines', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-voice-latency-'));
  try {
    const file = path.join(dir, 'export.json');
    const run = rows => {
      fs.writeFileSync(file, JSON.stringify(document(rows)));
      return spawnSync(process.execPath, ['scripts/aggregate-voice-latency.mjs', file], { encoding: 'utf8' });
    };
    const passed = run(samples());
    assert.equal(passed.status, 0);
    assert.match(passed.stderr, /target-device acceptance still require review/);
    assert.match(passed.stderr, /\[acceptance-candidate\] live-voice device arm64-v8a .* warm n=45 p50=5900 p95=5900 max=5900/);
    assert.equal(run(samples().slice(1)).status, 2);
    const emulator = run(samples().map(row => ({ ...row, identity: { ...row.identity, environment: 'emulator' } })));
    assert.equal(emulator.status, 2);
    assert.match(emulator.stderr, /\[emulator-diagnostic\]/);
    const slow = run(samples().map((_, i) => trial(i, 7000)));
    assert.equal(slow.status, 3);
    assert.equal(JSON.parse(slow.stdout).native.withinBudget, false);
    assert.match(slow.stderr, /failed the latency/);
    const failed = trial(50); failed.outcome = 'failed'; failed.reason = 'playback-stopped'; delete failed.marks['audible-playback'];
    assert.equal(run([...samples(), failed]).status, 3);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  assert.deepEqual(nativeTable({ cohorts: [] }), []);
});

test('the Android collector times capture from AudioRecord and playback from the output timestamp (host JVM state)', async () => {
  const { nativeSource, runJvm, upstreamBridgeSource, upstreamVoiceFixture, upstreamVoiceSource } = await import('./fixtures/jvm-tools.mjs');
  assert.match(runJvm([upstreamVoiceSource('VoiceLatencyTrials.java'), upstreamVoiceFixture('VoiceLatencyTrialsTest.java')], 'ai.eliza.voice.VoiceLatencyTrialsTest'), /^PASS voice latency trials/);
  const harness = fs.readFileSync(path.join(path.dirname(nativeSource('x')), '../../../../../androidTest/java/ai/elizaresearch/alphaphone/NativeVoiceLatencyInstrumentedTest.java'), 'utf8');
  assert.match(harness, /\},"harness-no-inference",source,LiveVoiceCapture\.detectors\(VoiceAssets\.sharedInference\(app\)\)\);/, 'the harness labels its own trials');
  const read = name => fs.readFileSync(nativeSource(name), 'utf8'), shared = name => fs.readFileSync(upstreamVoiceSource(name), 'utf8');
  const probe = shared('VoiceLatencyProbe.java'), capture = shared('LiveVoiceCapture.java'), plugin = fs.readFileSync(upstreamBridgeSource('LocalSpeechBridgePlugin.java'), 'utf8');
  // The shared probe keeps Alpha's timing document name and build identity, configured once per process.
  assert.match(read('AlphaApplication.java'), /VoiceLatencyProbe\.configureHost\("alpha-native-voice-timing-v3",BuildConfig\.ELIZA_SOURCE_COMMIT,BuildConfig\.ELIZA_SOURCE_DIRTY,/);
  assert.match(probe, /getTimestamp\(scratch,AudioTimestamp\.TIMEBASE_MONOTONIC\)/);
  assert.match(probe, /getAnchorSystemNanoTime\(\)/);
  assert.match(probe, /\.put\("format",format\)/);
  assert.match(probe, /\.put\("turnId",trial\.turnId\)/);
  // Streamed speech (#397): first-pcm at the first AudioTrack write, audible from AudioTrack.getTimestamp.
  const output = shared('AudioTrackSpeechOutput.java');
  assert.match(output, /track\.getTimestamp\(stamp\)/);
  assert.match(output, /MODE_STREAM/);
  assert.match(plugin, /TRIALS\.firstPcm\(trial,nanos\)/);
  assert.match(plugin, /TRIALS\.forTurn\(call\.getString\("voiceTurnId"\)\)/);
  assert.match(plugin, /@PluginMethod public void markVoiceTurn\(PluginCall call\)\{\n  long at=System\.nanoTime\(\);/);
  assert.equal(probe.includes('Log.'), false, 'the collector logs nothing');
  assert.match(capture, /TRIALS\.speechEnded\(lastSpeechNs,System\.nanoTime\(\)/);
  assert.match(plugin, /p\.start\(\);if\(playbackLocalReply\)VoiceLatencyProbe\.playbackStarted\(/);
  // The trial carries numbers and labels only: no text reaches the collector.
  for (const source of [probe, shared('VoiceLatencyTrials.java')]) assert.doesNotMatch(source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ''), /transcript|\btext\b/i);
});

test('duplicate trial provenance changes cannot replace an accepted record', () => {
  for (const mutate of [row => { row.identity.sourceDirty = true; }, row => { row.thermal = 'severe'; }, row => { row.network = 'cellular'; }, row => { row.audibleClock = 'start-call'; }, row => { row.reason = 'no-response'; }]) {
    const rows = samples(), changed = structuredClone(rows[0]); mutate(changed);
    for (const docs of [[document(rows), document([changed])], [document([changed]), document(rows)]]) {
      const result = aggregateNativeVoice(docs);
      assert.equal(result.conflictingTrials, 1);
      assert.equal(result.withinBudget, false);
    }
  }
  const rows = samples(); rows.forEach(row => { row.audibleClock = 'start-call'; });
  assert.equal(aggregateNativeVoice([document(rows)]).sufficient, false);
  assert.equal(rejection({ ...trial(0), pipeline: 'toString' }), 'pipeline');
});

test('v3 trials link one turn end to end; unlinked, legacy and fallback-clock trials stay diagnostic', () => {
  assert.equal(aggregateNativeVoice([document(samples())]).sufficient, true);
  for (const mutate of [row => delete row.marks.request, row => delete row.marks['first-token'], row => delete row.marks['asr-final'], row => (row.audibleClock = 'audiotrack-head-position')]) {
    const rows = samples(); mutate(rows[7]);
    const summary = aggregateNativeVoice([document(rows)]);
    assert.equal(summary.invalid, 0);
    assert.equal(summary.cohorts[0].class, 'diagnostic');
    assert.equal(summary.sufficient, false);
  }
  for (const mutate of [row => delete row.turnId, row => (row.turnId = 'turn-1'), row => (row.marks.request = 1600)]) {
    const rows = samples(); mutate(rows[0]);
    assert.ok(rejection(rows[0]));
    assert.equal(aggregateNativeVoice([document(rows)]).sufficient, false);
  }
  // Legacy v2 exports parse (without the new marks or turnId) but cannot be acceptance evidence.
  const legacy = samples().map(row => { const { turnId, ...rest } = row; const marks = { ...rest.marks }; delete marks.request; delete marks['first-token']; return { ...rest, audibleClock: 'mediaplayer-timestamp', marks }; });
  const old = aggregateNativeVoice([{ format: legacyNativeTimingFormat, records: legacy }]);
  assert.equal(old.invalid, 0);
  assert.equal(old.cohorts[0].class, 'diagnostic');
  assert.equal(old.sufficient, false);
  assert.ok(rejection({ ...legacy[0], marks: { ...legacy[0].marks, request: 1720 } }, legacyNativeTimingFormat), 'v2 has no request mark');
  assert.throws(() => aggregateNativeVoice([{ format: 'alpha-native-voice-timing-v1', records: [] }]), /export/);
});
