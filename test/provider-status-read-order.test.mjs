import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {stripTypeScriptTypes} from './support/strip-types.mjs';

const source = readFileSync('apps/app/src/runtime/connection-ui.tsx', 'utf8');
function section(start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, 'Missing source anchor ' + start);
  return source.slice(first, last);
}
const code = stripTypeScriptTypes([
  section('let providerStatusGeneration', 'function ownProviderSelected'),
  source.match(/^function ownProviderSelected.*$/m)?.[0],
  'const connectionController={',
  section('  cancelProviderSelection()', '  dismissError()'),
  section('  async recheckResidentProvider(', '  async cloudLogin('),
  '};Object.assign(globalThis,{connectionController,generation:()=>providerStatusGeneration});',
].join('\n'), {mode: 'strip'});

const earlier = {provider: 'cerebras', configured: true, selected: true, revision: 'earlier',
  keys: {text: {configured: true}, voice: {configured: false}}};
const latest = {provider: 'elizacloud', configured: true, revision: 'latest'};
const unbound = {provider: 'elizacloud', configured: false, revision: 'unbound'};

function fixture() {
  const state = {open: true, purpose: 'provider', cloudAccount: {userId: 'same-owner'},
    residentInference: 'cloud', providerStatus: earlier, providerStatusError: false};
  const reads = [], changes = [], restarts = [];
  let rebinds = 0;
  const box = {
    state, operation: null, sending: null, active: {kind: 'resident'},
    providerRechecks: new Set(), residentBinding: 'cloud', residentCloudFlow: () => true,
    queueResidentRebind() { rebinds++; },
    update(patch) { Object.assign(state, patch); },
    localProviderStatus() {
      const result = Promise.withResolvers();
      reads.push(result);
      return result.promise;
    },
    async work(_notice, run) {
      assert.equal(box.operation, null);
      box.operation = new AbortController();
      try { return await run(box.operation.signal); }
      finally { box.operation = null; }
    },
    selectLocalProvider(input, signal) {
      const result = Promise.withResolvers();
      changes.push({input, signal, result});
      return result.promise;
    },
    async restartAfterProviderChange(signal, wait) { restarts.push({signal, wait}); },
  };
  vm.runInNewContext(code, box);
  return {controller: box.connectionController, generation: box.generation, state,
    reads, changes, restarts, rebinds: () => rebinds};
}

test('the older same-generation success neither overwrites nor returns an obsolete status', async () => {
  const {controller, reads, state} = fixture();
  const old = controller.refreshProviderStatus(), current = controller.refreshProviderStatus();
  reads[1].resolve(latest);
  assert.equal(await current, latest);
  reads[0].resolve(earlier);
  assert.deepEqual({result: await old, status: state.providerStatus, unavailable: state.providerStatusError},
    {result: null, status: latest, unavailable: false});
});

test('out-of-order read failures cannot hide a later success or revive an earlier status', async () => {
  for (const currentFailed of [true, false]) {
    const {controller, reads, state} = fixture();
    const old = controller.refreshProviderStatus(), current = controller.refreshProviderStatus();
    if (currentFailed) {
      reads[1].reject(Error('Latest read failed'));
      assert.equal(await current, null);
      reads[0].resolve(latest);
    } else {
      reads[1].resolve(latest);
      assert.equal(await current, latest);
      reads[0].reject(Error('Older read failed'));
    }
    assert.deepEqual({result: await old, status: state.providerStatus, unavailable: state.providerStatusError},
      {result: null, status: currentFailed ? earlier : latest, unavailable: currentFailed});
  }
});

test('an explicitly retired generation cannot displace a current read or start another native request', async () => {
  const {controller, generation, reads, state} = fixture();
  const first = generation(), retired = controller.refreshProviderStatus(first);
  controller.cancelProviderSelection();
  const current = controller.refreshProviderStatus(generation());
  const late = controller.refreshProviderStatus(first);
  reads[2]?.resolve(unbound);
  reads[1].resolve(latest);
  reads[0].resolve(earlier);
  assert.equal(await current, latest);
  assert.equal(await retired, null);
  assert.equal(await late, null);
  assert.equal(state.providerStatus, latest);
  assert.equal(reads.length, 2);
});

test('a committed provider selection outranks passive reads from before and during that operation', async () => {
  const {controller, reads, state, changes, restarts} = fixture();
  const before = controller.refreshProviderStatus();
  const selection = controller.selectSavedProvider('cloud');
  assert.equal(changes.length, 1);
  assert.equal(changes[0].input.mode, 'cloud');
  assert.equal(changes[0].input.expectedRevision, earlier.revision);
  assert.equal(state.providerStatusError, true);
  const during = controller.refreshProviderStatus();
  changes[0].result.resolve(latest);
  await selection;
  assert.equal(restarts.length, 1);
  reads[1].resolve(earlier);
  reads[0].resolve(earlier);
  assert.equal(await before, null, 'an older operation stays retired');
  assert.deepEqual({result: await during, status: state.providerStatus, unavailable: state.providerStatusError},
    {result: null, status: latest, unavailable: false});
  assert.equal(changes.length, 1, 'reconciliation never resends the selection');
});

test('a lost selection response still reads its generation once and never repeats the write', async () => {
  const {controller, reads, state, changes, restarts} = fixture();
  const selection = assert.rejects(controller.selectSavedProvider('cloud'), /Selection response lost/);
  changes[0].result.reject(Error('Selection response lost'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads.length, 1);
  reads[0].resolve(latest);
  await selection;
  assert.equal(state.providerStatus, latest);
  assert.equal(state.providerStatusError, false);
  assert.equal(changes.length, 1);
  assert.equal(restarts.length, 0);
});

test('a superseded failed-turn check can be retried and only a current unbound read schedules a rebind', async () => {
  const {controller, reads, state, rebinds} = fixture();
  const check = controller.recheckResidentProvider('failed-turn');
  await controller.recheckResidentProvider('failed-turn');
  assert.equal(reads.length, 1, 'a repeat click shares the in-flight check');
  const refresh = controller.refreshProviderStatus();
  reads[1].resolve(latest);
  await refresh;
  reads[0].resolve(unbound);
  await check;
  assert.deepEqual({status: state.providerStatus, inference: state.residentInference, rebinds: rebinds()},
    {status: latest, inference: 'cloud', rebinds: 0});
  const current = controller.recheckResidentProvider('failed-turn');
  assert.equal(reads.length, 3, 'the same card can retry a superseded check');
  reads[2].resolve(unbound);
  await current;
  assert.equal(state.residentInference, 'unavailable');
  assert.equal(rebinds(), 1);
  await controller.recheckResidentProvider('failed-turn');
  assert.equal(reads.length, 3);
  assert.equal(rebinds(), 1);
});
