// NotesDocumentTransfer against installNotesDocumentAdapter in
// apps/app/src/prototype/notes-document-adapter.ts. Ports: the AlphaNoteDocuments plugin, the
// Notes view api and document visibility. Import is a developer surface, so the module is
// loaded with test mocks enabled.
import {loadProductModule, modelTraces, replayTraces, settle} from './notes-files-media-itf.mjs';

const source = 'apps/app/src/prototype/notes-document-adapter.ts';
const capped = value => Math.min(value, 3);

export async function replayNotesDocumentTransfer({rewrite, ...options} = {}) {
  const traces = modelTraces({path: 'specs/quint/application/NotesDocumentTransfer.qnt', main: 'NotesDocumentTransfer', ...options});
  const product = await loadProductModule(source, {rewrite, stubs: {
    '../build-flags': 'export const testMocksEnabled=true;',
    '../platform-plugins': 'export const registerPlugin=()=>({importText:()=>globalThis.__alphaNotesDocumentPorts.call("import"),exportText:input=>globalThis.__alphaNotesDocumentPorts.call("export",input)});',
    '../runtime/browser-note-documents': 'export class BrowserNoteDocuments{}',
  }});
  return replayTraces(traces, {
    required: ['choose', 'settles', 'leaveNotes', 'enterNotes', 'hide', 'show'],
    reached: {
      'a receipt waiting for a visible page': state => state.s.receipts.length > 0,
      'a result dropped after Notes was left': state => state.s.settled > 0 && state.s.shown + state.s.dropped + state.s.receipts.length < state.s.settled,
      'a receipt of an earlier visit dropped': state => state.s.dropped > 0,
      'an imported note with its receipt': state => state.s.imported > 0 && state.s.shown > 0,
      'a second choice refused': state => state.s.refusedBusy > 0,
    },
    // Waiting receipts are closures; their count is the number of visibility listeners held.
    project: ({s}) => ({...s, receipts: s.receipts.length, operation: s.operation.kind}),
    async start() {
      const saved = Object.getOwnPropertyDescriptor(globalThis, 'document'), listeners = new Set();
      let hidden = false, active = true, epoch = 0, busy = false, pending, stored = true;
      let shown = 0, dropped = 0, settled = 0, imported = 0, reads = 0, refusedBusy = 0, lastShownEpoch = -1;
      Object.defineProperty(globalThis, 'document', {configurable: true, value: {
        get hidden() { return hidden; },
        addEventListener(type, listener) { if (type === 'visibilitychange') listeners.add(listener); },
        removeEventListener(type, listener) { if (type === 'visibilitychange') listeners.delete(listener); }}});
      globalThis.__alphaNotesDocumentPorts = {call: kind => new Promise((resolve, reject) => { pending = {kind, resolve, reject}; })};
      const note = {id: 'note-1', kind: 'text', title: 'Kept note', body: 'Body', pinned: false, when: 'Today'};
      const state = {list: [note], open: note.id};
      const api = {
        toast(message) { if (message === 'Busy') refusedBusy = capped(refusedBusy + 1);else { shown++;lastShownEpoch = epoch; } },
        set(patch) { if ('noteDocumentBusy' in patch) busy = patch.noteDocumentBusy; },
        get: () => state, isActive: () => active,
        async saveImportedNote() { reads++;if (stored) imported++;return stored; },
      };
      const views = {notes: {render: () => ({}), onLeave() {}}};
      product.installNotesDocumentAdapter({prototype: {api: () => api}}, views);
      return {
        actions: {
          async choose({kind}) { const view = views.notes.render(state, api);if (kind === 'import') view.importText();else view.exportText();await settle(); },
          async settles({outcome, stored: keep}) {
            const {kind, resolve, reject} = pending;pending = undefined;stored = keep;settled++;
            if (outcome === 'threw') reject(Error('The provider call failed.'));
            else if (outcome === 'refused') resolve({status: 'cancelled', message: 'Nothing was chosen.'});
            else resolve(kind === 'import' ? {status: 'read', message: '', text: 'Imported body', name: 'file.txt'} : {status: 'exported', message: 'Exported.'});
            await settle();
          },
          leaveNotes() { active = false;epoch++;views.notes.onLeave(api); },
          enterNotes() { active = true; },
          hide() { hidden = true; },
          async show() {
            hidden = false;
            const waiting = listeners.size, before = shown;
            for (const listener of [...listeners]) listener();
            await settle();
            dropped += waiting - (shown - before);
          },
        },
        observe: () => ({active, hidden, epoch, busy, operation: pending?.kind ?? 'none', receipts: listeners.size,
          shown, dropped, settled, imported, reads, refusedBusy, lastShownEpoch}),
        close() {
          if (saved) Object.defineProperty(globalThis, 'document', saved);else delete globalThis.document;
          delete globalThis.__alphaNotesDocumentPorts;
        },
      };
    },
  });
}
