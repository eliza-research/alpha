// SystemPickerVisibility against duringSystemPicker and systemPickerActive
// (apps/app/src/prototype/scan-pdf.ts) and runFilePicker (apps/app/src/browser/file-picker.ts).
// The picker counter and the single owned browser file picker are observed. The five scan
// dialogs of the model are DOM dialogs spread over four modules; their open and close steps
// change nothing these two entry points hold and pass through the driver untouched.
import assert from 'node:assert/strict';
import {loadProductModule, modelTraces, replayTraces, settle} from '../application/notes-files-media-itf.mjs';

export async function replaySystemPickerVisibility({rewrite, ...options} = {}) {
  const traces = modelTraces({path: 'specs/quint/services/SystemPickerVisibility.qnt', main: 'SystemPickerVisibility', ...options});
  const scan = await loadProductModule('apps/app/src/prototype/scan-pdf.ts', {rewrite, stubs: {
    '../../../../.eliza/client-features/plugins/plugin-files/src/documents/scan-pdf.ts': 'export const createScanPdf=async()=>new Uint8Array();',
    '../platform-plugins': 'export const registerPlugin=()=>({});', '../runtime/browser-note-documents': 'export class BrowserNoteDocuments{}',
    './files-index': 'export const filesIndex={};', '../daily': 'export const DailyApps={};'}});
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'window');
  try {
    return await replayTraces(traces, {
      required: ['pickerStart', 'pickerEnd', 'pageHide', 'filePickerStart', 'filePickerCancel', 'filePickerResult', 'hideEvent', 'showEvent'],
      reached: {
        'two system pickers in flight': ({s}) => s.pickers === 2,
        'a late result of a retired file picker dropped': ({s}) => s.retired.some(id => !s.pending.includes(id)) && s.delivered.length === 0,
        'a delivered file picker result': ({s}) => s.delivered.length > 0,
        'a file picker retired by its successor': ({s}) => s.live !== 0 && s.retired.length > 0,
      },
      project: ({s}) => ({active: s.pickers > 0, live: s.live, pending: s.pending, retired: s.retired, delivered: s.delivered}),
      async start() {
        const window = new EventTarget();
        Object.defineProperty(globalThis, 'window', {configurable: true, writable: true, value: window});
        // A fresh file-picker module per trace: its owner is module state.
        const files = await loadProductModule('apps/app/src/browser/file-picker.ts', {rewrite});
        const system = [], chooser = new Map(), unsettled = new Set(), retired = new Set(), delivered = new Set();
        let generation = 0;
        const none = () => {};
        return {
          actions: {
            openReview: none, openDocument: none, openSearchable: none, openCorrection: none, openCapture: none,
            hideEvent: none, showEvent: none, closeDialog: none,
            async pickerStart() { void scan.duringSystemPicker(() => new Promise(resolve => system.push(resolve)));await settle(); },
            async pickerEnd() { system.shift()();await settle(); },
            async pageHide() { window.dispatchEvent(new Event('pagehide'));await settle(); },
            async filePickerStart() {
              const id = ++generation;unsettled.add(id);
              void files.runFilePicker(() => new Promise(resolve => chooser.set(id, resolve)), null).then(result => {
                unsettled.delete(id);
                if (result === null) retired.add(id);else delivered.add(id);
              });
              await settle();
            },
            async filePickerCancel() { window.dispatchEvent(new Event('alpha-back', {cancelable: true}));await settle(); },
            async filePickerResult({id}) { chooser.get(id)([`file-${id}`]);chooser.delete(id);await settle(); },
          },
          observe() {
            assert.ok(unsettled.size <= 1, 'two file pickers own the consumer');
            const sorted = values => [...values].sort((a, b) => a - b);
            return {active: scan.systemPickerActive(), live: [...unsettled][0] ?? 0, pending: sorted(chooser.keys()), retired: sorted(retired), delivered: sorted(delivered)};
          },
          async close() { while (system.length) system.shift()();window.dispatchEvent(new Event('pagehide'));await settle(); },
        };
      },
    });
  } finally { if (saved) Object.defineProperty(globalThis, 'window', saved);else delete globalThis.window; }
}
