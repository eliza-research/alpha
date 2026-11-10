import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import YAML from 'yaml';
import {candidateVersion, candidateReceipt, main} from '../scripts/app-update-candidate.ts';
import {candidateFixture as fixture, hash, json, read} from './fixtures/app-update-candidate.mjs';

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

test('missing or malformed inventories, hidden pointers and wrong source/workflow epochs fail before writing a candidate', async t => {
  const f = fixture(t), destination = 'test-results/version.json';
  for (const change of [{GITHUB_EVENT_NAME: 'workflow_dispatch'}, {GITHUB_REF: 'refs/heads/develop'},
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
  for (const runChanges of [{workflow_id: 373209005}, {event: 'pull_request'}, {head_sha: '0'.repeat(40)}, {run_attempt: 2}, {run_number: 704}]) {
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
  const receipt = path.join(archive.output, 'app-update-candidate.json'), before = fs.readFileSync(receipt);
  await assert.rejects(main(['receipt', versionFile, archive.relative], f), /EEXIST/);
  assert.deepEqual(fs.readFileSync(receipt), before, 'A retry cannot overwrite prior evidence');
});

test('changed APKs, mocks, Cloud/private profiles, code/package drift, signed output and changed inputs cannot become native candidates', async t => {
  const f = fixture(t), admission = await candidateVersion(f), archive = f.archive(admission);
  const file = path.join(archive.output, 'apk-verification.json'), original = read(file);
  for (const change of [v => v.testMocks = true, v => v.runtimeProfile = 'cloud', v => v.allowUnpackagedRuntime = true,
    v => v.updateChannel.kind = 'private-qa', v => v.upstream.commit = '0'.repeat(40),
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
  assert.equal(evaluate(build.if, main), true);
  assert.equal(evaluate(build.env.ALPHA_APP_UPDATE_CANDIDATE, main), '1');
  assert.equal(build.env.ALPHA_RUNTIME_PROFILE, undefined);
  assert.equal(build.env.ELIZA_ANDROID_BUN_TARGET, 'linux-musl');
  assert.equal(build.env.ELIZA_ANDROID_TARGET_ABIS, 'arm64-v8a,x86_64');
  assert.equal(evaluate(workflow.concurrency['cancel-in-progress'], main), true);
  // Inspect the first substitution used to group candidate attempts.
  const group = workflow.concurrency.group.match(/\$\{\{([\s\S]*?)\}\}/)[1];
  const newer = {...main, sha: 'b'.repeat(40), run_id: '102'};
  const oldRerun = {...main, run_attempt: '2'};
  assert.equal(evaluate(group, main), evaluate(group, newer));
  assert.notEqual(evaluate(group, oldRerun), evaluate(group, newer), 'rerunning an old push cannot enter the primary group');
  assert.equal(evaluate(workflow.concurrency['cancel-in-progress'], oldRerun), false);
  assert.equal(evaluate(group, oldRerun), evaluate(group, {...oldRerun, run_attempt: '3'}), 'reruns keep their own run-ID group');
  assert.notEqual(evaluate(group, oldRerun), evaluate(group, {...newer, run_attempt: '2'}));
  assert.equal(evaluate(build.env.ALPHA_APP_UPDATE_CANDIDATE, oldRerun), '1');
  const dispatch = {...main, event_name: 'workflow_dispatch'}, manual = {operation: 'build', build_version_code: '44'};
  assert.equal(evaluate(build.if, dispatch, manual), true);
  assert.equal(evaluate(build.env.ALPHA_APP_UPDATE_CANDIDATE, dispatch, manual), '0');
  assert.equal(workflow.on.workflow_dispatch.inputs.runtime_profile, undefined);
  assert.equal(workflow.on.workflow_dispatch.inputs.local_embeddings, undefined);
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
  assert.equal(evaluate(build.if, {...main, event_name: 'schedule'}, {}, {ELIZA_RESIDENT_QUALIFICATION: 'nightly'}), true);
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
