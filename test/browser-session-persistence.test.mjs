import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {stripTypeScriptTypes} from './support/strip-types.mjs';

// The extracted saver remains independently checked; production retains the stronger
// epoch/drain/React-commit writer while sharing its bounded retry and idle-poll semantics.
const load = async path => import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(readFileSync(path, 'utf8'))).toString('base64'));
const {createSessionSaver, saveRetryDelay, surfacePollIdle} = await load('apps/app/src/browser/browser-poll.ts');
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolveTick => setImmediate(resolveTick)); };

function saverHarness() {
  const h = {inputs: [1], enabled: true, time: 0, built: 0, writes: [], fail: false, value: {tabs: ['a']}};
  h.saver = createSessionSaver({
    inputs: () => h.inputs, enabled: () => h.enabled, now: () => h.time,
    snapshot: () => { h.built++; return h.value; },
    write: async snapshot => { h.writes.push(snapshot); if (h.fail) throw new Error('store'); },
  });
  return h;
}

test('an idle poll builds no snapshot', async () => {
  const h = saverHarness();
  h.saver.prime();
  const built = h.built;
  for (let tick = 0; tick < 50; tick++) h.saver.save();
  await settle();
  assert.equal(h.built, built);
  assert.equal(h.writes.length, 0);
  h.inputs = [2]; h.value = {tabs: ['a', 'b']};
  for (let tick = 0; tick < 50; tick++) h.saver.save();
  await settle();
  assert.equal(h.built, built + 1, 'one snapshot for one change');
  assert.deepEqual(h.writes, [{tabs: ['a', 'b']}]);
  h.inputs = [3];
  h.saver.save(); await settle();
  assert.equal(h.writes.length, 1, 'an unchanged snapshot is not written again');
});

test('nothing is built or written while saving is disabled, and the change is kept', async () => {
  const h = saverHarness();
  h.enabled = false;
  for (let tick = 0; tick < 20; tick++) h.saver.save();
  assert.equal(h.built, 0);
  h.enabled = true; h.saver.save(); await settle();
  assert.equal(h.writes.length, 1);
});

test('a rejected save backs off instead of repeating on every poll', async () => {
  const h = saverHarness();
  h.fail = true;
  h.saver.save(); await settle();
  assert.equal(h.writes.length, 1);
  for (let tick = 0; tick < 19; tick++) { h.time += 100; h.saver.save(); await settle(); }
  assert.equal(h.writes.length, 1, 'no retry inside the first 2 s');
  const built = h.built;
  h.saver.save();
  assert.equal(h.built, built, 'a waiting retry builds nothing');
  h.time = 2000; h.saver.save(); await settle();
  assert.equal(h.writes.length, 2);
  h.time = 5999; h.saver.save(); await settle();
  assert.equal(h.writes.length, 2, 'the second wait is 4 s');
  h.time = 6000; h.saver.save(); await settle();
  assert.equal(h.writes.length, 3);
  // A changed snapshot is written at once; success ends the backoff.
  h.inputs = [2]; h.value = {tabs: ['c']}; h.fail = false; h.time = 6100;
  h.saver.save(); await settle();
  assert.equal(h.writes.length, 4);
  h.time = 1e9; h.saver.save(); await settle();
  assert.equal(h.writes.length, 4, 'a stored snapshot is not retried');
});

test('retry delay doubles from 2 s to at most 60 s', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 500].map(saveRetryDelay), [2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
  for (const odd of [0, -3, NaN, undefined]) assert.equal(saveRetryDelay(odd), 2000);
});

test('the poll is idle only off the Browser view with the page already hidden', () => {
  assert.equal(surfacePollIdle('home', 'hidden', 'hidden'), true);
  assert.equal(surfacePollIdle(undefined, 'hidden', 'hidden'), true);
  assert.equal(surfacePollIdle('browser', 'hidden', 'hidden'), false);
  assert.equal(surfacePollIdle('home', '', 'hidden'), false, 'geometry must be resent first');
  assert.equal(surfacePollIdle('home', '{"id":"b1"}', 'hidden'), false);
});

test('a question dialog that cannot open removes itself and its listeners', async () => {
  const {JSDOM} = createRequire(import.meta.url)('jsdom');
  const dom = new JSDOM('<div class="os"><button id="opener"></button></div>');
  const names = ['window', 'document', 'HTMLElement', 'getComputedStyle'], previous = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  const directory = mkdtempSync(join(tmpdir(), 'content-question-'));
  try {
    for (const name of names) Object.defineProperty(globalThis, name, {configurable: true, writable: true, value: name === 'window' ? dom.window : dom.window[name]});
    globalThis.getComputedStyle = element => dom.window.getComputedStyle(element);
    const bundle = await build({entryPoints: [resolve('apps/app/src/browser/content-question.ts')], bundle: true, format: 'esm', platform: 'node', write: false,
      plugins: [{name: 'ports', setup(b) { b.onResolve({filter: /local-ocr$/}, args => ({path: args.path, namespace: 'fixture'})); b.onLoad({filter: /.*/, namespace: 'fixture'}, () => ({contents: 'export const recognizeLocalText=async()=>({text:""});'})); }}]});
    const file = join(directory, 'content-question.mjs');
    writeFileSync(file, bundle.outputFiles[0].text);
    const {reviewContentQuestion} = await import(pathToFileURL(file));
    dom.window.HTMLDialogElement.prototype.showModal = function () { throw new dom.window.DOMException('cannot open', 'InvalidStateError'); };
    const closed = [];
    const open = () => reviewContentQuestion({name: 'Example', text: 'page text', current: () => true, compose() {}, closed: dismissed => closed.push(dismissed)});
    assert.throws(open, /cannot open/);
    assert.deepEqual(closed, [false], 'the caller is told once that the review is gone');
    assert.equal(dom.window.document.querySelector('dialog'), null);
    const back = new dom.window.Event('alpha-back', {cancelable: true});
    dom.window.dispatchEvent(back);
    assert.equal(back.defaultPrevented, false, 'no Back handler is left behind');
    // A dialog that opens still stays open and owns Back until dismissed.
    dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    const close = open();
    assert.ok(dom.window.document.querySelector('.os dialog'));
    const owned = new dom.window.Event('alpha-back', {cancelable: true});
    dom.window.dispatchEvent(owned);
    assert.equal(owned.defaultPrevented, true);
    close();
    assert.deepEqual(closed, [false, true]);
  } finally {
    names.forEach((name, index) => { if (previous[index]) Object.defineProperty(globalThis, name, previous[index]); else delete globalThis[name]; });
    rmSync(directory, {recursive: true, force: true});
  }
});
