import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {nativeRecipe, nativeRecipeDigest, NATIVE_BUILD_RECEIPT, nativeOutputInventory} from '../../scripts/native-build-inputs.ts';
import {embeddingProducerInputPaths, nativeInputPaths, nativeJavaPath, nativeBinding, nativeInputs, nativeGenerated} from '../../scripts/embedding-native-contract.ts';

// Disposable real Git/filesystem inputs; archive bytes and remote metadata are synthetic.
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const json = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
export const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export const legacyManifestUrl = 'https://github.com/eliza-research/alpha/releases/download/app-stable/alpha-update-stable.json';
const repository = {id: 1396333361, full_name: 'eliza-research/alpha'};
export function candidateFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-app-candidate-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const git = (cwd, args) => execFileSync('git', args, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  const commit = cwd => git(cwd, ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'Synthetic candidate fixture']);
  const sdk = path.join(directory, 'vendor/eliza');
  fs.mkdirSync(sdk, {recursive: true}); git(sdk, ['init', '-q']);
  const write = (name, bytes, root = directory) => {
    const target = path.join(root, name); fs.mkdirSync(path.dirname(target), {recursive: true}); fs.writeFileSync(target, bytes);
  };
  for (const name of new Set([...embeddingProducerInputPaths, ...nativeInputPaths, nativeJavaPath,
    'packages/app/scripts/paradee-voice/build-native.ts', 'packages/app/scripts/voice/build-phonon2-gguf.ts',
    'plugins/plugin-local-inference/native/android/CMakeLists.txt',
    'plugins/plugin-native-inference/src/model-catalog/voice-model-versions.json'])) write(name, 'synthetic source', sdk);
  write('bun.lock', 'synthetic lock', sdk);
  fs.mkdirSync(path.join(sdk, 'plugins/plugin-local-inference/native/llama.cpp'), {recursive: true});
  git(sdk, ['add', '.']);
  git(sdk, ['update-index', '--add', '--cacheinfo', '160000,' + 'e'.repeat(40) + ',plugins/plugin-local-inference/native/llama.cpp']);
  commit(sdk);
  const sdkCommit = git(sdk, ['rev-parse', 'HEAD']);
  fs.mkdirSync(path.join(directory, 'android'));
  const config = {appId: 'ai.alphacompute.alphaphone', versionCode: 1,
    updateManifestUrl: 'https://github.com/eliza-research/alpha/releases/download/app-stable-alphacompute/alpha-update-stable.json'};
  json(path.join(directory, 'app.config.json'), config);
  json(path.join(directory, 'upstream.lock.json'), {commit: sdkCommit});
  json(path.join(directory, 'android/release-signer.json'), {lastRelease: {versionCode: null}});
  for (const name of ['voice-host', 'embedding-host']) fs.mkdirSync(path.join(directory, 'android', name));
  json(path.join(directory, 'android/voice-host/qualified-voice-host.json'), {models: [], asrSlot: {}});
  json(path.join(directory, 'android/embedding-host/qualified-host.json'), {forkPin: 'e'.repeat(40), model: {id: 'synthetic-embedding-model'}});
  json(path.join(directory, 'android/embedding-host/build-toolchain.json'), {ndk: '28.2.13676358', cmake: '4.0.3'});
  write('android/embedding-host/native-requirements.txt', 'synthetic pinned package==1');
  write('android/embedding-host/bootstrap-requirements.txt', 'synthetic pinned bootstrap==1');
  write('android/paradee-voice/asr-inputs.json', '{}');
  for (const name of ['build-embedding-host', 'prepare-embedding-host', 'embedding-native-contract',
    'embedding-build-remap', 'native-build-inputs', 'android-stage-voice-models', 'local-agent-source', 'voice-host', 'paradee-runtime', 'android-abis', 'copy-file-clone', 'stage-embedding-host']) write(`scripts/${name}.ts`, 'synthetic recipe input');
  git(directory, ['init', '-q']); git(directory, ['add', 'app.config.json', 'upstream.lock.json', 'android', 'scripts']); commit(directory);
  const env = {...process.env, GITHUB_REPOSITORY: repository.full_name, GITHUB_EVENT_NAME: 'push',
    GITHUB_REPOSITORY_ID: String(repository.id),
    GITHUB_REF: 'refs/heads/main', GITHUB_WORKFLOW_REF: 'eliza-research/alpha/.github/workflows/resident-android.yml@refs/heads/main',
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
    if (args[0] === 'repos/eliza-research/alpha') return {...repository, private: false};
    if (args[0].endsWith('/tags/app-stable')) return state.legacyMissing ? null : {id: 15, draft: false};
    if (args[0].endsWith('/tags/app-stable-alphacompute')) return state.missing ? null : {id: 16, draft: false};
    if (args[2] === 'repos/eliza-research/alpha/releases/15/assets?per_page=100') {
      assert.deepEqual(args.slice(0, 2), ['--paginate', '--slurp']);
      return state.legacyPages;
    }
    assert.deepEqual(args, ['--paginate', '--slurp', 'repos/eliza-research/alpha/releases/16/assets?per_page=100']);
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
    const recipe = nativeRecipe(directory);
    const library = name => ({name, bytes: 23, sha256: hash('synthetic native output'), alignment16KiB: true});
    const voice = {identity: config.appId, pin: sdkCommit, forkPin: recipe.engineCommit, qualified: false,
      models: recipe.models, asrSlot: recipe.asrSlot,
      abis: ['arm64-v8a', 'x86_64'].map(abi => ({abi, abiVersion: 17, alignment16KiB: true,
        libraries: ['libelizainference.so', 'libc++_shared.so'].map(library)}))};
    const binding = nativeBinding('synthetic source', 'synthetic source', config.appId);
    const native = {schema: 'alpha-native-build/v1', consumerSdkCommit: sdkCommit, recipe, recipeSha256: nativeRecipeDigest(recipe),
      producer: {sdkCommit, platform: 'linux', arch: 'x64', ndk: recipe.toolchain.ndk, cmake: recipe.toolchain.cmake, python: recipe.python},
      voice, embedding: {identity: config.appId, model: {id: 'synthetic-embedding-model'}, pin: sdkCommit, forkPin: recipe.engineCommit, abi: 'arm64-v8a',
        jniIdentityRelocated: true, jniBinding: binding,
        libraries: ['libelizainference.so', 'libc++_shared.so', 'libelizavoicejni.so'].map(library),
        additionalAbis: [{abi: 'x86_64', libraries: ['libelizainference.so', 'libc++_shared.so', 'libelizavoicejni.so'].map(library)}],
        inputs: nativeInputs(binding).map(name => ({path: name, sourceSha256: hash('synthetic source'),
          generatedSha256: hash(nativeGenerated(name, 'synthetic source', config.appId, binding))})),
        producerInputs: embeddingProducerInputPaths.map(name => ({path: name, sha256: hash('synthetic source')}))},
      files: [], qualification: {deviceExecuted: false, userAccepted: false}};
    for (const name of nativeOutputInventory(native).keys()) write(name, 'synthetic native output');
    write('.eliza/paradee-voice/native/assets/paradee-voice/v1/manifest.json', JSON.stringify({format: 'eliza-paradee-voice-v2', files: []}));
    const record = {sourceCommit: sdkCommit, nativeCommit: recipe.engineCommit,
      files: [...nativeOutputInventory(native).keys()].filter(name => name.startsWith('.eliza/paradee-voice/native/') && !name.endsWith('/build-record.json'))
        .map(name => ({path: name.slice('.eliza/paradee-voice/native/'.length),
          bytes: fs.statSync(path.join(directory, name)).size, sha256: hash(fs.readFileSync(path.join(directory, name)))}))};
    write('.eliza/paradee-voice/native/build-record.json', JSON.stringify(record));
    native.files = [...nativeOutputInventory(native).keys()].sort().map(name => ({path: name,
      bytes: fs.statSync(path.join(directory, name)).size, sha256: hash(fs.readFileSync(path.join(directory, name)))}));
    write(NATIVE_BUILD_RECEIPT, JSON.stringify(native));
    json(path.join(output, 'native-input-admission.json'), native);
    const files = {...recipe.productInputs, 'upstream.lock.json': hash(fs.readFileSync(path.join(directory, 'upstream.lock.json'))),
      [NATIVE_BUILD_RECEIPT]: hash(JSON.stringify(native)),
      ...Object.fromEntries(native.files.map(row => [row.path, row.sha256]))};
    for (const name of ['inputs-before.json', 'inputs-after.json']) json(path.join(output, name), {schemaVersion: 5, digest: hash(JSON.stringify(files)), files});
    const manifest = {}, rows = [];
    for (const variant of ['launcher']) {
      const name = `${variant}-release-unsigned.apk`, bytes = Buffer.from(`Synthetic ${variant} archive bytes; no APK or device claim`);
      fs.writeFileSync(path.join(output, name), bytes); manifest[name] = hash(bytes);
      rows.push({variant, mode: 'release', file: `artifacts/${name}`, packageName: config.appId, versionCode: admission.versionCode,
        sha256: hash(bytes), signed: false, signerSha256: null, distributable: false, testMocks: false, debuggable: false,
        runtime: 'PACKAGED', home: variant === 'launcher', launcher: true, updateChannel: channel,
        releaseAdmission: {failures: [], blockers: ['unsigned release']}});
    }
    for (const variant of ['launcher']) {
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

