// Alpha's launcher APKs are built by the pinned upstream consumer build orchestration
// (AP-02). These checks run that orchestration with Alpha's options and a stand-in for Gradle
// and the verifier; they assemble no APK and are not APK, emulator or device evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {buildAndroidConsumer} from '../vendor/eliza/packages/app/scripts/mobile/android/build-consumer.mjs';
import {SIGNING_ENV, buildEnv, consumerBuildOptions, parseBuildArgs} from '../scripts/build-android.ts';

const SIGNING = Object.fromEntries(SIGNING_ENV.map(name => [name, `value-of-${name}`]));

function build(t, {environment = {}, signed = false, release = true} = {}) {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-consumer-build-'));
 t.after(() => fs.rmSync(root, {recursive: true, force: true}));
 const env = buildEnv({PATH: process.env.PATH, ...environment});
 const consumer = consumerBuildOptions(env, root, undefined, {release});
 const calls = [], seen = [];
 const outputs = path.join(root, 'android/app/build/outputs');
 const write = (relative, value) => {
  fs.mkdirSync(path.dirname(path.join(outputs, relative)), {recursive: true});
  fs.writeFileSync(path.join(outputs, relative), value);
 };
 const run = (command, args, opts) => {
  calls.push({command, args, cwd: opts.cwd, env: opts.env});
  if (command === './gradlew') for (const task of args) {
   const match = /^:app:assemble(Launcher)(Debug|Release|DebugAndroidTest)$/.exec(task);
   if (!match) continue;
   const variant = match[1].toLowerCase();
   if (match[2] === 'Debug') write(`apk/${variant}/debug/app-${variant}-debug.apk`, `${variant}:debug`);
   else if (match[2] === 'DebugAndroidTest') write(`apk/androidTest/${variant}/debug/app-${variant}-debug-androidTest.apk`, `${variant}:test`);
   else {
    write(`apk/${variant}/release/app-${variant}-release${signed ? '' : '-unsigned'}.apk`, `${variant}:release`);
    write(`mapping/${variant}Release/mapping.txt`, `${variant}:mapping`);
   }
  }
  if (command === 'bun' && args[0] === 'scripts/verify-apks.ts') {
   // verify-apks reads the build record beside the APKs it verifies.
   const directory = path.join(opts.cwd, consumer.output);
   seen.push({record: JSON.parse(fs.readFileSync(path.join(directory, 'build-config.json'), 'utf8')), apks: fs.readdirSync(directory).filter(name => name.endsWith('.apk')).sort()});
   fs.writeFileSync(path.join(directory, 'apk-manifest.json'), '{}');
  }
 };
 const result = buildAndroidConsumer({...consumer, run});
 return {root, calls, seen, result, output: path.join(root, consumer.output)};
}

const gradleCalls = calls => calls.filter(call => call.command === './gradlew');

test('a release build assembles the launcher APKs and instrumentation, lints and verifies them flag-off', t => {
 const f = build(t, {environment: {ELIZA_DEV_ALLOW_TEST_MOCKS: '1', VITE_ELIZA_DEV_ALLOW_TEST_MOCKS: '1'}});
 const [gradle] = gradleCalls(f.calls);
 assert.equal(gradleCalls(f.calls).length, 1);
 assert.equal(gradle.cwd, path.join(f.root, 'android'));
 assert.equal(gradle.env.ELIZA_DEV_ALLOW_TEST_MOCKS, undefined);
 assert.equal(gradle.env.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS, undefined);
 assert.deepEqual(gradle.args, ['--no-daemon', ':app:assembleLauncherDebug', ':app:assembleLauncherRelease', ':app:assembleLauncherDebugAndroidTest', ':app:lint']);
 assert.equal(f.output, path.join(f.root, 'artifacts'));
 assert.deepEqual(fs.readdirSync(f.output).sort(), ['apk-manifest.json', 'build-config.json', 'instrumentation', 'launcher-debug.apk',
  'launcher-release-unsigned.apk', 'mapping']);
 assert.deepEqual(fs.readdirSync(path.join(f.output, 'instrumentation')).sort(), ['launcher-androidTest.apk']);
 assert.deepEqual(fs.readdirSync(path.join(f.output, 'mapping')).sort(), ['launcher-release-mapping.txt']);
 // The verifier ran once, after this build's APKs and its record were in place.
 assert.deepEqual(f.calls.filter(call => call.command === 'bun').map(call => call.args), [['scripts/verify-apks.ts']]);
 assert.equal(f.seen.length, 1);
 assert.deepEqual(f.seen[0].apks, ['launcher-debug.apk', 'launcher-release-unsigned.apk']);
 const {createdAt, ...record} = f.seen[0].record;
 assert.ok(!Number.isNaN(Date.parse(createdAt)));
 const updateChannel={kind:'public',manifestUrlSha256:createHash('sha256').update(JSON.parse(fs.readFileSync('app.config.json','utf8')).updateManifestUrl).digest('hex')};
 assert.deepEqual(record, {testMocks: false, release: true, runtimeProfile: 'native', updateChannel, mapsProvider: 'cloud', signingRequested: false, versionOverride: {code: null, name: null}});
 assert.deepEqual(f.result.files.map(file => path.basename(file)), ['launcher-debug.apk', 'launcher-release-unsigned.apk']);
});

test('a local build assembles only the debug APK and its instrumentation and records release:false', t => {
 assert.deepEqual(parseBuildArgs([]), {release: false});
 assert.deepEqual(parseBuildArgs(['--release']), {release: true});
 assert.throws(() => parseBuildArgs(['--release', '--release']), /Unknown option/);
 assert.throws(() => parseBuildArgs(['--debug']), /Unknown option/);
 const f = build(t, {release: false});
 assert.deepEqual(gradleCalls(f.calls).map(call => call.args), [['--no-daemon', ':app:assembleLauncherDebug', ':app:assembleLauncherDebugAndroidTest', ':app:lint']]);
 assert.deepEqual(fs.readdirSync(f.output).sort(), ['apk-manifest.json', 'build-config.json', 'instrumentation', 'launcher-debug.apk']);
 assert.deepEqual(f.seen[0].apks, ['launcher-debug.apk']);
 assert.equal(f.seen[0].record.release, false);
 assert.deepEqual(f.result.files.map(file => path.basename(file)), ['launcher-debug.apk']);
 // Upstream refuses to archive a debug-only build.
 const {release, ...options} = consumerBuildOptions(buildEnv({}), f.root, undefined, {release: false});
 assert.equal(release, false);
 assert.throws(() => buildAndroidConsumer({...options, release, archive: {name: 'local'}, run: () => {}}), /debug-only Android build cannot be archived/);
});

test('a version override reaches the build record', t => {
 const f = build(t, {environment: {ELIZAOS_VERSION_CODE: '41', ELIZAOS_VERSION_NAME: '1.4.1'}});
 assert.deepEqual(f.seen[0].record.versionOverride, {code: '41', name: '1.4.1'});
});

test('release signing names come from the host descriptor: a signed release keeps its name, an unsigned one with every name set fails', t => {
 const signed = build(t, {environment: SIGNING, signed: true});
 assert.ok(fs.existsSync(path.join(signed.output, 'launcher-release.apk')));
 assert.equal(signed.seen[0].record.signingRequested, true);
 // Only names reach the record and Gradle arguments; values stay in the environment.
 assert.equal(JSON.stringify(signed.seen[0].record).includes('value-of-'), false);
 assert.equal(gradleCalls(signed.calls)[0].args.some(arg => arg.includes('value-of-')), false);
 assert.throws(() => build(t, {environment: SIGNING, signed: false}), new RegExp(`${SIGNING_ENV.join(', ')} are set but Gradle produced an unsigned launcher release`));
});
