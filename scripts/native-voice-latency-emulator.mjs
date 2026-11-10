#!/usr/bin/env node
/**
 * Issue #395 emulator campaign: runs NativeVoiceLatencyInstrumentedTest on an owned emulator while
 * scripts/inject-emulator-audio.py streams speech WAVs into its virtual microphone, then pulls the
 * alpha-native-voice-timing-v3 export and aggregates it.
 *
 *   node scripts/native-voice-latency-emulator.mjs --serial emulator-5610 --avd <name> \
 *     --python <venv python with grpcio> --wav q1.wav [--wav q2.wav ...] \
 *     [--trials 60] [--cold-every 6] [--gap-seconds 9] [--feed] --out <new directory>
 *
 * --feed pushes the WAVs to the app's external files and has the harness read them as a paced feed
 * instead of the virtual microphone (no --python needed). Use it when the emulator's microphone
 * delivers silence (seen on a heavily loaded macOS host: the ranchu HAL logs pcm_readi failures).
 * Feed trials carry the synthetic-feed capture clock.
 *
 * The app and androidTest APKs must already be installed (developer APKs that carry the voice bundle
 * and the app JNI bridge). Only the emulator whose console reports --avd is used; the run never
 * starts, stops, wipes or reconfigures an emulator. The microphone audio is synthetic and the timing
 * is the emulator's: every result is emulator-class (E) diagnostic evidence, not device latency.
 */
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { aggregate, nativeTable } from './aggregate-voice-latency.mjs';

const PACKAGE = 'ai.elizaresearch.alphaphone';
const ROOT = path.resolve(import.meta.dirname, '..');
const CLASS = `${PACKAGE}.NativeVoiceLatencyInstrumentedTest`;

export function parse(argv) {
  const options = { wavs: [], trials: 60, coldEvery: 6, gapSeconds: 9, feed: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--feed') { options.feed = true; continue; }
    const key = argv[i], value = argv[++i];
    if (value === undefined) throw new Error(`${key} needs a value`);
    if (key === '--serial') options.serial = value;
    else if (key === '--avd') options.avd = value;
    else if (key === '--python') options.python = value;
    else if (key === '--wav') options.wavs.push(value);
    else if (key === '--out') options.out = value;
    else if (key === '--trials') options.trials = Number(value);
    else if (key === '--cold-every') options.coldEvery = Number(value);
    else if (key === '--gap-seconds') options.gapSeconds = Number(value);
    else throw new Error(`Unknown option ${key}`);
  }
  if (!/^emulator-(\d+)$/.test(options.serial ?? '')) throw new Error('--serial emulator-<port> is required');
  if (!/^[A-Za-z0-9_.-]+$/.test(options.avd ?? '')) throw new Error('--avd <name> of the owned emulator is required');
  if ((!options.feed && !options.python) || !options.wavs.length || !options.out) throw new Error('--wav, --out and (without --feed) --python are required');
  if (!Number.isInteger(options.trials) || options.trials < 1 || !Number.isInteger(options.coldEvery) || options.coldEvery < 2 || !(options.gapSeconds >= 0.5 && options.gapSeconds <= 60)) throw new Error('--trials >= 1, --cold-every >= 2, --gap-seconds 0.5-60');
  options.port = Number(options.serial.slice('emulator-'.length));
  return options;
}

/** Repetitions of the WAV list that cover the requested trials plus skipped or failed turns. */
export const repetitions = (trials, wavs) => Math.min(200, Math.ceil((trials * 1.25 + 4) / wavs));

async function main() {
  const options = parse(process.argv.slice(2));
  if (fs.existsSync(options.out)) throw new Error(`${options.out} exists; evidence is never replaced`);
  const adb = (...args) => execFileSync('adb', ['-s', options.serial, ...args], { encoding: 'utf8' }).trim();
  const avd = adb('emu', 'avd', 'name').split(/\r?\n/)[0].trim();
  if (avd !== options.avd) throw new Error(`${options.serial} runs AVD ${JSON.stringify(avd)}, not ${options.avd}`);
  for (const name of [PACKAGE, `${PACKAGE}.test`]) if (!adb('shell', 'pm', 'path', name).startsWith('package:')) throw new Error(`${name} is not installed on ${options.serial}`);
  fs.mkdirSync(options.out, { recursive: true });
  if (options.feed) {
    // Into the debuggable app's own files: shared storage created by the shell is not readable by the app.
    adb('shell', 'run-as', PACKAGE, 'sh', '-c', 'rm -rf files/latency-feed && mkdir -p files/latency-feed');
    options.wavs.forEach((file, index) => execFileSync('adb', ['-s', options.serial, 'exec-in', 'run-as', PACKAGE, 'sh', '-c', `cat > files/latency-feed/${String(index).padStart(3, '0')}.wav`], { input: fs.readFileSync(file) }));
  }
  const device = { serial: options.serial, avd, abi: adb('shell', 'getprop', 'ro.product.cpu.abi'), sdk: adb('shell', 'getprop', 'ro.build.version.sdk'), fingerprint: adb('shell', 'getprop', 'ro.build.fingerprint'), qemu: adb('shell', 'getprop', 'ro.kernel.qemu') || adb('shell', 'getprop', 'ro.boot.qemu') };
  const instrument = spawn('adb', ['-s', options.serial, 'shell', 'am', 'instrument', '-w', '-r', '-e', 'class', CLASS, '-e', 'nativeVoiceLatency', '1', '-e', 'trials', String(options.trials), '-e', 'coldEvery', String(options.coldEvery), ...(options.feed ? ['-e', 'feed', '1', '-e', 'gapSeconds', String(options.gapSeconds)] : []), `${PACKAGE}.test/androidx.test.runner.AndroidJUnitRunner`]);
  let output = '';
  instrument.stdout.on('data', chunk => { output += chunk; });
  instrument.stderr.on('data', chunk => { output += chunk; });
  let instrumentExit;
  const finished = new Promise(resolve => instrument.on('close', code => { instrumentExit = code; resolve(code); }));
  // The harness installs the voice bundle and opens both engines, then reports that it listens.
  const deadline = Date.now() + 600000;
  while (!/nativeVoiceLatencyReady=1/.test(output) && instrumentExit === undefined && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 1000));
  if (!/nativeVoiceLatencyReady=1/.test(output)) {
    instrument.kill('SIGTERM');
    fs.writeFileSync(path.join(options.out, 'instrumentation.txt'), output);
    throw new Error(`The harness never reported that it listens; see ${path.join(options.out, 'instrumentation.txt')}`);
  }
  const inject = options.feed ? null : spawn(options.python, [path.join(ROOT, 'scripts/inject-emulator-audio.py'), '--port', String(options.port), '--repeat', String(repetitions(options.trials, options.wavs.length)), '--gap-seconds', String(options.gapSeconds), '--inject', ...options.wavs], { stdio: ['ignore', 'pipe', 'pipe'] });
  let injection = options.feed ? 'feed mode: no microphone injection\n' : '';
  let injectExit;
  if (inject) {
    inject.stdout.on('data', chunk => { injection += chunk; });
    inject.stderr.on('data', chunk => { injection += chunk; });
    // An injector that stops early (authentication, gRPC) would leave the harness waiting out its timeout.
    inject.on('close', code => { injectExit = code; if (code !== 0 && instrumentExit === undefined) instrument.kill('SIGTERM'); });
  }
  const status = await finished;
  if (inject) {
    if (inject.exitCode === null) inject.kill('SIGTERM');
    await new Promise(resolve => (injectExit !== undefined ? resolve() : inject.on('close', () => resolve())));
  }
  fs.writeFileSync(path.join(options.out, 'instrumentation.txt'), output);
  fs.writeFileSync(path.join(options.out, 'injection.txt'), injection);
  // The harness rewrites its export after every turn; a run the emulator cut short keeps its trials.
  const exported = /nativeVoiceLatencyExport=(\S+)/.exec(output)?.[1] ?? /nativeVoiceLatencyExportPath=(\S+)/.exec(output)?.[1];
  const report = { campaign: 'issue-395-native-voice-latency-emulator', evidenceClass: 'E', notEvidenceFor: ['device latency', 'acoustic output timing', 'physical microphone', 'voice-assistant acceptance (no language model ran)'], device, options: { source: options.feed ? 'synthetic-feed' : 'virtual-microphone', trials: options.trials, coldEvery: options.coldEvery, gapSeconds: options.gapSeconds, wavs: options.wavs.map(file => path.basename(file)) }, instrumentationExit: status, injectorExit: injectExit ?? null, passed: /OK \(1 test\)/.test(output) };
  if (exported) {
    const local = path.join(options.out, 'native-voice-timing.json');
    try { execFileSync('adb', ['-s', options.serial, 'pull', exported, local], { stdio: 'ignore' }); }
    catch { report.exportUnavailable = 'the emulator stopped before the export could be pulled'; fs.writeFileSync(path.join(options.out, 'report.json'), JSON.stringify(report, null, 2) + '\n'); throw new Error(report.exportUnavailable); }
    const summary = aggregate([JSON.parse(fs.readFileSync(local, 'utf8'))], { warm: 20, cold: 5 });
    fs.writeFileSync(path.join(options.out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
    report.cohorts = nativeTable(summary.native);
    for (const line of report.cohorts) console.log(line);
  }
  fs.writeFileSync(path.join(options.out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  if (!report.passed || !exported) { console.error(`The harness did not complete; see ${path.join(options.out, 'instrumentation.txt')}`); process.exit(1); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exit(1); });
