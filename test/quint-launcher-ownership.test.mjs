import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import {checkTraces, qmap, qset} from '../specs/quint/refinement/check-traces.mjs';
import {boundInputs, call, captureSources, checkpoint, deferred, root, tick, trace} from '../specs/quint/refinement/application/support.mjs';
import {resolve} from 'node:path';

const driver = fileURLToPath(import.meta.url);
const source = '.eliza/client-features/plugins/plugin-native-system/src/client/launcher.ts';
const readIds = Array.from({length: 8}, (_, i) => i + 1), launchIds = [1, 2, 3, 4];
const apps = [null,
  {packageName: 'org.example.app', activityName: 'Main', user: '0', label: 'Example'},
  {packageName: 'org.example.app', activityName: 'Edit', user: '0', label: 'Example'},
  {packageName: 'org.example.app', activityName: 'Main', user: '10', label: 'Example', profile: 'work'},
];
const defaults = [null,
  {available: true, packageName: 'org.example.phone', activityName: 'Dial', label: 'Phone'},
  {available: true, packageName: 'org.example.call', activityName: 'Dial', label: 'New phone'},
];
const emptyRead = {listDone: false, listOk: false, entries: [], dialDone: false, dial: 0};
const emptyLaunch = {lifetime: 0, target: 0, resolvedDial: 0};

function compile(extraSources) {
  const sources = [source, driver, ...extraSources];
  captureSources(sources);
  const text = readFileSync(resolve(root, source), 'utf8'), marker = '  let lifetime = 0;';
  assert.equal(text.split(marker).length, 2, 'One launcher generation observation seam');
  const code = transformSync(text.replace(marker, marker + '\n  __port.inspect=()=>({state,generation,lifetime});'),
    {loader: 'ts', format: 'cjs', target: 'es2022'}).code;
  return {code, sources};
}

function fixture(compiled) {
  const port = {}, module = {exports: {}};
  new Function('module', 'exports', '__port', compiled.code)(module, module.exports, port);
  const {appKey, createLauncher, createSystemLauncherBridge} = module.exports;
  const reads = new Map(), launches = [];
  const keys = new Map(apps.slice(1).map((app, index) => [appKey(app), index + 1]));
  const appId = value => {
    const id = keys.get(appKey(value));
    assert.ok(id, 'Every accepted installed identity is in the finite fixture');
    return id;
  };
  const dialId = value => {
    if (!value) return 0;
    const id = defaults.findIndex(other => other?.packageName === value.packageName);
    assert.ok(id > 0, 'The default handler came from an actual role result');
    return id;
  };
  function registerRead(portName) {
    const id = port.inspect().generation;
    if (!reads.has(id)) reads.set(id, {...emptyRead});
    const record = reads.get(id);
    assert.equal(record[portName], undefined);
    record[portName] = deferred();
    return record[portName].promise;
  }
  function registerLaunch(target) {
    const {state, lifetime} = port.inspect();
    const task = deferred();
    launches.push({lifetime, target, resolvedDial: target === 4 ? dialId(state.dial) : 0, settled: false, task});
    return task.promise;
  }
  const system = {
    listLauncherApps(input) {assert.equal(input?.icons, true); return registerRead('list');},
    resolveDefaultApp(input) {assert.deepEqual(input, {role: 'dial'}); return registerRead('dialReply');},
    launchApp(input) {
      const target = appId(input), expected = apps[target];
      assert.deepEqual(input, {packageName: expected.packageName, activityName: expected.activityName, user: expected.user});
      return registerLaunch(target);
    },
    openDefaultApp(input) {assert.deepEqual(input, {role: 'dial'}); return registerLaunch(4);},
  };
  const launcher = createLauncher(createSystemLauncherBridge(system), () => {}, {icons: true});
  const error = value => {
    if (!value) return '';
    if (value.endsWith('is no longer installed.')) return 'stale-app';
    if (value.endsWith('Fixture refusal.')) return value.startsWith('Example') ? 'launch-failed' : 'dial-failed';
    return assert.fail('Unexpected launcher result: ' + value);
  };
  return {
    observe() {
      const {state, generation, lifetime} = port.inspect();
      return {'s.status': state.status, 's.apps': state.apps.map(appId), 's.dial': dialId(state.dial),
        's.error': error(state.launchError), 's.launching': state.launching === 'dial' ? 4 : keys.get(state.launching) ?? 0,
        's.generation': generation, 's.lifetime': lifetime,
        's.pendingReads': qset([...reads].filter(([, read]) => !read.listDone || !read.dialDone).map(([id]) => id)),
        's.reads': qmap(readIds.map(id => {
          const read = reads.get(id);
          return [id, read ? {listDone: read.listDone, listOk: read.listOk, entries: read.entries, dialDone: read.dialDone, dial: read.dial} : emptyRead];
        })),
        's.nextLaunch': launches.length, 's.pendingLaunches': qset(launches.flatMap((launch, index) => launch.settled ? [] : [index + 1])),
        's.launches': qmap(launchIds.map(id => {
          const launch = launches[id - 1];
          return [id, launch ? {lifetime: launch.lifetime, target: launch.target, resolvedDial: launch.resolvedDial} : emptyLaunch];
        }))};
    },
    request(quiet) {void (quiet ? launcher.refresh() : launcher.load());},
    listReply(id, result, entries = []) {
      const read = reads.get(id);
      assert.ok(read?.list && !read.listDone);
      read.listDone = true;
      read.listOk = result === 'ready';
      read.entries = entries;
      if (result === 'rejected') read.list.reject(Error('Injected list failure'));
      else read.list.resolve({apps: result === 'ready' ? entries.map(entry => apps[entry]) : null});
    },
    dialReply(id, dial, rejects = false) {
      const read = reads.get(id);
      assert.ok(read?.dialReply && !read.dialDone);
      read.dialDone = true;
      read.dial = dial;
      if (rejects) read.dialReply.reject(Error('Injected default failure'));
      else read.dialReply.resolve(defaults[dial] ?? {available: false});
    },
    launchApp(id) {void launcher.launch(apps[id]);},
    launchDial() {void launcher.openDial();},
    launchReply(id, ok) {
      const launch = launches[id - 1];
      assert.ok(launch && !launch.settled);
      launch.settled = true;
      if (ok) launch.task.resolve();
      else launch.task.reject(Error('Fixture refusal.'));
    },
    cancelPending() {launcher.cancelPending();},
    clearError() {launcher.clearError();},
    async close() {
      launcher.cancelPending();
      for (const read of reads.values()) {
        if (!read.listDone) read.list.reject(Error('Fixture teardown'));
        if (!read.dialDone) read.dialReply.reject(Error('Fixture teardown'));
      }
      for (const launch of launches) if (!launch.settled) launch.task.reject(Error('Fixture teardown'));
      await tick();
    },
  };
}

const request = ['request', false], refresh = ['request', true], cancel = ['cancelPending'];
const listed = (id, entries = [1, 2, 3]) => ['listReply', id, 'ready', entries];
const dial = (id, value = 1) => ['dialReply', id, value];
const boot = [request, listed(1), dial(1)];
const app = id => ['launchApp', id], phone = ['launchDial'];
const finish = (id, ok = true) => ['launchReply', id, ok];
const scenarios = [
  ['quiet-idle-then-list-waits-for-role', [refresh, request, listed(1), dial(1)]],
  ['role-first-waits-for-list', [request, dial(1, 2), listed(1, [3, 2, 1, 3])]],
  ['out-of-order-read-ownership', [request, request, listed(2, [3]), dial(2, 2), dial(1), listed(1, [1])]],
  ['retire-read-and-reuse-controller', [request, cancel, listed(1), dial(1), request, dial(3, 2), listed(3, [2])]],
  ['quiet-failure-drops-inventory-retains-current-role', [...boot, refresh, ['listReply', 2, 'rejected'], dial(2, 2), phone, finish(1)]],
  ['malformed-list-and-role-rejection', [request, ['dialReply', 1, 0, true], ['listReply', 1, 'malformed']]],
  ['component-and-profile-identity', [request, listed(1, [1, 0, 2, 3]), dial(1),
    app(1), finish(1), app(2), finish(2), app(3), finish(3)]],
  ['other-app-and-role-wait-during-launch', [...boot, app(1), app(3), phone, finish(1), phone, finish(2)]],
  ['old-app-refusal-cannot-clear-new-dial', [...boot, app(1), cancel, phone, finish(1, false), finish(2)]],
  ['old-role-completion-cannot-clear-new-role', [...boot, phone, cancel, phone, finish(1), finish(2)]],
  ['current-app-refusal-refreshes-with-error', [...boot, app(2), finish(1, false), listed(2, [2]), dial(2), ['clearError']]],
  ['current-dial-refusal-refreshes-and-retries-role', [...boot, phone, finish(1, false), dial(2, 2),
    ['listReply', 2, 'rejected'], phone, finish(2)]],
  ['removed-app-cannot-dispatch', [...boot, refresh, listed(2, [2]), dial(2), app(1), app(2), finish(1)]],
  ['missing-role-does-not-dispatch', [request, listed(1), ['dialReply', 1, 0, true], phone, app(1), finish(1)]],
  ['clear-error-does-not-retire-new-read', [...boot, app(3), finish(1, false), ['clearError'], listed(2, [1, 3]), dial(2)]],
];

async function checkLauncherOwnership(extraSources = []) {
  const compiled = compile(extraSources), traces = [];
  for (const [name, operations] of scenarios) {
    const f = fixture(compiled), t = trace(name, f.observe());
    try {
      for (const [operation, ...args] of operations) {
        f[operation](...args);
        await tick();
        const abstract = operation === 'listReply' ? [args[0], args[1] === 'ready', args[2] ?? []]
          : operation === 'dialReply' ? args.slice(0, 2) : args;
        checkpoint(t, [operation, ...args].join(' '), call(operation, ...abstract), f.observe());
      }
      assert.deepEqual(f.observe()['s.pendingReads'], qset([]));
      assert.deepEqual(f.observe()['s.pendingLaunches'], qset([]));
      traces.push(t);
    } catch (error) {
      throw Error('Launcher source scenario ' + name, {cause: error});
    } finally {await f.close();}
  }
  return checkTraces(boundInputs({model: 'LauncherOwnership', sources: compiled.sources, traces, scope: 'bounded-component', assumptions: [
    'Actual prepared createLauncher and createSystemLauncherBridge execute against held system list, default resolution and launch promises. A read-only observer exposes native handoff lifetime and inventory generation.',
    'Three exact package/activity/profile app identities, two default-handler readbacks, eight generations and four launches. Failed/malformed reads, invalid entries, duplicate identities and retired promises are concrete input classes.',
    'No builtins, favorites mutation or host watch scheduling in this projection. Actual Android package effects and open-default execution remain controlled system ports.',
  ]}));
}

test('shared launcher readbacks and native handoffs retain the current owner', {timeout: scaledTimeout(120000)}, async () => {
  const receipt = await checkLauncherOwnership([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 15);
  assert.equal(receipt.checkpoints, 120);
});
