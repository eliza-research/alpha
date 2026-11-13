#!/usr/bin/env bun
// Drives ResidentServiceInstrumentedTest on a disposable emulator in a fresh secondary user.
// Usage: ALPHA_RESIDENT_DISPOSABLE_EMULATOR=1 ANDROID_SERIAL=<fresh arm64 emulator, >=4 GB RAM> bun scripts/android-resident-instrumentation.ts <app.apk> <androidTest.apk>
// RESIDENT_TEST selects the class (default: the egress redaction test). Removes the fixture user afterwards.
// Emulator evidence only; not physical-device or image acceptance.
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {sha256 as sha} from './sha256.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { admitResidentEmulator, removeResidentFixtureUser } from './resident-emulator-admission.ts';
const [apk, testApk] = process.argv.slice(2);
const serial = process.env.ANDROID_SERIAL;
if (!serial || !apk || !testApk) throw Error('ANDROID_SERIAL, app APK and test APK are required');
const adb = (args: string[], opts: Omit<import('node:child_process').ExecFileSyncOptionsWithStringEncoding, 'encoding'> = {}) => execFileSync('adb', ['-s', serial, ...args], {encoding: 'utf8', maxBuffer: 64 << 20, ...opts}).trim();
const pkg = 'ai.alphacompute.alphaphone';
// Installation replaces package code across users. A secondary user alone does
// not protect an existing installation, and must not admit a physical phone.
admitResidentEmulator(process.env, adb);
const entry = (name: string) => execFileSync('unzip', ['-p', apk, name], {maxBuffer: 1 << 30});
const runId = randomUUID();
const test = process.env.RESIDENT_TEST || `${pkg}.ResidentEgressRedactionInstrumentedTest`;
const proofFile = test.includes('ResidentEgressRedaction') ? 'files/resident-redaction-complete.json' : 'files/resident-service-complete.json';
const keyPath = path.join(os.homedir(), '.config/alphaphone/cerebras-key');
if ((fs.statSync(keyPath).mode & 0o077) !== 0) throw Error('Provider key must be owner-only');
const bun = sha(entry('lib/arm64-v8a/libeliza_bun.so'));
const fixture = {runId, apiKey: fs.readFileSync(keyPath, 'utf8').trim(), bunSha256: bun, processExecutableSha256: bun,
  bundleSha256: sha(entry('assets/agent/agent-bundle.js')), sourceSha256: sha(entry('assets/agent/alpha-source.json'))};
const fixtureName = `alpha-resident-${runId}`;
const created = adb(['shell', 'pm', 'create-user', fixtureName]);
const user = /^Success: created user id ([1-9]\d*)$/.exec(created)?.[1];
if (!user) throw Error('Could not create fixture user: ' + created);
// apkSha256 binds this record to the installed app APK.
type Proof = { runId?: string; passed?: boolean };
let result: { runId: string; user: string; test: string; apkSha256: string; passed: boolean; proof?: Proof | null; instrumentation?: string } = {runId, user, test, apkSha256: sha(fs.readFileSync(apk)), passed: false};
try {
  adb(['shell', 'am', 'start-user', '-w', user]);
  adb(['install', '--user', user, '-r', '-t', apk]);
  adb(['install', '--user', user, '-r', '-t', testApk]);
  adb(['shell', 'run-as', pkg, '--user', user, 'sh', '-c', "'umask 077; mkdir -p files; cat > files/resident-provider-input.json'"], {input: JSON.stringify(fixture)});
  const output = adb(['shell', 'am', 'instrument', '-w', '-r', '--user', user, '-e', 'residentService', '1', '-e', 'residentRunId', runId,
    '-e', 'class', test, `${pkg}.test/androidx.test.runner.AndroidJUnitRunner`], {timeout: 900000});
  let proof: Proof | null = null;
  try { proof = JSON.parse(adb(['shell', 'run-as', pkg, '--user', user, 'cat', proofFile])); } catch {}
  result = {...result, passed: /OK \(1 test\)/.test(output) && proof?.passed === true && proof?.runId === runId, proof, instrumentation: output.split('\n').slice(-25).join('\n')};
} finally {
  // A passing test cannot hide a retained credential-bearing fixture.
  removeResidentFixtureUser(adb, user, fixtureName);
}
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.passed ? 0 : 1;
