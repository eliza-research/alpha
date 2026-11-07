// Native audio-clock evidence for issue #395: last captured user speech sample to the first audible
// response sample, measured by the Android collector (shared ai.eliza.voice VoiceLatencyProbe / VoiceLatencyTrials)
// on CLOCK_MONOTONIC. Renderer marks and stage sums cannot establish this boundary.
//
// Export (alpha-native-voice-timing-v3, AlphaVoiceCloudPlugin.nativeVoiceTiming, the renderer's
// diagnostics export, or the NativeVoiceLatency harness): {format, records: [row]}, each row
//   {id, turnId, pipeline, clock: 'native-monotonic-ms', captureClock, cold, coldReason?, outcome,
//    reason?, audibleClock?, network?, thermal?, thermalHeadroom?, identity, marks}
// identity: {sourceCommit, sourceDirty, engineSha256, modelSha256, models?, device, environment, abi,
//   sdk?, build}
// marks (ms on one monotonic clock): last-user-audio, endpoint, asr-final?, request?, first-token?,
//   tts-start?, tts-ready?, first-pcm, audible-playback. turnId links capture, endpoint, transcript,
//   agent request, first streamed token, first PCM and audible playback of one turn (issue #395).
//   asr-final/request/first-token are stamped natively when the renderer reports them over the
//   bridge. Streamed speech times audible playback from AudioTrack.getTimestamp
//   ('audiotrack-timestamp'); 'audiotrack-head-position' is a diagnostic fallback.
// Earlier alpha-native-voice-timing-v2 exports (no turnId, request or first-token) still parse, as
// diagnostics only: they cannot show the linked stage chain.
//
// The result is audible-playback - last-user-audio, which includes end-of-turn detection,
// recognition, the reply, synthesis and playback buffering; nothing is subtracted. Stage spans are
// reported as diagnostics only and never summed.
//
// Acceptance-eligible trials: pipeline 'live-voice' (the shipped live conversation), environment
// 'device', ABI arm64-v8a, a release build from a clean source tree, capture timed from AudioRecord
// timestamps. Emulator runs, the harness ('harness-no-inference': no language model; a document
// with a `harness` section is treated as harness whatever its rows say) and debug or dirty builds
// are summarized as diagnostic cohorts and can never make the evidence sufficient. An acceptance
// cohort also needs every passed trial linked (v3 turnId with asr-final, request and first-token) and
// audible time from a platform output timestamp. Turns that waited
// for a response that never came (abandoned, no-response) fail the reliability check.
export const nativeTimingFormat = 'alpha-native-voice-timing-v3';
export const legacyNativeTimingFormat = 'alpha-native-voice-timing-v2';
export const nativeTimingFormats = Object.freeze([legacyNativeTimingFormat, nativeTimingFormat]);
export const marks = Object.freeze(['last-user-audio', 'endpoint', 'asr-final', 'request', 'first-token', 'tts-start', 'tts-ready', 'first-pcm', 'audible-playback']);
const legacyMarks = Object.freeze(['last-user-audio', 'endpoint', 'asr-final', 'tts-start', 'tts-ready', 'first-pcm', 'audible-playback']);
/** Stages a passed trial needs before it can be acceptance evidence: one linked turn end to end. */
export const linkedStages = Object.freeze(['asr-final', 'request', 'first-token']);
export const audibleClocks = Object.freeze(['audiotrack-timestamp', 'mediaplayer-timestamp']);
const turnId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const requiredForPass = ['last-user-audio', 'endpoint', 'first-pcm', 'audible-playback'];
export const identityKeys = Object.freeze(['sourceCommit', 'engineSha256', 'modelSha256', 'device', 'environment', 'abi', 'build']);
export const pipelines = Object.freeze({ 'live-voice': 'voice-assistant', 'harness-no-inference': 'diagnostic' });
export const minimumTrials = 50, budgetMs = 6000;
const outcomes = ['passed', 'failed', 'abandoned'];
const captureClocks = ['audiorecord-timestamp', 'read-return', 'synthetic-feed'];
const thermalStates = ['none', 'light', 'moderate', 'severe', 'critical', 'emergency', 'shutdown', 'unknown'];
const sha256 = /^[a-f0-9]{64}$/, commit = /^[a-f0-9]{40}$/;
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const label = value => typeof value === 'string' && value.length > 0 && value.length <= 120 && !/[\u0000-\u001f]/.test(value);

/** Why a row is unusable, or null. `format` is its document's format (v3 unless given). */
export function rejection(row, format = nativeTimingFormat) {
  const allowed = format === legacyNativeTimingFormat ? legacyMarks : format === nativeTimingFormat ? marks : null;
  if (!allowed) return 'format';
  if (!row || typeof row !== 'object' || Array.isArray(row)) return 'not an object';
  if (!label(row.id)) return 'id';
  if (format === nativeTimingFormat ? !turnId.test(row.turnId) : row.turnId !== undefined) return 'turn id';
  if (!Object.hasOwn(pipelines, row.pipeline)) return 'pipeline';
  if (row.clock !== 'native-monotonic-ms' || !captureClocks.includes(row.captureClock)) return 'clock';
  if (typeof row.cold !== 'boolean' || !outcomes.includes(row.outcome)) return 'cold/outcome';
  const id = row.identity;
  if (!id || typeof id !== 'object' || identityKeys.some(key => !label(id[key]))) return 'identity';
  if (!commit.test(id.sourceCommit) || typeof id.sourceDirty !== 'boolean' || !sha256.test(id.engineSha256) || !sha256.test(id.modelSha256)) return 'identity hashes';
  if (!['arm64-v8a', 'x86_64'].includes(id.abi) || !['device', 'emulator'].includes(id.environment)) return 'identity abi/environment';
  if (row.thermal !== undefined && !thermalStates.includes(row.thermal)) return 'thermal';
  if (!row.marks || typeof row.marks !== 'object' || Array.isArray(row.marks)) return 'marks';
  if (Object.entries(row.marks).some(([key, value]) => !allowed.includes(key) || !finite(value))) return 'marks';
  if (!finite(row.marks['last-user-audio']) || !finite(row.marks.endpoint)) return 'turn marks';
  if (row.outcome === 'passed' && (requiredForPass.some(key => row.marks[key] === undefined) || !label(row.audibleClock))) return 'incomplete pass';
  // A synthesis that finished without a start in the same turn belongs to an earlier turn.
  if (row.marks['tts-ready'] !== undefined && row.marks['tts-start'] === undefined) return 'unattributed synthesis';
  let previous = -1;
  for (const key of marks) {
    const at = row.marks[key];
    if (at === undefined) continue;
    if (at < previous) return 'order';
    previous = at;
  }
  return null;
}

/** Nearest-rank statistics. */
export function statistics(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const percentile = p => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] : null);
  const round = value => (value === null ? null : Math.round(value * 10) / 10);
  return { samples: sorted.length, min: round(sorted[0] ?? null), p50: round(percentile(0.5)), p95: round(percentile(0.95)), max: round(sorted.at(-1) ?? null), mean: round(sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : null) };
}
/** A passed v3 trial whose transcript, agent request and first token are on its own turn. */
export const linked = row => row.format === nativeTimingFormat && turnId.test(row.turnId) && linkedStages.every(key => row.marks[key] !== undefined);
const span = (row, from, to) => (row.marks[from] !== undefined && row.marks[to] !== undefined ? row.marks[to] - row.marks[from] : undefined);
/** Diagnostic stage spans; never summed into the result. */
export const stages = Object.freeze({
  endpointDetection: row => span(row, 'last-user-audio', 'endpoint'),
  recognitionFinal: row => span(row, 'endpoint', 'asr-final'),
  transcriptToRequest: row => span(row, 'asr-final', 'request'),
  requestToFirstToken: row => span(row, 'request', 'first-token'),
  firstTokenToSynthesisStart: row => span(row, 'first-token', 'tts-start'),
  replyToSynthesisStart: row => span(row, row.marks['asr-final'] !== undefined ? 'asr-final' : 'endpoint', 'tts-start'),
  synthesis: row => span(row, 'tts-start', 'tts-ready'),
  playbackHandoff: row => span(row, 'tts-ready', 'first-pcm'),
  outputLatency: row => span(row, 'first-pcm', 'audible-playback'),
});
const latency = row => row.marks['audible-playback'] - row.marks['last-user-audio'];
const histogram = values => values.reduce((out, value) => ((out[value ?? 'unrecorded'] = (out[value ?? 'unrecorded'] ?? 0) + 1), out), {});

export function aggregateNativeVoice(documents, required = { warm: 20, cold: 5 }) {
  const records = new Map(), conflicts = new Set(), rejected = {};
  let invalid = 0;
  for (const document of documents) {
    if (!nativeTimingFormats.includes(document?.format) || !Array.isArray(document.records)) throw new Error(`Not an ${nativeTimingFormats.join(' or ')} export`);
    const harness = document.harness !== undefined;
    for (const original of document.records) {
      const base = harness && original && typeof original === 'object' ? { ...original, pipeline: 'harness-no-inference' } : original;
      const reason = rejection(base, document.format);
      const row = reason ? base : { ...base, format: document.format };
      if (reason) { invalid++; rejected[reason] = (rejected[reason] ?? 0) + 1; continue; }
      // IDs identify trials globally. Conflicting exports cannot quietly keep an earlier success.
      const canonical = JSON.stringify([row.format, row.turnId ?? null, row.pipeline, row.cold, row.outcome, row.captureClock, row.audibleClock, row.reason, row.coldReason, row.network, row.thermal, row.thermalHeadroom, row.identity.sourceDirty, identityKeys.map(key => row.identity[key]), marks.map(key => row.marks[key] ?? null)]);
      const prior = records.get(row.id);
      if (prior && prior.canonical !== canonical) conflicts.add(row.id);
      else records.set(row.id, { row, canonical });
    }
  }
  const groups = new Map();
  for (const { row } of records.values()) {
    if (conflicts.has(row.id)) continue;
    const network = row.network ?? 'unrecorded';
    const key = JSON.stringify([row.pipeline, network, row.identity.sourceDirty, ...identityKeys.map(name => row.identity[name])]);
    if (!groups.has(key)) groups.set(key, { pipeline: row.pipeline, network, identity: { ...Object.fromEntries(identityKeys.map(name => [name, row.identity[name]])), sourceDirty: row.identity.sourceDirty }, models: row.identity.models ?? null, rows: [] });
    groups.get(key).rows.push(row);
  }
  const warmNeeded = Math.max(20, required.warm ?? 0), coldNeeded = Math.max(5, required.cold ?? 0);
  const cohorts = [...groups.values()].map(({ pipeline, network, identity, models, rows }) => {
    const passed = rows.filter(row => row.outcome === 'passed');
    const eligible = pipelines[pipeline] === 'voice-assistant' && identity.environment === 'device' && identity.abi === 'arm64-v8a'
      && /-release$/.test(identity.build) && identity.sourceDirty === false
      && passed.every(row => row.captureClock === 'audiorecord-timestamp' && audibleClocks.includes(row.audibleClock) && linked(row));
    const result = {
      pipeline, network, identity, models,
      class: eligible ? 'acceptance-candidate' : identity.environment === 'emulator' ? 'emulator-diagnostic' : 'diagnostic',
      trials: rows.length, passed: passed.length,
      linked: passed.filter(linked).length,
      formats: histogram(rows.map(row => row.format)),
      failures: rows.filter(row => row.outcome === 'failed').length,
      abandoned: rows.filter(row => row.outcome === 'abandoned').length,
      noResponse: rows.filter(row => row.outcome === 'abandoned' && row.reason === 'no-response').length,
      abandonedReasons: histogram(rows.filter(row => row.outcome === 'abandoned').map(row => row.reason)),
      failureReasons: histogram(rows.filter(row => row.outcome === 'failed').map(row => row.reason)),
      thermal: histogram(rows.map(row => row.thermal)),
      captureClock: histogram(passed.map(row => row.captureClock)),
      audibleClock: histogram(passed.map(row => row.audibleClock)),
      coldReasons: histogram(passed.filter(row => row.cold).map(row => row.coldReason)),
    };
    for (const cold of [false, true]) result[cold ? 'cold' : 'warm'] = statistics(passed.filter(row => row.cold === cold).map(latency));
    result.all = statistics(passed.map(latency));
    result.stagesDiagnosticOnly = Object.fromEntries(Object.entries(stages).map(([name, measure]) => [name, statistics(passed.map(measure))]));
    result.sampleSufficient = passed.length >= minimumTrials && result.warm.samples >= warmNeeded && result.cold.samples >= coldNeeded;
    result.sufficient = eligible && result.sampleSufficient;
    const throttled = rows.some(row => ['severe', 'critical', 'emergency', 'shutdown'].includes(row.thermal));
    result.withinBudget = result.sufficient && !result.failures && !result.noResponse && !throttled && result.warm.max <= budgetMs && result.cold.max <= budgetMs;
    return result;
  });
  const acceptance = cohorts.filter(row => row.class === 'acceptance-candidate');
  const clean = !invalid && !conflicts.size;
  return {
    boundary: 'last captured user speech sample (AudioRecord timestamp of the last VAD speech window) to the first audible response sample (output presentation time), including endpoint detection, recognition, reply, synthesis and buffering; nothing subtracted',
    units: 'ms', requiredSuccessfulTrials: minimumTrials, requiredWarm: warmNeeded, requiredCold: coldNeeded, budgetMs,
    invalid, rejected, conflictingTrials: conflicts.size, cohorts,
    sufficient: acceptance.length > 0 && clean && acceptance.every(row => row.sufficient),
    withinBudget: acceptance.length > 0 && clean && acceptance.every(row => row.withinBudget),
    acceptance: 'Timing evidence only. asr-final, request and first-token are bridge-stamped (they include the renderer to native hop). Emulator and harness cohorts are diagnostic. The audible mark is the platform output presentation time, not an acoustic measurement; microphone/speaker quality and target-device acceptance still require review.',
  };
}
