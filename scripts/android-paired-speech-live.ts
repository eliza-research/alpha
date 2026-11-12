/** Actual paired speech and native decoding with synthetic recording ingress. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { androidEnv } from './toolchain.ts';

const mode = process.argv[2];
if (process.argv.length !== 3 || (mode !== 'asr' && mode !== 'voice'))
  throw Error('Usage: bun scripts/android-paired-speech-live.ts asr|voice');

const { ANDROID_SERIAL: serial, ALPHA_BUILD_ARCHIVE: archive, ALPHA_ASR_PROFILE: asrProfile } = process.env;
if (!serial || !/^emulator-\d+$/.test(serial) || !archive)
  throw Error('Explicit disposable ANDROID_SERIAL and ALPHA_BUILD_ARCHIVE required');
// The host requires its owner token to issue a pairing code.
if (mode === 'asr' && (!asrProfile || !path.isAbsolute(asrProfile)))
  throw Error('Explicit absolute ALPHA_ASR_PROFILE (the 47846 host profile) required');

const campaign = mode === 'asr'
  ? {
      port: 47846, gate: 'pairedAsrLive', testClass: 'PairedAsrLiveInstrumentedTest',
      profile: asrProfile!,
      scope: 'Actual paired agent ASR (/api/asr/libelizainference, libelizainference provider) + Notes explicit synthetic AAC upload, native PCM conversion, real transcript review/edit + TTS Listen decoded completion/cancel. Recording ingress is instrumented synthetic AAC; no microphone, Cloud, or enclave acceptance. Original selection and encrypted credential restored by test finally.',
    }
  : {
      port: 47844, gate: 'pairedVoiceLive', testClass: 'PairedVoiceLiveInstrumentedTest',
      profile: path.join(os.homedir(), '.local/share/alphaphone/local-voice'),
      scope: 'Actual paired Eliza47844 capability + Notes explicit synthetic manual transcript Listen + native decoded completion/cancel. Recording ingress is instrumented synthetic PCM; no microphone, ASR, Cloud, or enclave acceptance. Original selection and encrypted credential restored by test finally.',
    };
const fixture = `paired-${mode}-live`;
const out = path.join(archive, fixture);
const env = androidEnv();
const adb = path.join(env.ANDROID_HOME, 'platform-tools/adb');
const { appId }: { appId: string } = JSON.parse(fs.readFileSync('app.config.json', 'utf8'));
const manifest: Record<string, string> = JSON.parse(fs.readFileSync(path.join(archive, 'apk-manifest.json'), 'utf8'));
const run = (args: string[], input?: string) => execFileSync(adb, ['-s', serial, ...args], {
  env, input, encoding: 'utf8', timeout: args.includes('instrument') ? 360000 : 120000,
});
const hash = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

interface Result {
  variant: string;
  sha256: string;
  testSha256: string;
  passed: boolean;
  stage?: string;
  fixtureCleanupFailed?: true;
}
const results: Result[] = [];
fs.mkdirSync(out, { recursive: true });
for (const variant of ['standalone', 'launcher']) {
  const apk = path.join(archive, `${variant}-debug.apk`);
  const testApk = path.join(archive, `${variant}-androidTest.apk`);
  const sha256 = hash(apk), testSha256 = hash(testApk);
  assert.equal(manifest[path.basename(apk)], sha256);
  assert.equal(manifest[path.basename(testApk)], testSha256);
  const record: Result = { variant, sha256, testSha256, passed: false };
  let stage = 'install';
  try {
    for (const file of [apk, testApk]) run(['install', '--no-incremental', '-r', file]);
    run(['shell', 'am', 'force-stop', appId]);
    stage = 'private pairing fixture';
    const response = await fetch(`http://127.0.0.1:${campaign.port}/api/auth/pair-code`, {
      headers: { Authorization: 'Bearer ' + fs.readFileSync(path.join(campaign.profile, 'owner-token'), 'utf8').trim() },
      redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw Error('Pairing unavailable');
    const data: { code?: unknown } = await response.json();
    if (typeof data?.code !== 'string' || !data.code) throw Error('Invalid pairing fixture');
    run(['shell', `run-as ${appId} sh -c 'umask 077; mkdir -p files; cat > files/${fixture}.json'`],
      JSON.stringify({ origin: `http://10.0.2.2:${campaign.port}`, code: data.code }));
    stage = 'native Notes flow';
    const log = run(['shell', 'am', 'instrument', '-w', '-e', campaign.gate, '1', '-e', 'class',
      `${appId}.${campaign.testClass}`, `${appId}.test/androidx.test.runner.AndroidJUnitRunner`]);
    fs.writeFileSync(path.join(out, `${variant}.txt`), log);
    record.passed = /OK \(1 test\)/.test(log) && !/FAILURES|INSTRUMENTATION_FAILED|Process crashed/.test(log);
  } catch {
    // Command arguments can contain private pairing input.
  } finally {
    record.stage = stage;
    try { run(['shell', `run-as ${appId} rm -f files/${fixture}.json`]); }
    catch { record.fixtureCleanupFailed = true; record.passed = false; }
  }
  results.push(record);
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({
    testedAt: new Date().toISOString(), serial, archive, scope: campaign.scope, results,
  }, null, 2));
  console.log(`${variant}: ${record.passed ? 'passed' : 'failed'} (${record.stage})`);
}
if (results.some(record => !record.passed)) process.exitCode = 1;
