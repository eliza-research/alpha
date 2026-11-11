// Alpha's four distribution APKs are built by the pinned upstream consumer build orchestration
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

function build(t, argv, {environment = {}, signed = false} = {}) {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-consumer-build-'));
 t.after(() => fs.rmSync(root, {recursive: true, force: true}));
 const options = parseBuildArgs(argv);
 const env = buildEnv({PATH: process.env.PATH, ...environment}, options);
 const consumer = consumerBuildOptions(options, env, root);
 const calls = [], seen = [];
 const outputs = path.join(root, 'android/app/build/outputs');
 const write = (relative, value) => {
  fs.mkdirSync(path.dirname(path.join(outputs, relative)), {recursive: true});
  fs.writeFileSync(path.join(outputs, relative), value);
 };
 const run = (command, args, opts) => {
  calls.push({command, args, cwd: opts.cwd, env: opts.env});
  if (command === './gradlew') for (const task of args) {
   const match = /^:app:assemble(Standalone|Launcher)(Debug|Release|DebugAndroidTest)$/.exec(task);
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

test('a distribution build assembles the four APKs and instrumentation, lints and verifies them flag-off', t => {
 const f = build(t, []);
 const [gradle] = gradleCalls(f.calls);
 assert.equal(gradleCalls(f.calls).length, 1);
 assert.equal(gradle.cwd, path.join(f.root, 'android'));
 assert.equal(gradle.env.ELIZA_DEV_ALLOW_TEST_MOCKS, undefined);
 assert.deepEqual(gradle.args, ['--no-daemon', '-PELIZA_DEV_ALLOW_TEST_MOCKS=0', '-PELIZA_ALLOW_UNPACKAGED_RUNTIME=0',
  ':app:assembleStandaloneDebug', ':app:assembleLauncherDebug', ':app:assembleStandaloneRelease', ':app:assembleLauncherRelease',
  ':app:assembleStandaloneDebugAndroidTest', ':app:assembleLauncherDebugAndroidTest', ':app:lint']);
 assert.equal(f.output, path.join(f.root, 'artifacts'));
 assert.deepEqual(fs.readdirSync(f.output).sort(), ['apk-manifest.json', 'build-config.json', 'instrumentation', 'launcher-debug.apk',
  'launcher-release-unsigned.apk', 'mapping', 'standalone-debug.apk', 'standalone-release-unsigned.apk']);
 assert.deepEqual(fs.readdirSync(path.join(f.output, 'instrumentation')).sort(), ['launcher-androidTest.apk', 'standalone-androidTest.apk']);
 assert.deepEqual(fs.readdirSync(path.join(f.output, 'mapping')).sort(), ['launcher-release-mapping.txt', 'standalone-release-mapping.txt']);
 // The verifier ran once, after this build's four APKs and its record were in place.
 assert.deepEqual(f.calls.filter(call => call.command === 'bun').map(call => call.args), [['scripts/verify-apks.ts']]);
 assert.equal(f.seen.length, 1);
 assert.deepEqual(f.seen[0].apks, ['launcher-debug.apk', 'launcher-release-unsigned.apk', 'standalone-debug.apk', 'standalone-release-unsigned.apk']);
 const {createdAt, ...record} = f.seen[0].record;
 assert.ok(!Number.isNaN(Date.parse(createdAt)));
 const updateChannel={kind:'public',manifestUrlSha256:createHash('sha256').update(JSON.parse(fs.readFileSync('app.config.json','utf8')).updateManifestUrl).digest('hex')};
 assert.deepEqual(record, {testMocks: false, runtimeProfile: 'native', updateChannel, mapsProvider: 'cloud', signingRequested: false, versionOverride: {code: null, name: null}});
 assert.deepEqual(f.result.files.map(file => path.basename(file)), ['standalone-debug.apk', 'standalone-release-unsigned.apk', 'launcher-debug.apk', 'launcher-release-unsigned.apk']);
});

test('a test-mocks build keeps its instrumentation beside its APKs, skips lint and is verified as test mocks', t => {
 const f = build(t, ['--test-mocks']);
 const [gradle] = gradleCalls(f.calls);
 assert.equal(gradle.env.ELIZA_DEV_ALLOW_TEST_MOCKS, '1');
 assert.ok(gradle.args.includes('-PELIZA_DEV_ALLOW_TEST_MOCKS=1'));
 assert.ok(!gradle.args.includes(':app:lint'));
 assert.equal(f.output, path.join(f.root, 'artifacts/test-mocks'));
 assert.deepEqual(fs.readdirSync(f.output).filter(name => name.endsWith('-androidTest.apk')).sort(), ['launcher-androidTest.apk', 'standalone-androidTest.apk']);
 assert.equal(fs.existsSync(path.join(f.output, 'instrumentation')), false);
 assert.deepEqual(f.calls.filter(call => call.command === 'bun').map(call => call.args), [['scripts/verify-apks.ts', '--test-mocks']]);
 assert.equal(f.seen[0].record.testMocks, true);
 assert.equal(f.seen[0].record.mapsProvider, 'cloud');
 const regional = build(t, ['--test-mocks'], {environment: {VITE_MAPS_BASE_URL: 'http://127.0.0.1:8787'}});
 assert.equal(regional.seen[0].record.mapsProvider, 'regional-gateway');
});

test('the one-profile distribution, unpackaged and skipped-instrumentation builds carry their selection to Gradle, the record and the verifier', t => {
 // One runtime profile: no profile property reaches Gradle or the verifier, and the removed options are refused.
 for (const removed of [['--runtime-profile=cloud'], ['--runtime-profile=native'], ['--local-embeddings'], ['--runtime-profile=cloud', '--local-embeddings']])
  assert.throws(() => parseBuildArgs(removed), /There is one runtime profile now: remove --runtime-profile and --local-embeddings/);
 const cloud = build(t, [], {environment: {VITE_MAPS_BASE_URL: 'https://maps.example.test', ELIZAOS_VERSION_CODE: '41', ELIZAOS_VERSION_NAME: '1.4.1', VITE_ELIZA_RUNTIME_PROFILE: 'cloud', ORG_GRADLE_PROJECT_ELIZA_RUNTIME_PROFILE: 'cloud', ORG_GRADLE_PROJECT_ELIZA_LOCAL_EMBEDDINGS: '1'}});
 assert.deepEqual(gradleCalls(cloud.calls)[0].args.slice(0, 3), ['--no-daemon', '-PELIZA_DEV_ALLOW_TEST_MOCKS=0', '-PELIZA_ALLOW_UNPACKAGED_RUNTIME=0']);
 assert.equal(gradleCalls(cloud.calls)[0].args.some(arg => /RUNTIME_PROFILE|LOCAL_EMBEDDINGS/.test(arg)), false);
 assert.deepEqual(cloud.calls.filter(call => call.command === 'bun').map(call => call.args), [['scripts/verify-apks.ts']]);
 assert.equal(cloud.seen[0].record.runtimeProfile, 'native');assert.equal('localEmbeddings' in cloud.seen[0].record, false);
 // An inherited profile switch never reaches the renderer build or Gradle.
 const cleaned = buildEnv({VITE_ELIZA_RUNTIME_PROFILE: 'cloud', ORG_GRADLE_PROJECT_ELIZA_RUNTIME_PROFILE: 'cloud', ELIZA_LOCAL_EMBEDDINGS: '1', ORG_GRADLE_PROJECT_ELIZA_LOCAL_EMBEDDINGS: '1', KEEP: 'yes'}, {testMocks: false});
 assert.deepEqual(cleaned, {KEEP: 'yes'});
 // The regional gateway variable is read only by test-mocks renderers.
 assert.equal(cloud.seen[0].record.mapsProvider, 'cloud');
 assert.deepEqual(cloud.seen[0].record.versionOverride, {code: '41', name: '1.4.1'});
 const developer = build(t, ['--allow-unpackaged-runtime', '--skip-instrumentation']);
 const args = gradleCalls(developer.calls)[0].args;
 assert.ok(args.includes('-PELIZA_ALLOW_UNPACKAGED_RUNTIME=1'));
 assert.equal(args.some(task => task.endsWith('AndroidTest')), false);
 assert.equal(fs.existsSync(path.join(developer.output, 'instrumentation')), false);
 assert.deepEqual(developer.calls.filter(call => call.command === 'bun').map(call => call.args), [['scripts/verify-apks.ts', '--allow-unpackaged-runtime']]);
});

test('release signing names come from the host descriptor: a signed release keeps its name, an unsigned one with every name set fails', t => {
 const signed = build(t, [], {environment: SIGNING, signed: true});
 assert.ok(fs.existsSync(path.join(signed.output, 'standalone-release.apk')));
 assert.ok(fs.existsSync(path.join(signed.output, 'launcher-release.apk')));
 assert.equal(signed.seen[0].record.signingRequested, true);
 // Only names reach the record and Gradle arguments; values stay in the environment.
 assert.equal(JSON.stringify(signed.seen[0].record).includes('value-of-'), false);
 assert.equal(gradleCalls(signed.calls)[0].args.some(arg => arg.includes('value-of-')), false);
 assert.throws(() => build(t, [], {environment: SIGNING, signed: false}), new RegExp(`${SIGNING_ENV.join(', ')} are set but Gradle produced an unsigned standalone release`));
});

test('the low-disk mode builds one variant and mode at a time', t => {
 const f = build(t, [], {environment: {ALPHA_ANDROID_LOW_DISK: '1'}});
 assert.deepEqual(gradleCalls(f.calls).map(call => call.args.slice(3)), [
  [':app:assembleStandaloneDebug', ':app:assembleStandaloneDebugAndroidTest'], [':app:assembleStandaloneRelease'],
  [':app:assembleLauncherDebug', ':app:assembleLauncherDebugAndroidTest'], [':app:assembleLauncherRelease'], [':app:lint']]);
 assert.equal(f.seen.length, 1);
});
