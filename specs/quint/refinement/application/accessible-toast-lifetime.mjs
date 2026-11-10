import assert from 'node:assert/strict';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {stripTypeScriptTypes} from '../../../../test/support/strip-types.mjs';
import {checkTraces, qset} from '../check-traces.mjs';
import {boundInputs, captureSources, checkpoint, deferred, read, tick, trace, call} from './support.mjs';

const model = 'AccessibleToastLifetime';
const timeoutPath = 'apps/app/src/runtime/accessibility-timeout.ts';
const shellPath = 'apps/app/src/prototype/model.js';
const timeoutCode = () => stripTypeScriptTypes(read(timeoutPath), {mode: 'strip'})
  .replace(/^import .*;\r?\n/gm, '')
  .replace(/^export /gm, '');
const shellCode = () => {
  const text = read(shellPath);
  const start = text.indexOf('  later(fn, ms, grp)');
  const end = text.indexOf('  /* ---- per-app state ---- */', start);
  assert.ok(start > 0 && end > start);
  assert.match(text, /import \{ accessibilityTimeoutScale \} from '\.\.\/runtime\/accessibility-timeout';/);
  return text.slice(start, end);
};

function fixture(name, code) {
  let timerId = 0;
  const timers = new Map();
  const pending = new Map();
  const requests = new Map();
  const running = new Map();
  let requestId, resumed;
  const context = vm.createContext({
    setTimeout(callback, delay) {
      timers.set(++timerId, {callback, delay});
      return timerId;
    },
    clearTimeout(id) { timers.delete(id); },
  });
  code.runInContext(context);
  const {refresh, start, scale, latest, ShellTimers} = context.api;
  const shell = new ShellTimers();
  shell.state = {toast: '', toastUndo: false};
  shell.setState = (patch, committed) => {Object.assign(shell.state, patch); committed?.();};
  const observe = () => ({
    'state.scale': Math.round(scale() * 100),
    'state.latest': [...requests].find(([, owner]) => owner === latest())?.[0] ?? 0,
    'state.started': qset(requests.keys()),
    'state.pending': qset(pending.keys()),
    'state.message': shell.state.toast ? Number(shell.state.toast[0]) : 0,
    'state.undo': typeof shell.undoFn === 'function',
    'state.duration': shell.state.toast ? shell.toastDuration : 0,
    'state.held': !!shell.toastHeld,
    'state.timerDelay': timers.values().next().value?.delay ?? 0,
    'state.queued': Array.from(shell.toastQueue ?? [], row => ({message: Number(row.msg[0]), undo: typeof row.undo === 'function'})),
  });
  const result = trace(name, observe());
  const save = (label, ...action) => {
    assert.equal(shell.state.toastUndo, typeof shell.undoFn === 'function');
    assert.equal(timers.size, Number(Boolean(shell.state.toast) && !shell.toastHeld));
    checkpoint(result, label, call(...action), observe());
  };
  const port = {
    recommendedTimeout(options) {
      assert.equal(options.baseMs, 5000);
      assert.equal(pending.has(requestId), false);
      const reply = deferred();
      pending.set(requestId, reply);
      requests.set(requestId, latest());
      return reply.promise;
    },
  };
  return {
    result,
    request(id, via = 'direct') {
      requestId = id;
      if (via === 'boot') {
        start({async addListener(event, callback) {
          assert.equal(event, 'appResumed');
          resumed = callback;
        }}, port);
      } else if (via === 'resume') {
        assert.equal(typeof resumed, 'function');
        resumed();
      } else running.set(id, refresh(port));
      assert.ok(pending.has(id));
      save('read Android recommended timeout at ' + via, 'request', id);
    },
    async reply(id, value, expectedScale) {
      const reply = pending.get(id);
      assert.ok(reply);
      if (value === 'reject') reply.reject(Error('Fixture native refusal'));
      else reply.resolve({timeoutMs: value});
      await tick();
      pending.delete(id);
      if (running.has(id)) assert.equal(await running.get(id), scale());
      const valid = typeof value === 'number' && Number.isFinite(value) && value > 0;
      save('settle exact native read', 'reply', id, valid ? Math.max(100, value / 50) : 0);
      if (expectedScale !== undefined) assert.equal(scale(), expectedScale);
    },
    async reset() {
      assert.equal(await refresh(null), 1);
      save('non-native reset retires older reads', 'reset');
    },
    show(message, undo) {
      shell.toast(message === 3 ? '3'.repeat(191) : String(message), undo ? {undo() { assert.fail('expiration must never invoke Undo'); }} : undefined);
      save('the actual shell schedules or replaces a toast', 'show', message, undo);
    },
    expire() {
      const [id, timer] = timers.entries().next().value;
      timers.delete(id);
      timer.callback();
      save('the shell expiry clears message and undo', 'expire');
    },
    hold() {shell.holdToast(); save('focus cancels the owned expiry', 'hold');},
    resume() {shell.resumeToast(); save('leaving focus reuses the captured duration', 'resume');},
  };
}

export async function checkAccessibleToastLifetime() {
  const sources = [fileURLToPath(import.meta.url), timeoutPath, shellPath, 'apps/app/src/main.tsx',
    'android/app/src/main/java/ai/alphacompute/alphaphone/AlphaDevicePlugin.java'];
  captureSources(sources);
  const code = new vm.Script(`${timeoutCode()}
class ShellTimers {${shellCode()}}
globalThis.api = {refresh: refreshAccessibilityTimeout, start: startAccessibilityTimeout,
  scale: accessibilityTimeoutScale, latest: () => latestRefresh, ShellTimers};`);
  const traces = [];
  async function run(name, sequence) {
    const owner = fixture(name, code);
    await sequence(owner);
    traces.push(owner.result);
  }
  await run('stale_boot_after_resume', async f => {
    f.request(1, 'boot'); f.request(2, 'resume');
    await f.reply(2, 30000, 6); await f.reply(1, 5000, 6);
    f.show(1, true); f.expire();
  });
  await run('stale_reply_after_non_native_reset', async f => {
    f.request(1); await f.reset(); await f.reply(1, 30000, 1); f.show(1, false); f.expire();
  });
  await run('malformed_or_failed_reply_keeps_scale', async f => {
    f.request(1); await f.reply(1, 7500, 1.5); f.show(1, false);
    f.request(2); await f.reply(2, 'unknown', 1.5);
    f.request(3); await f.reply(3, 'reject', 1.5); f.show(2, true); f.expire();
  });
  await run('latest_reply_changes_future_toasts_only', async f => {
    f.show(1, true); f.request(1); await f.reply(1, 15000, 3);
    f.show(2, false); f.expire();
  });
  await run('valid_replies_never_shorten_base', async f => {
    f.request(1); await f.reply(1, 10000, 2); f.show(1, true);
    f.request(2); await f.reply(2, 1000, 1); f.show(2, false); f.expire();
  });
  await run('newest_rejection_still_retires_older_reply', async f => {
    f.request(1); await f.reply(1, 10000, 2);
    f.request(2); f.request(3); await f.reply(3, 'reject', 2); await f.reply(2, 30000, 2);
    f.show(1, true); f.expire();
  });
  await run('long_message_focus_hold_keeps_captured_duration', async f => {
    f.show(3, false); f.hold(); f.request(1); await f.reply(1, 30000, 6); f.resume(); f.expire();
  });
  await run('passive_notices_preserve_current_undo', async f => {
    f.show(1, true); f.show(2, false); f.show(3, false); f.expire(); f.expire();
  });
  await run('every_queued_undo_keeps_its_own_slot', async f => {
    f.show(1, true); f.show(2, true); f.show(3, false); f.expire(); f.expire(); f.expire();
  });

  return checkTraces(boundInputs({model, modelPath: 'specs/quint/application/AccessibleToastLifetime.qnt',
    sources, traces, scope: 'bounded-component',
    assumptions: ['Bounded reply values and three unique read identities per trace.',
      'Actual Android AccessibilityManager and TalkBack behavior need installed observation.',
      'Hold/resume execute actual shell callbacks. Replacement while DOM focus remains inside, focus-return delivery, Undo selection and browser scheduling latency are covered separately by rendered browser checks.']}));
}
