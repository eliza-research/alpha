import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as promises from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {execFileSync} from 'node:child_process';
import {registerHooks} from 'node:module';
import {basename, dirname, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {CORE_STATE_MANIFEST} from '../../../../scripts/core-state-patch.mjs';
import {writeCoreStateFixture} from '../../../../test/fixtures/core-state-root.mjs';

const repository = resolve(import.meta.dirname, '../../../..');
const launcher = 'scripts/start-cloud-qa.mjs';
const shared = 'vendor/eliza/packages/agent/native-host/private-runtime-launch.mjs';
const support = [
  launcher, shared, 'vendor/eliza/packages/agent/native-host/private-runtime-json.mjs',
  'scripts/cloud-sdk-authority.mjs', 'scripts/native-view-policy.mjs',
  'scripts/cloud-deployment-policy.mjs',
];
const input = 'synthetic-staging-fixture-input';
const model = 'reviewed/fixture-model';
const route = {backend: 'elizacloud', transport: 'cloud-proxy', accountId: 'elizacloud', smallModel: model, largeModel: model};
const action = (name, ...args) => ({name, args});
const file = name => fs.lstatSync(name, {throwIfNoEntry: false})?.isFile() === true;
const directory = name => fs.lstatSync(name, {throwIfNoEntry: false})?.isDirectory() === true;
const privateMode = name => fs.statSync(name).mode & 0o777;
const read = name => JSON.parse(fs.readFileSync(name, 'utf8'));
const args = process.argv.slice(2);
const [scratch, scenario] = args;
assert.equal(scratch, process.cwd());
assert.equal(scratch, process.env.TMPDIR);
assert.equal(process.env.HOME, join(scratch, 'home'));
assert.deepEqual(fs.readdirSync(scratch), ['home']);
for (const name of [scratch, process.env.HOME]) assert.equal(privateMode(name), 0o700);
globalThis.fetch = async () => {throw Error('Network is outside the Cloud QA fixture');};
const root = join(scratch, 'product');
const profile = join(scratch, 'profile');
const key = join(scratch, 'input');
const marker = join(profile, 'alpha-cloud-qa.json');
const token = join(profile, 'owner-token');
const config = join(profile, 'eliza.json');
const log = join(profile, 'server.log');
const receipt = join(profile, 'process.json');
const otherLog = join(scratch, 'unrelated-synthetic-file');
const command = join(scratch, 'closed-bun-port');
const defaultSource = scenario === 'fresh-default';
let source = join(root, 'artifacts/synthetic-sdk');
let entry = join(source, 'packages/app/src/runtime/dev-server.ts');
const write = (name, bytes, mode = 0o600) => {
  fs.mkdirSync(dirname(name), {recursive: true, mode: 0o700});
  fs.writeFileSync(name, bytes, {mode});
};
const json = (name, value) => write(name, JSON.stringify(value)+'\n');

for (const name of support) write(join(root, name), fs.readFileSync(join(repository, name)));
writeCoreStateFixture(root, source, '0'.repeat(40), true);
json(join(source, 'package.json'), {workspaces: []});
json(join(source, 'turbo.json'), {tasks: {}});
if (scenario !== 'missing-entry') write(entry, 'throw Error("The synthetic entry must never run");\n');
const git = (...arguments_) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...arguments_], {
  cwd: source, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000,
}).trim();
git('init', '-q'); git('add', '.');
git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Synthetic SDK');
const revision = git('rev-parse', 'HEAD'), alternate = 'f'.repeat(40);
assert.notEqual(revision, alternate);
function classifyRevision(value) {
  if (value === revision) return 'reviewed';
  assert.equal(value, alternate);
  return 'other';
}
const earlyPreload = ['preload-matches-receipt','preload-admits-before-late-head'].includes(scenario);
const latePreloadRefusal = scenario === 'preload-rejects-after-receipt';
if (defaultSource) {
  const target = join(root, 'artifacts/local-agent-resident-'+revision);
  fs.renameSync(source, target);
  source = target;
  entry = join(source, 'packages/app/src/runtime/dev-server.ts');
}
json(join(root, 'upstream.lock.json'), {commit: revision});
const patchManifest = join(root, CORE_STATE_MANIFEST);
json(patchManifest, {...read(patchManifest), baseCommit: revision});
write(key, input, scenario === 'key-mode' ? 0o644 : 0o600);
Object.assign(process.env, {
  ALPHA_QA_PROFILE: scenario === 'relative-profile' ? 'relative-fixture-profile' : profile,
  ALPHA_QA_CLOUD_KEY_FILE: key, ALPHA_QA_PORT: scenario === 'protected-port' ? '5209' : '47859',
  ALPHA_BUN: command, ALPHA_QA_MODEL: scenario === 'missing-model' ? '' : model,
  ELIZAOS_CLOUD_BASE_URL: 'https://untrusted.example.invalid', OPENAI_API_KEY: 'synthetic-unrelated-value',
  CEREBRAS_API_KEY: 'synthetic-unrelated-value', ANTHROPIC_API_KEY: 'synthetic-unrelated-value',
  VITE_ELIZAOS_CLOUD_API_KEY: 'synthetic-renderer-value',
  ...(defaultSource ? {} : {ALPHA_ELIZA_SOURCE: source}),
});
const kinds = {'personal-profile': 'personal', 'wrong-route': 'wrongRoute', 'invalid-token': 'badToken',
  'saved-profile': 'saved', 'receipt-write': 'saved', 'linked-log': 'linkedLog',
  'hardlinked-log': 'hardlinkedLog', 'fifo-log': 'fifoLog'};
const kind = kinds[scenario] ?? 'fresh';
const priorReceipt = ['saved-profile', 'receipt-write'].includes(scenario);
if (kind === 'personal') write(join(profile, 'history'), 'unrelated synthetic contents');
else if (kind !== 'fresh') {
  json(marker, {purpose: 'isolated-staging-cloud-qa', environment: 'staging'});
  write(token, kind === 'badToken' ? 'synthetic\nbad-token' : 'saved-synthetic-token');
  json(config, {cloud: {enabled: true}, serviceRouting: {llmText: kind === 'wrongRoute' ? {...route, smallModel: 'different'} : route},
    plugins: {entries: {'personal-assistant': {enabled: false}}}});
  if (priorReceipt) json(receipt, {pid: 5, purpose: 'isolated-staging-cloud-qa'});
  if (kind === 'linkedLog' || kind === 'hardlinkedLog') {
    write(otherLog, 'untouched fixture bytes', 0o644);
    if (kind === 'linkedLog') fs.symlinkSync(otherLog, log);
    else fs.linkSync(otherLog, log);
  } else if (kind === 'fifoLog') {
    execFileSync('mkfifo', [log], {cwd: scratch, timeout: 5000, stdio: 'pipe'});
  } else if (scenario === 'saved-profile') write(log, 'prior log bytes', 0o644);
}
const baseListeners = process.listenerCount('SIGTERM');
const state = {kind, phase: 'checking', source: 'none', entry: false, logOpen: false,
  child: 'none', pid: false, fault: 'none', stop: 'none', cancelled: false, childCode: -1, childSignal: 'none',
  result: 'running', exitCode: -1, requestedPin: 'none', preloadHead: 'none', admittedPin: 'none',
  preloadOutcome: 'unobserved', parentHead: 'none'};
const inspectRoute = () => {
  if (!file(config)) return 'none';
  const saved = read(config);
  return saved.cloud?.enabled === true && JSON.stringify(saved.serviceRouting?.llmText) === JSON.stringify(route)
    ? 'staging' : 'wrong';
};
const getReceipt = () => !file(receipt) ? 'none' : read(receipt).pid === 5 ? 'prior' : 'current';
const observe = () => {
  const snapshot = {...state, profile: directory(profile), marker: file(marker), token: file(token), route: inspectRoute(),
    supervised: process.listenerCount('SIGTERM') > baseListeners, receipt: getReceipt(),
    receiptHead: getReceipt() === 'current' ? classifyRevision(read(receipt).revision) : 'none',
    foreignLogModeChanged: file(otherLog) && privateMode(otherLog) !== 0o644,
    tempClean: !directory(profile) || !fs.readdirSync(profile).some(name => name.startsWith('process.json.') && name.endsWith('.tmp'))};
  return Object.fromEntries(Object.entries(snapshot).map(([name, value]) => ['s.'+name, value]));
};
const trace = {name: scenario, init: action('startState', kind, priorReceipt), expect: observe(), steps: []};
const point = (label, transition) => trace.steps.push({label, action: transition, expect: observe()});
const initialToken = file(token) ? fs.readFileSync(token, 'utf8') : null;
const initialConfig = file(config) ? fs.readFileSync(config, 'utf8') : null;
let logFd, child, runPreload, observedParentRevision, childGitHead, childObservedHead;
const originalError = console.error, originalLog = console.log;
const errors = [];
console.error = message => errors.push(String(message));
const exitOutcomes = {
  'relative-profile': ['path', /Provide absolute/], 'protected-port': ['port', /protected/], 'key-mode': ['key', /owner-only/],
  'missing-model': ['model', /exact reviewed/], 'personal-profile': ['personal', /existing non-QA/],
  'missing-entry': ['entry', /source entrypoint is missing/], 'wrong-route': ['route', /profile routing differs/],
  'invalid-token': ['token', /INVALID_RUNTIME_TOKEN/], 'no-pid': ['spawn', /RUNTIME_PROCESS_FAILED/],
  'linked-log': ['log', /ELOOP/], 'hardlinked-log': ['log', /single-link regular file/], 'fifo-log': ['log', /ENXIO/],
  'revision-read': ['revision', /Fixture revision read refused/], 'receipt-write': ['write', /Fixture receipt rename refused/],
  'pending-signal': ['cancelled', /RUNTIME_LAUNCH_CANCELLED/],
};

function readProfile() {
  assert.equal(privateMode(profile), 0o700);
  assert.equal(privateMode(marker), 0o600);
  assert.equal(privateMode(token), 0o600);
  assert.equal(privateMode(config), 0o600);
  assert.equal(read(marker).environment, 'staging');
  state.phase = 'profile';
  point('The actual private profile token, marker and route exist', action('prepareProfile'));
}

function closeChild(code, signal = 'none') {
  assert.ok(child && state.child !== 'closed' && logFd !== undefined);
  child.emit('close', code === -1 ? null : code, signal === 'none' ? null : signal);
  Object.assign(state, {child: 'closed', childCode: code, childSignal: signal});
  assert.equal(process.listenerCount('SIGTERM'), baseListeners);
  point('Only the returned child closes and releases the shared signal listeners', action('closeChild', code, signal));
}

function cancel(signal) {
  state.cancelled = true;
  assert.equal(process.emit(signal), true);
}

function recordFault(fault) {
  state.fault = fault;
  // The selected receipt staging file exists during the rename refusal and is
  // cleaned by the actual helper before it stops the child.
  return action('refuseRecord', fault);
}

console.log = line => {
  assert.deepEqual(JSON.parse(line), read(receipt));
  if (scenario !== 'pending-signal') setImmediate(async () => {
    state.phase = 'running';
    point('Source has handed off the receipt and is waiting for its child', action('activate'));
    if (scenario === 'running-signal') cancel('SIGTERM');
    else if (latePreloadRefusal) {
      await runPreload(alternate);
      closeChild(1);
    } else closeChild(scenario === 'exit-seven' ? 7 : 0);
  });
};
const launchUrl = pathToFileURL(join(root, launcher)).href;
const sharedUrl = pathToFileURL(join(root, shared)).href;
const coreUrl = pathToFileURL(join(root, 'scripts/core-state-patch.mjs')).href;
const immutableUrl = pathToFileURL(join(root, 'vendor/eliza/packages/app/scripts/lib/immutable-workspace-source.mjs')).href;
globalThis.cloudQaPorts = {
  fs: {
    ...fs,
    readFileSync(name, ...options) {
      const bytes = fs.readFileSync(name, ...options);
      if (name === join(root, 'upstream.lock.json') && state.phase === 'log')
        state.requestedPin = classifyRevision(JSON.parse(bytes).commit);
      return bytes;
    },
    existsSync(name) {
      const exists = fs.existsSync(name);
      if (name === entry) {
        Object.assign(state, {phase: 'entry', source: defaultSource ? 'default' : 'explicit', entry: exists});
        point('The selected source entry is checked before private profile creation', action('checkEntry', state.source, exists));
      }
      return exists;
    },
    openSync(name, flags, mode) {
      assert.equal(name, log);
      readProfile();
      const {O_WRONLY,O_APPEND,O_CREAT,O_NOFOLLOW,O_NONBLOCK} = fs.constants;
      assert.equal(flags, O_WRONLY|O_APPEND|O_CREAT|O_NOFOLLOW|O_NONBLOCK);
      logFd = fs.openSync(name, flags, mode);
      return logFd;
    },
    fchmodSync(fd, mode) {
      assert.equal(fd, logFd);
      const stat = fs.fstatSync(fd);
      assert.ok(stat.isFile() && stat.nlink === 1);
      fs.fchmodSync(fd, mode);
      Object.assign(state, {phase: 'log', logOpen: true});
      point('The accepted staging route owns a regular log descriptor', action('openLog'));
    },
    closeSync(fd) {
      assert.equal(fd, logFd);
      fs.closeSync(fd);
      logFd = undefined;
      state.logOpen = false;
    },
  },
  execFileSync(program, argv, options) {
    assert.equal(program, 'git');
    assert.deepEqual(argv, ['rev-parse', 'HEAD']);
    assert.deepEqual(options, {cwd: source, encoding: 'utf8'});
    assert.equal(process.listenerCount('SIGTERM'), baseListeners + 1);
    Object.assign(state, {phase: 'recording', child: 'spawned'});
    point('The shared owner handles spawn before the launcher reads receipt provenance', action('beginRecord'));
    if (scenario === 'revision-read') {
      point('Revision read refuses while the exact child is still owned', recordFault('revision'));
      throw Error('Fixture revision read refused');
    }
    observedParentRevision = scenario === 'preload-admits-before-late-head' ? alternate : git(...argv);
    state.parentHead = classifyRevision(observedParentRevision);
    point('The parent independently observes HEAD while recording the launched PID',
      action('observeParentHead', state.parentHead));
    return observedParentRevision+'\n';
  },
  preloadGit(program, argv, options) {
    assert.equal(program, 'git');
    assert.equal(options.cwd, source);
    assert.ok(['rev-parse','ls-tree','diff','ls-files'].includes(argv[0]));
    if (argv.join(' ') === 'rev-parse HEAD') {
      assert.ok(childGitHead);
      childObservedHead = childGitHead;
      return childGitHead+'\n';
    }
    return execFileSync(program, argv, options);
  },
  async rename(from, to) {
    assert.equal(to, receipt);
    assert.match(basename(from), /^process\.json\.[0-9a-f]{32}\.tmp$/);
    assert.equal(dirname(from), profile);
    const body = read(from);
    assert.deepEqual(Object.keys(body).sort(), ['apiBase','credentialLocation','environment','identityVerified',
      'modelCallsPerformedByLauncher','pid','port','profile','purpose','revision','route','source','startedAt']);
    assert.equal(body.pid, child.pid);
    assert.equal(body.port, 47859);
    assert.equal(body.profile, profile);
    assert.equal(body.source, source);
    assert.equal(body.revision, observedParentRevision);
    assert.equal(body.environment, 'staging');
    assert.equal(body.identityVerified, false);
    assert.equal(body.modelCallsPerformedByLauncher, 0);
    assert.equal(body.apiBase, 'https://api-staging.eliza.app/api/v1');
    assert.deepEqual(body.route, route);
    assert.ok(!JSON.stringify(body).includes(input));
    assert.equal(privateMode(from), 0o600);
    point('The shared writer stages exact receipt bytes in a private temporary file', action('stageReceipt'));
    if (scenario === 'receipt-write') {
      point('Receipt rename refuses with an existing history', recordFault('write'));
      throw Error('Fixture receipt rename refused');
    }
    if (scenario === 'pending-signal') {
      cancel('SIGINT');
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(state.child, 'closed');
      assert.equal(logFd !== undefined, true);
    }
    await promises.rename(from, to);
    state.phase = 'published';
    assert.equal(privateMode(to), 0o600);
    point('The shared private writer atomically publishes historical process metadata', action('publishReceipt'));
  },
  spawn(executable, argv, options) {
    assert.equal(executable, command);
    assert.deepEqual(argv, ['--preload', join(root, 'scripts/core-state-preload.mjs'), '--no-install', '--conditions=eliza-source', entry]);
    assert.equal(options.cwd, profile);
    assert.deepEqual(options.stdio, ['ignore', logFd, logFd]);
    const env = options.env;
    assert.equal(env.ELIZAOS_CLOUD_BASE_URL, 'https://api-staging.eliza.app/api/v1');
    assert.ok(env.ELIZAOS_CLOUD_API_KEY === input);
    assert.ok(env.ELIZA_API_TOKEN === fs.readFileSync(token, 'utf8'));
    assert.equal(env.ELIZA_DEV_CLOUD_ENV_AUTHORITY, 'staging-explicit');
    assert.equal(env.ELIZA_API_BIND, '127.0.0.1');
    assert.equal(env.ELIZA_API_PORT, '47859');
    assert.equal(env.ELIZA_REQUIRE_LOCAL_AUTH, '1');
    assert.equal(env.ELIZA_CONFIG_PATH, config);
    assert.equal(env.ALPHA_CORE_STATE_SOURCE, source);
    for (const name of ['OPENAI_API_KEY','ANTHROPIC_API_KEY','CEREBRAS_API_KEY','VITE_ELIZAOS_CLOUD_API_KEY'])
      assert.ok(!Object.hasOwn(env, name));
    assert.equal(privateMode(log), 0o600);
    assert.equal(state.requestedPin, 'reviewed');
    const noPid = scenario === 'no-pid';
    runPreload = async observed => {
      childGitHead = observed;
      const originalBun = globalThis.Bun, originalSource = process.env.ALPHA_CORE_STATE_SOURCE;
      process.env.ALPHA_CORE_STATE_SOURCE = env.ALPHA_CORE_STATE_SOURCE;
      let pluginInstalled = false;
      globalThis.Bun = {plugin(value) {
        assert.equal(value.name, 'authenticated-core-state');
        pluginInstalled = true;
      }};
      try {
        await import(pathToFileURL(argv[1]).href);
        assert.equal(observed, revision);
        assert.equal(pluginInstalled, true);
        state.preloadOutcome = 'admitted';
        state.admittedPin = classifyRevision(childObservedHead);
      } catch (error) {
        assert.equal(observed, alternate);
        assert.match(error.message, /Prepared runtime base commit changed/);
        assert.equal(pluginInstalled, false);
        state.preloadOutcome = 'rejected';
      } finally {
        if (originalBun === undefined) delete globalThis.Bun;
        else globalThis.Bun = originalBun;
        if (originalSource === undefined) delete process.env.ALPHA_CORE_STATE_SOURCE;
        else process.env.ALPHA_CORE_STATE_SOURCE = originalSource;
      }
      assert.equal(childObservedHead, observed);
      state.preloadHead = classifyRevision(childObservedHead);
      point('The exact child preload validates its own HEAD and admits or refuses the pin',
        action('observePreload', state.preloadHead));
    };
    child = new EventEmitter();
    if (!noPid) child.pid = 43210;
    child.kill = signal => {
      assert.ok(['SIGINT','SIGTERM'].includes(signal));
      // The real atomic writer has already cleaned its staged file before stop.
      if (state.fault === 'write') point('Actual writer cleans its temporary receipt before child retirement', action('discardReceipt'));
      state.stop = signal;
      point('Only the returned child receives the shared stop request', action('requestStop', signal, state.cancelled));
      setImmediate(() => closeChild(-1, noPid ? 'none' : signal));
      return !noPid;
    };
    Object.assign(state, {phase: 'requested', child: 'requested', pid: !noPid});
    point('The launcher asks the shared owner for one closed synthetic child', action('requestChild', !noPid));
    queueMicrotask(async () => {
      assert.equal(process.listenerCount('SIGTERM'), baseListeners + 1);
      point('The shared owner is listening before the child reports spawn or error', action('ownChild'));
      if (noPid) child.emit('error', Object.assign(Error('synthetic no PID'), {code: 'ENOENT'}));
      else {
        if (earlyPreload) await runPreload(revision);
        child.emit('spawn');
      }
    });
    return child;
  },
};
const portModule = join(scratch, 'ports.mjs');
write(portModule, `
export default globalThis.cloudQaPorts.fs;
export const execFileSync = (...args) => globalThis.cloudQaPorts.execFileSync(...args);
export const spawn = (...args) => globalThis.cloudQaPorts.spawn(...args);
export const rename = (...args) => globalThis.cloudQaPorts.rename(...args);
export {open,readFile,unlink,writeFile} from 'node:fs/promises';
`);
const childGitModule = join(scratch, 'child-git-port.mjs');
write(childGitModule, 'export const execFileSync = (...args) => globalThis.cloudQaPorts.preloadGit(...args);');
registerHooks({resolve(specifier, context, next) {
  if (context.parentURL === immutableUrl && specifier === 'node:child_process')
    return {url: pathToFileURL(childGitModule).href, shortCircuit: true};
  const launcherPort = context.parentURL === launchUrl && ['node:fs','node:child_process'].includes(specifier);
  const sharedPort = context.parentURL === sharedUrl && ['node:child_process','node:fs/promises'].includes(specifier);
  const corePort = context.parentURL === coreUrl && specifier === 'node:fs';
  if (launcherPort || sharedPort || corePort) return {url: pathToFileURL(portModule).href, shortCircuit: true};
  return next(specifier, context);
}});

process.once('exit', code => {
  console.error = originalError;
  console.log = originalLog;
  const [result, message] = exitOutcomes[scenario] ?? ['child', null];
  assert.equal(code, message || scenario === 'running-signal' || latePreloadRefusal ? 1 : scenario === 'exit-seven' ? 7 : 0);
  if (message) {assert.equal(errors.length, 1); assert.match(errors[0], message);}
  else assert.deepEqual(errors, []);
  if (['route','token'].includes(result)) readProfile();
  assert.equal(logFd, undefined);
  assert.equal(process.listenerCount('SIGTERM'), baseListeners);
  if (initialToken !== null) assert.equal(fs.readFileSync(token, 'utf8'), initialToken);
  if (initialConfig !== null) assert.equal(fs.readFileSync(config, 'utf8'), initialConfig);
  if (kind === 'personal') assert.equal(fs.readFileSync(join(profile,'history'),'utf8'), 'unrelated synthetic contents');
  if (result === 'log') assert.equal(child, undefined);
  if (file(otherLog)) {
    if (kind === 'linkedLog') assert.ok(fs.lstatSync(log).isSymbolicLink());
    else {
      assert.equal(fs.statSync(otherLog).ino, fs.statSync(log).ino);
      assert.equal(fs.statSync(log).nlink, 2);
    }
    assert.equal(privateMode(otherLog), 0o644);
    assert.equal(fs.readFileSync(otherLog, 'utf8'), 'untouched fixture bytes');
  }
  if (kind === 'fifoLog') assert.ok(fs.lstatSync(log).isFIFO());
  if (scenario === 'saved-profile') {
    assert.equal(fs.readFileSync(log, 'utf8'), 'prior log bytes');
    assert.equal(privateMode(log), 0o600);
  }
  Object.assign(state, {phase: 'done', result, exitCode: code});
  point('Launcher exit closes its log and reports the source result', action('finish', result, code));
  write(join(scratch, 'report.json'), JSON.stringify(trace));
});
process.argv[1] = join(root, launcher);
await import(launchUrl);
