import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../apps/app/src/prototype/model.js', import.meta.url), 'utf8');
const start = source.indexOf('  later(fn, ms, grp)');
const end = source.indexOf('  /* ---- per-app state ---- */', start);
assert.ok(start > 0 && end > start);

function shell(document, {deferCommit = false} = {}) {
  let timerId = 0;
  const timers = new Map(), commits = [];
  const context = vm.createContext({
    document,
    accessibilityTimeoutScale: () => 1,
    setTimeout(callback, delay) { timers.set(++timerId, {callback, delay}); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  });
  vm.runInContext(`class Shell {${source.slice(start, end)}}\nglobalThis.Shell = Shell;`, context);
  const owner = new context.Shell();
  owner.state = {toast: '', toastUndo: false};
  owner.setState = (patch, done) => { Object.assign(owner.state, patch); if (done) { if (deferCommit) commits.push(done); else done(); } };
  const expire = () => {
    assert.equal(timers.size, 1);
    const [id, timer] = timers.entries().next().value;
    timers.delete(id);
    timer.callback();
  };
  return {owner, timers, expire, commit: () => commits.shift()?.()};
}

test('a message without Undo waits behind a visible Undo offer', () => {
  const {owner, timers, expire} = shell(undefined);
  let undone = 0;
  owner.toast('Note deleted', {undo() { undone += 1; }});
  owner.toast('Turn left onto Pine Street');
  owner.toast('Arriving at Cafe');
  assert.deepEqual({...owner.state}, {toast: 'Note deleted', toastUndo: true});
  assert.equal(typeof owner.undoFn, 'function');
  assert.equal(timers.size, 1);
  assert.equal(timers.values().next().value.delay, 10000);

  expire();
  assert.deepEqual({...owner.state}, {toast: 'Arriving at Cafe', toastUndo: false});
  assert.equal(owner.undoFn, null);
  assert.equal(timers.values().next().value.delay, 1900);
  expire();
  assert.deepEqual({...owner.state}, {toast: '', toastUndo: false});
  assert.equal(timers.size, 0);
  assert.equal(undone, 0);
});

test('Undo still runs after a later message, and the waiting message follows it', () => {
  const {owner, timers} = shell(undefined);
  let undone = 0;
  owner.toast('Note deleted', {undo() { undone += 1; }});
  owner.toast('Model ready');
  const undo = owner.undoFn;
  owner.closeToast();
  undo();
  assert.equal(undone, 1);
  assert.deepEqual({...owner.state}, {toast: 'Model ready', toastUndo: false});
  assert.equal(timers.size, 1);
});

test('each Undo offer remains available and keeps the waiting message in order', () => {
  const {owner, expire} = shell(undefined);
  const second = () => {};
  owner.toast('Note deleted', {undo() {}});
  owner.toast('Model ready');
  owner.toast('Folder deleted', {undo: second});
  assert.deepEqual({...owner.state}, {toast: 'Note deleted', toastUndo: true});
  assert.notEqual(owner.undoFn, second);
  expire();
  assert.deepEqual({...owner.state}, {toast: 'Model ready', toastUndo: false});
  expire();
  assert.deepEqual({...owner.state}, {toast: 'Folder deleted', toastUndo: true});
  assert.equal(owner.undoFn, second);
});

test('messages without Undo still replace each other at once', () => {
  const {owner, timers} = shell(undefined);
  owner.toast('Saved');
  owner.toast('Link copied');
  assert.deepEqual({...owner.state}, {toast: 'Link copied', toastUndo: false});
  assert.equal(owner.toastQueued ?? null, null);
  assert.equal(timers.size, 1);
});

test('focus on the removed Undo button does not hold the waiting message', () => {
  const button = {closest: selector => selector === '[data-alpha-toast]' ? {} : null};
  const document = {activeElement: null, body: {}};
  const {owner, timers} = shell(document);
  owner.toast('Note deleted', {undo() {}});
  document.activeElement = button;
  owner.holdToast();
  owner.toast('Model ready');
  assert.equal(timers.size, 0);
  owner.closeToast();
  assert.deepEqual({...owner.state}, {toast: 'Model ready', toastUndo: false});
  assert.equal(owner.toastHeld, false);
  assert.equal(timers.size, 1);
});

test('a delayed close commit cannot replace a new retry Undo or lose the waiting offer', () => {
  const {owner, commit} = shell(undefined, {deferCommit: true});
  const queued = () => {}, retry = () => {};
  owner.toast('First deletion', {undo() {}});
  owner.toast('Second deletion', {undo: queued});
  owner.closeToast();
  // Undo can fail synchronously and offer a retry before React commits the old close.
  owner.toast('Restore failed. Retry Undo', {undo: retry});
  commit();
  assert.equal(owner.state.toast, 'Restore failed. Retry Undo');
  assert.equal(owner.undoFn, retry);
  assert.equal(owner.toastQueue.length, 1);
  owner.closeToast();
  commit();
  assert.equal(owner.state.toast, 'Second deletion');
  assert.equal(owner.undoFn, queued);
  assert.equal(owner.toastQueue.length, 0);
});
