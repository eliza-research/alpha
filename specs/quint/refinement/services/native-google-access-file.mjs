import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {javaBinary, jvmTimeout} from '../../../../test/fixtures/jvm-tools.mjs';
import {captureInputs, checkTraces, qmap} from '../check-traces.mjs';
import {deferred} from './support.mjs';

const model = 'NativeGoogleAccessFile';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const entry = 'scripts/native-google-product-host.ts';
const bridge = 'android/app/src/main/java/ai/alphacompute/alphaphone/AlphaLocalAgentPlugin.java';
const writer = 'android/app/src/main/java/ai/alphacompute/alphaphone/GoogleAgentAccessFile.java';
const fixture = fileURLToPath(new URL('./NativeGoogleAccessFileTraces.java', import.meta.url));
const fileName = 'alpha-google-agent-access.json';
const envKey = 'ALPHA_GOOGLE_AGENT_ACCESS_FILE';
const off = {gmailChanges: false, calendarEdits: false};
const idle = {kind: 'none', phase: 'idle'};
const enabled = {version: 1, gmailChanges: true, calendarEdits: true};
const apiToken = 'synthetic_private_host_token_'.padEnd(64, 'x');
const userId = '11111111-1111-4111-8111-111111111111';
const organizationId = '22222222-2222-4222-8222-222222222222';
const binding = {credentialId: '33333333-3333-4333-8333-333333333333', userId, organizationId,
  accountRef: JSON.stringify(['cloud', 'production', userId, organizationId]), sessionGeneration: 'synthetic',
  token: 'synthetic-native-cloud-credential'};
const action = (name, ...args) => ({name, args});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function loadHost(extraSources) {
  const initial = [entry, bridge, writer, fixture, fileURLToPath(import.meta.url),
    'test/fixtures/jvm-tools.mjs', 'specs/quint/refinement/services/support.mjs',
    'package-lock.json', 'upstream.lock.json', ...extraSources];
  const initialHashes = captureInputs(initial), compiled = new Map();
  const bundled = await build({absWorkingDir: root, entryPoints: [entry], bundle: true, write: false,
    format: 'esm', platform: 'node', metafile: true,
    define: {'import.meta.env': '{"VITE_ELIZA_DEV_ALLOW_TEST_MOCKS":"0"}'},
    plugins: [{name: 'native-google-host-source', setup(builder) {
      builder.onLoad({filter: /\.(?:[cm]?[jt]sx?|json)$/, namespace: 'file'}, args => {
        const contents = fs.readFileSync(args.path);
        compiled.set(args.path, hash(contents));
        const extension = args.path.split('.').at(-1);
        return {contents, loader: {mjs: 'js', cjs: 'js', mts: 'ts', cts: 'ts'}[extension] ?? extension,
          resolveDir: dirname(args.path)};
      });
    }}],
  });
  for (const path of Object.keys(bundled.metafile.inputs)) {
    if (path === '<define:import.meta.env>') continue; // Bound by this driver.
    assert.ok(compiled.has(resolve(root, path)), 'Unbound native host module: '+path);
  }
  const sources = [...new Set([...initial, ...compiled.keys()])];
  const driverHashes = captureInputs(sources);
  for (const [path, sha] of [...Object.entries(initialHashes), ...compiled]) {
    assert.equal(driverHashes[path], sha, 'Source changed before executing the JVM or host: '+path);
  }
  const exports = await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].contents).toString('base64'));
  return {exports, sources, driverHashes};
}

function recordedBits(value) {
  assert.equal(value.version, 1);
  assert.equal(typeof value.gmailChanges, 'boolean');
  assert.equal(typeof value.calendarEdits, 'boolean');
  return {gmailChanges: value.gmailChanges, calendarEdits: value.calendarEdits};
}

async function scenario(hostModule, classes, name, drive) {
  const dir = fs.mkdtempSync(join(tmpdir(), 'quint-native-google-access-'));
  const parent = join(dir, '.eliza'), path = join(parent, fileName), peer = join(dir, 'peer');
  const previous = process.env[envKey];
  process.env[envKey] = path;
  const {readGoogleAgentAccessFile, startNativeGoogleAgentHost} = hostModule;
  const savedGoogleAgentAccess = () => readGoogleAgentAccessFile(process.env[envKey]);
  const requests = new Map(), transportCalls = [];
  let host, armed, writes = 0, refusals = 0, hostGeneration = 0;
  let readerOpen = false, snapshot = off, lastRead = off;
  async function startHost() {
    host = await startNativeGoogleAgentHost({binding, apiToken, async request(url) {
      assert.equal(new URL(url).pathname, '/api/v1/user', 'only the synthetic verification port can be called');
      assert.ok(armed && !armed.reached, 'verification port belongs to a single admitted request');
      const ticket = armed;
      transportCalls.push(url);
      ticket.reached = true;
      ticket.entered.resolve();
      await ticket.release.promise;
      throw Error('Controlled verification stop before provider operation');
    }});
    hostGeneration++;
  }
  function readDisk() {
    try {
      if (fs.lstatSync(parent).isSymbolicLink()) return {file: 'linked-parent', access: off};
      const stat = fs.lstatSync(path);
      if (stat.isSymbolicLink()) return {file: 'link', access: off};
      if (stat.isDirectory()) return {file: 'directory', access: off};
      if (stat.isFIFO()) return {file: 'fifo', access: off};
      assert.ok(stat.isFile(), 'fixture creates only known file types');
      try { return {file: 'valid', access: recordedBits(JSON.parse(fs.readFileSync(path, 'utf8')))}; }
      catch { return {file: 'invalid', access: off}; }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return {file: 'missing', access: off};
    }
  }
  function observe() {
    const {file, access} = readDisk();
    return {'s.file': file, 's.access': access, 's.sidecars': fs.existsSync(path+'.tmp') && fs.existsSync(path+'.bak'),
      's.writes': writes, 's.refusals': refusals, 's.readerOpen': readerOpen, 's.snapshot': snapshot,
      's.lastRead': lastRead, 's.hostGeneration': hostGeneration,
      's.requests': qmap([1, 2].map(id => {
        const ticket = requests.get(id);
        const phase = ticket?.reply ? ticket.reply.data.reason === 'changes-off' ? 'changes-off' : 'verification-failed'
          : ticket?.reached ? 'verification' : 'idle';
        return [id, ticket ? {kind: ticket.kind, phase} : idle];
      }))};
  }
  try {
    await startHost();
    const trace = {name, init: action('init'), expect: observe(), steps: []};
    const record = (label, transition) => trace.steps.push({label, action: transition, expect: observe()});
    function publish(gmail, calendar, expected = 'applied') {
      const result = execFileSync(javaBinary('java'), ['-cp', classes,
        'ai.alphacompute.alphaphone.NativeGoogleAccessFileTraces', dir, String(gmail), String(calendar)],
      {encoding: 'utf8', timeout: jvmTimeout}).trim();
      assert.equal(result, expected);
      if (result === 'applied') {
        assert.equal(fs.statSync(path).mode & 0o777, 0o600);
        writes++;
      } else refusals++;
      const current = readDisk().file;
      if (current !== 'linked-parent' && fs.existsSync(parent)) {
        assert.ok(fs.readdirSync(parent).every(name => [fileName, fileName+'.tmp', fileName+'.bak'].includes(name)),
          'the actual writer leaves no temporary file behind after settlement');
      }
      record(result === 'applied' ? 'JVM writer acknowledges its atomic replacement' : 'JVM writer rejects without replacing the target',
        result === 'applied' ? action('publish', gmail, calendar) : action('refuseWrite'));
    }
    const api = {
      publish,
      replace(kind, raw = '{"version":1,"gmailChanges":true') {
        if (readDisk().file === 'linked-parent') fs.unlinkSync(parent);
        fs.mkdirSync(parent, {recursive: true});
        fs.rmSync(path, {recursive: true, force: true});
        if (kind === 'invalid') fs.writeFileSync(path, raw);
        if (kind === 'fifo') execFileSync('mkfifo', [path]);
        if (kind === 'directory') {
          fs.mkdirSync(path);
          fs.writeFileSync(join(path, 'marker'), 'fixture directory');
        }
        if (kind === 'link' || kind === 'linked-parent') {
          fs.mkdirSync(peer, {recursive: true});
          fs.writeFileSync(join(peer, fileName), JSON.stringify(enabled));
          if (kind === 'link') fs.symlinkSync(join(peer, fileName), path);
          else { fs.rmdirSync(parent); fs.symlinkSync(peer, parent); }
        }
        record('fixture changes the durable canonical path type', action('replaceWith', kind));
      },
      sidecars() {
        fs.mkdirSync(parent, {recursive: true});
        for (const suffix of ['.tmp', '.bak']) fs.writeFileSync(path+suffix, JSON.stringify(enabled));
        record('noncanonical replacement artifacts exist without a target', action('leaveSidecars'));
      },
      read() {
        lastRead = savedGoogleAgentAccess();
        record('actual host reads the canonical descriptor or returns both switches off', action('readNow'));
      },
      overlap() {
        const original = fs.openSync;
        let opened = false, failure;
        fs.openSync = function (candidate, ...args) {
          const descriptor = original.call(this, candidate, ...args);
          if (candidate !== path || opened) return descriptor;
          opened = true;
          try {
            const bytes = Buffer.alloc(128);
            const count = fs.readSync(descriptor, bytes, 0, bytes.length, 0);
            snapshot = recordedBits(JSON.parse(bytes.subarray(0, count).toString('utf8')));
            readerOpen = true;
            record('actual host reader owns the old descriptor before any bytes are returned', action('openReader'));
            publish(false, true);
            return descriptor;
          } catch (error) {
            failure = error;
            fs.closeSync(descriptor);
            throw error;
          }
        };
        syncBuiltinESMExports();
        try { lastRead = savedGoogleAgentAccess(); }
        finally { fs.openSync = original; syncBuiltinESMExports(); }
        if (failure) throw failure;
        assert.equal(opened, true, 'the actual host reached the instrumented open boundary');
        readerOpen = false;
        snapshot = off;
        record('overlapping read returns the old complete record after replacement', action('finishReader'));
      },
      async request(id, kind, expected) {
        const body = kind === 'gmail' ? {send: {operation: 'prepare', requestId: randomUUID(),
          to: ['synthetic@example.invalid'], subject: 'Synthetic', bodyText: 'Fixture'}}
          : kind === 'calendar' ? {calendar: {operation: 'write-capabilities'}} : {limit: 1};
        const ticket = {kind, reached: false, entered: deferred(), release: deferred()};
        requests.set(id, ticket);
        const before = transportCalls.length;
        armed = ticket;
        ticket.result = fetch('http://127.0.0.1:'+host.port+'/__alpha-owner-gmail', {
          method: 'POST', headers: {Authorization: 'Bearer '+apiToken, 'Content-Type': 'application/json'},
          body: JSON.stringify(body), signal: AbortSignal.timeout(12000), redirect: 'error',
        }).then(async response => { ticket.reply = {status: response.status, data: await response.json()}; });
        try {
          await Promise.race([ticket.entered.promise, ticket.result]);
          if (expected === 'verification') {
            assert.equal(ticket.reached, true);
            assert.equal(transportCalls.length, before+1);
            assert.equal(ticket.reply, undefined);
          } else {
            assert.equal(ticket.reply?.status, 409);
            assert.deepEqual(ticket.reply.data, {reason: 'changes-off'});
            assert.equal(ticket.reached, false);
            assert.equal(transportCalls.length, before);
          }
          record('private loopback broker admits verification or refuses before its transport', action('request', id, kind));
        } finally { armed = null; }
      },
      async stopAtVerification(id) {
        const ticket = requests.get(id);
        ticket.release.resolve();
        await ticket.result;
        assert.equal(ticket.reply?.status, 409);
        assert.notEqual(ticket.reply.data.reason, 'changes-off');
        record('held admission settles at the synthetic verification port', action('stopAtVerification', id));
      },
      async restart() {
        await host.close();
        requests.clear();
        await startHost();
        record('new real host reads from the same file path without a cached decision', action('restartHost'));
      },
    };
    await drive(api);
    return trace;
  } finally {
    for (const ticket of requests.values()) ticket.release.resolve();
    await Promise.allSettled([...requests.values()].map(ticket => ticket.result));
    try { await host?.close(); }
    finally {
      if (previous === undefined) delete process.env[envKey];
      else process.env[envKey] = previous;
      fs.rmSync(dir, {recursive: true, force: true});
    }
  }
}

export async function runNativeGoogleAccessFileRefinement(extraSources = []) {
  const loaded = await loadHost(extraSources);
  const classes = fs.mkdtempSync(join(tmpdir(), 'quint-google-access-classes-'));
  const traces = [];
  const run = async (name, drive) => traces.push(await scenario(loaded.exports, classes, name, drive));
  try {
    execFileSync(javaBinary('javac'), ['--release', '11', '-d', classes, resolve(root, writer), fixture],
      {timeout: jvmTimeout});
    await run('missing-canonical-path-ignores-sidecars', async api => {
      api.sidecars(); api.read(); api.publish(true, false); api.read();
    });
    await run('malformed-and-wrong-version-records-deny-both-switches', async api => {
      api.publish(true, true);
      for (const raw of ['{"version":1,"gmailChanges":true', 'null',
        '{"version":2,"gmailChanges":true,"calendarEdits":true}',
        '{"version":1,"gmailChanges":"true","calendarEdits":true}',
        '{"version":1,"gmailChanges":true}']) {
        api.replace('invalid', raw); api.read();
      }
      api.publish(false, true); api.read();
    });
    await run('writer-and-reader-refuse-linked-leaf-and-private-parent', async api => {
      for (const kind of ['link', 'linked-parent']) {
        api.replace(kind); api.read(); api.publish(false, false, 'refused'); api.read();
      }
      api.replace('missing'); api.publish(true, false); api.read();
    });
    await run('directory-write-refusal-fifo-read-and-recovery-through-host-restart', async api => {
      api.replace('directory'); api.publish(true, true, 'refused'); api.read();
      api.replace('fifo'); api.read(); api.publish(false, true);
      await api.restart(); api.read();
    });
    await run('actual-open-file-reader-overlaps-the-jvm-replacement', async api => {
      api.publish(true, false); api.read(); api.overlap(); api.read();
    });
    await run('off-refuses-later-admission-while-a-previous-verification-is-held', async api => {
      api.publish(true, false); await api.request(1, 'gmail', 'verification');
      api.publish(false, false); await api.request(2, 'gmail', 'off');
      await api.stopAtVerification(1); await api.restart();
      await api.request(1, 'gmail', 'off'); api.read();
    });
    await run('malformed-record-blocks-calendar-write-but-not-lookup', async api => {
      api.replace('invalid');
      await api.request(1, 'lookup', 'verification'); await api.request(2, 'calendar', 'off');
      await api.stopAtVerification(1);
      await api.restart(); api.publish(false, true);
      await api.request(1, 'calendar', 'verification'); await api.stopAtVerification(1);
      await api.request(2, 'gmail', 'off');
    });
  } finally { fs.rmSync(classes, {recursive: true, force: true}); }

  const receipt = await checkTraces({model, sources: loaded.sources, driverHashes: loaded.driverHashes, traces,
    scope: 'bounded-orchestration', assumptions: [
      'Actual Capacitor-free GoogleAgentAccessFile runs in a host JVM against disposable POSIX paths. The actual native broker runs on loopback with a controlled verification transport.',
      'Two request slots, at most one host recreation and a bounded sequence of switch replacements. A source open hold coordinates one real Java replacement while retaining the opened inode.',
      'Wrong schema and malformed bytes are one equivalence class. The broker never reaches a real provider, and the already admitted request stops at its synthetic verification port.',
    ]});
  return {receipts: [receipt], obligations: [
    {model, obligation: 'Android power-loss durability and mutable path ancestors',
      reason: 'The JVM forces the temporary file and atomically renames it. Host recreation and descriptor snapshots do not establish power-loss directory fsync, Android filesystem guarantees or adversarial ancestor replacement.'},
    {model, obligation: 'Already-admitted provider mutation and bridge acknowledgement',
      reason: 'Access is sampled once before verification. The source replay stops there and leaves provider mutation, lost renderer acknowledgement and installed bridge behavior separate.'},
  ]};
}
