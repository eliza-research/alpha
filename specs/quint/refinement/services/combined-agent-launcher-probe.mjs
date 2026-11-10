import assert from 'node:assert/strict';
import fs from 'node:fs';
import {registerHooks} from 'node:module';
import {resolve, join, dirname, basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync, spawn} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {CORE_STATE_MANIFEST} from '../../../../scripts/core-state-patch.ts';
import {sourceManifest, sha} from '../../../../scripts/combined-agent-source.ts';
import {writeCoreStateFixture} from '../../../../test/fixtures/core-state-root.mjs';

const root = resolve(import.meta.dirname, '../../../..');
const launcher = 'scripts/start-combined-agent.ts';
const support = [
  'scripts/launcher-child.ts',
  'scripts/combined-agent-source.ts', 'scripts/host-speech-admission.ts', 'scripts/agent-model.ts',
  'scripts/agent-identity.ts', 'config/alpha-product.json',
  'vendor/eliza/packages/agent/native-host/private-runtime-launch.mjs',
  'vendor/eliza/packages/agent/native-host/private-runtime-json.mjs',
];
const action = (name, ...args) => ({name, args});

function createFixture(scratch, scenario) {
  const repo = join(scratch, 'consumer');
  const frozen = join(scratch, 'frozen');
  const profile = scenario === 'profile-source' ? join(frozen, 'profile') : join(scratch, 'profile');
  const home = process.env.HOME;
  const marker = join(profile, 'combined-profile.json'), config = join(profile, 'eliza.json');
  const token = join(profile, 'owner-token'), log = join(profile, 'server.log'), metadata = join(profile, 'process.json');
  const key = join(home, '.config/alphaphone/cerebras-key');
  const manifest = join(scratch, 'reviewed-source.json');
  const node = join(scratch, 'tool/node'), bun = join(scratch, 'tool/bun');
  const library = join(scratch, 'assets/lib'), tts = join(scratch, 'assets/tts'), asr = join(scratch, 'assets/asr');
  const write = (name, value, mode = 0o600) => {
    fs.mkdirSync(dirname(name), {recursive: true, mode: 0o700});
    fs.writeFileSync(name, value, {mode});
  };
  const json = (name, value) => write(name, JSON.stringify(value)+'\n');
  for (const source of [launcher, ...support]) write(join(repo, source), fs.readFileSync(join(root, source)));
  writeCoreStateFixture(repo, frozen, '1'.repeat(40), true);
  write(join(frozen, 'packages/app/src/runtime/dev-server.ts'), 'throw Error("Frozen fixture entry must not execute");\n');
  json(join(frozen, 'tsconfig.json'), {});
  const git = (...args) => execFileSync('git', args, {
    cwd: frozen, encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  git('init'); git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Synthetic frozen source');
  const snapshot = sourceManifest(frozen);
  json(manifest, snapshot);
  if (scenario === 'source-mismatch') write(join(frozen, 'tsconfig.json'), '{"changed":true}');
  const selectedPin = scenario === 'pinned' ? snapshot.revision : '1'.repeat(40);
  json(join(repo, 'upstream.lock.json'), {commit: selectedPin});
  const manifestFile = join(repo, CORE_STATE_MANIFEST);
  const manifestValue = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  json(manifestFile, {...manifestValue, baseCommit: selectedPin});
  if (scenario === 'core-refused') write(join(repo, 'patches/eliza/task-service-stop.patch'), 'Synthetic wrong patch bytes');
  write(node, 'Private fixture version port only\n', 0o700);
  write(bun, 'Private fixture version and launch port only\n', 0o700);
  write(key, scenario === 'empty-input' ? '' : 'synthetic-model-port-input', scenario === 'key-mode' ? 0o644 : 0o600);
  write(library, 'synthetic-native-library-bytes');
  const pin = (directory, path, content) => {
    write(join(directory, path), content);
    return {path, sha256: sha(content), bytes: Buffer.byteLength(content)};
  };
  const speech = {tts: [pin(tts, 'model.bin', 'synthetic-tts')],
    asr: [pin(asr, 'asr/model.gguf', 'synthetic-asr'), pin(asr, 'vad/silero-vad-v5.gguf', 'synthetic-vad')], espeak: []};
  json(join(repo, 'scripts/host-speech-assets.json'), speech);
  if (scenario === 'speech') write(join(tts, 'model.bin'), 'synthetic-err');
  if (scenario === 'unmarked') fs.mkdirSync(profile, {mode: 0o700});
  if (['bad-marker', 'validate-bad-marker', 'bad-routing'].includes(scenario)) {
    json(marker, {kind: scenario === 'bad-routing' ? 'alphaphone-combined' : 'wrong-fixture-marker', port: 47858});
    json(config, {});
  }
  Object.assign(process.env, {
    ALPHA_NODE_BIN: node, ALPHA_BUN: bun, ALPHA_COMBINED_SOURCE: frozen,
    ALPHA_COMBINED_SOURCE_MANIFEST: manifest, ALPHA_COMBINED_PROFILE: profile,
    ELIZA_INFERENCE_LIBRARY: library, ELIZA_INFERENCE_LIBRARY_SHA256: sha(fs.readFileSync(library)),
    ELIZA_PARADEE_MODEL_DIR: tts, ELIZA_ASR_MODEL_DIR: asr,
    ALPHA_FIXTURE_UNRELATED: 'synthetic-inherited-value',
  });
  if (scenario === 'validate' || scenario === 'validate-bad-marker') process.argv.push('--validate-only');
  return {repo, frozen, profile, marker, config, token, log, metadata, manifest, node, bun, snapshot, write};
}

const refusals = {
  'node-version': /Combined runtime requires Node24\.15\.0 and Bun1\.4\.2/,
  'source-mismatch': /Frozen source content differs/,
  'port-busy': /Combined port47858 unavailable/,
  'profile-source': /Private profile must be outside frozen source/,
  'key-mode': /Private path must be owned, non-symlink and owner-only/,
  speech: /Speech asset checksum mismatch/,
  unmarked: /Refuse adoption of another existing profile/,
  'bad-marker': /Wrong profile marker/,
  'bad-routing': /Profile routing differs/,
  'empty-input': /Required private credential is empty/,
  'core-refused': /Core patch digest mismatch/,
  'metadata-write': /EISDIR/,
  'metadata-stubborn': /EISDIR/,
};

function isFile(path) {
  return fs.statSync(path, {throwIfNoEntry: false})?.isFile() === true;
}
function isDirectory(path) {
  return fs.statSync(path, {throwIfNoEntry: false})?.isDirectory() === true;
}

async function drive(scratch, scenario) {
  assert.equal(scratch, process.env.TMPDIR);
  assert.ok(basename(scratch).startsWith('combined-launch-'));
  const home = join(scratch, 'home');
  assert.equal(process.env.HOME, home);
  assert.deepEqual(fs.readdirSync(scratch), ['home']);
  for (const dir of [scratch, home]) {
    const stat = fs.lstatSync(dir);
    assert.ok(stat.isDirectory() && stat.uid === process.getuid() && (stat.mode & 0o077) === 0);
  }
  const f = createFixture(scratch, scenario);
  const entry = pathToFileURL(join(f.repo, launcher)).href;
  const ports = join(scratch, 'ports');
  const report = join(scratch, 'report.json');
  const failedMetadata = scenario === 'metadata-write' || scenario === 'metadata-stubborn';
  const probe = {checks: 0, port: 'unprobed', logFd: undefined, core: 'unselected',
    child: undefined, booted: false, childExited: false, childFailed: false, childClosed: false,
    receiptFailed: false, cleanupSignal: 'none', forwarded: 'none', outcome: 'running', exited: -1};
  const trace = {name: scenario, init: action('startState', isDirectory(f.profile), isFile(f.marker), isFile(f.config)),
    expect: null, steps: []};
  const supervisorCount = {int: process.listenerCount('SIGINT'), term: process.listenerCount('SIGTERM')};
  function observe() {
    const metadata = isFile(f.metadata) ? JSON.parse(fs.readFileSync(f.metadata, 'utf8')) : null;
    const config = isFile(f.config) ? JSON.parse(fs.readFileSync(f.config, 'utf8')) : null;
    const signals = process.listenerCount('SIGINT') > supervisorCount.int &&
      process.listenerCount('SIGTERM') > supervisorCount.term;
    return {
      's.checks': probe.checks, 's.port': probe.port, 's.profile': isDirectory(f.profile),
      's.marker': isFile(f.marker), 's.config': !!config, 's.identity': !!config?.agents?.list?.[0]?.identityName,
      's.token': isFile(f.token), 's.logOpen': probe.logFd !== undefined,
      's.core': probe.core, 's.spawnRequested': !!probe.child, 's.pid': Number(!!probe.child?.pid),
      's.metadata': !!metadata, 's.metadataPid': Number(!!metadata?.pid),
      's.supervised': signals, 's.booted': probe.booted, 's.childExited': probe.childExited,
      's.childFailed': probe.childFailed, 's.childClosed': probe.childClosed, 's.receiptFailed': probe.receiptFailed,
      's.cleanupSignal': probe.cleanupSignal, 's.forwarded': probe.forwarded, 's.outcome': probe.outcome,
      's.exitCode': probe.exited,
      ChildCustodyAfterLaunch: !probe.receiptFailed || (probe.outcome === 'running' ? signals || probe.childClosed : probe.childClosed),
    };
  }
  const point = (label, next) => trace.steps.push({label, action: next, expect: observe()});
  trace.expect = observe();
  const finish = (outcome, code) => {
    probe.outcome = outcome; probe.exited = code;
  };
  process.once('exit', code => {
    if (['validate', 'validate-bad-marker'].includes(scenario)) {
      assert.equal(code, 0);
      finish('validated', code);
      point('Validate-only exits after the closed preflight, before profile writes or child spawn', action('validateOnly'));
    } else assert.equal(code, probe.exited);
    fs.writeFileSync(report, JSON.stringify(trace), {mode: 0o600});
  });

  let bootResolve, childResolve;
  const boot = new Promise(resolve => {bootResolve = resolve;});
  const settled = new Promise(resolve => {childResolve = resolve;});
  const childScript = join(scratch, 'fake-child.mjs');
  const signalReady = join(scratch, 'child-signal-ready'), signalSeen = join(scratch, 'child-signal-seen');
  const stubborn = scenario === 'metadata-stubborn';
  const ignoreTerm = stubborn ? `import {writeFileSync} from 'node:fs';
process.on('SIGTERM', () => writeFileSync(${JSON.stringify(signalSeen)}, 'SIGTERM'));
writeFileSync(${JSON.stringify(signalReady)}, 'ready');` : '';
  f.write(childScript, `${ignoreTerm}
process.on('disconnect', () => process.exit(0));
process.on('message', message => {if (message?.kind === 'finish') process.exit(message.code);});
process.send({kind:'boot'});
`);

  globalThis.closedCombinedPorts = {
    execFileSync(file, args, options) {
      assert.ok([f.node, f.bun].includes(file), 'Only fixture tool version requests reach this port');
      assert.deepEqual(args, ['--version']);
      assert.deepEqual(options, {encoding: 'utf8'});
      probe.checks++;
      point('Launcher requests the selected fixture '+(file === f.node ? 'Node' : 'Bun')+' version', action('checkVersion'));
      return file === f.node ? scenario === 'node-version' ? 'v25.0.0\n' : 'v26.13.0\n' : '1.4.2\n';
    },
    createServer() {
      const server = new EventEmitter();
      server.listen = (port, host, callback) => {
        assert.equal(port, 47858); assert.equal(host, '127.0.0.1');
        probe.port = 'probing';
        point('The real launcher requests its fixed loopback port probe', action('probePort'));
        queueMicrotask(() => {
          if (scenario === 'port-busy') {
            probe.port = 'busy';
            point('The isolated probe refuses an occupied port', action('portBusy'));
            server.emit('error', Error('Synthetic port occupied'));
          } else callback();
        });
        return server;
      };
      server.close = callback => {
        probe.port = 'released';
        point('The port probe is closed before profile preparation and launch', action('releasePort'));
        queueMicrotask(callback);
      };
      return server;
    },
    fs: {
      ...fs,
      openSync(path, flags, mode) {
        assert.equal(path, f.log);
        assert.equal(flags, 'a'); assert.equal(mode, 0o600);
        const descriptor = fs.openSync(path, flags, mode);
        probe.logFd = descriptor;
        point('Profile marker, canonical identity and owner token are present when the private log opens',
          [action('prepareFiles'), action('openLog')]);
        return descriptor;
      },
      closeSync(descriptor) {
        assert.equal(descriptor, probe.logFd);
        fs.closeSync(descriptor);
        probe.logFd = undefined;
      },
      writeFileSync(path, bytes, options) {
        if (path !== f.metadata) return fs.writeFileSync(path, bytes, options);
        assert.equal(options.mode, 0o600);
        if (stubborn) {
          // Give only our synthetic child time to install its ignoring handler.
          const wait = new Int32Array(new SharedArrayBuffer(4)), deadline = Date.now() + 5000;
          while (!isFile(signalReady) && Date.now() < deadline) Atomics.wait(wait, 0, 0, 10);
          assert.ok(isFile(signalReady));
        }
        if (failedMetadata) fs.mkdirSync(f.metadata, {mode: 0o700});
        try { fs.writeFileSync(path, bytes, options); }
        catch (error) {
          assert.ok(failedMetadata);
          assert.equal(error.code, 'EISDIR');
          probe.receiptFailed = true;
          point('Process receipt fails while child supervision is already installed', action('metadataFailure'));
          throw error;
        }
        const value = JSON.parse(fs.readFileSync(path, 'utf8'));
        assert.equal(value.source, f.frozen);
        assert.equal(value.revision, f.snapshot.revision);
        assert.equal(value.contentSha256, f.snapshot.contentSha256);
        assert.equal(value.port, 47858);
        assert.equal(fs.statSync(path).mode & 0o077, 0);
        assert.equal(value.nodeBinarySha256, sha(fs.readFileSync(f.node)));
        assert.equal(value.bunBinarySha256, sha(fs.readFileSync(f.bun)));
        assert.equal(Object.hasOwn(value, 'pid'), !!probe.child.pid);
        assert.equal(value.pid, probe.child.pid);
        assert.equal(value.coreState.applied, probe.core === 'pinned');
        assert.ok(!Object.hasOwn(value, 'ready'));
        assert.ok(!Object.hasOwn(value, 'ELIZA_API_TOKEN') && !Object.hasOwn(value, 'CEREBRAS_API_KEY'));
        point('Process metadata is published after supervision and before the synthetic boot observation', action('publishMetadata'));
      },
    },
    spawn(command, args, options) {
      assert.equal(command, f.bun);
      assert.equal(options.cwd, f.profile);
      assert.deepEqual(options.stdio, ['ignore', probe.logFd, probe.logFd]);
      assert.equal(options.env.ELIZA_API_BIND, '127.0.0.1');
      assert.equal(options.env.ELIZA_API_PORT, '47858');
      assert.equal(options.env.ELIZA_REQUIRE_LOCAL_AUTH, '1');
      assert.equal(options.env.ELIZA_STATE_DIR, f.profile);
      assert.equal(options.env.ELIZA_CONFIG_PATH, f.config);
      assert.equal(options.env.HOME, process.env.HOME);
      assert.ok(options.env.CEREBRAS_API_KEY === 'synthetic-model-port-input');
      assert.ok(options.env.ELIZA_API_TOKEN === fs.readFileSync(f.token, 'utf8'));
      assert.ok(!Object.hasOwn(options.env, 'ALPHA_FIXTURE_UNRELATED'));
      const selected = args.includes('--preload');
      assert.equal(selected, scenario === 'pinned');
      assert.deepEqual(args.slice(-4), ['--conditions=eliza-source', '--tsconfig-override', join(f.frozen, 'tsconfig.json'),
        join(f.frozen, 'packages/app/src/runtime/dev-server.ts')]);
      if (selected) {
        assert.equal(options.env.ALPHA_CORE_STATE_SOURCE, f.frozen);
        assert.equal(options.env.ALPHA_CORE_STATE_FROZEN_MANIFEST, f.manifest);
      }
      probe.core = selected ? 'pinned' : 'independent';
      point('Launcher selects an authenticated overlay only for the matching frozen source', action('selectCore', probe.core));
      // Only the locally generated child script or an intentionally absent scratch path can spawn.
      const executable = scenario === 'spawn-error' ? join(scratch, 'absent-child') : process.execPath;
      const child = spawn(executable, [childScript], {cwd: scratch, env: {PATH: '/usr/bin:/bin'},
        stdio: ['ignore', probe.logFd, probe.logFd, 'ipc']});
      probe.child = child;
      point('Launcher receives the synthetic ChildProcess before recording metadata', action('spawnChild', !!child.pid));
      child.on('message', message => {
        assert.deepEqual(message, {kind: 'boot'});
        bootResolve();
      });
      let spawnError, exit;
      child.on('error', error => {
        assert.equal(scenario, 'spawn-error');
        assert.equal(error.code, 'ENOENT');
        spawnError = error;
      });
      child.on('exit', (code, signal) => {exit = {code, signal};});
      child.on('close', () => queueMicrotask(() => {
        const next = [];
        if (spawnError) {
          probe.childFailed = true;
          finish('child-error', process.exitCode);
          next.push(action('childError'));
        } else {
          assert.ok(exit);
          probe.childExited = true;
          if (failedMetadata) {
            probe.exited = process.exitCode;
            assert.equal(exit.signal, stubborn ? 'SIGKILL' : 'SIGTERM');
          } else finish('child-exit', process.exitCode);
          assert.equal(process.exitCode, exit.code ?? 1);
          if (scenario.startsWith('signal-')) assert.equal(exit.signal, probe.forwarded);
          next.push(action('childExit', exit.code ?? -1));
        }
        probe.childClosed = true;
        next.push(action('closeChild'));
        point('The actual close event reaps the child, detaches handlers and closes only its log', next);
        childResolve();
      }));
      const on = child.on, kill = child.kill;
      child.on = function(event, handler) {
        const result = on.call(this, event, handler);
        if (event === 'exit') point('The actual launcher attaches supervision before receipt publication', action('supervise'));
        return result;
      };
      child.kill = function(signal) {
        if (probe.receiptFailed) {
          probe.cleanupSignal = signal;
          point('Failed handoff signals only the exact returned synthetic child', action('cleanupSignal', signal));
        } else {
          probe.forwarded = signal;
          point('The launcher forwards the synthetic parent signal only to its returned child', action('forward', signal));
        }
        return kill.call(this, signal);
      };
      return child;
    },
  };

  f.write(join(ports, 'child.mjs'), `export const spawn=(...args)=>globalThis.closedCombinedPorts.spawn(...args);
export const execFileSync=(...args)=>globalThis.closedCombinedPorts.execFileSync(...args);`);
  f.write(join(ports, 'net.mjs'), 'export default {createServer:()=>globalThis.closedCombinedPorts.createServer()};');
  f.write(join(ports, 'fs.mjs'), 'export default globalThis.closedCombinedPorts.fs;');
  const mappings = {'node:child_process': 'child.mjs', 'node:net': 'net.mjs', 'node:fs': 'fs.mjs'};
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (context.parentURL === entry && Object.hasOwn(mappings, specifier))
        return {url: pathToFileURL(join(ports, mappings[specifier])).href, shortCircuit: true};
      return next(specifier, context);
    },
  });
  try {
    await import(entry);
    assert.ok(!Object.hasOwn(refusals, scenario));
  } catch (error) {
    assert.ok(Object.hasOwn(refusals, scenario), error.stack);
    assert.match(error.message, refusals[scenario]);
    process.exitCode = 1;
    finish(failedMetadata ? 'metadata-write' : scenario, 1);
    if (failedMetadata) {
      assert.ok(probe.childClosed && probe.childExited);
      assert.equal(probe.logFd, undefined);
      assert.ok(!isFile(f.metadata));
      if (stubborn) assert.equal(fs.readFileSync(signalSeen, 'utf8'), 'SIGTERM');
      point('Only after child close does the launcher return the original metadata error', action('rejectMetadata'));
    } else if (scenario === 'empty-input') {
      point('Prepared identity and token survive refusal of the empty synthetic input',
        [action('prepareFiles'), action('failBeforeSpawn', scenario)]);
    } else if (scenario === 'core-refused') {
      point('Patch refusal occurs after the private log opens and before child spawn', action('failBeforeSpawn', scenario));
    } else point('Launcher refuses the selected closed preflight or profile condition', action('refuse', scenario));
    return;
  } finally {hooks.deregister();}
  if (scenario !== 'spawn-error') {
    await boot;
    probe.booted = true;
    point('The controlled child begins executing after spawn metadata is already present', action('childBoot'));
    if (scenario === 'signal-int' || scenario === 'signal-term') {
      const signal = scenario === 'signal-int' ? 'SIGINT' : 'SIGTERM';
      assert.equal(process.emit(signal), true);
    } else probe.child.send({kind: 'finish', code: scenario === 'child-seven' ? 7 : 0});
  }
  await settled;
}

const [scratch, scenario] = process.argv.slice(2);
globalThis.fetch = async () => {throw Error('Network is outside the closed launcher fixture');};
await drive(scratch, scenario);
