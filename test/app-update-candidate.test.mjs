import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import YAML from 'yaml';
import {candidateVersion, candidateReceipt, candidateArchiveSize, uploadedCandidateMetadata, main} from '../scripts/app-update-candidate.ts';
import {candidateFixture as fixture, hash, json, legacyManifestUrl, read} from './fixtures/app-update-candidate.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

test('uploaded artifact metadata retries transient visibility and transport failures within the same authenticated read', async () => {
  let calls = 0, waits = 0;
  const result = await uploadedCandidateMetadata('4242', 'controlled-token', {
    request: async (url, options) => {
      assert.equal(url, 'https://api.github.com/repos/eliza-research/alpha/actions/artifacts/4242');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, 'Bearer controlled-token');
      assert.ok(options.signal instanceof AbortSignal);
      calls++;
      if (calls === 1) throw Error('controlled network failure');
      if (calls === 2) return new Response('not visible yet', {status: 404});
      if (calls === 3) return new Response('temporary service failure', {status: 503});
      return Response.json({id: 4242, size_in_bytes: 1500});
    }, wait: async milliseconds => {assert.equal(milliseconds, 1000); waits++;},
  });
  assert.deepEqual(result, {id: 4242, size_in_bytes: 1500});
  assert.equal(calls, 4); assert.equal(waits, 3);
});

test('artifact metadata never substitutes a floor or retries authorization and malformed responses', async () => {
  for (const status of [401, 403]) {
    let calls = 0;
    await assert.rejects(uploadedCandidateMetadata('4242', 'controlled-token', {
      request: async () => {calls++; return new Response('private response body', {status});},
      wait: async () => assert.fail('Authorization failures cannot become a retry'),
    }), error => error.message === 'Uploaded candidate metadata read failed (HTTP ' + status + ')');
    assert.equal(calls, 1);
  }
  for (const payload of ['not JSON', 'x'.repeat(16 * 1024 * 1024 + 1)]) {
    let calls = 0;
    await assert.rejects(uploadedCandidateMetadata('4242', 'controlled-token', {
      request: async () => {calls++; return new Response(payload);},
      wait: async () => assert.fail('Malformed metadata cannot become a retry'),
    }), /metadata (?:is not JSON|exceeds 16 MiB)/);
    assert.equal(calls, 1);
  }
  let calls = 0, waits = 0;
  await assert.rejects(uploadedCandidateMetadata('4242', 'controlled-token', {
    request: async () => {calls++; return new Response('', {status: 404});},
    wait: async () => {waits++;},
  }), /HTTP 404/);
  assert.equal(calls, 5); assert.equal(waits, 4);
  await assert.rejects(uploadedCandidateMetadata('../4242', 'controlled-token'), /Exact uploaded candidate/);
  await assert.rejects(uploadedCandidateMetadata('4242', undefined), /requires a GitHub token/);
});

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
  for (const variant of ['launcher']) {
    const bytes = fs.readFileSync(path.join(archive.output, variant + '-debug.apk'));
    assert.equal(result.debugApks[variant].sha256, hash(bytes));
    assert.equal(result.debugApks[variant].bytes, bytes.length);
  }
  assert.equal(result.nativeInputAdmissionSha256, candidate.nativeInputAdmissionSha256);
  assert.throws(() => candidateArchiveSize({...options, api: () => ({...uploaded, digest: 'sha256:' + 'b'.repeat(64)})}),
    /artifact identity or size differs/);
  assert.throws(() => candidateArchiveSize({...options, api: () => ({...uploaded, name: uploaded.name.slice(0, -1) + '2'})}),
    /artifact identity or size differs/);
  const debug = path.join(archive.output, 'launcher-debug.apk'), priorDebug = fs.readFileSync(debug);
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
    v => v.results[0].versionCode++, v => v.results[0].packageName = 'other.package',
    v => v.results[0].signed = true, v => v.results[0].distributable = true]) {
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
  const build = workflow.jobs.build;
  assert.deepEqual(workflow.permissions, {contents: 'read'});
  assert.deepEqual(build.permissions, {contents: 'read', actions: 'read'});
  const candidate = build.steps.find(step => step.name === 'Retain the unsigned native update candidate');
  assert.equal(candidate.if, "env.ALPHA_APP_UPDATE_CANDIDATE == '1'");
  assert.equal(candidate.with.path, 'test-results/resident-ci-distribution/');
  assert.deepEqual(Object.keys(workflow.jobs), ['publish-qualification', 'build']);

});
