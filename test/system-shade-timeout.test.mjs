import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from './support/strip-types.mjs';

// The bounded port and the Android request run from source against the shared shade policy at the
// pin, with the plugin supplied by the test. What Android does with a request is device evidence.
const shared = await import('../.eliza/client-features/plugins/plugin-native-system/src/client/shade.ts');
const source = readFileSync('apps/app/src/prototype/system-shade.ts', 'utf8');
const portStart = source.indexOf('export const SHADE_REQUEST_TIMEOUT'), portEnd = source.indexOf('/** Reads what a pull started on.');
const askStart = source.indexOf('  p.expandAndroidShade = async function () {'), askEnd = source.lastIndexOf('}');
assert.ok(portStart > 0 && portEnd > portStart && askStart > portEnd && askEnd > askStart);
const module = `${source.slice(portStart, portEnd)}\nexport function install(p, device, requestNotificationShade, ALPHA_SHADE_COPY) {\n${source.slice(askStart, askEnd)}\n}`;
const m = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(module)).toString('base64'));
const copy = shared.defaultShadeFallbackCopy('Alpha');
const fallback = shared.shadeFallback('unsupported', copy);
const install = (shell, device) => m.install(shell, device, shared.requestNotificationShade, copy);
const settle = () => new Promise(resolve => setImmediate(resolve));

test('Android’s answer passes through when it arrives in time; a failure stays a failure', async () => {
  assert.deepEqual(await m.shadePortWithin({openNotificationShade: async () => ({status: 'opened'})}).openNotificationShade(), {status: 'opened'});
  assert.equal(await m.shadePortWithin({openNotificationShade: async () => undefined}).openNotificationShade(), undefined);
  await assert.rejects(m.shadePortWithin({openNotificationShade: async () => { throw Error('refused'); }}).openNotificationShade(), /refused/);
  await assert.rejects(m.shadePortWithin({openNotificationShade() { throw Error('no bridge'); }}).openNotificationShade(), /no bridge/);
});

test('a request Android never answers reads as unsupported at the limit, and a late answer changes nothing', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  let answer, outcome;
  void m.shadePortWithin({openNotificationShade: () => new Promise(resolve => { answer = resolve; })}).openNotificationShade().then(value => { outcome = value; });
  await settle();
  t.mock.timers.tick(m.SHADE_REQUEST_TIMEOUT - 1); await settle();
  assert.equal(outcome, undefined);
  t.mock.timers.tick(1); await settle();
  assert.deepEqual(outcome, {status: 'unsupported'});
  answer({status: 'opened'}); await settle();
  assert.deepEqual(outcome, {status: 'unsupported'});
});

test('a hung shade request shows the fallback once and the next pull asks Android again', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const toasts = [], pending = [];
  const shell = {toast: message => toasts.push(message)};
  install(shell, {openNotificationShade: () => new Promise(resolve => pending.push(resolve))});
  void shell.expandAndroidShade(); await settle();
  void shell.expandAndroidShade(); await settle();
  assert.equal(pending.length, 1, 'one request while Android has not answered');
  assert.equal(shell.alphaShadeAsking, true);
  t.mock.timers.tick(m.SHADE_REQUEST_TIMEOUT); await settle();
  assert.equal(shell.alphaShadeAsking, false);
  assert.ok(fallback);
  assert.deepEqual(toasts, [fallback]);
  const second = shell.expandAndroidShade(); await settle();
  assert.equal(pending.length, 2);
  pending[1]({status: 'opened'}); await second;
  assert.equal(shell.alphaShadeAsking, false);
  assert.equal(toasts.length, 1, 'an opened shade shows no fallback');
});

test('a plugin that throws synchronously still releases the next pull', async () => {
  const toasts = [], shell = {toast: message => toasts.push(message)};
  install(shell, {openNotificationShade() { throw Error('no bridge'); }});
  await shell.expandAndroidShade();
  assert.equal(shell.alphaShadeAsking, false);
  assert.deepEqual(toasts, [fallback]);
});
