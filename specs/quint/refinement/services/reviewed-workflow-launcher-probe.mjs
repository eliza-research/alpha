import assert from 'node:assert/strict';
import fs from 'node:fs';
import {registerHooks} from 'node:module';
import {execFileSync, spawn} from 'node:child_process';
import {basename, dirname, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {CORE_STATE_MANIFEST} from '../../../../scripts/core-state-patch.mjs';
import {writeCoreStateFixture} from '../../../../test/fixtures/core-state-root.mjs';

const repository = resolve(import.meta.dirname, '../../../..');
const launcher = 'scripts/start-reviewed-workflow-agent.mjs';
const support = [
  'scripts/launcher-child.mjs',
  'scripts/agent-model.mjs', 'scripts/agent-identity.mjs', 'scripts/agent-embeddings.mjs', 'apps/app/src/product/alpha-product-registration.ts',
  'vendor/eliza/packages/agent/native-host/private-runtime-launch.mjs',
  'vendor/eliza/packages/agent/native-host/private-runtime-json.mjs',
];
const action = (name, ...args) => ({name, args});
const isFile = path => fs.statSync(path, {throwIfNoEntry: false})?.isFile() === true;
const isDirectory = path => fs.statSync(path, {throwIfNoEntry: false})?.isDirectory() === true;

function fixture(scratch, scenario) {
  const repo = join(scratch, 'consumer'), profile = join(scratch, 'profile');
  const home = join(scratch, 'home');
  let source = join(repo, 'artifacts/fixture-prepared-source');
  const defaultSource = scenario === 'default-source' || scenario === 'relative-default';
  const input = join(home, '.config/alphaphone/cerebras-key'), tool = join(scratch, 'fixture-bun');
  const token = join(profile, 'owner-token'), config = join(profile, 'eliza.json'), log = join(profile, 'server.log');
  const metadata = join(profile, 'process.json'), invoked = join(profile, 'synthetic-entry');
  let entry = join(source, 'packages/app/src/runtime/dev-server.ts');
  const write = (path, bytes, mode = 0o600) => {
    fs.mkdirSync(dirname(path), {recursive: true, mode: 0o700});
    fs.writeFileSync(path, bytes, {mode});
  };
  const json = (path, value) => write(path, JSON.stringify(value)+'\n');
  for (const name of [launcher, ...support]) write(join(repo, name), fs.readFileSync(join(repository, name)));
  writeCoreStateFixture(repo, source, '1'.repeat(40), true);
  json(join(source, 'package.json'), {type: 'module', workspaces: ['packages/*']});
  json(join(source, 'turbo.json'), {tasks: {}});
  write(join(source, '.gitignore'), 'node_modules/\n');
  if (scenario !== 'missing-entry') write(entry, `import {writeFileSync} from 'node:fs';
import {value} from '../../../core/src/services/task.ts';
if (value !== 'after') throw Error('Core preload did not patch the synthetic module');
writeFileSync(${JSON.stringify(invoked)}, 'patched fixture entry', {mode: 0o600});
`);
  const git = (...args) => execFileSync('git', args, {
    cwd: source, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000,
  }).trim();
  git('init'); git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Synthetic prepared source');
  const head = git('rev-parse', 'HEAD');
  if (scenario === 'default-source') {
    const target = join(repo, 'artifacts/local-agent-resident-'+head);
    fs.renameSync(source, target);
    source = target;
    entry = join(source, 'packages/app/src/runtime/dev-server.ts');
  }
  const selected = scenario === 'actual-wrong-pin' ? '1'.repeat(40) : head;
  json(join(repo, 'upstream.lock.json'), {commit: selected});
  const patchManifest = join(repo, CORE_STATE_MANIFEST);
  json(patchManifest, {...JSON.parse(fs.readFileSync(patchManifest, 'utf8')), baseCommit: selected});
  if (scenario === 'actual-dirty') fs.appendFileSync(entry, '// synthetic source drift\n');
  if (scenario !== 'missing-deps') fs.mkdirSync(join(source, 'node_modules'));
  write(input, 'synthetic-workflow-input', scenario === 'input-mode' ? 0o644 : 0o600);
  if (scenario === 'unreviewed-profile') write(join(profile, 'unrelated'), 'synthetic marker');
  const prior = ['existing-profile', 'routing'].includes(scenario);
  if (prior) json(config, {
    cloud: {enabled: false},
    serviceRouting: {llmText: {backend: scenario === 'routing' ? 'unsupported-fixture-route' : 'cerebras',
      transport: 'direct', smallModel: 'saved-fixture', largeModel: 'saved-fixture'}},
    agents: {list: [{id: 'main', name: 'Existing fixture identity'}]},
    plugins: {entries: {scheduling: {enabled: true}, 'personal-assistant': {enabled: true}}},
  });
  Object.assign(process.env, {
    ALPHA_FIXTURE_UNRELATED: 'synthetic-inherited-value', OPENAI_API_KEY: 'synthetic-unrelated-value',
    ...(scenario === 'relative-default' ? {ALPHA_LOCAL_AGENT_SOURCE_DIR: 'relative-fixture'} : {}),
    ...(scenario === 'embedding-path' ? {MODELS_DIR: 'relative-fixture'} : {}),
  });
  const port = scenario === 'invalid-port' ? '1023' : '47998';
  process.argv.splice(2, process.argv.length - 2, ...(defaultSource ? [] : ['--source', source]),
    '--profile', profile, '--port', port, '--bun', tool);
  return {repo, profile, home, source, input, token, config, log, metadata, invoked, entry, git, head, selected,
    defaultSource, tool, port, write};
}

const refusals = {
  'relative-default': /ALPHA_LOCAL_AGENT_SOURCE_DIR must be absolute/,
  'invalid-port': /Invalid port/,
  'unreviewed-profile': /Existing agent identity is ambiguous/,
  'input-mode': /Provider key must be owner-only/,
  'missing-entry': /Eliza app host source is missing/,
  routing: /Local launcher requires reviewed direct Cerebras routing/,
  'embedding-path': /MODELS_DIR must be an absolute path/,
  'git-metadata': /Closed metadata revision read failed/,
  'write-metadata': /EISDIR/,
};

async function drive(scratch, scenario, realBun) {
  assert.equal(scratch, process.env.TMPDIR);
  assert.ok(basename(scratch).startsWith('reviewed-launch-'));
  assert.equal(process.env.HOME, join(scratch, 'home'));
  assert.deepEqual(fs.readdirSync(scratch), ['home']);
  for (const dir of [scratch, process.env.HOME]) {
    const stat = fs.lstatSync(dir);
    assert.ok(stat.isDirectory() && stat.uid === process.getuid() && (stat.mode & 0o077) === 0);
  }
  const f = fixture(scratch, scenario);
  const entry = pathToFileURL(join(f.repo, launcher)).href;
  const trace = {name: scenario, init: action('startState', isDirectory(f.profile), isFile(f.config)), expect: null, steps: []};
  const observation = {source: 'none', deps: false, entryChecked: false, selectedEntry: false, logFd: undefined, child: undefined,
    gitRevision: 'none', receiptFailed: false, cleanupSignal: 'none', booted: false,
    childClosed: false, forwarded: 'none', outcome: 'running', exitCode: -1};
  const listeners = process.listenerCount('SIGTERM');
  const saved = () => isFile(f.config) ? JSON.parse(fs.readFileSync(f.config, 'utf8')) : null;
  function profile() {
    const config = saved();
    const identity = !!config?.agents?.list?.[0]?.identityName;
    const route = config?.serviceRouting?.llmText;
    const text = !route ? 'none' : route.backend === 'cerebras' && route.transport === 'direct' ? 'direct' : 'invalid';
    const features = config ? ['scheduling', 'personal-assistant'].every(name => config.plugins.entries[name].enabled === false)
      ? 'disabled' : 'enabled' : 'none';
    return {identity, text, embedding: !!config?.serviceRouting?.embeddings, features};
  }
  function observe() {
    const p = profile(), metadata = isFile(f.metadata) ? JSON.parse(fs.readFileSync(f.metadata, 'utf8')) : null;
    const supervised = process.listenerCount('SIGTERM') > listeners;
    return {
      's.source': observation.source, 's.deps': observation.deps, 's.profile': isDirectory(f.profile),
      's.token': isFile(f.token), 's.entryChecked': observation.entryChecked, 's.entry': observation.selectedEntry, 's.config': isFile(f.config),
      's.identity': p.identity, 's.text': p.text, 's.embeddings': p.embedding, 's.features': p.features,
      's.logOpen': observation.logFd !== undefined, 's.child': !!observation.child, 's.childPid': !!observation.child?.pid,
      's.metadata': !!metadata, 's.pid': !!metadata?.pid,
      's.gitRevision': observation.gitRevision, 's.revision': !metadata ? 'none' : metadata.revision === f.selected ? 'pinned' : 'other',
      's.supervised': supervised, 's.booted': observation.booted, 's.childClosed': observation.childClosed,
      's.preloadEntry': observation.childClosed && isFile(f.invoked), 's.forwarded': observation.forwarded,
      's.receiptFailed': observation.receiptFailed, 's.cleanupSignal': observation.cleanupSignal,
      's.outcome': observation.outcome, 's.exitCode': observation.exitCode,
      ChildCustodyAfterReceiptFailure: !observation.receiptFailed ||
        (observation.outcome === 'running' ? supervised || observation.childClosed : observation.childClosed),
    };
  }
  const point = (label, next) => trace.steps.push({label, action: next, expect: observe()});
  trace.expect = observe();
  // Existing routing metadata is input before the invocation. Identity is observed after source migration.
  trace.init.args.push(profile().text, profile().embedding, profile().features);
  process.once('exit', code => {
    if (scenario === 'missing-deps') {
      assert.equal(code, 2);
      Object.assign(observation, {outcome: 'missing-deps', exitCode: code});
      point('Dependency refusal exits before creating a profile', action('missingDependencies'));
    } else assert.equal(code, observation.exitCode);
    f.write(join(scratch, 'report.json'), JSON.stringify(trace));
  });

  let bootResolve, settledResolve;
  const boot = new Promise(resolve => {bootResolve = resolve;});
  const settled = new Promise(resolve => {settledResolve = resolve;});
  const fake = join(scratch, 'fake-child.mjs');
  f.write(fake, `process.on('disconnect', () => process.exit(0));
process.on('message', message => {if (message?.kind === 'finish') process.exit(message.code);});
process.send({kind:'boot'});
`);
  const admitProfile = () => {
    const {text, embedding, features} = profile();
    return action('readProfile', text, embedding, features);
  };

  globalThis.reviewedWorkflowPorts = {
    fs: {
      ...fs,
      existsSync(path) {
        const exists = fs.existsSync(path);
        if (path === join(f.source, 'node_modules')) {
          observation.source = f.defaultSource ? 'default' : 'explicit';
          observation.deps = exists;
          point('Selected source dependency directory is checked', action('selectSource', observation.source, exists));
        } else if (path === f.entry) {
          observation.entryChecked = true;
          observation.selectedEntry = exists;
          assert.ok(isFile(f.token));
          assert.equal(fs.statSync(f.profile).mode & 0o077, 0);
          point('The owner token is already durable when the runtime entry is checked',
            [action('prepareToken'), action('checkEntry', exists)]);
        }
        return exists;
      },
      openSync(path, flags, mode) {
        assert.equal(path, f.log);
        observation.logFd = fs.openSync(path, flags, mode);
        point('Private identity and routing are accepted before opening the log', [admitProfile(), action('openLog')]);
        return observation.logFd;
      },
      closeSync(descriptor) {
        assert.equal(descriptor, observation.logFd);
        fs.closeSync(descriptor);
        observation.logFd = undefined;
      },
      writeFileSync(path, bytes, options) {
        if (path !== f.metadata) return fs.writeFileSync(path, bytes, options);
        if (scenario === 'write-metadata') fs.mkdirSync(f.metadata, {mode: 0o700});
        try {fs.writeFileSync(path, bytes, options);}
        catch (error) {
          assert.equal(scenario, 'write-metadata');
          assert.equal(error.code, 'EISDIR');
          observation.receiptFailed = true;
          point('Receipt write refuses after the exact child is supervised', action('receiptFailure'));
          throw error;
        }
        const value = JSON.parse(fs.readFileSync(path, 'utf8'));
        assert.equal(value.pid, observation.child.pid);
        assert.equal(value.profile, f.profile);
        assert.equal(value.source, f.source);
        assert.equal(value.revision, f.head);
        assert.equal(value.port, Number(f.port));
        assert.equal(fs.statSync(path).mode & 0o077, 0);
        assert.ok(!Object.hasOwn(value, 'ready') && !Object.hasOwn(value, 'CEREBRAS_API_KEY'));
        point('Process metadata publishes the revision before child admission is known',
          action('publishMetadata', !!value.pid, value.revision === f.selected ? 'pinned' : 'other'));
      },
    },
    execFileSync(command, args, options) {
      assert.equal(command, 'git');
      assert.deepEqual(args, ['rev-parse', 'HEAD']);
      assert.deepEqual(options, {cwd: f.source, encoding: 'utf8'});
      assert.equal(observation.child, undefined);
      if (scenario === 'git-metadata') throw Error('Closed metadata revision read failed');
      const revision = f.git(...args);
      observation.gitRevision = revision === f.selected ? 'pinned' : 'other';
      point('Launcher captures the actual Git revision before requesting a child', action('readRevision', observation.gitRevision));
      return revision+'\n';
    },
    spawn(command, args, options) {
      assert.equal(command, f.tool);
      assert.deepEqual(args, ['--preload', join(f.repo, 'scripts/core-state-preload.mjs'), '--conditions=eliza-source', f.entry]);
      assert.deepEqual(options.stdio, ['ignore', observation.logFd, observation.logFd]);
      assert.equal(fs.statSync(f.log).mode & 0o077, 0);
      assert.equal(options.cwd, f.profile);
      assert.equal(options.env.ALPHA_CORE_STATE_SOURCE, f.source);
      assert.equal(options.env.ELIZA_API_BIND, '127.0.0.1');
      assert.equal(options.env.ELIZA_API_PORT, f.port);
      assert.equal(options.env.ELIZA_REQUIRE_LOCAL_AUTH, '1');
      assert.equal(options.env.ELIZA_STATE_DIR, f.profile);
      assert.equal(options.env.ELIZA_CONFIG_PATH, f.config);
      assert.ok(options.env.CEREBRAS_API_KEY === 'synthetic-workflow-input');
      assert.ok(options.env.ELIZA_API_TOKEN === fs.readFileSync(f.token, 'utf8'));
      assert.ok(!Object.hasOwn(options.env, 'OPENAI_API_KEY') && !Object.hasOwn(options.env, 'ALPHA_FIXTURE_UNRELATED'));
      assert.equal(options.env.MODELS_DIR, join(f.home, '.local/state/eliza/models'));
      assert.equal(options.env.CEREBRAS_MODEL, scenario === 'existing-profile' ? 'saved-fixture' : 'qwen-3.8-27b');
      const executable = realBun || (scenario === 'spawn-error' ? join(scratch, 'absent-child') : process.execPath);
      const child = realBun ? spawn(executable, args, options) : spawn(executable, [fake], {
        cwd: scratch, env: {PATH: '/usr/bin:/bin'}, stdio: ['ignore', observation.logFd, observation.logFd, 'ipc'],
      });
      observation.child = child;
      point('The launcher requests one exact child with a pinned preload and isolated inputs', action('spawnChild', !!child.pid));
      let launchError, exit;
      child.on('message', message => {assert.deepEqual(message, {kind: 'boot'}); bootResolve();});
      child.on('error', error => {assert.equal(error.code, 'ENOENT'); launchError = error;});
      child.on('exit', (code, signal) => {exit = {code, signal};});
      child.on('close', () => queueMicrotask(() => {
        observation.childClosed = true;
        assert.equal(observation.logFd, undefined);
        assert.equal(process.exitCode, launchError ? 1 : exit.code ?? 1);
        const expected = scenario === 'actual-pinned' || !realBun;
        if (realBun) {
          assert.equal(isFile(f.invoked), expected);
          assert.equal(exit.code, expected ? 0 : 1);
          if (!expected) assert.match(fs.readFileSync(f.log, 'utf8'), /Prepared runtime base commit changed|Unexpected runtime source change/);
        }
        if (scenario.startsWith('signal-')) assert.equal(exit.signal, observation.forwarded);
        if (observation.receiptFailed) assert.equal(exit.signal, 'SIGTERM');
        const outcome = launchError ? 'spawn-error' : 'child-exit';
        observation.exitCode = process.exitCode;
        if (!observation.receiptFailed) observation.outcome = outcome;
        point('Child settlement closes the log and removes its signal handlers',
          action('settleChild', outcome, observation.exitCode, isFile(f.invoked)));
        settledResolve();
      }));
      const on = child.on, kill = child.kill;
      child.on = function(event, handler) {
        const result = on.call(this, event, handler);
        if (event === 'exit') point('Source attaches signal handlers before publishing metadata', action('supervise'));
        return result;
      };
      child.kill = function(signal) {
        if (observation.receiptFailed) {
          observation.cleanupSignal = signal;
          point('Only the exact returned synthetic child receives failed-handoff cleanup', action('cleanupSignal', signal));
        } else {
          observation.forwarded = signal;
          point('Only the returned synthetic child receives the parent signal', action('forward', signal));
        }
        return kill.call(this, signal);
      };
      return child;
    },
  };
  const moduleFile = join(scratch, 'ports.mjs');
  f.write(moduleFile, `export default globalThis.reviewedWorkflowPorts.fs;
export const spawn = (...args) => globalThis.reviewedWorkflowPorts.spawn(...args);
export const execFileSync = (...args) => globalThis.reviewedWorkflowPorts.execFileSync(...args);`);
  const hooks = registerHooks({resolve(specifier, context, next) {
    if (context.parentURL === entry && ['node:fs', 'node:child_process'].includes(specifier))
      return {url: pathToFileURL(moduleFile).href, shortCircuit: true};
    return next(specifier, context);
  }});
  try {
    await import(entry);
    assert.ok(!Object.hasOwn(refusals, scenario));
  } catch (error) {
    assert.ok(Object.hasOwn(refusals, scenario), error.stack);
    assert.match(error.message, refusals[scenario]);
    process.exitCode = 1;
    Object.assign(observation, {outcome: scenario, exitCode: 1});
    if (scenario === 'write-metadata') {
      assert.ok(observation.childClosed);
      assert.equal(observation.logFd, undefined);
      point('The original receipt error returns after the exact child closes', action('rejectReceipt'));
    } else if (scenario === 'routing') {
      point('Identity is durable even though the retained text route is refused', [admitProfile(), action('refuse', scenario)]);
    } else point('Source refuses the selected fixture condition', action('refuse', scenario));
    return;
  } finally {
    hooks.deregister();
    process.once('exit', () => {if (observation.logFd !== undefined) fs.closeSync(observation.logFd);});
  }
  if (!realBun && scenario !== 'spawn-error') {
    await boot;
    observation.booted = true;
    point('Synthetic child acknowledges execution after the receipt', action('childBoot'));
    if (scenario.startsWith('signal-')) assert.equal(process.emit(scenario === 'signal-int' ? 'SIGINT' : 'SIGTERM'), true);
    else observation.child.send({kind: 'finish', code: scenario === 'exit-seven' ? 7 : 0});
  }
  await settled;
}

globalThis.fetch = async () => {throw Error('Network is outside the reviewed workflow launcher fixture');};
await drive(...process.argv.slice(2));
