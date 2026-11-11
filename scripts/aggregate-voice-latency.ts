#!/usr/bin/env bun
// Aggregate exported per-turn voice timing records (apps/app/src/runtime/voice-timing.ts).
//
//   bun scripts/aggregate-voice-latency.ts export-1.json [export-2.json ...] [--warm N>=20] [--cold N>=5] [--entry conversation|notes] [--out summary.json]
//
// Phases are measured from marks on one device clock, in milliseconds:
//   recognition         transcript-ready - recording-end
//   review              send - transcript-ready   (the user's review and Send; P-01: never automatic)
//   firstToken          first-token - send
//   finalReply          final-reply - send
//   firstAudio          first-audio - send        (voice conversation turns; a dictated turn is never spoken)
//   speechToTokenExcludingReview  recognition + firstToken
//   speechToAudioExcludingReview  recognition + firstAudio
//   speechToTokenIncludingReview  first-token - recording-end
//   speechToAudioIncludingReview  first-audio - recording-end
// These renderer measures are legacy stage sums, one per boundary in `boundaries`, not end-to-end
// voice-assistant latency, and are reported as diagnostics only. Only native audio-clock exports
// (alpha-native-voice-timing-v3, or diagnostic-only v2, from the Android collector, scripts/native-voice-latency.ts) can
// satisfy the approved issue #395 boundary: last captured speech sample to first audible response
// sample, at least 50 successful simple-query trials (20 warm and 5 cold at least) per
// source/engine/model/device/ABI/network cohort, p50/p95 per cold and warm, six-second upper budget.
// Emulator and harness (no language model) cohorts are summarized and never sufficient.
//
// Records written by an app entrypoint name it: `entry` is 'conversation' (the voice
// conversation) or 'notes' (the Notes recorder, whose send is the user's Save and which has no
// reply), and conversation records name the send `policy` ('auto-send' or 'review'). The
// summary counts each entry; --entry keeps only that entry's records. Records without an entry
// (older exports) stay valid and are counted as 'unspecified'.
// Exit 0: native device samples are sufficient and within the latency budget (not device signoff).
// Exit 2: native acceptance evidence insufficient (including emulator-only or harness-only input).
// Exit 3: sufficient samples fail the budget/reliability check.
// Exit 1: bad input. Legacy exports remain readable.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { VoiceTimingMark, VoiceTimingRecord } from '../.eliza/client-features/packages/voice/src/voice-turn-timing.ts';
import { aggregateNativeVoice, nativeTimingFormats } from './native-voice-latency.ts';

const order: readonly VoiceTimingMark[] = ['recording-end', 'transcript-ready', 'send', 'first-token', 'final-reply', 'first-audio'];
const routes = new Set(['on-device', 'browser', 'local-agent', 'eliza-cloud', 'paired-agent', 'development-agent', 'manual']);
export const voiceEntries = Object.freeze(['conversation', 'notes'] as const);
export const boundaries = Object.freeze({ excludingReview: 'recording-end to transcript-ready, plus send to the reply mark', includingReview: 'recording-end to the reply mark, including review and send time' });

/** The sample counts the measurement plan requires. Options can raise them, never lower them. */
export const minimumSamples = Object.freeze({ warm: 20, cold: 5 });
type Entry = (typeof voiceEntries)[number];
type TimingRecord = Omit<VoiceTimingRecord, 'entry'> & {entry?: Entry};
type TimingDocument = Parameters<typeof aggregateNativeVoice>[0][number];
interface RequestedSamples { warm?: number; cold?: number; entry?: Entry | null }
interface AggregateOptions extends Required<RequestedSamples> { files: string[]; out: string | null }

const isEntry = (entry: unknown): entry is Entry => voiceEntries.some(name => name === entry);

export function parseArguments(argv: readonly string[]) {
  const options: AggregateOptions = { files: [], warm: minimumSamples.warm, cold: minimumSamples.cold, out: null, entry: null };
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (value === '--warm' || value === '--cold') { const n = Number(argv[++i]); const key = value === '--warm' ? 'warm' : 'cold'; if (!Number.isInteger(n) || n < minimumSamples[key]) throw new Error(`${value} needs an integer of at least ${minimumSamples[key]}`); options[key] = n; }
    else if (value === '--out') { options.out = argv[++i]; if (!options.out) throw new Error('--out needs a path'); }
    else if (value === '--entry') { const entry = argv[++i]; if (!isEntry(entry)) throw new Error('--entry needs conversation or notes'); options.entry = entry; }
    else if (value.startsWith('--')) throw new Error(`Unknown option ${value}`);
    else options.files.push(value);
  }
  if (!options.files.length) throw new Error('Pass at least one voice timing export');
  return options;
}

function validRecord(value: unknown): value is TimingRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as TimingRecord;
  if ( row.version !== 1 || typeof row.id !== 'string' || !/^[0-9a-f-]{36}$/.test(row.id)) return false;
  if (typeof row.cold !== 'boolean' || !routes.has(row.route) || !Number.isFinite(row.recordedAt) || !row.marks || typeof row.marks !== 'object') return false;
  if ((row.entry !== undefined && !isEntry(row.entry)) || (row.policy !== undefined && row.policy !== 'auto-send' && row.policy !== 'review')) return false;
  const entries = Object.entries(row.marks);
  if (entries.some(([key, at]) => !order.some(mark => mark === key) || typeof at !== 'number' || !Number.isFinite(at) || at < 0)) return false;
  // Marks must be monotonic in their defined order.
  let last = -1;
  for (const key of order) { const at = row.marks[key]; if (at === undefined) continue; if (at < last) return false; last = at; }
  return true;
}

/** Reads exports, drops invalid and duplicate records, and keeps the first copy of each id. */
export function collectRecords(exports: readonly TimingDocument[]) {
  const seen = new Map<string, TimingRecord>(); let invalid = 0;
  for (const document of exports) {
    if (!document || document.format !== 'alpha-voice-timing-v1' || !Array.isArray(document.records)) throw new Error('Not an alpha-voice-timing-v1 export');
    for (const row of document.records) { if (!validRecord(row)) { invalid++; continue; } if (!seen.has(row.id)) seen.set(row.id, row); }
  }
  return { records: [...seen.values()], invalid };
}

/** Nearest-rank percentile of sorted values. */
export function percentile(sorted: readonly number[], p: number) { if (!sorted.length) return null; return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p / 100 * sorted.length) - 1))]; }
function stats(values: readonly (number | undefined)[]) {
  const sorted = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value)).sort((a, b) => a - b);
  return { n: sorted.length, p50: percentile(sorted, 50), p90: percentile(sorted, 90), p95: percentile(sorted, 95), max: sorted.length ? sorted[sorted.length - 1] : null };
}
export function phases(row: Pick<TimingRecord, 'marks'>) {
  const gap = (from: VoiceTimingMark, to: VoiceTimingMark) => {
    const start = row.marks[from], end = row.marks[to];
    return start !== undefined && end !== undefined ? end - start : undefined;
  };
  const recognition = gap('recording-end', 'transcript-ready'), firstToken = gap('send', 'first-token'), firstAudio = gap('send', 'first-audio');
  return {
    recognition, review: gap('transcript-ready', 'send'), firstToken, finalReply: gap('send', 'final-reply'), firstAudio,
    speechToTokenExcludingReview: recognition !== undefined && firstToken !== undefined ? recognition + firstToken : undefined,
    speechToAudioExcludingReview: recognition !== undefined && firstAudio !== undefined ? recognition + firstAudio : undefined,
    speechToTokenIncludingReview: gap('recording-end', 'first-token'),
    speechToAudioIncludingReview: gap('recording-end', 'first-audio'),
  };
}
/** A complete sample reached the final reply through every earlier mark. */
export const complete = (row: TimingRecord) => !row.outcome && order.slice(0, 5).every(key => row.marks[key] !== undefined);

export function aggregate(exports: TimingDocument[], requested: RequestedSamples = minimumSamples) {
  const required = { warm: Math.max(minimumSamples.warm, requested.warm ?? 0), cold: Math.max(minimumSamples.cold, requested.cold ?? 0) };
  const native = aggregateNativeVoice(exports.filter(document => nativeTimingFormats.some(format => format === document?.format)), required);
  const collected = collectRecords(exports.filter(document => !nativeTimingFormats.some(format => format === document?.format))), invalid = collected.invalid;
  if (requested.entry != null && !isEntry(requested.entry)) throw new Error('Unknown entry ' + requested.entry);
  const records = requested.entry ? collected.records.filter(row => row.entry === requested.entry) : collected.records;
  interface EntryRecords {
    records: number;
    complete: number;
    abandoned: number;
    policies: Partial<Record<NonNullable<TimingRecord['policy']>, number>>;
    recognition: (number | undefined)[];
  }
  const bySource: Record<string, EntryRecords> = {};
  for (const row of collected.records) {
    const name = row.entry ?? 'unspecified', item = bySource[name] ??= { records: 0, complete: 0, abandoned: 0, policies: {}, recognition: [] };
    item.records++; if (complete(row)) item.complete++; if (row.outcome === 'abandoned') item.abandoned++;
    if (row.policy) item.policies[row.policy] = (item.policies[row.policy] ?? 0) + 1;
    item.recognition.push(phases(row).recognition);
  }
  const entries = Object.fromEntries(Object.entries(bySource).map(([name, item]) => [
    name, { ...item, recognition: stats(item.recognition) },
  ]));
  const usable = records.filter(complete);
  type Phase = keyof ReturnType<typeof phases>;
  const phaseKeys = Object.keys(phases({ marks: {} })) as Phase[];
  const summarize = (name: keyof typeof required) => {
    const rows = usable.filter(row => row.cold === (name === 'cold'));
    const measured = rows.map(phases);
    const byPhase = Object.fromEntries(phaseKeys.map(key => [key, stats(measured.map(values => values[key]))]));
    return { samples: rows.length, required: required[name], sufficient: rows.length >= required[name], routes: [...new Set(rows.map(row => row.route))].sort(), withAudio: rows.filter(row => row.marks['first-audio'] !== undefined).length, phases: byPhase };
  };
  const cohorts = { warm: summarize('warm'), cold: summarize('cold') };
  return {
    format: 'alpha-voice-latency-summary-v1', units: 'ms', entry: requested.entry ?? null, entries, boundaries,
    records: records.length, complete: usable.length, abandoned: records.filter(row => row.outcome === 'abandoned').length, incomplete: records.filter(row => !row.outcome && !complete(row)).length, invalid,
    cohorts, legacyDiagnosticsSufficient: cohorts.warm.sufficient && cohorts.cold.sufficient,
    native, sufficient: native.sufficient,
    targetSignOff: 'Issue #395: at least 50 simple-query native audio trials on the device, last speech sample through first audible response, six-second upper budget. Legacy renderer marks and stage sums are diagnostic and cannot qualify this boundary.',
  };
}

/** One line per native cohort: class, counts and cold/warm p50/p95/max of the full interval. */
export function nativeTable(native: ReturnType<typeof aggregateNativeVoice>) {
  const cell = (stats: typeof native.cohorts[number]['warm']) => (stats.samples ? `n=${stats.samples} p50=${stats.p50} p95=${stats.p95} max=${stats.max}` : 'n=0');
  return native.cohorts.map(row => `[${row.class}] ${row.pipeline} ${row.identity.environment} ${row.identity.abi} ${row.identity.device} @${row.identity.sourceCommit.slice(0, 10)} network=${row.network}: trials=${row.trials} passed=${row.passed} ineligible=${row.ineligibleRows} failed=${row.failures} abandoned=${row.abandoned} | warm ${cell(row.warm)} | cold ${cell(row.cold)} (ms, last speech -> audible)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let options;
  try { options = parseArguments(process.argv.slice(2)); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); }
  let summary;
  try { summary = aggregate(options.files.map(file => JSON.parse(fs.readFileSync(file, 'utf8'))), { warm: options.warm, cold: options.cold, entry: options.entry }); }
  catch (error) { console.error(`Cannot aggregate: ${error instanceof Error ? error.message : String(error)}`); process.exit(1); }
  const text = JSON.stringify(summary, null, 2);
  if (options.out) fs.writeFileSync(options.out, text + '\n'); else console.log(text);
  for (const line of nativeTable(summary.native)) console.error(line);
  if (!summary.sufficient) { console.error('Insufficient native audio acceptance evidence: require at least 50 successful live-voice trials on a device per source/engine/model/device/ABI/network cohort, including the requested warm/cold minimums. Emulator, harness and legacy renderer samples are diagnostic only; inspect native.invalid, native.rejected and native.conflictingTrials for rejected records.'); process.exit(2); }
  if (!summary.native.withinBudget) { console.error('Native audio evidence failed the latency/reliability check: inspect cold/warm max against the 6000 ms upper budget and failures/cancelled counts in native.cohorts.'); process.exit(3); }
  console.error('Native timing sample and budget checks passed. Clock provenance, microphone/speaker quality and target-device acceptance still require review.');
}
