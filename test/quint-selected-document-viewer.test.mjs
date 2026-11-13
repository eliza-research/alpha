import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {modelTraces, replayTraces, loadBundled, installDocument, countListeners, settle} from '../specs/quint/refinement/application/browser-model-traces.mjs';

/** Replays SelectedDocumentViewer traces against the real `openSelectedDocumentViewer` in a jsdom
 * document.
 *
 * Abstraction: viewer n is the dialog titled `Document n`; `open` lists the dialogs in document
 * order (the order they were opened); `listening` holds when the installed listeners number four
 * per open viewer; `opened` counts the calls and `closes` the owner's close notifications. */

const model = {path: 'specs/quint/application/SelectedDocumentViewer.qnt', module: 'SelectedDocumentViewer'};
const scenarios = ['closedOnceTest', 'backClosesOldestTest', 'hideClosesAllTest', 'openedWhileHiddenStaysTest', 'reopenTest'];
const witnesses = ['TwoViewersOpenWitness', 'OpenWhileHiddenWitness', 'ReopenedWitness'];

async function selectedDocumentViewerDriver() {
  const load = await loadBundled('apps/app/src/browser/selected-document-viewer.ts');
  return async () => {
    const dom = await installDocument('<!doctype html><body><button id="origin">Files</button></body>');
    const {window, document} = dom;
    const windowListeners = countListeners(window, ['alpha-back', 'pagehide', 'alpha:device-state']);
    const documentListeners = countListeners(document, ['visibilitychange']);
    const {openSelectedDocumentViewer} = await load();
    const opened = {1: 0, 2: 0}, closes = {1: 0, 2: 0}, closers = {};
    let ways = 0, changes = 0;
    const dialogs = () => [...document.querySelectorAll('dialog[aria-label="Selected document"]')];
    const number = dialog => Number(dialog.querySelector('h2').textContent.slice('Document '.length));
    const dialog = id => dialogs().find(item => number(item) === id);
    return {
      async openViewer(id) { opened[id]++; closers[id] = openSelectedDocumentViewer(`Document ${id}`, 'about:blank', () => { closes[id]++; }); await settle(); },
      async closeViewer(id) {
        const way = ways++ % 4;
        if (way === 0) dialog(id).querySelector('footer button').click();
        else if (way === 1) dialog(id).dispatchEvent(new window.Event('cancel'));
        else if (way === 2) dialog(id).dispatchEvent(new window.Event('close'));
        else closers[id]();
        await settle();
      },
      async closeAgain(id) { closers[id]?.(); await settle(); },
      async back() { window.dispatchEvent(new window.Event('alpha-back', {cancelable: true})); await settle(); },
      async hide() { dom.setHidden(true); await settle(); },
      async show() { dom.setHidden(false); await settle(); },
      async deviceChange() { window.dispatchEvent(new window.Event(changes++ % 2 ? 'pagehide' : 'alpha:device-state')); await settle(); },
      observe() {
        const open = dialogs().map(number), installed = windowListeners() + documentListeners();
        return {foreground: !document.hidden, open, listening: installed === 4 * open.length ? [...open].sort((a, b) => a - b) : `listeners ${installed}`,
          opened: {...opened}, closes: {...closes}};
      },
      teardown() { dom.restore(); },
    };
  };
}

async function checkSelectedDocumentViewer({random = 40, steps = 30} = {}) {
  const create = await selectedDocumentViewerDriver();
  const traces = modelTraces({...model, scenarios, witnesses, random, steps});
  return replayTraces(traces, create);
}

test('the selected document preview follows every SelectedDocumentViewer trace', {timeout: scaledTimeout(240000)}, async () => {
  const receipt = await checkSelectedDocumentViewer();
  assert.equal(receipt.traces, 48);
  assert.ok(receipt.checkpoints > 1000, `checkpoints ${receipt.checkpoints}`);
  for (const action of ['openViewer', 'closeViewer', 'closeAgain', 'back', 'hide', 'show', 'deviceChange'])
    assert.ok(receipt.actions[action] > 0, `${action} is replayed`);
});
