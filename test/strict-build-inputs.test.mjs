// What the strict distribution build needs, which of it a script may produce, and which needs a person.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import {BUILD_TOOLCHAIN, QUALIFIED_HOST, Stop, compareWithQualified, describeDifference, run, stageReproduced, stagedLibraries} from '../scripts/build-embedding-host.ts';
import {formatReport, strictBuildInputs} from '../scripts/android-build-preflight.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const sha = text => createHash('sha256').update(text).digest('hex');
const readJson = rel => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

/** A product root with a three-library "reviewed" manifest whose bytes are the library names. */
function fixture(t, {remapBuildPath = false} = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-embedding-step-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), {recursive: true}); fs.writeFileSync(path.join(root, rel), text); };
  const names = ['libelizainference.so', 'libelizavoicejni.so', 'libc++_shared.so'];
  const manifest = {abi: 'arm64-v8a', forkPin: 'a'.repeat(40),
    model: {path: 'android/app/src/main/assets/agent/models/model.gguf'},
    libraries: names.map(name => ({name, sha256: sha(`reviewed ${name}`), bytes: `reviewed ${name}`.length}))};
  write(QUALIFIED_HOST, JSON.stringify(manifest));
  write(BUILD_TOOLCHAIN, JSON.stringify({ndk: '0.0.0', cmake: '0.0.0', remapBuildPath, remapBuildPathEvidence: 'the reviewed bytes embed an unrecorded build directory'}));
  const stage = (name, text = `reviewed ${name}`) => write(`android/app/src/main/jniLibs/arm64-v8a/${name}`, text);
  return {root, write, names, manifest, stage};
}

test('staged embedding bytes reject conflicts and accept matching libraries', t => {
  const f = fixture(t);
  // A library that is not the reviewed bytes is never replaced and never accepted.
  f.stage('libelizainference.so', 'rebuilt elsewhere');
  assert.throws(() => run(f.root), error => error.code === 2 && /libelizainference\.so .* is not the reviewed bytes.*never replaces a staged library/.test(error.message));
  assert.equal(fs.readFileSync(path.join(f.root, 'android/app/src/main/jniLibs/arm64-v8a/libelizainference.so'), 'utf8'), 'rebuilt elsewhere');

  // The reviewed bytes, however they were supplied, pass without building.
  for (const name of f.names) f.stage(name);
  assert.equal(run(f.root), 0);
  assert.equal(run(f.root, {status: true}), 0);
});

test('a rebuild is staged only when every library is byte-identical to the reviewed manifest', t => {
  const f = fixture(t);
  const built = {};
  for (const name of f.names) { built[name] = path.join(f.root, 'out', name); f.write(`out/${name}`, `reviewed ${name}`); }
  f.write('out/libelizainference.so', 'same source, different build directory');
  let comparison = compareWithQualified(f.manifest, built);
  assert.deepEqual(comparison.map(row => row.reproduced), [false, true, true]);
  assert.match(describeDifference(comparison)[0], /^libelizainference\.so: built 38 bytes sha256 [0-9a-f]{64}, reviewed \d+ bytes sha256 [0-9a-f]{64}$/);
  assert.throws(() => stageReproduced(f.root, f.manifest, comparison), /Refusing to stage: the rebuilt embedding host is not the reviewed bytes/);
  assert.deepEqual(stagedLibraries(f.root).map(row => row.state), ['missing', 'missing', 'missing'], 'a partial match stages nothing');
  assert.deepEqual(compareWithQualified(f.manifest, {}).map(row => row.reason), ['not built', 'not built', 'not built']);

  f.write('out/libelizainference.so', 'reviewed libelizainference.so');
  comparison = compareWithQualified(f.manifest, built);
  // A different library that is already staged is never overwritten, even by the reviewed bytes.
  f.stage('libelizavoicejni.so', 'placed by something else');
  assert.throws(() => stageReproduced(f.root, f.manifest, comparison), /A different libelizavoicejni\.so is already staged; review ownership before replacing it/);
  assert.deepEqual(stagedLibraries(f.root).map(row => row.state), ['missing', 'different', 'missing']);
  assert.equal(fs.readFileSync(path.join(f.root, 'android/app/src/main/jniLibs/arm64-v8a/libelizavoicejni.so'), 'utf8'), 'placed by something else');
  fs.rmSync(path.join(f.root, 'android/app/src/main/jniLibs/arm64-v8a/libelizavoicejni.so'));
  stageReproduced(f.root, f.manifest, comparison);
  assert.deepEqual(stagedLibraries(f.root).map(row => row.state), ['staged', 'staged', 'staged']);
});

test('once the reviewed bytes are reproducible the step rebuilds with the remap and stages only an exact reproduction', t => {
  // The compile step is replaced: these cases are about what the step does with its result.
  const f = fixture(t, {remapBuildPath: true});
  const calls = [];
  const builder = texts => (root, manifest, toolchain, output, options) => {
    calls.push({output: path.relative(root, output), options});
    const built = {};
    for (const name of f.names) { built[name] = path.join(output, name); f.write(path.relative(root, built[name]), texts[name] ?? `reviewed ${name}`); }
    const comparison = compareWithQualified(manifest, built);
    const reproduced = comparison.every(row => row.reproduced);
    f.write(path.relative(root, path.join(output, 'COMPARISON.json')), JSON.stringify({reproduced, staged: false, libraries: comparison}, null, 2) + '\n');
    return {receiptFile: path.join(output, 'PREPARATION.json'), comparison, reproduced};
  };
  // --status never builds.
  assert.equal(run(f.root, {status: true, build: builder({})}), 3);
  assert.deepEqual(calls, []);

  // A rebuild that differs in one library stages nothing.
  assert.throws(() => run(f.root, {build: builder({'libelizavoicejni.so': 'built on another host'})}), error => error instanceof Stop && error.code === 3
    && /The rebuilt embedding host is not the reviewed bytes and was not staged:\n  - libelizavoicejni\.so: built 21 bytes/.test(error.message));
  assert.deepEqual(stagedLibraries(f.root).map(row => row.state), ['missing', 'missing', 'missing']);
  assert.deepEqual(calls, [{output: `.eliza/embedding-host/build-${'a'.repeat(40)}`, options: {offline: false, remap: true}}], 'the chain build uses the path remap the reviewed bytes were built with');

  // An exact reproduction is staged and recorded.
  fs.rmSync(path.join(f.root, '.eliza'), {recursive: true});
  assert.equal(run(f.root, {offline: true, build: builder({})}), 0);
  assert.deepEqual(calls[1].options, {offline: true, remap: true});
  assert.deepEqual(stagedLibraries(f.root).map(row => row.state), ['staged', 'staged', 'staged']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, calls[1].output, 'COMPARISON.json'), 'utf8')).staged, true);
  // Staged now: a later run passes without building.
  assert.equal(run(f.root, {build: () => assert.fail('must not build')}), 0);

  // A candidate build is never staged, whatever it produced, and uses its own directory.
  const g = fixture(t);
  assert.equal(run(g.root, {candidate: true, build: (root, manifest, toolchain, output, options) => { calls.push({output: path.relative(root, output), options}); return {receiptFile: path.join(output, 'PREPARATION.json'), reproduced: true}; }}), 0);
  assert.deepEqual(calls[2], {output: `.eliza/embedding-host/candidate-${'a'.repeat(40)}`, options: {offline: false, remap: true}});
  assert.equal(fs.existsSync(path.join(g.root, 'android/app/src/main/jniLibs')), false);
});

test('path remapping is opt-in, recorded in the receipt and leaves the default build unchanged', () => {
  const source = stripTypeScriptTypes(fs.readFileSync(path.join(ROOT, 'scripts/prepare-embedding-host.ts'), 'utf8'));
  assert.match(source, /const remapEnv=remap\?embeddingBuildRemap\(root,/);
  assert.match(source, /:\{\};\nconst receipt\s*=\{[^\n]*\.\.\.remapEnv\},buildPathRemapped:remap,/);
  assert.match(source, /import \{embeddingBuildRemap\} from '\.\/embedding-build-remap\.ts'/);
  // An unknown option is still refused before anything is written.
  const output = path.join(os.tmpdir(), `alpha-embed-unknown-${process.pid}`);
  const result = spawnSync(process.execPath, ['scripts/prepare-embedding-host.ts', '--fork', ROOT, '--output', output, '--remap'], {cwd: ROOT, encoding: 'utf8'});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown option/);
  assert.equal(fs.existsSync(output), false);
  const step = fs.readFileSync(path.join(ROOT, 'scripts/build-embedding-host.ts'), 'utf8');
  assert.doesNotMatch(step, /qualifiedAt\s*[:=]/, 'the step never writes a qualification');
  assert.doesNotMatch(step, /writeFileSync\([^)]*QUALIFIED_HOST/, 'the step never rewrites the reviewed manifest');
});

test('the input report separates what a script produces from what needs a person', t => {
  const f = fixture(t);
  f.write('upstream.lock.json', JSON.stringify({commit: 'c'.repeat(40)}));
  f.write('android/release-signer.json', JSON.stringify({schema: 1, signerSha256: 'unset', lastRelease: {versionCode: null}}));
  // A staged voice bundle that is not the pinned bytes; the real verifier is exercised in test/voice-host-bundle tests.
  const badVoice = () => { throw new Error('Voice bundle file missing or changed: asr.gguf'); };
  let rows = strictBuildInputs(f.root, null, {env: {}, voiceHost: badVoice});
  const row = name => rows.find(item => item.input === name);
  assert.deepEqual(rows.filter(item => item.suppliedBy === 'person').map(item => item.input), ['on-device voice outputs', 'release signer']);
  assert.ok(rows.every(item => item.state === 'missing' && item.action), 'an empty checkout has nothing ready and an action for every input');
  assert.match(row('pinned upstream checkout').action, /git submodule update --init vendor\/eliza/);
  assert.match(row('on-device voice outputs').detail, /are not admitted by .*Voice bundle file missing or changed: asr\.gguf/);
  assert.match(row('on-device voice outputs').action, /^Needs a person to supply the recorded voice outputs and models: node scripts\/android-stage-voice-models\.ts --from /);
  assert.equal(row('embedding host libraries').action, 'npm run agent:build-embedding-host');
  assert.match(row('release signer').action, /^Needs a person: Alpha Compute controls signing and Shaw owns release/);
  assert.match(row('release signer').detail, /says unset; not set in this environment: ELIZAOS_KEYSTORE_PATH, ELIZAOS_KEYSTORE_PASSWORD, ELIZAOS_KEY_ALIAS, ELIZAOS_KEY_PASSWORD/);
  for (const name of ['prepared resident runtime source', 'workflow worker artifact', 'staged resident runtime payload', 'embedding model', 'Gradle dependency verification metadata'])
    assert.match(row(name).action, /^npm run /, name);
  let report = formatReport(rows);
  assert.match(report, /2 input\(s\) only a person can supply: on-device voice outputs, release signer\./);
  assert.match(report, /An unset release signer does not stop the build: verify-apks records its releases distributable:false/);
  assert.match(report, /Missing or changed voice outputs stop Gradle :app:verifyVoiceHost in a distribution build\./);

  // Staged voice outputs are ready; signing values are never printed.
  for (const name of f.names) f.stage(name);
  const prepared = path.join(f.root, 'artifacts/local-agent-resident-' + 'c'.repeat(40));
  f.write(path.relative(f.root, path.join(prepared, '.alpha-runtime-source.json')), 'stamp');
  f.write('android/app/src/main/assets/agent/alpha-source.json', 'stamp');
  f.write('android/app/src/main/assets/agent/workflow-worker/manifest.json', '{}');
  rows = strictBuildInputs(f.root, prepared, {env: {ELIZAOS_KEYSTORE_PATH: '/secret/path.jks', ELIZAOS_KEYSTORE_PASSWORD: 'hunter2', ELIZAOS_KEY_ALIAS: 'release', ELIZAOS_KEY_PASSWORD: 'hunter2'}, voiceHost: () => ({status: 'packaged', qualified: false})});
  assert.equal(row('on-device voice outputs').state, 'ready');
  assert.match(row('on-device voice outputs').detail, /^staged outputs match android\/voice-host\/qualified-voice-host\.json/);
  assert.equal(row('embedding host libraries').state, 'ready');
  assert.equal(row('staged resident runtime payload').state, 'ready');
  assert.equal(row('release signer').state, 'missing', 'signing variables alone do not make a release signer');
  report = formatReport(rows);
  assert.doesNotMatch(report, /hunter2|secret\/path/);
  assert.doesNotMatch(report, /cannot pass Gradle/);

  // Once the reviewed bytes are reproducible the same row belongs to a script.
  const g = fixture(t, {remapBuildPath: true});
  for (const file of ['upstream.lock.json', 'android/release-signer.json'])
    g.write(file, fs.readFileSync(path.join(f.root, file), 'utf8'));
  const host = strictBuildInputs(g.root, null, {env: {}, voiceHost: () => ({status: 'not-packaged'})}).find(item => item.input === 'embedding host libraries');
  assert.deepEqual([host.suppliedBy, host.action], ['script', 'npm run agent:build-embedding-host']);
});

test('the real checkout reports its inputs without failing and without building', () => {
  // Signing values, if this machine has any, are not this test's input.
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^ELIZAOS_(KEYSTORE_PATH|KEYSTORE_PASSWORD|KEY_ALIAS|KEY_PASSWORD)$/.test(name)));
  const result = spawnSync(process.execPath, ['scripts/android-build-preflight.ts', '--report', '--json'], {cwd: ROOT, encoding: 'utf8', env});
  assert.equal(result.status, 0, result.stderr);
  const rows = JSON.parse(result.stdout);
  const row = name => rows.find(item => item.input === name);
  assert.deepEqual(rows.map(item => item.input), ['pinned upstream checkout', 'on-device voice outputs', 'embedding host libraries',
    'prepared resident runtime source', 'workflow worker artifact', 'staged resident runtime payload', 'embedding model', 'Gradle dependency verification metadata', 'release signer']);
  assert.equal(row('Gradle dependency verification metadata').state, 'ready');
  // The pinned voice models and a release signer are a person's to supply, whatever is staged locally,
  // and the report follows the committed records: it never calls the signer ready while they say otherwise.
  assert.equal(row('release signer').suppliedBy, 'person');
  assert.equal(row('release signer').state, 'missing', 'no signing values in this environment');
  assert.equal(row('on-device voice outputs').suppliedBy, 'person');
  assert.equal(row('embedding host libraries').suppliedBy, 'script');
  for (const item of rows) assert.equal(item.action === null, item.state === 'ready', item.input);
});
