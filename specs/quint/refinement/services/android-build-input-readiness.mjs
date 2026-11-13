import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkoutProblems, formatProblems, formatReport, strictBuildInputs} from '../../../../scripts/android-build-preflight.ts';
import {BUILD_TOOLCHAIN, QUALIFIED_HOST} from '../../../../scripts/build-embedding-host.ts';
import {captureInputs, checkTraces, qset} from '../check-traces.mjs';

const inputs = ['scripts/android-build-preflight.ts', 'scripts/build-embedding-host.ts', 'scripts/voice-host.ts'];
const labels = new Map([
  ['pinned upstream checkout', 'pin'], ['on-device voice outputs', 'voice'],
  ['embedding host libraries', 'embedding'],
  ['prepared resident runtime source', 'prepared'], ['workflow worker artifact', 'worker'],
  ['staged resident runtime payload', 'payload'], ['embedding model', 'model'],
  ['Gradle dependency verification metadata', 'gradle'], ['release signer', 'signer'],
]);
const notices = [
  [/Every build input is present/, 'allInputs'],
  [/Missing or changed voice outputs stop Gradle/, 'voiceBlocker'],
  [/An unset release signer does not stop the build/, 'unsigned'],
];
const kinds = [
  [/^(vendor\/eliza is |upstream\.lock\.json pins |The upstream pin )/, 'pin'],
  [/^The on-device voice outputs/, 'voice'],
];
const signingNames = ['ELIZAOS_KEYSTORE_PATH', 'ELIZAOS_KEYSTORE_PASSWORD', 'ELIZAOS_KEY_ALIAS', 'ELIZAOS_KEY_PASSWORD'];
const marker = 'synthetic-signing-environment-marker';
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, '-c', 'user.name=Quint Fixture',
  '-c', 'user.email=quint-fixture@example.invalid', '-c', 'commit.gpgsign=false',
  '-c', 'core.hooksPath=/dev/null', ...args], {
  encoding: 'utf8', env: {PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1'}, stdio: ['ignore', 'pipe', 'pipe'],
}).trim();

function fixture(root) {
  const write = (path, bytes) => {
    const file = join(root, path);
    fs.mkdirSync(dirname(file), {recursive: true});
    fs.writeFileSync(file, bytes);
  };
  const json = (path, data) => write(path, JSON.stringify(data) + '\n');
  const remove = path => {
    const file = join(root, path);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  };
  const commit = (cwd, label) => {
    git(cwd, 'add', '.');
    git(cwd, 'commit', '-qm', label);
    return git(cwd, 'rev-parse', 'HEAD');
  };
  const vendor = join(root, 'vendor/eliza');
  fs.mkdirSync(vendor, {recursive: true});
  git(vendor, 'init', '-q');
  write('vendor/eliza/fixture-source', 'first reviewed source\n');
  const older = commit(vendor, 'first reviewed source');
  write('vendor/eliza/fixture-source', 'second reviewed source\n');
  const current = commit(vendor, 'second reviewed source');
  const unknown = 'f'.repeat(40);
  git(root, 'init', '-q');
  const setLock = pin => json('upstream.lock.json', {commit: pin});
  const mainRefs = new Map([older, current, unknown].map(pin => {
    setLock(pin);
    git(root, 'add', 'upstream.lock.json');
    git(root, 'commit', '-qm', 'reviewed main pin');
    return [pin, git(root, 'rev-parse', 'HEAD')];
  }));
  const pinCases = {
    equal: [current, current, current], descendant: [current, current, older],
    older: [older, older, current], unknown: [current, current, unknown],
    mismatch: [current, older, current],
  };
  const selectPin = value => {
    const [pin, head, main] = pinCases[value];
    setLock(pin);
    git(vendor, 'checkout', '-q', '--detach', head);
    git(root, 'update-ref', 'refs/remotes/origin/main', mainRefs.get(main));
  };
  selectPin('equal');

  const abi = 'arm64-v8a';
  const libraries = ['libelizainference.so', 'libelizavoicejni.so', 'libc++_shared.so']
    .map(name => ({name, content: 'synthetic byte record for ' + name + '\n'}));
  const hostRecord = {abi, model: {path: 'android/app/src/main/assets/agent/models/fixture.gguf'},
    libraries: libraries.map(({name, content}) => ({name, bytes: Buffer.byteLength(content),
      sha256: createHash('sha256').update(content).digest('hex')}))};
  let voice = 'missing', host = 'missing', env = {};
  const setHost = value => {
    host = value;
    json(QUALIFIED_HOST, hostRecord);
    for (const {name, content} of libraries) {
      const path = 'android/app/src/main/jniLibs/' + abi + '/' + name;
      if (value === 'missing') remove(path);
      else write(path, value === 'different' && name === libraries[0].name ? 'synthetic drift\n' : content);
    }
  };
  const setSigner = value => {
    env = ['envOnly', 'ready'].includes(value) ? Object.fromEntries(signingNames.map(key => [key, marker])) : {};
    json('android/release-signer.json', {signerSha256: ['identityOnly', 'ready'].includes(value) ? 'e'.repeat(64) : 'unset'});
  };
  setHost('missing');
  json(BUILD_TOOLCHAIN, {});
  setSigner('unset');

  const source = join(root, 'artifacts/prepared');
  const workerDirectory = join(root, 'artifacts/worker');
  const assets = 'android/app/src/main/assets/agent';
  const artifact = 'artifacts/worker/manifest.json', worker = assets + '/workflow-worker/manifest.json';
  const sourceStamp = '{ "base": "synthetic pinned source", "id": "first" }\n';
  const voiceHost = () => {
    if (voice === 'missing') throw Error('synthetic voice input missing');
    return {};
  };
  const classify = problem => {
    const row = kinds.find(([pattern]) => pattern.test(problem));
    assert.ok(row, 'Unknown prerequisite category: ' + problem);
    return row[1];
  };
  const observe = () => {
    const rows = strictBuildInputs(root, source, {env, voiceHost, workerDirectory});
    assert.equal(rows.length, labels.size);
    for (const row of rows) assert.ok(labels.has(row.input));
    const preflight = checkoutProblems(root, {voiceHost});
    const text = formatReport(rows);
    assert.ok(!text.includes(marker) && !JSON.stringify(rows).includes(marker),
      'The report must not disclose values from the synthetic signing environment');
    if (preflight.length) {
      const problemText = formatProblems(preflight);
      assert.match(problemText, /^Android build prerequisites are missing:/);
      for (const problem of preflight) assert.ok(problemText.includes(problem));
    }
    return {
      's.ready': qset(rows.filter(row => row.state === 'ready').map(row => labels.get(row.input))),
      's.attention': qset(rows.filter(row => row.state === 'missing' && row.suppliedBy === 'person').map(row => labels.get(row.input))),
      's.preflight': qset(preflight.map(classify)),
      's.notices': qset(notices.filter(([pattern]) => pattern.test(text)).map(([, label]) => label)),
    };
  };
  return {observe, selectPin, setHost, setSigner,
    setVoice: value => {voice = value;},
    prepare: () => write('artifacts/prepared/.alpha-runtime-source.json', sourceStamp),
    setPayload: value => write(assets + '/alpha-source.json', value === 'exact' ? sourceStamp : sourceStamp.replace('first', 'second')),
    setWorker(value) {
      if (value === 'artifact' || value === 'both') json(artifact, {}); else remove(artifact);
      if (value === 'staged' || value === 'both') json(worker, {}); else remove(worker);
    },
    stageSupport() {
      write(hostRecord.model.path, 'synthetic model presence only');
      write('android/gradle/verification-metadata.xml', '<fixture/>');
    },
  };
}

function trace(name, actions) {
  using scratch = fs.mkdtempDisposableSync(join(tmpdir(), 'alpha-quint-android-inputs-'));
  const f = fixture(fs.realpathSync(scratch.path));
  const expect = f.observe();
  const steps = actions.map(([action, ...args]) => {
    f[action](...args);
    return {action: {name: action, args}, expect: f.observe()};
  });
  return {name, init: {name: 'init', args: []}, expect, steps};
}

export async function checkAndroidBuildInputReadiness(extraSources = []) {
  const sources = [...inputs, fileURLToPath(import.meta.url), ...extraSources];
  const driverHashes = captureInputs(sources);
  const voice = ['setVoice', 'staged'];
  const host = ['setHost', 'ready'];
  const prep = ['prepare'];
  const payload = ['setPayload', 'exact'];
  const worker = ['setWorker', 'both'];
  const ready = [voice, host, prep, payload, worker];
  const cases = [
    ['the preflight passes with no prepared source, which the chain produces', [voice]],
    ['real Git ancestry admits the current and descendant locks and refuses stale or unknown locks', [voice,
      ['selectPin', 'older'], ['selectPin', 'unknown'], ['selectPin', 'mismatch'], ['selectPin', 'descendant'], ['selectPin', 'equal']]],
    ['the separate artifact is reported while an absent staged worker or stale stamp keeps the payload unready', [voice, host,
      prep, ['setPayload', 'stale'], ['setWorker', 'artifact'], worker, payload]],
    ['the embedding report rejects changed or missing native library bytes', [voice, prep, payload, worker,
      host, ['setHost', 'different'], ['setHost', 'missing'], host]],
    ['signing report needs both identity and environment presence while disclosing no marker value', [
      ['setSigner', 'envOnly'], ['setSigner', 'identityOnly'], ['setSigner', 'ready']]],
    ['all reported inputs can be ready without running a build or an external provider', [
      ...ready, ['stageSupport'], ['setSigner', 'ready']]],
  ];
  return checkTraces({model: 'AndroidBuildInputReadiness', scope: 'bounded-orchestration',
    sources, driverHashes, traces: cases.map(([name, actions]) => trace(name, actions)),
    assumptions: [
      'The real report, formatter, Git pin comparison and preflight gate execute on a private fixture.',
      'Voice verification returns a controlled admission outcome. Reported embedding byte readiness uses the real staged-library digest checks on synthetic bytes.',
      'Report presence and build admission are separate. Staging, the Gradle verify tasks, verify-apks, Android builds, real artifact and signing qualification and concurrent staging remain outside this projection.',
    ]});
}
