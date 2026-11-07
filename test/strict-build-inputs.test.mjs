// What the strict distribution build needs, which of it a script may produce, and which needs a person.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {BUILD_TOOLCHAIN, HUMAN_ACTION, QUALIFIED_HOST, Stop, compareWithQualified, describeDifference, run, stageReproduced, stagedLibraries} from '../scripts/build-embedding-host.mjs';
import {formatReport, strictBuildInputs} from '../scripts/android-build-preflight.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const sha = text => createHash('sha256').update(text).digest('hex');
const readJson = rel => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

/** A product root with a three-library "reviewed" manifest whose bytes are the library names. */
function fixture(t, {remapBuildPath = false} = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-embedding-step-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), {recursive: true}); fs.writeFileSync(path.join(root, rel), text); };
  const names = ['libelizainference.so', 'libelizavoicejni.so', 'libc++_shared.so'];
  const manifest = {abi: 'arm64-v8a', forkPin: 'a'.repeat(40), qualificationReceiptSha256: 'b'.repeat(64),
    model: {path: 'android/app/src/main/assets/agent/models/model.gguf'},
    libraries: names.map(name => ({name, sha256: sha(`reviewed ${name}`), bytes: `reviewed ${name}`.length}))};
  write(QUALIFIED_HOST, JSON.stringify(manifest));
  write(BUILD_TOOLCHAIN, JSON.stringify({ndk: '0.0.0', cmake: '0.0.0', remapBuildPath, remapBuildPathEvidence: 'the reviewed bytes embed an unrecorded build directory'}));
  const stage = (name, text = `reviewed ${name}`) => write(`android/app/src/main/jniLibs/arm64-v8a/${name}`, text);
  return {root, write, names, manifest, stage};
}

test('the embedding host step stages nothing it cannot prove and names the person when no script can produce the bytes', t => {
  const f = fixture(t);
  assert.deepEqual(stagedLibraries(f.root).map(row => row.state), ['missing', 'missing', 'missing']);
  // Reviewed bytes that embed an unrecorded build directory: stop at once, before any fetch or compile.
  assert.throws(() => run(f.root), error => error instanceof Stop && error.code === 3
    && /libelizainference\.so, libelizavoicejni\.so, libc\+\+_shared\.so missing/.test(error.message)
    && /No script can produce them: the reviewed bytes embed an unrecorded build directory/.test(error.message)
    && error.message.includes(HUMAN_ACTION));
  assert.equal(fs.existsSync(path.join(f.root, '.eliza')), false, 'nothing was fetched or built');
  assert.match(HUMAN_ACTION, /^Needs a person: /);
  assert.match(HUMAN_ACTION, /stage-embedding-host\.mjs --receipt/);
  assert.match(HUMAN_ACTION, /qualifiedAt/);
  assert.match(HUMAN_ACTION, /No script may do either\.$/);
  // What the staging command itself requires, so the instruction works on a clean checkout:
  // it refuses to replace a differing manifest, and it checks the embedding model that only
  // agent:stage-android stages (the chain reaches that step after this one).
  assert.match(HUMAN_ACTION, /removes the superseded android\/embedding-host\/qualified-host\.json/);
  assert.match(HUMAN_ACTION, /run npm run agent:prepare, npm run agent:build-workflow-worker and npm run agent:stage-android before it/);
  const staging = fs.readFileSync(path.join(ROOT, 'scripts/stage-embedding-host.mjs'), 'utf8');
  assert.match(staging, /Existing embedding qualification differs; review before replacing/);
  assert.ok(staging.indexOf('Pinned BGE model is not staged: run npm run agent:prepare') > 0);
  assert.ok(staging.indexOf('Pinned BGE model is not staged') < staging.indexOf('Pinned BGE model bytes changed'), 'a missing model is named before its bytes are read');

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

test('pending requalification stops every builder entry before historical bytes or producers are used', t => {
  const f = fixture(t, {remapBuildPath: true});
  const record = {...f.manifest, requalification: {required: true, atPin: 'c'.repeat(40), reason: 'The pinned engine and producer inputs changed.'}};
  const stored = JSON.stringify(record);
  f.write(QUALIFIED_HOST, stored);
  // The qualification decision must precede even reading the historical toolchain.
  fs.unlinkSync(path.join(f.root, BUILD_TOOLCHAIN));
  for (const staged of [false, true]) {
    if (staged) for (const name of f.names) f.stage(name);
    for (const options of [{}, {status: true}, {candidate: true}]) {
      assert.throws(() => run(f.root, {...options, build: () => assert.fail('historical producer must not run')}),
        error => error instanceof Stop && error.code === 3
          && error.message.includes(`requalification required at ${'c'.repeat(40)}`)
          && error.message.includes('prepare-embedding-host.mjs --fork')
          && error.message.includes('stage-embedding-host.mjs --receipt'));
    }
  }
  assert.equal(fs.readFileSync(path.join(f.root, QUALIFIED_HOST), 'utf8'), stored);
  assert.equal(fs.existsSync(path.join(f.root, '.eliza')), false);
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

  // A rebuild that differs in one library stages nothing and still names the person.
  assert.throws(() => run(f.root, {build: builder({'libelizavoicejni.so': 'built on another host'})}), error => error instanceof Stop && error.code === 3
    && /The rebuilt embedding host is not the reviewed bytes and was not staged:\n  - libelizavoicejni\.so: built 21 bytes/.test(error.message) && error.message.includes(HUMAN_ACTION));
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

test('the committed embedding host record states whether its bytes are reproducible and keeps an unqualified candidate apart', () => {
  const host = readJson(QUALIFIED_HOST), toolchain = readJson(BUILD_TOOLCHAIN);
  assert.equal(typeof toolchain.remapBuildPath, 'boolean');
  assert.match(toolchain.ndk, /^\d+\.\d+\.\d+$/);
  assert.match(toolchain.cmake, /^\d+\.\d+\.\d+$/);
  assert.match(toolchain.engineRepository, /^https:\/\/github\.com\/elizaOS\/llama\.cpp\.git$/);
  const reviewed = Object.fromEntries(host.libraries.map(row => [row.name, row.sha256]));
  const candidate = toolchain.unqualifiedCandidateMeasurement;
  if (toolchain.remapBuildPath === false) {
    // Today: the reviewed bytes carry their build directory, and the measured remapped candidate is a different, unqualified build.
    assert.match(toolchain.remapBuildPathEvidence, /embed the absolute directory/);
    assert.match(candidate.note, /^NOT reviewed, NOT qualified and NOT staged/);
    for (const row of candidate.libraries.filter(item => item.name !== 'libc++_shared.so')) assert.notEqual(row.sha256, reviewed[row.name], `${row.name}: the candidate is not the reviewed bytes`);
    assert.equal(candidate.libraries.find(item => item.name === 'libc++_shared.so').sha256, reviewed['libc++_shared.so'], 'the NDK runtime identifies the toolchain');
  } else {
    // After a person qualifies a remapped build (the commit that sets this true): no record may still call the reviewed bytes unqualified.
    for (const row of candidate?.libraries ?? []) assert.notEqual(row.sha256, reviewed[row.name], `${row.name}: remove the unqualified measurement once those bytes are the reviewed ones`);
  }
  // The libraries are never committed: they are staged bytes checked against the manifest.
  assert.match(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8'), /^android\/app\/src\/main\/jniLibs\/$/m);
});

test('path remapping is opt-in, recorded in the receipt and leaves the default build unchanged', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts/prepare-embedding-host.mjs'), 'utf8');
  assert.match(source, /const remapEnv=remap\?embeddingBuildRemap\(root,/);
  assert.match(source, /:\{\};\nconst receipt=\{[^\n]*\.\.\.remapEnv\},buildPathRemapped:remap,/);
  assert.match(source, /import \{embeddingBuildRemap\} from '\.\/embedding-build-remap\.mjs'/);
  // An unknown option is still refused before anything is written.
  const output = path.join(os.tmpdir(), `alpha-embed-unknown-${process.pid}`);
  const result = spawnSync(process.execPath, ['scripts/prepare-embedding-host.mjs', '--fork', ROOT, '--output', output, '--remap'], {cwd: ROOT, encoding: 'utf8'});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown option/);
  assert.equal(fs.existsSync(output), false);
  const step = fs.readFileSync(path.join(ROOT, 'scripts/build-embedding-host.mjs'), 'utf8');
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
  assert.deepEqual(rows.filter(item => item.suppliedBy === 'person').map(item => item.input), ['on-device voice outputs', 'on-device voice qualified', 'embedding host libraries', 'release signer']);
  assert.ok(rows.every(item => item.state === 'missing' && item.action), 'an empty checkout has nothing ready and an action for every input');
  assert.match(row('pinned upstream checkout').action, /git submodule update --init vendor\/eliza/);
  assert.match(row('on-device voice outputs').detail, /are not admitted by .*Voice bundle file missing or changed: asr\.gguf/);
  assert.match(row('on-device voice outputs').action, /^Needs a person to supply the recorded voice outputs and models: node scripts\/android-stage-voice-models\.mjs --from /);
  assert.match(row('on-device voice qualified').action, /^Needs a person: on-device qualification on both ABIs/);
  assert.match(row('embedding host libraries').action, /^Needs a person: /);
  assert.match(row('release signer').action, /^Needs a person: Alpha Compute controls signing and Shaw owns release/);
  assert.match(row('release signer').detail, /says unset; not set in this environment: ELIZAOS_KEYSTORE_PATH, ELIZAOS_KEYSTORE_PASSWORD, ELIZAOS_KEY_ALIAS, ELIZAOS_KEY_PASSWORD/);
  for (const name of ['prepared resident runtime source', 'workflow worker artifact', 'staged resident runtime payload', 'embedding model', 'Gradle dependency verification metadata'])
    assert.match(row(name).action, /^npm run /, name);
  let report = formatReport(rows);
  assert.match(report, /4 input\(s\) only a person can supply: on-device voice outputs, on-device voice qualified, embedding host libraries, release signer\./);
  assert.match(report, /The chain cannot pass Gradle :app:verifyEmbeddingHost until a person supplies the embedding host libraries\./);
  assert.match(report, /An unset release signer does not stop the build: verify-apks records its releases distributable:false/);
  assert.match(report, /Missing or changed voice outputs stop Gradle :app:verifyVoiceHost in a distribution build; an unqualified voice host makes its releases distributable:false\./);

  // Staged, admitted voice outputs are ready (qualification stays a person's); signing values are never printed.
  for (const name of f.names) f.stage(name);
  const prepared = path.join(f.root, 'artifacts/local-agent-resident-' + 'c'.repeat(40));
  f.write(path.relative(f.root, path.join(prepared, '.alpha-runtime-source.json')), 'stamp');
  f.write('android/app/src/main/assets/agent/alpha-source.json', 'stamp');
  f.write('android/app/src/main/assets/agent/workflow-worker/manifest.json', '{}');
  rows = strictBuildInputs(f.root, prepared, {env: {ELIZAOS_KEYSTORE_PATH: '/secret/path.jks', ELIZAOS_KEYSTORE_PASSWORD: 'hunter2', ELIZAOS_KEY_ALIAS: 'release', ELIZAOS_KEY_PASSWORD: 'hunter2'}, voiceHost: () => ({status: 'packaged', qualified: false})});
  assert.equal(row('on-device voice outputs').state, 'ready');
  assert.match(row('on-device voice outputs').detail, /^staged outputs match android\/voice-host\/qualified-voice-host\.json/);
  assert.equal(row('on-device voice qualified').state, 'missing');
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
  const result = spawnSync(process.execPath, ['scripts/android-build-preflight.mjs', '--report', '--json'], {cwd: ROOT, encoding: 'utf8', env});
  assert.equal(result.status, 0, result.stderr);
  const rows = JSON.parse(result.stdout);
  const row = name => rows.find(item => item.input === name);
  assert.deepEqual(rows.map(item => item.input), ['pinned upstream checkout', 'on-device voice outputs', 'on-device voice qualified', 'embedding host libraries',
    'prepared resident runtime source', 'workflow worker artifact', 'staged resident runtime payload', 'embedding model', 'Gradle dependency verification metadata', 'release signer']);
  assert.equal(row('Gradle dependency verification metadata').state, 'ready');
  // The pinned voice models and a release signer are a person's to supply, whatever is staged locally,
  // and the report follows the committed records: it never calls the signer ready while they say otherwise.
  assert.equal(row('release signer').suppliedBy, 'person');
  assert.equal(row('release signer').state, 'missing', 'no signing values in this environment');
  assert.equal(row('on-device voice outputs').suppliedBy, 'person');
  assert.equal(row('on-device voice qualified').state, 'missing', 'the committed record is not qualified');
  assert.equal(row('embedding host libraries').suppliedBy, readJson(BUILD_TOOLCHAIN).remapBuildPath === true ? 'script' : 'person');
  for (const item of rows) assert.equal(item.action === null, item.state === 'ready', item.input);
});
