import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import YAML from 'yaml';
import {candidateVersion, candidateReceipt, candidateArchiveSize, main} from '../scripts/app-update-candidate.ts';
import {candidateFixture as fixture, hash, json, legacyManifestUrl, read} from './fixtures/app-update-candidate.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

test('candidate versions use fixed run numbers above every page of retained assets and all committed/public floors', async t => {
  const f = fixture(t);
  f.state.pages = [Array.from({length: 100}, (_, i) => ({name: `alpha-phone-${i + 1}.apk`})), [{name: 'alpha-phone-704.apk'}]];
  const admitted = await candidateVersion(f);
  assert.equal(admitted.versionCode, 705); assert.equal(admitted.observedFloor, 704);
  f.env.GITHUB_RUN_ATTEMPT = '2';
  const retry = await candidateVersion(f);
  assert.equal(retry.versionCode, 705); assert.equal(retry.runAttempt, '2');
  f.env.GITHUB_RUN_NUMBER = '706';
  assert.equal((await candidateVersion(f)).versionCode, 706);
  f.env.GITHUB_RUN_NUMBER = '705';
  for (const name of ['alpha-phone-705.apk', 'alpha-phone-2100000001.apk']) {
    f.state.pages[1] = [{name}]; await assert.rejects(candidateVersion(f));
  }
  f.state.pages = [[]];
  json(path.join(f.root, 'android/release-signer.json'), {lastRelease: {versionCode: 705}});
  await assert.rejects(candidateVersion(f), /version floor/);
  json(path.join(f.root, 'android/release-signer.json'), {lastRelease: {versionCode: null}});
  json(path.join(f.root, 'app.config.json'), {...f.config, versionCode: 705});
  await assert.rejects(candidateVersion(f), /version floor/);
});

test('retired-channel inventory sets a version floor while the receipt binds only the active pointer', async t => {
  const f = fixture(t);
  const pointer = (url, versionCode) => {
    const bytes = Buffer.from(JSON.stringify({schema: 'alpha-update/v1', variant: 'launcher', versionCode,
      signerSha256: 'a'.repeat(64), sha256: 'b'.repeat(64), sizeBytes: 100,
      apkUrl: new URL(`alpha-phone-${versionCode}.apk`, url).href}));
    return {bytes, sha256: hash(bytes)};
  };
  f.state.legacyMissing = false;
  f.state.legacyPages = [[{name: 'alpha-phone-703.apk'}]];
  for (const repository of ['eliza-research/alpha', 'eliza-research/alphaphone', 'alphacompute/alpha', 'alphacompute/alphaphone']) {
    f.state.legacyPointer = pointer(legacyManifestUrl.replace('eliza-research/alpha', repository), 704);
    const initial = await candidateVersion(f);
    assert.equal(initial.observedFloor, 704, repository);
    assert.equal(initial.manifestSha256, null);
  }
  f.state.pointer = pointer(f.config.updateManifestUrl, 702);
  assert.equal((await candidateVersion(f)).manifestSha256, f.state.pointer.sha256);
  f.state.legacyPages.push([{name: 'alpha-phone-705.apk'}]);
  await assert.rejects(candidateVersion(f), /version floor/);
  f.state.legacyPages = [[{name: 'alpha-update-stable.json'}]];
  f.state.legacyPointer = null;
  await assert.rejects(candidateVersion(f), /not anonymously readable/);
});

test('missing or malformed inventories, hidden pointers and wrong source/workflow epochs fail before writing a candidate', async t => {
  const f = fixture(t), destination = 'test-results/version.json';
  for (const change of [{GITHUB_EVENT_NAME: 'workflow_dispatch'}, {GITHUB_REF: 'refs/heads/develop'},
    {GITHUB_REPOSITORY_ID: '99'},
    {GITHUB_WORKFLOW_REF: f.env.GITHUB_WORKFLOW_REF.replace('resident-android', 'new-workflow')},
    {GITHUB_SHA: '0'.repeat(40)}, {GITHUB_RUN_NUMBER: '2100000001'}, {GITHUB_RUN_ATTEMPT: '0'}]) {
    await assert.rejects(main(['version', destination], {...f, env: {...f.env, ...change}}));
    assert.equal(fs.existsSync(path.join(f.root, destination)), false);
  }
  f.state.pages = [[{name: 'alpha-update-stable.json'}]];
  await assert.rejects(candidateVersion(f), /not anonymously readable/);
  for (const pages of [null, []]) {
    f.state.pages = pages;
    await assert.rejects(main(['version', destination], f), /Incomplete/);
    assert.equal(fs.existsSync(path.join(f.root, destination)), false);
  }
  f.state.pages = [[]]; f.state.pointer = {bytes: Buffer.from('{}'), sha256: hash('{}')};
  await assert.rejects(candidateVersion(f), /Malformed/);
  const offer = {schema: 'alpha-update/v1', variant: 'launcher', versionCode: 705,
    signerSha256: 'a'.repeat(64), sha256: 'b'.repeat(64), sizeBytes: 100,
    apkUrl: new URL('alpha-phone-705.apk', f.config.updateManifestUrl).href};
  f.state.pointer = {bytes: Buffer.from(JSON.stringify(offer)), sha256: hash(JSON.stringify(offer))};
  await assert.rejects(candidateVersion(f), /version floor/);
  f.state.pointer = null; f.state.missing = true;
  assert.equal((await candidateVersion(f)).observedFloor, 1);
  for (const runChanges of [{workflow_id: 373209005}, {event: 'pull_request'}, {head_sha: '0'.repeat(40)}, {run_attempt: 2}, {run_number: 704},
    {repository: {id: 99, full_name: f.env.GITHUB_REPOSITORY}}, {head_repository: {id: 99, full_name: f.env.GITHUB_REPOSITORY}}]) {
    f.state.runChanges = runChanges;
    await assert.rejects(candidateVersion(f), /run identity or workflow version epoch/);
  }
  f.state.runChanges = {};
  f.commit(f.sdk); await assert.rejects(candidateVersion(f), /SDK changed/);
});

test('candidate receipt binds actual archive bytes and source freeze while keeping unsigned evidence separate from distribution', async t => {
  const f = fixture(t), versionFile = 'test-results/version.json';
  const admission = await main(['version', versionFile], f), archive = f.archive(admission);
  const result = await main(['receipt', versionFile, archive.relative], f);
  assert.equal(result.schema, 'alpha-app-update-candidate/v1');
  assert.equal(result.sourceCommit, f.env.GITHUB_SHA); assert.equal(result.sdkCommit, admission.sdkCommit);
  assert.equal(result.runAttempt, '1'); assert.equal(result.runtimeProfile, 'native');
  assert.equal(result.distributionQualified, false); assert.equal(result.signed, false);
  assert.equal(result.apks.launcher.sha256, hash(fs.readFileSync(path.join(archive.output, result.apks.launcher.file))));
  assert.equal(result.sourceFingerprint, read(path.join(archive.output, 'inputs-before.json')).digest);
  assert.equal(result.nativeInputAdmissionSha256, hash(fs.readFileSync(path.join(archive.output, 'native-input-admission.json'))));
  const receipt = path.join(archive.output, 'app-update-candidate.json'), before = fs.readFileSync(receipt);
  await assert.rejects(main(['receipt', versionFile, archive.relative], f), /EEXIST/);
  assert.deepEqual(fs.readFileSync(receipt), before, 'A retry cannot overwrite prior evidence');
});

test('native build receipt must match frozen and staged bytes', async t => {
  const f = fixture(t), admission = await candidateVersion(f), archive = f.archive(admission);
  const file = path.join(archive.output, 'native-input-admission.json'), original = read(file);
  json(file, {...original, producer: {...original.producer, sdkCommit: 'invalid'}});
  assert.throws(() => candidateReceipt({...f, admission, archive: archive.relative}), /differs from the build freeze/);
  const freeze = read(path.join(archive.output, 'inputs-before.json'));
  freeze.files['.eliza/native-inputs/receipt.json'] = hash(fs.readFileSync(file));
  freeze.digest = hash(JSON.stringify(freeze.files));
  for (const name of ['inputs-before.json', 'inputs-after.json']) json(path.join(archive.output, name), freeze);
  assert.throws(() => candidateReceipt({...f, admission, archive: archive.relative}), /differs from the staged build/);
  fs.unlinkSync(file);
  assert.throws(() => candidateReceipt({...f, admission, archive: archive.relative}), /native-input-admission.json/);
});

test('frozen native receipt requires current recipe, valid outputs and honest qualification', async t => {
  const f = fixture(t), admission = await candidateVersion(f);
  for (const change of [value => value.producer.sdkCommit = 'invalid', value => value.producer.ndk = 'old',
    value => value.recipe.identity = 'other.app', value => value.recipeSha256 = '0'.repeat(64),
    value => value.qualification.deviceExecuted = true, value => value.voice.qualified = true,
    value => value.files[0].sha256 = '0'.repeat(64), value => value.files[0].path = '../outside']) {
    const archive = f.archive(admission), file = path.join(archive.output, 'native-input-admission.json');
    const changed = read(file); change(changed); json(file, changed);
    json(path.join(f.root, '.eliza/native-inputs/receipt.json'), changed);
    const freeze = read(path.join(archive.output, 'inputs-before.json'));
    freeze.files['.eliza/native-inputs/receipt.json'] = hash(fs.readFileSync(file));
    freeze.digest = hash(JSON.stringify(freeze.files));
    for (const name of ['inputs-before.json', 'inputs-after.json']) json(path.join(archive.output, name), freeze);
    assert.throws(() => candidateReceipt({...f, admission, archive: archive.relative}));
  }
  const archive = f.archive(admission);
  fs.appendFileSync(path.join(f.root, '.eliza/paradee-voice/native/assets/paradee-voice/v1/manifest.json'), 'tampered');
  assert.throws(() => candidateReceipt({...f, admission, archive: archive.relative}), /Native output changed/);
});

test('archive measurement binds the actual artifact metadata and expanded upload file sizes', async t => {
  const f = fixture(t), versionFile = 'test-results/version.json';
  const admission = await main(['version', versionFile], f), archive = f.archive(admission);
  const candidate = await main(['receipt', versionFile, archive.relative], f);
  const uploaded = {id: 4242, digest: 'sha256:' + 'a'.repeat(64), expired: false, size_in_bytes: 1500,
    name: `app-native-candidate-${admission.runNumber}-${admission.sourceCommit}-${admission.runId}-${admission.runAttempt}`,
    workflow_run: {id: Number(admission.runId), head_sha: admission.sourceCommit, head_branch: 'main',
      repository_id: 1396333361, head_repository_id: 1396333361}};
  const options = {...f, archive: archive.relative, env: {...f.env, ALPHA_CANDIDATE_ARTIFACT_ID: '4242',
    ALPHA_CANDIDATE_ARTIFACT_SHA256: 'a'.repeat(64)}, api: args => {
      assert.deepEqual(args, ['repos/eliza-research/alpha/actions/artifacts/4242']); return uploaded;
    }};
  const files = fs.readdirSync(archive.output);
  const expandedBytes = files.reduce((sum, file) => sum + fs.statSync(path.join(archive.output, file)).size, 0);
  fs.writeFileSync(path.join(archive.output, '.excluded-by-uploader'), 'hidden input');
  const result = await main(['archive-size', 'test-results/archive-size.json', archive.relative], options);
  assert.equal(result.compressedBytes, 1500);
  assert.equal(result.expandedBytes, expandedBytes);
  assert.equal(result.files, files.length);
  assert.deepEqual(result.apks, candidate.apks);
  for (const variant of ['launcher', 'standalone']) {
    const bytes = fs.readFileSync(path.join(archive.output, variant + '-debug.apk'));
    assert.equal(result.debugApks[variant].sha256, hash(bytes));
    assert.equal(result.debugApks[variant].bytes, bytes.length);
  }
  assert.equal(result.nativeInputAdmissionSha256, candidate.nativeInputAdmissionSha256);
  assert.throws(() => candidateArchiveSize({...options, api: () => ({...uploaded, digest: 'sha256:' + 'b'.repeat(64)})}),
    /artifact identity or size differs/);
  assert.throws(() => candidateArchiveSize({...options, api: () => ({...uploaded, name: uploaded.name.slice(0, -1) + '2'})}),
    /artifact identity or size differs/);
  const debug = path.join(archive.output, 'standalone-debug.apk'), priorDebug = fs.readFileSync(debug);
  fs.appendFileSync(debug, 'changed after upload');
  assert.throws(() => candidateArchiveSize(options), /Measured APK differs/);
  fs.writeFileSync(debug, priorDebug);
  fs.appendFileSync(path.join(archive.output, 'native-input-admission.json'), '\n');
  assert.throws(() => candidateArchiveSize(options), /native input receipt changed/);
});

test('changed APKs, mocks, another profile or channel, code/package drift, signed output and changed inputs cannot become native candidates', async t => {
  const f = fixture(t), admission = await candidateVersion(f), archive = f.archive(admission);
  const file = path.join(archive.output, 'apk-verification.json'), original = read(file);
  for (const change of [v => v.testMocks = true, v => v.runtimeProfile = 'cloud', v => v.allowUnpackagedRuntime = true,
    v => v.updateChannel.kind = 'other', v => v.upstream.commit = '0'.repeat(40),
    v => v.results[0].versionCode++, v => v.results[1].packageName = 'other.package',
    v => v.results[1].signed = true, v => v.results[1].distributable = true]) {
    const modified = structuredClone(original); change(modified); json(file, modified);
    assert.throws(() => candidateReceipt({...f, admission, archive: archive.relative}));
  }
  json(file, original);
  fs.appendFileSync(path.join(archive.output, 'launcher-release-unsigned.apk'), 'changed');
  assert.throws(() => candidateReceipt({...f, admission, archive: archive.relative}), /differs from verification/);
  const fresh = f.archive(admission);
  json(path.join(fresh.output, 'inputs-after.json'), {digest: '0'.repeat(64)});
  assert.throws(() => candidateReceipt({...f, admission, archive: fresh.relative}), /inputs changed/);
  assert.equal(fs.existsSync(path.join(archive.output, 'app-update-candidate.json')), false);
});

test('a floor advancing during the build refuses the final receipt without altering the admitted version', async t => {
  const f = fixture(t), versionFile = 'test-results/version.json';
  const admission = await main(['version', versionFile], f), archive = f.archive(admission);
  const before = fs.readFileSync(path.join(f.root, versionFile));
  f.state.pages = [[{name: 'alpha-phone-705.apk'}]];
  await assert.rejects(main(['receipt', versionFile, archive.relative], f), /version floor/);
  assert.equal(fs.existsSync(path.join(archive.output, 'app-update-candidate.json')), false);
  assert.deepEqual(fs.readFileSync(path.join(f.root, versionFile)), before);
  const child = spawnSync(process.execPath, [path.join(root, 'scripts/app-update-candidate.ts'), 'version', 'test-results/refused.json'],
    {cwd: f.root, env: {...f.env, GITHUB_EVENT_NAME: 'workflow_dispatch'}, encoding: 'utf8'});
  assert.equal(child.status, 1); assert.match(child.stderr, /main push/);
  assert.equal(fs.existsSync(path.join(f.root, 'test-results/refused.json')), false);
});

test('real workflow keeps main candidates unsigned and isolated while preserving explicit qualification and dispatched versions', () => {
  const workflow = YAML.parse(fs.readFileSync(path.join(root, '.github/workflows/resident-android.yml'), 'utf8'));
  const evaluate = (text, github, inputs = {}, vars = {}) => {
    const expression = text.startsWith('${{') ? text.slice(3, -2) : text;
    const format = (pattern, ...args) => pattern.replace(/\{(\d+)\}/g, (_, index) => args[index]);
    return new Function('github', 'inputs', 'vars', 'format', `return (${expression});`)(github, inputs, vars, format);
  };
  const main = {event_name: 'push', ref: 'refs/heads/main', sha: 'a'.repeat(40), run_id: '101', run_attempt: '1'};
  const build = workflow.jobs.build;
  const stepNames = build.steps.map(step => step.name || step.uses || step.run);
  const nativeBuild = build.steps.find(step => step.name === 'Build and stage native voice and embeddings from verified inputs');
  assert.ok(stepNames.indexOf('Resolve the current native build recipe') < stepNames.indexOf('Cache verified native source and model inputs'));
  assert.ok(stepNames.indexOf('Cache verified native source and model inputs') < stepNames.indexOf(nativeBuild.name));
  assert.match(nativeBuild.run, /bun run agent:build-embedding-host/);
  assert.match(nativeBuild.run, /bun scripts\/voice-host.ts --verify/);
  assert.equal(nativeBuild.if, undefined, 'both dispatched and automatic builds acquire native inputs');
  assert.equal(nativeBuild.env?.GH_TOKEN, undefined);
  const cache = build.steps.find(step => step.name === 'Cache verified native source and model inputs');
  assert.match(cache.uses, /^actions\/cache\/restore@/);
  assert.equal(cache.with.path, '${{ env.XDG_CACHE_HOME }}/alpha/native-inputs');
  assert.match(cache.with.key, /steps.native-recipe.outputs.sha256/);
  assert.equal(cache.with['restore-keys'].trim(), 'alpha-native-${{ runner.os }}-${{ runner.arch }}-');
  const cacheSave = build.steps.find(step => step.name === 'Retain verified native build cache');
  assert.match(cacheSave.uses, /^actions\/cache\/save@/);
  assert.equal(cacheSave.if, "steps.native-cache.outputs.cache-hit != 'true'");
  assert.deepEqual(cacheSave.with, {path: cache.with.path, key: cache.with.key});
  assert.ok(stepNames.indexOf(nativeBuild.name) < stepNames.indexOf(cacheSave.name));
  assert.ok(!build.steps.some(step => step.run?.includes('hosted-native-inputs.py')));
  assert.equal(evaluate(build.if, main), true);
  assert.equal(evaluate(build.env.ALPHA_APP_UPDATE_CANDIDATE, main), '1');
  assert.equal(build.env.ELIZA_ANDROID_BUN_TARGET, 'linux-musl');
  assert.equal(build.env.ELIZA_ANDROID_TARGET_ABIS, 'arm64-v8a,x86_64');
  assert.equal(evaluate(workflow.concurrency['cancel-in-progress'], main), false);
  // Literal expression checks, not execution of GitHub's concurrency backend.
  // One template string holds two GHA substitutions; inspect its group key.
  const group = workflow.concurrency.group.match(/\$\{\{([\s\S]*?)\}\}/)[1];
  const newer = {...main, sha: 'b'.repeat(40), run_id: '102'};
  const oldRerun = {...main, run_attempt: '2'};
  assert.notEqual(evaluate(group, main), evaluate(group, newer), 'an older push queued later cannot displace the latest push');
  assert.equal(evaluate(group, main), evaluate(group, oldRerun), 'an attempt keeps the group of its own run');
  assert.notEqual(evaluate(group, oldRerun), evaluate(group, newer), 'an older rerun cannot displace the latest push');
  assert.equal(evaluate(workflow.concurrency['cancel-in-progress'], newer), false);
  assert.equal(evaluate(workflow.concurrency['cancel-in-progress'], oldRerun), false);
  assert.equal(evaluate(group, oldRerun), evaluate(group, {...oldRerun, run_attempt: '3'}), 'reruns keep their own run-ID group');
  assert.notEqual(evaluate(group, oldRerun), evaluate(group, {...newer, run_attempt: '2'}));
  assert.equal(evaluate(build.env.ALPHA_APP_UPDATE_CANDIDATE, oldRerun), '1');
  const dispatch = {...main, event_name: 'workflow_dispatch'}, manual = {operation: 'build', build_version_code: '44'};
  assert.equal(evaluate(build.if, dispatch, manual), true);
  assert.equal(evaluate(build.env.ALPHA_APP_UPDATE_CANDIDATE, dispatch, manual), '0');
  assert.equal(evaluate(build.env.ELIZAOS_VERSION_CODE, dispatch, manual), '44');
  assert.equal(evaluate(build.env.ELIZAOS_VERSION_CODE, main), '');
  assert.notEqual(evaluate(group, main), evaluate(group, dispatch, manual));
  assert.equal(evaluate(group, dispatch, manual), 'refs/heads/main');
  assert.equal(evaluate(group, dispatch, manual), evaluate(group, {...dispatch, run_attempt: '2'}, manual));
  assert.equal(evaluate(workflow.concurrency['cancel-in-progress'], {...dispatch, run_attempt: '2'}, manual), true);
  const develop = {...main, ref: 'refs/heads/develop'};
  assert.equal(evaluate(build.if, develop), false);
  assert.equal(evaluate(build.if, develop, {}, {ELIZA_RESIDENT_QUALIFICATION: 'push'}), true);
  assert.equal(evaluate(build.env.ALPHA_APP_UPDATE_CANDIDATE, develop), '0');
  const nightly = {...main, event_name: 'schedule'};
  assert.equal(evaluate(build.if, nightly, {}, {ELIZA_RESIDENT_QUALIFICATION: 'nightly'}), true);
  assert.notEqual(evaluate(group, develop), evaluate(group, {...develop, sha: newer.sha}));
  assert.notEqual(evaluate(group, develop), evaluate(group, nightly));
  for (const context of [develop, nightly]) {
    assert.notEqual(evaluate(group, context), evaluate(group, main));
    assert.equal(evaluate(workflow.concurrency['cancel-in-progress'], context), false);
  }
  assert.deepEqual(workflow.permissions, {contents: 'read'});
  assert.deepEqual(build.permissions, {contents: 'read', actions: 'read'});
  const candidate = build.steps.find(step => step.name === 'Retain the unsigned native update candidate separately from test mocks');
  assert.equal(candidate.if, "env.ALPHA_APP_UPDATE_CANDIDATE == '1'");
  assert.equal(candidate.with.path, 'test-results/resident-ci-distribution/');
  assert.equal(build.steps.find(step => step.id === 'apks').with.path,
    'test-results/resident-ci-archive/');
  assert.equal(workflow.jobs.native.needs, 'build');
  assert.equal(workflow.jobs.native.env.ALPHA_RESIDENT_MANIFEST_SHA256, '${{ needs.build.outputs.manifest_sha256 }}');
});

test('producer evidence retains exact unsigned distribution metadata and refuses drift before recording it', async t => {
  const workflow = YAML.parse(fs.readFileSync(path.join(root, '.github/workflows/resident-android.yml'), 'utf8'));
  const f = fixture(t);
  const admission = await candidateVersion(f);
  const archive = f.archive(admission, 'test-results/resident-ci-distribution');
  const evidence = path.join(archive.output, 'producer-evidence');
  const generatedManifest = 'android/app/build/generated/local-agent/source-manifest.json';
  const put = (name, bytes) => {
    const file = path.join(f.root, name);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, bytes);
  };
  const verification = fs.readFileSync(path.join(archive.output, 'apk-verification.json'));
  const config = {runtimeProfile: 'native', testMocks: false, signingRequested: false,
    updateChannel: admission.updateChannel, versionOverride: {code: String(admission.versionCode)}};
  const sourceManifest = '{"scope":"fixture-distribution"}';
  put('artifacts/apk-manifest.json', verification);
  put('artifacts/build-config.json', JSON.stringify(config));
  put(generatedManifest, sourceManifest);
  for (const name of ['artifacts/sbom/alphaphone.cdx.json', 'apps/app/public/licenses/notice', 'licenses/README.md',
    'android/app/src/main/assets/agent/agent-bundle.js', 'android/app/src/main/jniLibs/x86_64/libfixture.so',
    'artifacts/sdk/.alpha-runtime-source.json', 'artifacts/worker/manifest.json']) {
    put(name, 'synthetic evidence');
  }
  const snapshot = read(path.join(archive.output, 'inputs-after.json'));
  snapshot.files[generatedManifest] = hash(sourceManifest);
  snapshot.digest = hash(JSON.stringify(snapshot.files));
  for (const name of ['inputs-before.json', 'inputs-after.json']) json(path.join(archive.output, name), snapshot);
  const retain = workflow.jobs.build.steps.find(step => step.name === 'Retain bounded distribution producer evidence');
  const program = retain.run.split("python3 - <<'PYCODE'\n")[1].split('\nPYCODE')[0];
  const capture = () => spawnSync('python3', ['-c', program], {cwd: f.root, encoding: 'utf8', timeout: 5000,
    env: {...f.env, ALPHA_LOCAL_AGENT_SOURCE_DIR: path.join(f.root, 'artifacts/sdk'),
      ALPHA_WORKFLOW_WORKER_OUTPUT: path.join(f.root, 'artifacts/worker'), ELIZAOS_VERSION_CODE: String(admission.versionCode)}});
  const passed = capture();
  assert.equal(passed.status, 0, passed.stderr);
  const manifest = read(path.join(evidence, 'manifest.json'));
  assert.equal(manifest.source, admission.sourceCommit);
  assert.equal(manifest.versionCode, admission.versionCode);
  assert.deepEqual(manifest.updateChannel, admission.updateChannel);
  assert.deepEqual(fs.readFileSync(path.join(evidence, 'artifacts/apk-manifest.json')), verification);
  assert.deepEqual(manifest.files['native-source-manifest.json'],
    {bytes: Buffer.byteLength(sourceManifest), sha256: hash(sourceManifest)});
  assert.ok(manifest.files['native-build-receipt.json']);
  for (const [name, changed, original, error] of [
    ['artifacts/build-config.json', JSON.stringify({...config, testMocks: true}), JSON.stringify(config), /configuration differs/],
    ['artifacts/apk-manifest.json', '{}', verification, /APK verification differs/],
    [generatedManifest, '{"scope":"fixture-mocks"}', sourceManifest, /differs from frozen build input/],
  ]) {
    fs.rmSync(evidence, {recursive: true, force: true});
    put(name, changed);
    const refused = capture();
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, error);
    assert.equal(fs.existsSync(path.join(evidence, 'manifest.json')), false);
    put(name, original);
  }
});
