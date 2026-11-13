// Partial source contract regression evidence. Original schedules, actions and assertions are retained.
// Only the selected source members/components and controlled ports execute; this is not whole-file refinement.
import {after as afterPartialContract} from 'node:test';
import partialContractAssert from 'node:assert/strict';
import {fileURLToPath as partialContractFile} from 'node:url';
import {captureReplayClosure as capturePartialClosure} from '../specs/quint/refinement/observed-replay.mjs';
import {captureInputs as capturePartialInputs} from '../specs/quint/refinement/check-traces.mjs';
const partialContractInputs = capturePartialClosure([partialContractFile(import.meta.url)]);
afterPartialContract(() => partialContractAssert.deepEqual(capturePartialInputs(Object.keys(partialContractInputs)), partialContractInputs));

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import {modelTraces, replay, tick} from '../specs/quint/refinement/application/shell-model-traces.mjs';
import {settingsScenarioTraces} from './fixtures/settings-model-traces.mjs';

// SettingsSession traces from the simulator, replayed on the Settings adapter's own device-read
// and text-size code: refresh(), the size choice's handler, the result settlement, the merge and
// the unmount reset, taken from the source and run over a device whose answers arrive when the
// model says so. Mounting sets the owner only; the reads a real mount starts are refresh steps.
const source = readFileSync('apps/app/src/prototype/settings-adapter.ts', 'utf8');
const slice = (from, to) => { const a = source.indexOf(from), b = source.indexOf(to, a); assert.ok(a >= 0 && b > a, from); return source.slice(a, b); };
const unmount = slice('if (owner === this) { capabilityAbort?.abort();', '\n');
const code = stripTypeScriptTypes(`
let owner = null, facts = {}, controls = {}, delivery = {}, generation = 0, scaleGeneration = 0, scaleVersion = 0, scalePending = false, updateBusy = '', updateResult = '', cross = {}, choices = null, history = null;
let roles = null, crashLog = null, photoAccess = null, launcher = false, recovery = [], resumedUnread = false, capabilityAbort = null, inferenceAbort = null;
${slice('export function textScaleSettlement(', '/** Keep the reference settings components').replace(/export function/g, 'function')}
let scaleResults = textScaleSettlement();
${slice('  const showTextScale=', '  async function refresh() {')}
${slice('  async function refresh() {', '  p.componentDidMount = function')}
globalThis.page = {
  mount(instance) { owner = instance; }, unmount(instance) { (function () { ${unmount} }).call(instance); },
  refresh, choose: (value, api) => changeTextScale(value, api),
  shown: () => ({owner, generation, scaleGeneration, facts}),
};`);

function fixture() {
  const queue = [], handled = [], toasts = [], instances = [];
  let deviceScale = 100, deviceOther = 0;
  const request = kind => value => new Promise((settle, fail) => queue.push({kind, value: value?.percent, settle, fail}));
  const context = vm.createContext({
    device: {snapshot: request('read'), setTextScale: request('write')},
    Capacitor: {isNativePlatform: () => false}, developerTools: false, readRoles: value => value, refreshPasswordManager() {},
    system: {getDeviceSettings: async () => ({}), getStatus: async () => ({}), getBuildInfo: async () => null},
    notifications: {status: async () => ({}), crossAppStatus: async () => ({}), notificationHistory: async () => ({items: []})},
    readCrashLog: async () => null, photoLibrary: {libraryAccess: async () => null}, connectionController: {refreshProviderStatus: async () => {}},
    recoveryNeeded: async () => [], Date,
  });
  vm.runInContext(code, context);
  const {page} = context, api = {toast: message => toasts.push(message)};
  const name = op => `${op.kind}:${op.token}`;
  return {
    async apply({action, picks, state}, before) {
      if (action === 'mount') { instances.push({vset() {}}); page.mount(instances.at(-1)); }
      else if (action === 'unmount') page.unmount(instances.at(-1));
      else if (action === 'refresh') void page.refresh();
      else if (action === 'changeScale') void page.choose(picks.value, api);
      else if (action === 'deviceChanges') deviceOther++;
      else if (action === 'deviceHandles') {
        const op = queue.shift(), failed = picks.fails && op.kind === 'write';
        if (op.kind === 'write' && !failed) deviceScale = op.value;
        handled.push({...op, failed, answer: {textScalePercent: deviceScale, effectiveTextZoom: deviceScale, ...(op.kind === 'read' ? {other: deviceOther} : {})}});
      } else if (action === 'settleRead' || action === 'settleWrite') {
        const op = handled.splice(handled.findIndex(entry => entry.name === name(picks.op)), 1)[0];
        assert.equal(op.answer.textScalePercent, picks.op.scale);
        if (op.failed) op.fail(Error('rejected')); else op.settle(op.answer);
      } else assert.fail(`unmapped action ${action}`);
      await tick();
      // A request the page issued in this step takes the token the model gave it.
      if (state.queue.length > before.queue.length) {
        const issued = queue.at(-1), op = state.queue.at(-1);
        assert.ok(issued && issued.name === undefined && issued.kind === op.kind, 'the page issued the request');
        issued.name = name(op);
      }
      // The newest request's failure is reported once.
      assert.equal(toasts.length > 0, state.failedToken !== before.failedToken && state.failedToken !== 0, 'failure notice');
      toasts.length = 0;
    },
    observe() {
      const {owner, generation, scaleGeneration, facts} = page.shown();
      return {owner: owner ? instances.indexOf(owner) + 1 : 0, generation, scaleGeneration, shownScale: facts.textScalePercent ?? -1,
        shownOther: facts.other ?? -1, inFlight: queue.length, results: handled.length, deviceScale, deviceOther};
    },
  };
}

test("partial source contract: simulated SettingsSession traces agree with the Settings read and text-size code after every step", {timeout: 170000}, async () => {
  const traces = [
    ...modelTraces({module: 'SettingsSession', traces: 200, steps: 40}),
    ...settingsScenarioTraces(),
  ];
  // The campaign reaches the cases the settlement exists for.
  const reached = property => traces.some(trace => trace.some(step => property(step.state)));
  assert.ok(reached(s => s.restored === 1) && reached(s => s.restored === 2) && reached(s => s.keptSize) && reached(s => s.held !== -1));
  const result = await replay(traces, {
    start: fixture,
    project: s => ({owner: s.owner, generation: s.generation, scaleGeneration: s.scaleGeneration, shownScale: s.shownScale,
      shownOther: s.shownOther, inFlight: s.queue.length, results: s.results.length, deviceScale: s.deviceScale, deviceOther: s.deviceOther}),
  });
  assert.deepEqual([...result.exercised].sort(), ['changeScale', 'deviceChanges', 'deviceHandles', 'mount', 'refresh', 'settleRead', 'settleWrite', 'unmount']);
});
