import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {stripTypeScriptTypes} from '../../../../test/support/strip-types.mjs';
import {checkTraces, qset} from '../check-traces.mjs';
import {checkClientFeatures} from '../../../../scripts/prepare-client-features.mjs';
import {boundInputs, captureSources, checkpoint, deferred, read, tick, trace, call} from './support.mjs';

const model = 'MountedUpdateAdmission';
const modelPath = 'specs/quint/application/MountedUpdateAdmission.qnt';
const shared = 'packages/ui/src/state/app-update-gate.ts';
const effective = '.eliza/client-features/' + shared;
const projection = '.eliza/client-features/.source.json';
const main = 'apps/app/src/main.tsx';
const activations = ['', '11111111-2222-4333-8444-555555555555', '22222222-2222-4333-8444-555555555555'];
const bridges = ['', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee'];
const draftOwners = ['Composer', 'Calendar', 'Notes', 'Inbox', 'Workflows'];
const appearance = {
  dialogClass: 'alpha-update-startup', dialogLabel: 'App update',
  pendingLabel: 'Updating Alpha…', continueLabel: 'Continue update',
  navigationEvents: ['alpha-back', 'launcher-home'],
};

async function fixture(name, code) {
  const dom = new JSDOM('<main><textarea>Current draft</textarea></main>');
  const {window} = dom, {document} = window;
  const reads = [], waits = [], positive = new Set(), negative = new Set();
  const pending = new Map(), restarts = [], continues = [];
  let listener, continuation, notices = 0, failModal = false, busy = false;
  window.HTMLDialogElement.prototype.showModal = function () {
    if (failModal) throw Error('Fixture modal refused');
    this.setAttribute('open', '');
  };
  window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  const currentActivation = () => activations.indexOf(context.inspect().active?.activationId ?? '');
  const owner = {live: true,S:()=>({screen:'home',view:null,voice:'off',typing:busy,chat:'input'}),voiceConversationActive:()=>false};
  for (const name of draftOwners) {
    owner['flush' + name + 'ForAppUpdate'] = current => {
      assert.equal(current(), true);
      const id = currentActivation();
      if (!pending.has(id)) pending.set(id, {barrier: deferred(), flushes: []});
      const {barrier, flushes} = pending.get(id);
      assert.equal(flushes.includes(name), false);
      flushes.push(name);
      return barrier.promise;
    };
  }
  const context = vm.createContext({
    window, document, HTMLElement: window.HTMLElement, fixtureShell: owner,
    connectionController: {
      getSnapshot: () => ({busy: false}),
      captureAppUpdateReconnect() {
        const id = currentActivation();
        return async stillSettled => restarts.push({id, stillSettled});
      },
    },
    setTimeout(callback, delay) {
      assert.equal(delay, 1000);
      waits.push(callback);
      return waits.length;
    },
  });
  code.runInContext(context);
  const port = {
    updateState() {
      const next = deferred();
      reads.push(next);
      return next.promise;
    },
    async addListener(event, notify) {
      assert.equal(event, 'alphaUpdateReady');
      listener = notify;
      return {async remove() {}};
    },
    async activateUpdate(value) {
      const id = activations.indexOf(value.activationId);
      assert.ok(id > 0);
      assert.equal(value.bridgeId, context.inspect().active.bridgeId);
      assert.equal(positive.has(id) || negative.has(id), false);
      if (value.ready) assert.equal(value.resumeEligible, true);
      else assert.equal(Object.hasOwn(value, 'resumeEligible'), false);
      (value.ready ? positive : negative).add(id);
    },
    continueUpdate(value) {
      assert.equal(continuation, undefined);
      const id = activations.indexOf(value.activationId);
      assert.equal(id, currentActivation());
      assert.equal(value.bridgeId, context.inspect().active.bridgeId);
      continues.push(id);
      continuation = deferred();
      return continuation.promise;
    },
  };
  await context.watch(port, appearance, context.prepare, () => { notices++; });
  const block = name => {
    const event = new window.Event(name, {cancelable: true});
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };
  const button = () => document.querySelector('dialog[open] button');
  const observe = () => {
    const {active, acknowledged, reconnect, localRefusal} = context.inspect();
    assert.equal(block('alpha-back'), block('launcher-home'));
    for (const request of pending.values()) assert.deepEqual(request.flushes, draftOwners);
    return {
      'state.automatic': active?.automatic === true,
      'state.active': currentActivation(),
      'state.bridge': bridges.indexOf(active?.bridgeId ?? ''),
      'state.phase': active?.phase ?? 'idle',
      'state.panel': Boolean(document.querySelector('dialog[open]')),
      'state.canContinue': Boolean(button() && !button().hidden),
      'state.acknowledged': activations.indexOf(acknowledged ?? ''),
      'state.pending': qset(pending.keys()),
      'state.positive': qset(positive),
      'state.negative': qset(negative),
      'state.reconnect': reconnect ? activations.indexOf(acknowledged) : 0,
      'state.localRefusal': localRefusal,
      'state.restarts': restarts.map(result => result.id),
      'state.notices': notices,
      'state.continuing': Boolean(continuation),
      'state.continues': [...continues],
      navigationBlocked: block('alpha-back'),
    };
  };
  const result = trace(name, observe());
  const save = async (label, ...action) => {
    await tick();
    checkpoint(result, label, call(...action), observe());
  };
  async function readBack(row) {
    if (!reads.length) {
      const wait = waits.shift();
      assert.ok(wait, 'active update must have an exact read or a poll scheduled');
      wait();
      await tick();
    }
    const read = reads.shift();
    assert.ok(read);
    if (row === undefined) read.reject(Error('Fixture readback unavailable'));
    else read.resolve(row);
  }
  const entry = (id, bridge, phase) => ({activationId: activations[id], bridgeId: bridges[bridge], phase});
  return {
    result,
    end: () => window.close(),
    async notify(id, bridge, phase, show = true, automatic = false) {
      failModal = !show;
      listener({...entry(id, bridge, phase),automatic});
      await save('an exact Android readiness event freezes mounted navigation', 'notify', id, bridge, phase, show, automatic);
    },
    async pending(id, bridge, phase, canContinue = false, show = true, automatic = false) {
      failModal = !show;
      await readBack({pending: true, ...entry(id, bridge, phase), canContinue, automatic});
      await save('the native readback owns the mounted activation and local draft flush', 'readPending', id, bridge, phase, canContinue, show, automatic);
    },
    async finish(id, ready, replaceOwner = false) {
      const request = pending.get(id);
      assert.ok(request);
      pending.delete(id);
      if (replaceOwner) context.replace();
      if (ready || replaceOwner) request.barrier.resolve();
      else request.barrier.reject(Error('Fixture draft flush refused'));
      await save('the five mounted draft owners settle, with exact shell and activation guards', 'prepared', id, ready);
    },
    async finishWhileBusy(id) {
      const request = pending.get(id); assert.ok(request);
      pending.delete(id); busy = true; request.barrier.resolve();
      await save('new foreground work retires automatic readiness after draft flush', 'prepared', id, false);
    },
    async terminal(id, bridge, outcome, idle = false, resume = false) {
      await readBack({pending: false, bridgeId: bridges[bridge], activationId: activations[id],
        outcome: outcome === 'unknown' ? undefined : outcome, idle, resume});
      await save('terminal or idle readback can release only its current bridge', 'readTerminal', id, bridge, outcome, idle, resume);
    },
    async uncertain() {
      await readBack(undefined);
      await save('unavailable native status retains the current freeze', 'readUncertain');
    },
    async clickContinue() {
      button()?.click();
      await save('the modal coalesces repeated Continue clicks for one native request', 'clickContinue');
    },
    async finishContinue(ok) {
      const request = continuation;
      assert.ok(request);
      continuation = undefined;
      if (ok) request.resolve();
      else request.reject(Error('Fixture continuation refused'));
      await save('continue completion waits for canonical native readback', 'continued');
    },
    assertReconnectPermitted(value) {
      assert.equal(restarts.at(-1)?.stillSettled(), value);
    },
  };
}

export async function checkMountedUpdateAdmission() {
  const sources = [fileURLToPath(import.meta.url), main, 'apps/app/src/prototype/settings-adapter.ts', 'vendor/eliza/' + shared, effective, projection,
    'android/app/src/main/java/ai/alphacompute/alphaphone/AlphaDevicePlugin.java',
    'upstream.lock.json', 'scripts/prepare-client-features.mjs', 'scripts/pinned-upstream-source.mjs',
    'patches/eliza/app-update-resume-client.patch', 'patches/eliza/app-update-resume-client-manifest.json'];
  captureSources([...sources, modelPath]);
  checkClientFeatures();
  const gate = read(effective);
  const stamp = JSON.parse(read(projection));
  const digest = createHash('sha256').update(gate).digest('hex');
  assert.equal(stamp.files[shared], digest);
  assert.equal(stamp.appUpdateResumePatch.afterSha256, digest);
  const pinned = createHash('sha256').update(read('vendor/eliza/' + shared)).digest('hex');
  assert.equal(stamp.sourceFiles[shared], pinned);
  assert.equal(stamp.appUpdateResumePatch.beforeSha256, pinned);
  const text = read(main);
  const settings = read('apps/app/src/prototype/settings-adapter.ts');
  const idleStart=settings.indexOf('export function automaticUpdateIdle(');
  const idlePolicy=settings.slice(idleStart,settings.indexOf('\n}',idleStart)+2).replace(/^export /,'');
  const start = text.indexOf('async function prepareMountedUpdate(');
  const end = text.indexOf('\nlet nativeAppUpdateGate', start);
  assert.ok(start > 0 && end > start);
  const marker = '  let notified = false;';
  assert.equal(gate.split(marker).length, 2);
  const inspect = '  globalThis.inspect = () => ({active, acknowledged, reconnect, localRefusal});';
  const prepared = gate.replace(marker, marker + '\n' + inspect).replace(/^export /gm, '');
  const code = new vm.Script(stripTypeScriptTypes(`
let shell = fixtureShell;
${idlePolicy}
${text.slice(start, end)}
${prepared}
globalThis.watch = watchMountedAppUpdates;
globalThis.prepare = prepareMountedUpdate;
globalThis.replace = () => { shell = {live: true}; };
`, {mode: 'strip'}));
  const traces = [];
  async function run(name, sequence) {
    const owner = await fixture(name, code);
    try {
      await sequence(owner);
      traces.push(owner.result);
    } finally { owner.end(); }
  }
  await run('foreign_read_and_old_draft_completion_cannot_retire_successor', async f => {
    await f.notify(1, 1, 'preparing'); await f.pending(1, 1, 'preparing');
    await f.pending(1, 2, 'paused', true); await f.pending(2, 1, 'preparing');
    await f.finish(1, true); await f.finish(2, false);
    await f.terminal(2, 2, 'failed', true); await f.terminal(2, 1, 'failed');
  });
  await run('exact_cancel_owns_reconnect_and_continue_is_single_flight', async f => {
    await f.pending(1, 1, 'preparing'); await f.finish(1, true);
    await f.clickContinue(); await f.pending(1, 1, 'paused', true);
    await f.clickContinue(); await f.clickContinue(); await f.finishContinue(false);
    await f.clickContinue(); await f.finishContinue(true);
    await f.terminal(2, 1, 'canceled', false, true);
    await f.terminal(1, 1, 'canceled', false, true); f.assertReconnectPermitted(true);
    await f.notify(2, 1, 'paused'); f.assertReconnectPermitted(false);
    await f.terminal(2, 1, 'installed');
  });
  await run('same_bridge_idle_releases_without_reconnect', async f => {
    await f.pending(1, 1, 'preparing'); await f.finish(1, true); await f.uncertain();
    await f.terminal(2, 1, 'unknown', true, true);
  });
  await run('terminal_before_editor_flush_discards_late_readiness', async f => {
    await f.pending(1, 1, 'preparing'); await f.terminal(1, 1, 'canceled', false, true);
    await f.finish(1, true);
  });
  await run('failed_modal_cannot_acknowledge_ready', async f => {
    await f.notify(1, 1, 'preparing', false);
    await f.pending(1, 1, 'preparing', false, false);
    await f.uncertain(); await f.terminal(1, 1, 'failed');
  });
  await run('shell_replacement_refuses_before_acknowledgement', async f => {
    await f.pending(1, 1, 'preparing'); await f.finish(1, false, true);
    await f.terminal(1, 1, 'failed');
  });
  await run('automatic_download_cannot_interrupt_new_foreground_work', async f => {
    await f.pending(1, 1, 'preparing',false,true,true);
    await f.finishWhileBusy(1);
    await f.terminal(1, 1, 'failed');
  });

  return checkTraces(boundInputs({model, modelPath, sources, traces, scope: 'bounded-orchestration',
    assumptions: ['Exact prepared mounted-update gate and Alpha draft-flush orchestration execute with controlled Android readbacks and draft promises.',
      'Two unique activation IDs and two bridge identities. DOM modality and native readback timers are controlled.',
      'Installed Android PackageInstaller callbacks and physical persistence of each draft store require separate evidence.']}));
}
