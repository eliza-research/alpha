import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Disposable real Git/filesystem inputs; archive bytes and remote metadata are synthetic.
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const json = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
export const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export const legacyManifestUrl = 'https://github.com/alphacompute/alpha/releases/download/app-stable/alpha-update-stable.json';
const repository = {id: 1396333361, full_name: 'alphacompute/alpha'};
export function candidateFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-app-candidate-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const git = (cwd, args) => execFileSync('git', args, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  const commit = cwd => git(cwd, ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'Synthetic candidate fixture']);
  const sdk = path.join(directory, 'vendor/eliza');
  fs.mkdirSync(sdk, {recursive: true}); git(sdk, ['init', '-q']); commit(sdk);
  const sdkCommit = git(sdk, ['rev-parse', 'HEAD']);
  fs.mkdirSync(path.join(directory, 'android'));
  const config = {appId: 'ai.alphacompute.alphaphone', versionCode: 1,
    updateManifestUrl: 'https://github.com/alphacompute/alpha/releases/download/app-stable-alphacompute/alpha-update-stable.json'};
  json(path.join(directory, 'app.config.json'), config);
  json(path.join(directory, 'upstream.lock.json'), {commit: sdkCommit});
  json(path.join(directory, 'android/release-signer.json'), {lastRelease: {versionCode: null}});
  for (const name of ['voice-host', 'embedding-host']) fs.mkdirSync(path.join(directory, 'android', name));
  json(path.join(directory, 'android/voice-host/qualified-voice-host.json'), {synthetic: 'voice'});
  json(path.join(directory, 'android/embedding-host/qualified-host.json'), {forkPin: 'e'.repeat(40)});
  const nativePlan = {artifacts: Object.fromEntries(['voice', 'embeddingComponent', 'embeddingQualification']
    .map((name, index) => [name, {id: String(11 + index), sha256: hash('synthetic artifact ' + name)}]))};
  json(path.join(directory, 'android/hosted-native-inputs.json'), nativePlan);
  git(directory, ['init', '-q']); git(directory, ['add', 'app.config.json', 'upstream.lock.json', 'android']); commit(directory);
  const env = {...process.env, GITHUB_REPOSITORY: repository.full_name, GITHUB_EVENT_NAME: 'push',
    GITHUB_REPOSITORY_ID: String(repository.id),
    GITHUB_REF: 'refs/heads/main', GITHUB_WORKFLOW_REF: 'alphacompute/alpha/.github/workflows/resident-android.yml@refs/heads/main',
    GITHUB_SHA: git(directory, ['rev-parse', 'HEAD']), GITHUB_RUN_ID: '42885443022', GITHUB_RUN_NUMBER: '705', GITHUB_RUN_ATTEMPT: '1'};
  const state = {
    pages: [[{name: 'alpha-phone-24.apk'}]], pointer: null, missing: false,
    legacyPages: [[]], legacyPointer: null, legacyMissing: true, calls: [], runChanges: {},
  };
  const api = args => {
    state.calls.push(args);
    if (args[0].includes('/actions/runs/')) return {id: Number(env.GITHUB_RUN_ID), workflow_id: 373209004,
      path: '.github/workflows/resident-android.yml', event: 'push', head_branch: 'main', head_sha: env.GITHUB_SHA,
      repository, head_repository: repository, run_number: Number(env.GITHUB_RUN_NUMBER),
      run_attempt: Number(env.GITHUB_RUN_ATTEMPT), ...state.runChanges};
    if (args[0] === 'repos/alphacompute/alpha') return {...repository, private: false};
    if (args[0].endsWith('/tags/app-stable')) return state.legacyMissing ? null : {id: 15, draft: false};
    if (args[0].endsWith('/tags/app-stable-alphacompute')) return state.missing ? null : {id: 16, draft: false};
    if (args[2] === 'repos/alphacompute/alpha/releases/15/assets?per_page=100') {
      assert.deepEqual(args.slice(0, 2), ['--paginate', '--slurp']);
      return state.legacyPages;
    }
    assert.deepEqual(args, ['--paginate', '--slurp', 'repos/alphacompute/alpha/releases/16/assets?per_page=100']);
    return state.pages;
  };
  const options = {root: directory, env, api, read: async url => {
    if (url === legacyManifestUrl) return state.legacyPointer;
    assert.equal(url, config.updateManifestUrl);
    return state.pointer;
  }};
  function archive(admission, relative = 'test-results/distribution') {
    const output = path.join(directory, relative);
    fs.mkdirSync(output, {recursive: true});
    const channel = admission.updateChannel;
    json(path.join(output, 'configuration.json'), {runtimeProfile: 'native', testMocks: false, updateChannel: channel});
    const files = Object.fromEntries(['upstream.lock.json', 'android/hosted-native-inputs.json',
      'android/voice-host/qualified-voice-host.json', 'android/embedding-host/qualified-host.json']
      .map(name => [name, hash(fs.readFileSync(path.join(directory, name)))]));
    json(path.join(output, 'native-input-admission.json'), {schema: 'alpha-hosted-native-input-admission/v1',
      source: admission.sourceCommit, sdkCommit, packageName: config.appId, runId: admission.runId, attempt: admission.runAttempt,
      manifestSha256: files['android/hosted-native-inputs.json'],
      voiceRecordSha256: files['android/voice-host/qualified-voice-host.json'],
      embeddingRecordSha256: files['android/embedding-host/qualified-host.json'],
      artifacts: Object.fromEntries(Object.entries(nativePlan.artifacts).map(([name, pin]) => [name,
        {artifactId: Number(pin.id), sha256: pin.sha256, run: 10, source: admission.sourceCommit, archiveBytes: 1000, expandedBytes: 2000}])),
      embedding: {compiledAlpha: admission.sourceCommit, compiledSDK: sdkCommit, native: 'e'.repeat(40),
        qualifiedAt: '2026-11-10T12:00:00Z', qualificationTransferred: false}});
    files['test-results/resident-ci-native-inputs/admission.json'] = hash(fs.readFileSync(path.join(output, 'native-input-admission.json')));
    for (const name of ['inputs-before.json', 'inputs-after.json']) json(path.join(output, name), {schemaVersion: 5, digest: hash(JSON.stringify(files)), files});
    const manifest = {}, rows = [];
    for (const variant of ['standalone', 'launcher']) {
      const name = `${variant}-release-unsigned.apk`, bytes = Buffer.from(`Synthetic ${variant} archive bytes; no APK or device claim`);
      fs.writeFileSync(path.join(output, name), bytes); manifest[name] = hash(bytes);
      rows.push({variant, mode: 'release', file: `artifacts/${name}`, packageName: config.appId, versionCode: admission.versionCode,
        sha256: hash(bytes), signed: false, signerSha256: null, distributable: false, testMocks: false, debuggable: false,
        runtime: 'PACKAGED', home: variant === 'launcher', launcher: true, updateChannel: channel,
        releaseAdmission: {failures: [], blockers: ['unsigned release']}});
    }
    for (const variant of ['standalone', 'launcher']) {
      const name = `${variant}-debug.apk`, bytes = Buffer.from(`Synthetic ${variant} debug bytes`);
      fs.writeFileSync(path.join(output, name), bytes); manifest[name] = hash(bytes);
      rows.push({...rows.find(row => row.variant === variant), mode: 'debug', file: 'artifacts/' + name,
        debuggable: true, signed: true, sha256: hash(bytes)});
    }
    json(path.join(output, 'apk-manifest.json'), manifest);
    json(path.join(output, 'apk-verification.json'), {runtimeProfile: 'native', testMocks: false, allowUnpackagedRuntime: false,
      updateChannel: channel, upstream: {commit: sdkCommit}, results: rows});
    return {relative, output};
  }
  return {...options, state, git, commit, sdk, config, archive};
}

