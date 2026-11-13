// What the strict distribution build needs, which of it a script may produce, and which needs a person.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {BUILD_TOOLCHAIN, QUALIFIED_HOST} from '../scripts/build-embedding-host.ts';
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

test('path remapping is opt-in, recorded in the receipt and leaves the default build unchanged', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts/prepare-embedding-host.ts'), 'utf8');
  assert.match(source, /const remapEnv=remap\?embeddingBuildRemap\(root,/);
  assert.match(source, /:\{\};\nconst receipt=\{[^\n]*\.\.\.remapEnv\},buildPathRemapped:remap,/);
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
  assert.deepEqual(rows.filter(item => item.suppliedBy === 'person').map(item => item.input), ['release signer']);
  assert.ok(rows.every(item => item.state === 'missing' && item.action), 'an empty checkout has nothing ready and an action for every input');
  assert.match(row('pinned upstream checkout').action, /git submodule update --init vendor\/eliza/);
  assert.match(row('on-device voice outputs').detail, /are not admitted by .*Voice bundle file missing or changed: asr\.gguf/);
  assert.match(row('on-device voice outputs').action, /bun run agent:build-embedding-host/);
  assert.equal(row('embedding host libraries').action, 'bun run agent:build-embedding-host');
  assert.match(row('release signer').action, /^Needs a person: Alpha Compute controls signing and Shaw owns release/);
  assert.match(row('release signer').detail, /says unset; not set in this environment: ELIZAOS_KEYSTORE_PATH, ELIZAOS_KEYSTORE_PASSWORD, ELIZAOS_KEY_ALIAS, ELIZAOS_KEY_PASSWORD/);
  for (const name of ['prepared resident runtime source', 'workflow worker artifact', 'staged resident runtime payload', 'embedding model', 'Gradle dependency verification metadata'])
    assert.match(row(name).action, /^bun run /, name);
  let report = formatReport(rows);
  assert.match(report, /1 input\(s\) only a person can supply: release signer\./);
  assert.match(report, /An unset release signer does not stop the build: verify-apks records its releases distributable:false/);

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
  assert.deepEqual([host.suppliedBy, host.action], ['script', 'bun run agent:build-embedding-host']);
});

test('the real checkout reports its inputs without failing and without building', async () => {
  // Signing values, if this machine has any, are not this test's input.
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^ELIZAOS_(KEYSTORE_PATH|KEYSTORE_PASSWORD|KEY_ALIAS|KEY_PASSWORD)$/.test(name)));
  const source = await import('../scripts/local-agent-source.ts');
  const rows = strictBuildInputs(ROOT, source.sourceDirectory(ROOT), {env, workerDirectory: source.workerArtifactDirectory(ROOT)});
  const row = name => rows.find(item => item.input === name);
  assert.deepEqual(rows.map(item => item.input), ['pinned upstream checkout', 'on-device voice outputs', 'embedding host libraries',
    'prepared resident runtime source', 'workflow worker artifact', 'staged resident runtime payload', 'embedding model', 'Gradle dependency verification metadata', 'release signer']);
  assert.equal(row('Gradle dependency verification metadata').state, 'ready');
  // The pinned voice models and a release signer are a person's to supply, whatever is staged locally,
  // and the report follows the committed records: it never calls the signer ready while they say otherwise.
  assert.equal(row('release signer').suppliedBy, 'person');
  assert.equal(row('release signer').state, 'missing', 'no signing values in this environment');
  assert.equal(row('on-device voice outputs').suppliedBy, 'script');
  assert.equal(row('embedding host libraries').suppliedBy, 'script');
  for (const item of rows) assert.equal(item.action === null, item.state === 'ready', item.input);
});
