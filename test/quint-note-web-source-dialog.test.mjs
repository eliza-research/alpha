import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {loadProductModule, modelTraces, replayTraces, settle, witnessTraces} from '../specs/quint/refinement/application/notes-files-media-itf.mjs';

// NoteWebSourceDialog against installNoteWebSourceAdapter in
// apps/app/src/prototype/note-web-source-adapter.ts, mounted in a DOM.
// Ports: the Notes view api (the reviewed visit and the note save) and page visibility.

const source = 'apps/app/src/prototype/note-web-source-adapter.ts';
const globals = ['window', 'document', 'HTMLElement'];

async function replayNoteWebSourceDialog({rewrite, ...options} = {}) {
  const model = {path: 'specs/quint/application/NoteWebSourceDialog.qnt', main: 'NoteWebSourceDialog'};
  const traces = [...modelTraces({...model, ...options}), ...witnessTraces({...model, witnesses: ['VisitAbortedByCloseWitness', 'VisitedWitness',
    'RemovedWitness', 'UnconfirmedWitness', 'StalePressIgnoredWitness', 'AbandonedRemovalLandsWitness']})];
  const product = await loadProductModule(source, {rewrite});
  return replayTraces(traces, {
    required: ['openDialog', 'closeDialog', 'leaveNotes', 'enterNotes', 'hide', 'show', 'outsideEdit', 'act', 'visitSettles', 'removeSettles'],
    reached: {
      'a visit aborted by closing': ({s}) => s.op === 'visit' && !(s.opGen === s.gen && s.open),
      'a visit that closed its dialog': ({s}) => s.navigations > 0,
      'a saved removal': ({s}) => s.removals === 1,
      'an unconfirmed action': ({s}) => s.status === 'unconfirmed',
      'a press ignored by a stale or used dialog': ({s}) => s.refused > 0,
      'an abandoned removal landing under a newer dialog': ({s}) => !s.linked && s.open,
    },
    // The reviewed revision is closure state; a dialog's single action shows as disabled controls.
    project: ({s}) => ({visit: s.visit, hidden: s.hidden, rev: s.rev, linked: s.linked, gen: s.gen, open: s.open, busy: s.busy,
      status: s.status, op: s.op, edits: s.edits, navigations: s.navigations, removals: s.removals, refused: s.refused}),
    async start() {
      const dom = new JSDOM('<!doctype html><body></body>', {url: 'https://alpha.example/'}), {window} = dom;
      const saved = Object.fromEntries(globals.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
      window.HTMLElement.prototype.showModal ??= function () { this.setAttribute('open', ''); };
      let hidden = false, visit = true, rev = 0, gen = 0, edits = 0, navigations = 0, removals = 0, refused = 0, pending, dialog;
      Object.defineProperty(window.document, 'hidden', {configurable: true, get: () => hidden});
      for (const name of globals) Object.defineProperty(globalThis, name, {configurable: true, writable: true, value: name === 'window' ? window : window[name]});
      const notes = {open: 'note-1', list: [{id: 'note-1', kind: 'text', title: 'Summary', body: 'Body',
        webSource: {kind: 'web-page', version: 1, name: 'Example page', url: 'https://example.com/article'}}]};
      const wait = (kind, extra) => new Promise((resolve, reject) => { assert.equal(pending, undefined, 'two actions at once');pending = {kind, resolve, reject, ...extra}; });
      const api = {isActive: () => visit, get: () => notes,
        openReviewedWebSource: (_url, signal) => wait('visit', {signal}),
        saveImportedNote: patch => wait('remove').then(stored => { if (stored) { notes.list = patch.list;rev++;removals++; } return stored; })};
      const views = {notes: {render: () => ({}), onLeave() {}}};
      product.installNoteWebSourceAdapter(views);
      const button = index => dialog.querySelectorAll('footer button')[index];
      return {
        actions: {
          async openDialog() { views.notes.render(notes, api).openWebSource();gen++;dialog = window.document.querySelector('dialog');await settle(); },
          async closeDialog() { button(2).click();await settle(); },
          async leaveNotes() { visit = false;views.notes.onLeave(api);await settle(); },
          enterNotes() { visit = true; },
          async hide() { hidden = true;window.document.dispatchEvent(new window.Event('visibilitychange'));await settle(); },
          async show() { hidden = false;window.document.dispatchEvent(new window.Event('visibilitychange'));await settle(); },
          outsideEdit() { edits++;rev++;notes.list = notes.list.map(note => ({...note, body: `Edited ${edits}`})); },
          async act({kind}) {
            const before = pending;
            button(kind === 'visit' ? 0 : 1).click();await settle();
            if (pending === before) refused = Math.min(2, refused + 1);
          },
          async visitSettles({ok}) {
            const call = pending;pending = undefined;
            if (ok) { assert.equal(call.signal.aborted, false, 'the visit was aborted before it settled');navigations++;call.resolve(); }
            else call.reject(Object.assign(Error('The visit did not start.'), {name: call.signal.aborted ? 'AbortError' : 'Error'}));
            await settle();
          },
          async removeSettles({ok}) { const call = pending;pending = undefined;call.resolve(ok);await settle(); },
        },
        observe: () => ({visit, hidden, rev, linked: !!notes.list[0].webSource, gen, open: !!dialog?.isConnected,
          busy: dialog ? button(0).disabled : false,
          status: dialog?.querySelector('[role="status"]').textContent === 'Unconfirmed' ? 'unconfirmed' : 'none',
          op: pending?.kind ?? 'none', edits, navigations, removals, refused}),
        close() {
          for (const [name, descriptor] of Object.entries(saved)) if (descriptor) Object.defineProperty(globalThis, name, descriptor);else delete globalThis[name];
          window.close();
        },
      };
    },
  });
}

test('the mounted web source review follows every NoteWebSourceDialog model step', {timeout: scaledTimeout(240000)}, async () => {
  const receipt = await replayNoteWebSourceDialog({traces: 300, maxSteps: 20});
  assert.equal(receipt.traces, 306);
  assert.ok(receipt.steps > 2500, JSON.stringify(receipt));
  for (const action of ['openDialog', 'closeDialog', 'hide', 'act', 'visitSettles', 'removeSettles']) assert.ok(receipt.actions[action] > 0, action);
});
test('a web source review that acts on a changed note is rejected by the replay', {timeout: scaledTimeout(240000)}, async () => {
  await assert.rejects(replayNoteWebSourceDialog({traces: 300, maxSteps: 20, rewrite: {'prototype/note-web-source-adapter.ts': text =>
    text.replace('if(busy||!current())return;busy=true;', 'if(busy||closed)return;busy=true;')}}), /trace \d+ step \d+ /);
});
test('a web source review that stays open on a hidden page is rejected by the replay', {timeout: scaledTimeout(240000)}, async () => {
  await assert.rejects(replayNoteWebSourceDialog({traces: 300, maxSteps: 20, rewrite: {'prototype/note-web-source-adapter.ts': text =>
    text.replace('visibility=()=>{if(document.hidden)close();}', 'visibility=()=>{}')}}), /trace \d+ step \d+ hide/);
});
