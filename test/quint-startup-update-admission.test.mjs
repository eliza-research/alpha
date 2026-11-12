import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import {checkTraces, qset} from '../specs/quint/refinement/check-traces.mjs';
import {checkClientFeatures} from '../scripts/prepare-client-features.ts';
import {boundInputs, captureSources, checkpoint, deferred, read, tick, trace, call} from '../specs/quint/refinement/application/support.mjs';

const model = 'StartupUpdateAdmission';
const modelPath = 'specs/quint/application/StartupUpdateAdmission.qnt';
const shared = 'packages/ui/src/state/app-update-gate.ts';
const effective = '.eliza/client-features/' + shared;
const projection = '.eliza/client-features/.source.json';
const activations = ['', '11111111-2222-4333-8444-555555555555', '22222222-2222-4333-8444-555555555555'];
const bridges = ['', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee'];

function fixture(name, code) {
  const dom = new JSDOM('<main></main>');
  const {window} = dom, {document} = window;
  window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  const reads = [], waits = [], ready = new Set(), continues = [];
  let released = false, loseAck = false, continuing;
  const context = vm.createContext({document, setTimeout(callback, delay) {
    assert.equal(delay, 1000);
    waits.push(callback);
    return waits.length;
  }});
  code.runInContext(context);
  const activation = value => activations.indexOf(value ?? '');
  const bridge = value => bridges.indexOf(value ?? '');
  const exactPending = () => context.inspect().pending;
  const port = {
    updateState() {
      const read = deferred();
      reads.push(read);
      return read.promise;
    },
    async activateUpdate(input) {
      const id = activation(input.activationId);
      assert.ok(id > 0);
      assert.equal(input.ready, true);
      assert.equal(Object.hasOwn(input, 'resumeEligible'), false);
      assert.equal(input.bridgeId, exactPending().bridgeId);
      assert.equal(ready.has(id), false);
      ready.add(id);
      if (loseAck) throw Error('Fixture native acknowledgement was lost');
    },
    continueUpdate(input) {
      assert.equal(continuing, undefined);
      const id = activation(input.activationId);
      assert.equal(id, activation(exactPending().activationId));
      assert.equal(input.bridgeId, exactPending().bridgeId);
      continues.push(id);
      continuing = deferred();
      return continuing.promise;
    },
  };
  const held = context.hold(port, {
    dialogClass: 'alpha-update-startup', dialogLabel: 'App update',
    pendingLabel: 'Updating Alpha…', continueLabel: 'Continue update', navigationEvents: [],
  });
  const completion = held.then(() => { released = true; });
  const button = () => document.querySelector('dialog[open] button');
  const observe = () => ({
    'state.pending': activation(exactPending()?.activationId),
    'state.bridge': bridge(exactPending()?.bridgeId),
    'state.acknowledged': activation(context.inspect().acknowledged),
    'state.ready': qset(ready),
    'state.panel': Boolean(document.querySelector('dialog[open]')),
    'state.canContinue': Boolean(button() && !button().hidden),
    'state.continuing': Boolean(continuing),
    'state.continues': [...continues],
    'state.released': released,
  });
  const result = trace(name, observe());
  const save = async (label, ...action) => {
    await tick();
    checkpoint(result, label, call(...action), observe());
  };
  async function reply(value) {
    if (!reads.length) {
      const wait = waits.shift();
      assert.ok(wait, 'startup must await a readback');
      wait();
      await tick();
    }
    const read = reads.shift();
    assert.ok(read);
    if (value === undefined) read.reject(Error('Fixture status unavailable'));
    else read.resolve(value);
  }
  return {
    result,
    end: async () => {
      assert.equal(released, true, 'every startup schedule reaches a terminal disposition');
      await completion;
      window.close();
    },
    async pending(id, owner, phase, canContinue = false, lose = false) {
      loseAck = lose;
      await reply({pending: true, activationId: activations[id], bridgeId: bridges[owner], phase, canContinue});
      await save('startup receives exact native preparation or pause', 'readPending', id, owner, phase, canContinue);
    },
    async terminal(id, owner, outcome = 'unknown', idle = false) {
      await reply({pending: false, activationId: activations[id], bridgeId: bridges[owner],
        outcome: outcome === 'unknown' ? undefined : outcome, idle});
      await save('native terminal or idle readback can release mount', 'readTerminal', id, owner, outcome, idle);
    },
    async uncertain() {
      await reply(undefined);
      await save('uncertain status keeps mount held', 'readUncertain');
    },
    async click() {
      button()?.click();
      await save('continue sends the exact paused identity once while pending', 'clickContinue');
    },
    async finished(ok) {
      const current = continuing;
      assert.ok(current);
      continuing = undefined;
      if (ok) current.resolve();
      else current.reject(Error('Fixture continue acknowledgement was lost'));
      await save('continue acknowledgement does not release startup', 'continued');
    },
  };
}

async function checkStartupUpdateAdmission() {
  const sources = [fileURLToPath(import.meta.url), 'apps/app/src/main.tsx', 'vendor/eliza/' + shared, effective, projection,
    'android/app/src/main/java/ai/alphacompute/alphaphone/AlphaDevicePlugin.java',
    'upstream.lock.json', 'scripts/prepare-client-features.ts', 'scripts/pinned-upstream-source.ts'];
  captureSources([...sources, modelPath]);
  checkClientFeatures();
  const gate = read(effective);
  const stamp = JSON.parse(read(projection));
  const digest = createHash('sha256').update(gate).digest('hex');
  assert.equal(stamp.files[shared], digest);
  const pinned = createHash('sha256').update(read('vendor/eliza/' + shared)).digest('hex');
  assert.equal(stamp.sourceFiles[shared], pinned);
  assert.equal(digest, pinned, 'the prepared updater is the exact reviewed upstream source');
  assert.equal(Object.hasOwn(stamp, 'appUpdateResumePatch'), false, 'the retired updater patch has no receipt');
  const marker = '  let pending: Activation | undefined;\n  let acknowledged: string | undefined;';
  assert.equal(gate.split(marker).length, 2);
  const inspect = '  globalThis.inspect = () => ({pending, acknowledged});';
  const code = new vm.Script(stripTypeScriptTypes(gate.replace(marker, marker + '\n' + inspect)
    .replace(/^export /gm, '') + '\nglobalThis.hold = holdAppUpdateStartup;', {mode: 'strip'}));
  const traces = [];
  async function run(name, sequence) {
    const owner = fixture(name, code);
    try {
      await sequence(owner);
      traces.push(owner.result);
    } finally { await owner.end(); }
  }
  await run('fresh_mount_after_native_idle', async f => { await f.terminal(0, 1); });
  await run('lost_ack_and_foreign_bridge_keep_mount_held', async f => {
    await f.uncertain(); await f.pending(1, 1, 'preparing', false, true); await f.pending(1, 1, 'preparing');
    await f.pending(2, 2, 'paused', true); await f.terminal(1, 2, 'canceled', true);
    await f.terminal(1, 1, 'canceled');
  });
  await run('paused_continue_waits_for_native_release', async f => {
    await f.pending(1, 1, 'paused', true); await f.click(); await f.click(); await f.finished(false);
    await f.pending(1, 1, 'paused'); await f.click(); await f.terminal(2, 1, 'unknown', true);
  });
  await run('newer_same_bridge_activation_owns_terminal', async f => {
    await f.pending(1, 1, 'preparing'); await f.pending(2, 1, 'preparing');
    await f.terminal(1, 1, 'installed'); await f.terminal(2, 1, 'failed');
  });

  return checkTraces(boundInputs({model, modelPath, sources, traces, scope: 'bounded-component',
    assumptions: ['Actual prepared startup mount gate and confirmation panel execute on controlled bridge reads.',
      'Each checkpoint follows a completed or rejected bridge reply. Native replies that never settle and installed PackageInstaller delivery remain separate.']}));
}

test('the Android startup gate holds mount through uncertain and foreign update readbacks', {timeout: 60000}, async () => {
  const receipt = await checkStartupUpdateAdmission();
  assert.equal(receipt.traceInputs.length, 4);
  assert.equal(receipt.observedFields.length, 9);
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
});
