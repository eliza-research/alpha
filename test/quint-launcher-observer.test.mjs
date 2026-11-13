import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {transformSync} from 'esbuild';
import {checkTraces} from '../specs/quint/refinement/check-traces.mjs';
import {boundInputs, call, captureSources, checkpoint, deferred, root, tick, trace} from '../specs/quint/refinement/application/support.mjs';

const driver = fileURLToPath(import.meta.url);
const source = '.eliza/client-features/plugins/plugin-native-system/src/client/launcher.ts';
function compile(extraSources) {
  const sources = [source, driver, ...extraSources];
  captureSources(sources);
  const input = readFileSync(resolve(root, source), 'utf8'), marker = '  let pending: ReturnType<typeof setTimeout> | null = null;';
  assert.equal(input.split(marker).length, 2, 'One launcher watch observation seam');
  const instrumented = 'const {setTimeout,clearTimeout}=__port;\n' + input.replace(marker,
    marker + '\n  __port.inspect=()=>({active,pending});');
  const code = transformSync(instrumented, {loader: 'ts', format: 'cjs', target: 'es2022'}).code;
  return {code, sources};
}

function fixture(compiled, mode) {
  const document = Object.assign(new EventTarget(), {hidden: false});
  const subscriptionTask = deferred(), removalTask = deferred();
  let subscription = 'none', removal = 'none', removals = 0, refreshes = 0, nativeListener, timer;
  const port = {
    setTimeout(callback, milliseconds) {
      assert.equal(milliseconds, 120);
      assert.equal(timer, undefined, 'Only one live debounce');
      timer = {callback};
      return timer;
    },
    clearTimeout(handle) {assert.equal(handle, timer); timer = undefined;},
  };
  const module = {exports: {}};
  new Function('module', 'exports', '__port', 'document', compiled.code)(module, module.exports, port, document);
  const {observeLauncher, createSystemLauncherBridge} = module.exports;
  const system = {
    ...(mode === 'missing' ? {} : {addListener(event, listener) {
      assert.equal(event, 'launcherAppsChanged');
      if (mode === 'throwing') {subscription = 'failed'; throw Error('Injected registration throw');}
      nativeListener = listener;
      subscription = 'pending';
      return subscriptionTask.promise;
    }}),
  };
  const handle = {remove() {
    removals++;
    removal = 'pending';
    return removalTask.promise;
  }};
  const stop = observeLauncher(createSystemLauncherBridge(system), {refresh() {refreshes++;}}, {follow: mode !== 'disabled'});
  return {
    observe() {
      const {active, pending} = port.inspect();
      assert.equal(!!pending, !!timer, 'Observed launcher timeout matches the timer port');
      return {'s.active': active, 's.hidden': document.hidden, 's.scheduled': !!pending, 's.subscription': subscription,
        's.removal': removal, 's.removals': removals, 's.refreshes': refreshes};
    },
    subscriptionReply(ok) {
      assert.equal(subscription, 'pending');
      subscription = ok ? 'installed' : 'failed';
      if (ok) subscriptionTask.resolve(handle);
      else subscriptionTask.reject(Error('Injected subscription rejection'));
    },
    packageChanged() {assert.ok(nativeListener); nativeListener({});},
    resume() {document.dispatchEvent(new Event('resume'));},
    visibility(hidden) {document.hidden = hidden; document.dispatchEvent(new Event('visibilitychange'));},
    timer() {assert.ok(timer); const next = timer; timer = undefined; next.callback();},
    stop,
    removalReply(ok) {
      assert.equal(removal, 'pending');
      removal = ok ? 'done' : 'failed';
      if (ok) removalTask.resolve();
      else removalTask.reject(Error('Injected native remove rejection'));
    },
    async close() {
      stop();
      if (subscription === 'pending') subscriptionTask.reject(Error('Fixture teardown'));
      await tick();
      if (removal === 'pending') removalTask.resolve();
      await tick();
    },
  };
}

const subscribe = ['subscriptionReply', true], stop = ['stop'], packageChange = ['packageChanged'];
const resume = ['resume'], fire = ['timer'], remove = ['removalReply', true];
const cases = [
  ['native-visibility-resume-share-debounce', 'normal', [subscribe, packageChange, ['visibility', false], resume, fire, packageChange, fire, stop, remove]],
  ['hidden-visibility-does-not-schedule', 'normal', [subscribe, ['visibility', true], ['visibility', false], fire, stop, remove]],
  ['resume-schedules-even-when-hidden', 'normal', [subscribe, ['visibility', true], resume, fire, stop, remove]],
  ['hide-does-not-erase-an-already-scheduled-refresh', 'normal', [subscribe, packageChange, ['visibility', true], fire, stop, remove]],
  ['late-registration-after-stop-removes-once', 'normal', [stop, stop, subscribe, packageChange, resume, remove, stop]],
  ['stop-disarms-pending-timer-and-late-callback', 'normal', [subscribe, packageChange, stop, packageChange, resume, ['visibility', false], remove]],
  ['rejected-remove-is-contained', 'normal', [subscribe, stop, ['removalReply', false], stop, packageChange]],
  ['rejected-registration-has-no-handle', 'normal', [['subscriptionReply', false], resume, fire, stop]],
  ['package-notification-before-registration-ack', 'normal', [packageChange, fire, subscribe, stop, remove]],
  ['follow-disabled-keeps-resume', 'disabled', [resume, fire, stop, resume]],
  ['missing-package-port-keeps-visibility', 'missing', [['visibility', true], ['visibility', false], fire, stop]],
  ['synchronous-registration-throw-keeps-resume', 'throwing', [resume, fire, stop]],
];

async function checkLauncherObserver(extraSources = []) {
  const compiled = compile(extraSources), traces = [];
  for (const [name, mode, operations] of cases) {
    const f = fixture(compiled, mode), observed = f.observe();
    const t = trace(name, observed, call('initWith', observed['s.subscription']));
    try {
      for (const [operation, ...args] of operations) {
        f[operation](...args);
        await tick();
        checkpoint(t, [operation, ...args].join(' '), call(operation, ...args), f.observe());
      }
      traces.push(t);
    } finally {await f.close();}
  }
  return checkTraces(boundInputs({model: 'LauncherObserver', sources: compiled.sources, traces, scope: 'bounded-component', assumptions: [
    'Actual prepared observeLauncher and system launcher bridge execute with native listener promises, a real EventTarget and a controlled 120ms timer port.',
    'The model distinguishes registration and removal settlement from observer retirement. Source checkpoints count actual timeout, refresh and cleanup calls. Rejected cleanup remains a port outcome even after the observer has stopped.',
    'Inventory refresh and native package effects use separate contracts. This campaign does not assert an OS-level listener was removed after a failed cleanup acknowledgement.',
  ]}));
}

test('shared launcher observers retire timers and native subscriptions once', {timeout: scaledTimeout(120000)}, async () => {
  const receipt = await checkLauncherObserver([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 12);
  assert.equal(receipt.checkpoints, 78);
});
