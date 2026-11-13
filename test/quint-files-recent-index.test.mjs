import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {loadProductModule, memoryStorage, modelTraces, replayTraces, repositoryRoot, settle} from '../specs/quint/refinement/application/notes-files-media-itf.mjs';

// FilesRecentIndex against createFilesIndex (apps/app/src/prototype/files-index.ts) and
// exportScanPdf (apps/app/src/prototype/scan-pdf.ts).
// The index runs with its row limit lowered to the model's two. Picker grants are a port: a
// grant is issued when a document is accepted and released by DailyApps.forgetSelected. The
// selected-document adapter is bound to a DOM view, so its close and accept sequences are
// repeated here; the driver refuses to run when the adapter no longer contains them.

const adapterSequences = [
  "if (forget) { const row = filesIndex.list().find(item => item.selectionId === id); if (row) filesIndex.remove(row.key); }",
  "if (forget || !filesIndex.has(id)) release(id);",
  "if (recent) for (const evicted of filesIndex.record({ ...recent, name: result.name || 'Selected document', mimeType: result.mimeType || 'application/octet-stream', selectionId: result.selectionId })) if (evicted !== result.selectionId) release(evicted);",
  "filesIndex.setOpen(result.selectionId);",
];
const number = text => text ? Number(text.replace(/\D+/g, '')) : 0;

async function replayFilesRecentIndex({rewrite = {}, ...options} = {}) {
  const adapter = readFileSync(join(repositoryRoot, 'apps/app/src/prototype/selection-adapter.ts'), 'utf8');
  for (const sequence of adapterSequences) assert.ok(adapter.includes(sequence), `selection-adapter.ts no longer contains: ${sequence}`);
  const traces = modelTraces({path: 'specs/quint/application/FilesRecentIndex.qnt', main: 'FilesRecentIndex', ...options});
  const files = await loadProductModule('apps/app/src/prototype/files-index.ts', {rewrite: {
    'prototype/files-index.ts': text => text.replace('export const RECENT_LIMIT=24;', 'export const RECENT_LIMIT=2;')}});
  const scan = await loadProductModule('apps/app/src/prototype/scan-pdf.ts', {rewrite, stubs: {
    '../../../../.eliza/client-features/plugins/plugin-files/src/documents/scan-pdf.ts': 'export const createScanPdf=async()=>new Uint8Array([37,80,68,70]);',
    '../platform-plugins': 'export const registerPlugin=()=>({exportPdf:async()=>({status:"exported",message:""})});',
    '../runtime/browser-note-documents': 'export class BrowserNoteDocuments{}',
    './files-index': 'export const filesIndex=new Proxy({},{get:(_target,name)=>globalThis.__alphaFilesPorts.index[name]});',
    '../daily': 'export const DailyApps={forgetSelected:input=>globalThis.__alphaFilesPorts.forget(input)};',
  }});
  return replayTraces(traces, {
    required: ['accept', 'savedPdf', 'close', 'treeSessionEnds'],
    reached: {
      'an export that released an evicted grant': state => state.s.exportReleased.length > 0,
      'an open document pushed out of Recent by an export': state => state.s.opened !== 0 && state.s.rows.length === 2
        && state.s.rows.every(row => row.kind === 'scan-pdf'),
      'a revoked folder row': state => state.s.rows.some(row => row.status === 'revoked'),
      'a grant released by eviction': state => state.s.released.length > 0,
    },
    project: state => state.s,
    async start() {
      let clock = 0, serial = 0, sessions = 0, exporting = false;
      const store = memoryStorage(), index = files.createFilesIndex(store, () => ++clock);
      const issued = new Set(), released = new Set(), exportReleased = new Set();
      const release = id => { assert.ok(issued.has(id) && !released.has(id), `released ${id} twice or without a grant`);released.add(id);if (exporting) exportReleased.add(id); };
      globalThis.__alphaFilesPorts = {index, forget: async ({selectionId}) => release(selectionId)};
      const clear = (forget = false) => {
        const id = index.open();
        index.setOpen(null);
        if (!id) return;
        if (forget) { const row = index.list().find(item => item.selectionId === id);if (row) index.remove(row.key); }
        if (forget || !index.has(id)) release(id);
      };
      return {
        actions: {
          accept({kind, id, name, flag}) {
            const selectionId = `s${++serial}`, recent = !flag ? false : kind === 'tree' ? {kind, treeId: `tree-${id}`} : {kind};
            issued.add(selectionId);
            clear();
            if (recent) for (const evicted of index.record({...recent, name: `Document ${name}`, mimeType: 'text/plain', selectionId})) if (evicted !== selectionId) release(evicted);
            index.setOpen(selectionId);
          },
          async savedPdf({name}) {
            exporting = true;
            try { await scan.exportScanPdf(new Blob(['page']), new AbortController().signal, `Document ${name}`);await settle(); }
            finally { exporting = false; }
          },
          close({flag}) { clear(flag); },
          // The index operation and the release its contract asks of the caller.
          treeSessionEnds() {
            sessions++;
            const ended = index.revokeTree();
            if (ended.includes(index.open())) index.setOpen(null);
            ended.forEach(release);
          },
        },
        observe() {
          const rows = JSON.parse(store.getItem(files.filesIndexKey) ?? '[]').map(row => ({
            key: row.kind === 'selected' ? 100 + number(row.selectionId ?? row.key) : row.kind === 'tree' ? 10 + number(row.treeId) : 20 + number(row.name),
            kind: row.kind, name: number(row.name), status: row.status, selection: number(row.selectionId)}));
          const ids = set => [...set].map(number).sort((a, b) => a - b);
          return {rows, serial, grants: ids([...issued].filter(id => !released.has(id))), released: ids(released),
            exportReleased: ids(exportReleased), opened: number(index.open()), sessions};
        },
        close() { delete globalThis.__alphaFilesPorts; },
      };
    },
  });
}

test('Files Recent and scan export follow every FilesRecentIndex model step', {timeout: scaledTimeout(180000)}, async () => {
  const receipt = await replayFilesRecentIndex({traces: 200, maxSteps: 14});
  assert.equal(receipt.traces, 200);
  assert.ok(receipt.steps > 1000, JSON.stringify(receipt));
  for (const action of ['accept', 'savedPdf', 'close', 'treeSessionEnds']) assert.ok(receipt.actions[action] > 0, action);
});
test('a scan export that releases the open document is rejected by the replay', {timeout: scaledTimeout(180000)}, async () => {
  await assert.rejects(replayFilesRecentIndex({traces: 200, maxSteps: 14, rewrite: {'prototype/scan-pdf.ts': text =>
    text.replace('if(evicted!==filesIndex.open())', 'if(true)')}}), /trace \d+ step \d+ savedPdf/);
});
test('a scan export that keeps an evicted grant is rejected by the replay', {timeout: scaledTimeout(180000)}, async () => {
  await assert.rejects(replayFilesRecentIndex({traces: 200, maxSteps: 14, rewrite: {'prototype/scan-pdf.ts': text =>
    text.replace('if(evicted!==filesIndex.open())', 'if(false)')}}), /trace \d+ step \d+ savedPdf/);
});
