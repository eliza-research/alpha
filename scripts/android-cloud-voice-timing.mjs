#!/usr/bin/env node
/** Read only Alpha's numeric voice diagnostics from its running debug WebView.
 * No credential slots, transcripts, reply text, microphone, network speech requests,
 * installs or process restarts. The temporary adb forward is removed on exit.
 * Usage: node scripts/android-cloud-voice-timing.mjs [--serial DEVICE] [--out FILE]
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile);
const packageName = 'ai.elizaresearch.alphaphone';
const marks = ['recording-end', 'transcript-ready', 'send', 'first-token', 'final-reply', 'first-audio'];
const routes = ['on-device', 'browser', 'local-agent', 'eliza-cloud', 'paired-agent', 'development-agent', 'manual'];
const finiteMs = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 3_600_000;

/** Keep a fixed numeric/enum schema even if the device's storage is malformed. */
export function sanitizeTurns(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-200).flatMap(row => {
    if (!row || !routes.includes(row.route) || typeof row.cold !== 'boolean' || !row.marks || typeof row.marks !== 'object') return [];
    const clean = {};
    let previous = -1;
    for (const key of marks) {
      if (row.marks[key] === undefined) continue;
      if (!finiteMs(row.marks[key]) || row.marks[key] < previous) return [];
      clean[key] = row.marks[key]; previous = clean[key];
    }
    if (clean['recording-end'] !== 0) return [];
    return [{ route: row.route, cold: row.cold, ...(row.entry === 'conversation' || row.entry === 'notes' ? { entry: row.entry } : {}), ...(row.outcome === 'abandoned' ? { outcome: 'abandoned' } : {}), marks: clean }];
  });
}

export function summarizeTurns(turns) {
  return sanitizeTurns(turns).map(row => {
    const m = row.marks;
    const gap = (start, end) => m[start] === undefined || m[end] === undefined ? null : m[end] - m[start];
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
export function sanitizeNative(value) {
  if (value?.format !== 'alpha-cloud-speech-timing-v1' || !Array.isArray(value.records)) return null;
  return { format: value.format, records: value.records.slice(-100).flatMap(row => {
    if (!row || !['stt', 'tts'].includes(row.route) || !['active', 'completed', 'failed', 'cancelled'].includes(row.outcome)) return [];
    const clean = { route: row.route, outcome: row.outcome };
    if (['cartesia', 'unknown'].includes(row.provider)) clean.provider = row.provider;
    if (['reviewed', 'approved-hit'].includes(row.moderation)) clean.moderation = row.moderation;
    if (Number.isInteger(row.status) && row.status >= 100 && row.status <= 599) clean.status = row.status;
    for (const [key, fields] of [['marks', nativeMarks], ['phases', nativePhases], ['server', ['auth', 'admission', 'moderation', 'synthesis']]]) {
      if (!row[key] || typeof row[key] !== 'object') continue;
      clean[key] = Object.fromEntries(fields.filter(field => finiteMs(row[key][field])).map(field => [field, row[key][field]]));
    }
    return [clean];
  }) };
}

const streamStages = ['start', 'consent-start', 'consent-headers', 'consent-body', 'mint-start', 'mint-headers', 'mint-body', 'ws-open', 'ready', 'stt-connected', 'speech-start', 'asr-final', 'tts-request', 'first-pcm', 'first-audible', 'audio-end', 'error', 'stop'];
export function sanitizeStreaming(value) {
  if (value?.format !== 'alpha-cloud-stream-timing-v1' || !Array.isArray(value.records)) return null;
  return { format: value.format, records: value.records.slice(-200).flatMap(row => {
    if (!row || !streamStages.includes(row.stage) || !finiteMs(row.elapsedMs)) return [];
    const clean = { stage: row.stage, elapsedMs: row.elapsedMs };
    if (['audiotrack-timestamp', 'audiotrack-head-position', 'monotonic-observed'].includes(row.clock)) clean.clock = row.clock;
    if (finiteMs(row.utteranceElapsedMs)) clean.utteranceElapsedMs = row.utteranceElapsedMs;
    for (const key of ['session', 'sentFrames', 'sentBytes', 'receivedFrames', 'receivedBytes']) {
      if (Number.isSafeInteger(row[key]) && row[key] >= 0 && row[key] <= 100000000) clean[key] = row[key];
    }
    if (Number.isInteger(row.httpStatus) && row.httpStatus >= 100 && row.httpStatus <= 599) clean.httpStatus = row.httpStatus;
    return [clean];
  }) };
}

export async function evaluate(socketUrl, expression, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(socketUrl);
    const timeout = setTimeout(() => finish(Error('Voice diagnostic read timed out')), timeoutMs);
    let settled = false;
    function finish(error, value) { if (settled) return; settled = true; clearTimeout(timeout); ws.close(); error ? reject(error) : resolve(value); }
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

export async function collectDevice({ serial } = {}) {
  const args = serial ? ['-s', serial] : [];
  const adb = async (...command) => (await exec('adb', [...args, ...command], { timeout: 15000, maxBuffer: 2 * 1024 * 1024 })).stdout.trim();
  const pid = (await adb('shell', 'pidof', packageName)).split(/\s+/)[0];
  if (!/^\d+$/.test(pid)) throw Error('Alpha Phone must already be running with WebView debugging enabled');
  const socket = `webview_devtools_remote_${pid}`;
  if (!(await adb('shell', 'cat', '/proc/net/unix')).includes(`@${socket}`)) throw Error('This installed Alpha build does not expose a debug WebView');
  const installed = await adb('shell', 'dumpsys', 'package', packageName);
  const port = await adb('forward', 'tcp:0', `localabstract:${socket}`);
  if (!/^\d+$/.test(port)) throw Error('adb did not allocate a diagnostic port');
  try {
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
    const page = pages.find(item => item.type === 'page' && item.url === 'https://localhost/');
    if (!page?.webSocketDebuggerUrl?.startsWith(`ws://127.0.0.1:${port}/`)) throw Error('The expected Alpha app page is unavailable');
    const value = await evaluate(page.webSocketDebuggerUrl, `(async () => {
      let build = null, native = null, streaming = null, provider = null, turns = [];
      try { turns = JSON.parse(localStorage.getItem('alphaphone:voice-timing:v1') || '[]'); } catch {}
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
    const turns = sanitizeTurns(value?.turns);
    return { format: 'alpha-cloud-voice-diagnostic-v1', collectedAt: new Date().toISOString(),
      installed: { versionName: installed.match(/versionName=([A-Za-z0-9._-]+)/)?.[1] ?? null,
        versionCode: Number(installed.match(/versionCode=(\d+)/)?.[1]) || null,
        runtimeProfile: ['native', 'cloud'].includes(value?.build?.runtimeProfile) ? value.build.runtimeProfile : null,
        testMocks: typeof value?.build?.testMocks === 'boolean' ? value.build.testMocks : null },
      currentProvider: value?.provider && ['cerebras', 'elizacloud'].includes(value.provider.provider)
        ? { provider: value.provider.provider, configured: value.provider.configured === true, voiceConfigured: value.provider.voiceConfigured === true } : null,
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
      else throw Error('Usage: node scripts/android-cloud-voice-timing.mjs [--serial DEVICE] [--out FILE]');
      if (!(key === '--serial' ? serial : output)) throw Error(`${key} needs a value`);
    }
    const report = await collectDevice({ serial });
    if (output) await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify(output ? { output, installed: report.installed, currentProvider: report.currentProvider, phases: report.phases, native: report.native, streaming: report.streaming } : report, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
