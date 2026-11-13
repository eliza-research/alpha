#!/usr/bin/env bun
/** Read only Alpha's numeric voice diagnostics from its running debug WebView.
 * No credential slots, transcripts, reply text, microphone, network speech requests,
 * installs or process restarts. The temporary adb forward is removed on exit.
 * Usage: bun scripts/android-cloud-voice-timing.ts [--serial DEVICE] [--out FILE]
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile);
const packageName = 'ai.alphacompute.alphaphone';
const marks = ['recording-end', 'transcript-ready', 'send', 'first-token', 'final-reply', 'first-audio'] as const;
type Mark = typeof marks[number];
const routes = ['on-device', 'browser', 'local-agent', 'eliza-cloud', 'paired-agent', 'development-agent', 'manual'] as const;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const member = <T extends string>(value: unknown, values: readonly T[]): value is T => values.some(item => item === value);
const finiteMs = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 3_600_000;

/** Keep a fixed numeric/enum schema even if the device's storage is malformed. */
interface Turn {
  route: typeof routes[number];
  cold: boolean;
  entry?: 'conversation' | 'notes';
  outcome?: 'abandoned';
  marks: Partial<Record<Mark, number>>;
}

export function sanitizeTurns(value: unknown): Turn[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-200).flatMap(row => {
    if (!record(row) || !member(row.route, routes) || typeof row.cold !== 'boolean' || !record(row.marks)) return [];
    const clean: Turn['marks'] = {};
    let previous = -1;
    for (const key of marks) {
      const elapsed = row.marks[key];
      if (elapsed === undefined) continue;
      if (!finiteMs(elapsed) || elapsed < previous) return [];
      clean[key] = elapsed;
      previous = elapsed;
    }
    if (clean['recording-end'] !== 0) return [];
    return [{ route: row.route, cold: row.cold, ...(row.entry === 'conversation' || row.entry === 'notes' ? { entry: row.entry } : {}), ...(row.outcome === 'abandoned' ? { outcome: 'abandoned' } : {}), marks: clean }];
  });
}

export function summarizeTurns(turns: unknown) {
  return sanitizeTurns(turns).map(row => {
    const m = row.marks;
    const gap = (start: Mark, end: Mark) => {
      const from = m[start], to = m[end];
      return from === undefined || to === undefined ? null : to - from;
    };
    return { route: row.route, cold: row.cold, ...(row.outcome ? { outcome: row.outcome } : {}),
      recordingStopToTranscriptMs: gap('recording-end', 'transcript-ready'),
      transcriptToSendMs: gap('transcript-ready', 'send'),
      sendToFirstTokenMs: gap('send', 'first-token'),
      sendToFinalReplyMs: gap('send', 'final-reply'),
      finalReplyToPlaybackStartMs: gap('final-reply', 'first-audio'),
      recordingStopToPlaybackStartMs: gap('recording-end', 'first-audio') };
  });
}

const nativeMarks = ['queued', 'worker-start', 'decode-start', 'decode-end', 'upload-start', 'upload-end', 'headers', 'body-end', 'prepared', 'playback-start', 'playback-end'];
const nativePhases = ['queueMs', 'decodeMs', 'uploadMs', 'responseWaitMs', 'downloadMs', 'prepareMs', 'playbackStartMs', 'playbackMs', 'totalMs'];
/** No raw headers, arbitrary labels, request/account identifiers or strings cross this export. */
interface NativeTiming {
  route: 'stt' | 'tts';
  outcome: 'active' | 'completed' | 'failed' | 'cancelled';
  provider?: 'cartesia' | 'unknown';
  moderation?: 'reviewed' | 'approved-hit';
  status?: number;
  marks?: Record<string, number>;
  phases?: Record<string, number>;
  server?: Record<string, number>;
}
const httpStatus = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599;

export function sanitizeNative(value: unknown) {
  if (!record(value) || value.format !== 'alpha-cloud-speech-timing-v1' || !Array.isArray(value.records)) return null;
  return { format: value.format, records: value.records.slice(-100).flatMap(row => {
    if (!record(row) || !member(row.route, ['stt', 'tts'] as const)
        || !member(row.outcome, ['active', 'completed', 'failed', 'cancelled'] as const)) return [];
    const clean: NativeTiming = { route: row.route, outcome: row.outcome };
    if (member(row.provider, ['cartesia', 'unknown'] as const)) clean.provider = row.provider;
    if (member(row.moderation, ['reviewed', 'approved-hit'] as const)) clean.moderation = row.moderation;
    if (httpStatus(row.status)) clean.status = row.status;
    for (const [key, fields] of [['marks', nativeMarks], ['phases', nativePhases], ['server', ['auth', 'admission', 'moderation', 'synthesis']]] as const) {
      const readings = row[key];
      if (!record(readings)) continue;
      const admitted: Record<string, number> = {};
      for (const field of fields) {
        const elapsed = readings[field];
        if (finiteMs(elapsed)) admitted[field] = elapsed;
      }
      clean[key] = admitted;
    }
    return [clean];
  }) };
}

const streamStages = ['start', 'consent-start', 'consent-headers', 'consent-body', 'mint-start', 'mint-headers', 'mint-body', 'ws-open', 'ready', 'stt-connected', 'speech-start', 'asr-final', 'tts-request', 'first-pcm', 'first-audible', 'audio-end', 'error', 'stop'] as const;
const streamCounters = ['session', 'sentFrames', 'sentBytes', 'receivedFrames', 'receivedBytes'] as const;
interface StreamTiming extends Partial<Record<typeof streamCounters[number], number>> {
  stage: typeof streamStages[number];
  elapsedMs: number;
  clock?: 'audiotrack-timestamp' | 'audiotrack-head-position' | 'monotonic-observed';
  utteranceElapsedMs?: number;
  httpStatus?: number;
}
export function sanitizeStreaming(value: unknown) {
  if (!record(value) || value.format !== 'alpha-cloud-stream-timing-v1' || !Array.isArray(value.records)) return null;
  return { format: value.format, records: value.records.slice(-200).flatMap(row => {
    if (!record(row) || !member(row.stage, streamStages) || !finiteMs(row.elapsedMs)) return [];
    const clean: StreamTiming = { stage: row.stage, elapsedMs: row.elapsedMs };
    if (member(row.clock, ['audiotrack-timestamp', 'audiotrack-head-position', 'monotonic-observed'] as const)) clean.clock = row.clock;
    if (finiteMs(row.utteranceElapsedMs)) clean.utteranceElapsedMs = row.utteranceElapsedMs;
    for (const key of streamCounters) {
      const count = row[key];
      if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 && count <= 100000000) clean[key] = count;
    }
    if (httpStatus(row.httpStatus)) clean.httpStatus = row.httpStatus;
    return [clean];
  }) };
}

/** There is one runtime profile: a readable build-flags.json is native. */
export function sanitizeBuild(value: unknown) {
  if (!record(value)) return { runtimeProfile: null, testMocks: null };
  const testMocks = typeof value.testMocks === 'boolean' ? value.testMocks : null;
  const runtimeProfile = value.runtimeProfile === 'native' || (testMocks !== null && value.runtimeProfile === undefined) ? 'native' : null;
  return { runtimeProfile, testMocks };
}

export async function evaluate(socketUrl: string, expression: string, timeoutMs = 10000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(socketUrl);
    const timeout = setTimeout(() => finish(Error('Voice diagnostic read timed out')), timeoutMs);
    let settled = false;
    function finish(error: Error | null, value?: unknown) { if (settled) return; settled = true; clearTimeout(timeout); ws.close(); error ? reject(error) : resolve(value); }
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    ws.onerror = () => finish(Error('Cannot attach to Alpha WebView'));
    ws.onclose = () => { if (!settled) finish(Error('Alpha WebView closed during diagnostic read')); };
    ws.onmessage = event => {
      try { const result = JSON.parse(event.data); if (result.id !== 1) return;
        if (result.error || result.result?.exceptionDetails) return finish(Error('Alpha WebView could not export voice diagnostics'));
        finish(null, result.result?.result?.value);
      } catch { finish(Error('Invalid diagnostic response')); }
    };
  });
}

// The installed renderer persists pending marks on a zero-delay timer. Queue the
// snapshot on the same WebView timer queue, allowing for the 4 ms nested-timer minimum.
export const rendererTimingSnapshot = `new Promise(resolve => setTimeout(() => {
  try { resolve(JSON.parse(localStorage.getItem('alphaphone:voice-timing:v1') || '[]')); }
  catch { resolve([]); }
}, 4))`;

export async function collectDevice({ serial }: { serial?: string } = {}) {
  const args = serial ? ['-s', serial] : [];
  const adb = async (...command: string[]) => (await exec('adb', [...args, ...command], { timeout: 15000, maxBuffer: 2 * 1024 * 1024 })).stdout.trim();
  const pid = (await adb('shell', 'pidof', packageName)).split(/\s+/)[0];
  if (!/^\d+$/.test(pid)) throw Error('Alpha Phone must already be running with WebView debugging enabled');
  const socket = `webview_devtools_remote_${pid}`;
  if (!(await adb('shell', 'cat', '/proc/net/unix')).includes(`@${socket}`)) throw Error('This installed Alpha build does not expose a debug WebView');
  const installed = await adb('shell', 'dumpsys', 'package', packageName);
  const port = await adb('forward', 'tcp:0', `localabstract:${socket}`);
  if (!/^\d+$/.test(port)) throw Error('adb did not allocate a diagnostic port');
  try {
    const pages: { type: string; url: string; webSocketDebuggerUrl?: string }[] = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
    const page = pages.find(item => item.type === 'page' && item.url === 'https://localhost/');
    if (!page?.webSocketDebuggerUrl?.startsWith(`ws://127.0.0.1:${port}/`)) throw Error('The expected Alpha app page is unavailable');
    const raw = await evaluate(page.webSocketDebuggerUrl, `(async () => {
      const turns = await ${rendererTimingSnapshot};
      let build = null, native = null, streaming = null, provider = null;
      try { build = await (await fetch('/build-flags.json')).json(); } catch {}
      try { native = await Promise.race([window.Capacitor.Plugins.AlphaVoiceCloud.cloudVoiceTiming(), new Promise(resolve => setTimeout(() => resolve(null), 2000))]); } catch {}
      try {
        const status = await window.Capacitor.Plugins.Agent.providerStatus();
        provider = { provider: ['cerebras', 'elizacloud'].includes(status.provider) ? status.provider : null,
          configured: status.configured === true, voiceConfigured: status.voiceConfigured === true };
      } catch {}
      try { streaming = await window.Capacitor.Plugins.AlphaCloudSpeechStream.cloudStreamTiming(); } catch {}
      return { build, native, streaming, provider, turns };
    })()`);
    const value = record(raw) ? raw : {};
    const turns = sanitizeTurns(value.turns);
    const provider = value.provider;
    return { format: 'alpha-cloud-voice-diagnostic-v1', collectedAt: new Date().toISOString(),
      installed: { versionName: installed.match(/versionName=([A-Za-z0-9._-]+)/)?.[1] ?? null,
        versionCode: Number(installed.match(/versionCode=(\d+)/)?.[1]) || null,
        ...sanitizeBuild(value?.build) },
      currentProvider: record(provider) && member(provider.provider, ['cerebras', 'elizacloud'] as const)
        ? { provider: provider.provider, configured: provider.configured === true, voiceConfigured: provider.voiceConfigured === true } : null,
      boundary: 'Renderer recording-stop to playback-start; excludes speech endpoint silence and does not measure first physical audible sample.',
      turns, phases: summarizeTurns(turns), native: sanitizeNative(value?.native), streaming: sanitizeStreaming(value?.streaming) };
  } finally { await adb('forward', '--remove', `tcp:${port}`).catch(() => {}); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    let serial, output;
    for (let i = 2; i < process.argv.length; i++) {
      const key = process.argv[i];
      if (key === '--serial') serial = process.argv[++i];
      else if (key === '--out') output = process.argv[++i];
      else throw Error('Usage: bun scripts/android-cloud-voice-timing.ts [--serial DEVICE] [--out FILE]');
      if (!(key === '--serial' ? serial : output)) throw Error(`${key} needs a value`);
    }
    const report = await collectDevice({ serial });
    if (output) await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify(output ? { output, installed: report.installed, currentProvider: report.currentProvider, phases: report.phases, native: report.native, streaming: report.streaming } : report, null, 2));
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
