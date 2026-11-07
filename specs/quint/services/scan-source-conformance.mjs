/** Reproduce the documented scan draft discrepancy through the real UI entry point. */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const sourcePath = resolve('apps/app/src/prototype/scan-document.ts');
const stubs = new Map([
  ['../runtime/abort-signal', 'export const anyAbortSignal = signals => signals[0];'],
  ['./media-review-controls', 'export const mediaToolIcon = () => {};'],
  ['./scan-dialog.css', ''],
  ['./scan-searchable-review', 'export const reviewSearchableScan = async () => undefined;'],
  ['./scan-correction-review', 'export const reviewScanCorrection = async () => undefined;'],
  ['../browser/scan-draft', `
    export const readScanDraft = () => globalThis.scanPorts.read();
    export const saveScanDraft = (...args) => globalThis.scanPorts.save(...args);
    export const deleteScanDraft = (...args) => globalThis.scanPorts.remove(...args);
  `],
  ['./scan-page-camera', 'export const captureScanPage = async () => undefined;'],
  ['../browser/file-picker', 'export const inputFiles = async () => []; export const runFilePicker = async () => [];'],
  ['./scan-pdf', `
    export class ScanPdfExportError extends Error {}
    export const exportScanPdf = () => globalThis.scanPorts.export();
    export const duringSystemPicker = task => task();
    export const systemPickerActive = () => false;
    export const scanPdfRetryable = status => ['cancelled', 'failed', 'unavailable', 'too-large'].includes(status);
  `],
  ['@capacitor/core', 'export const Capacitor = { isNativePlatform: () => true };'],
  ['../daily', 'export const DailyApps = { perform: async () => ({status:"cancelled"}), forgetSelected: async () => {} };'],
]);
const bundle = await build({
  entryPoints: [sourcePath], bundle: true, write: false, format: 'iife',
  globalName: 'ScanSource', platform: 'browser',
  plugins: [{
    name: 'isolated-scan-ports',
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => {
        if (args.kind === 'entry-point') return;
        if (!stubs.has(args.path)) throw new Error(`Unreviewed scan dependency ${args.path}`);
        return { path: args.path, namespace: 'scan-port' };
      });
      builder.onLoad({ filter: /.*/, namespace: 'scan-port' }, args => ({
        contents: stubs.get(args.path), loader: 'ts',
      }));
    },
  }],
});
const dom = new JSDOM('<!doctype html><html><body><main class="os"></main></body></html>', {
  url: 'https://scan.example.test/',
});
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
let stored;
let saves = 0;
let deletes = 0;
let exports = 0;
const scanPorts = {
  async read() { return stored; },
  async save(pages, expected, signal, textLayers) {
    signal.throwIfAborted();
    assert.equal(expected, stored?.revision, 'the real UI must use the latest draft revision');
    stored = { pages: [...pages], textLayers, revision: `revision-${++saves}` };
    return stored;
  },
  async remove(expected, signal) {
    signal.throwIfAborted();
    assert.equal(expected, stored?.revision);
    stored = undefined;
    deletes++;
  },
  async export() {
    exports++;
    return { status: 'exported', message: 'Controlled export receipt' };
  },
};
const context = vm.createContext({
  document: dom.window.document, window: dom.window, HTMLElement: dom.window.HTMLElement,
  AbortController, Blob, scanPorts, console,
  URL: { createObjectURL: () => 'blob:scan-conformance', revokeObjectURL() {} },
});
vm.runInContext(bundle.outputFiles[0].text, context, { filename: sourcePath });
const tickUntil = async condition => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error('The controlled scan UI did not settle');
};
const button = label => {
  const element = dom.window.document.querySelector(`button[aria-label="${label}"]`);
  assert.ok(element, `Missing ${label} control from the actual source`);
  return element;
};
const close = context.ScanSource.openScanDocument(new Blob(['page'], { type: 'image/png' }));
try {
  await tickUntil(() => saves === 1 && !button('Save document draft').disabled);
  button('Save document draft').click();
  await tickUntil(() => saves === 2 && !button('Save document PDF').disabled);
  assert.equal(stored.revision, 'revision-2', 'the explicit user save completed');
  button('Save document PDF').click();
  await tickUntil(() => exports === 1 && deletes === 1);
  assert.equal(stored, undefined, 'current source clears the explicitly saved auto-draft');
  console.log('EXPECTED DISCREPANCY reproduced through openScanDocument: autosave -> explicit Save draft -> confirmed export -> saved draft deleted');
} finally {
  close();
  dom.window.close();
}
