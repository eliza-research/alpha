import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const {applyImageContacts} = await import('../apps/app/src/runtime/image-contacts.ts');

/** The shell's own masking rule: a deferred view is reported as no view (model.js S()). */
function shell(view, deferred) {
  const calls = [];
  const instance = {
    state: {view},
    S() { return {view: deferred.has(this.state.view) ? null : this.state.view}; },
    leave() { const current = this.S().view; if (current) calls.push(`leave:${current}`); },
    goHome() { this.leave(); this.state.view = null; calls.push('home'); },
  };
  return {instance, calls};
}
const admission = deferred => admitted => { if (admitted) deferred.delete('contacts'); else deferred.add('contacts'); };

test('losing Contacts admission while Contacts is open runs its leave hook and returns Home', () => {
  const deferred = new Set(), order = ['notes', 'contacts'];
  const {instance, calls} = shell('contacts', deferred);
  applyImageContacts(false, order, instance, admission(deferred));
  assert.deepEqual(calls, ['leave:contacts', 'home']);
  assert.equal(instance.state.view, null);
  assert.deepEqual(order, ['notes']);
  assert.ok(deferred.has('contacts'));
});

test('another open view is left alone, and admission is applied without a shell', () => {
  const deferred = new Set(), order = ['notes', 'contacts'];
  const {instance, calls} = shell('notes', deferred);
  applyImageContacts(false, order, instance, admission(deferred));
  assert.deepEqual(calls, []);
  assert.equal(instance.state.view, 'notes');
  applyImageContacts(true, order, undefined, admission(deferred));
  applyImageContacts(true, order, null, admission(deferred));
  assert.deepEqual(order, ['notes', 'contacts']);
  assert.equal(deferred.has('contacts'), false);
});

test('admitting Contacts never navigates', () => {
  const deferred = new Set(['contacts']), order = ['notes'];
  const {instance, calls} = shell(null, deferred);
  applyImageContacts(true, order, instance, admission(deferred));
  assert.deepEqual(calls, []);
  assert.deepEqual(order, ['notes', 'contacts']);
});

test('the Android resume path applies admission through this rule', () => {
  const main = readFileSync('apps/app/src/main.tsx', 'utf8');
  assert.match(main, /applyImageContacts\(admitted,ORDER,shell,admitImageContacts\)/);
  assert.equal(main.match(/admitImageContacts\(/g), null);
});
