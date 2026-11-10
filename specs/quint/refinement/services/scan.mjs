import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {existsSync} from 'node:fs';
import {chromium, expect} from '@playwright/test';
import {checkTraces, captureInputs} from '../check-traces.mjs';
import {action} from './support.mjs';

async function bundle() {
  const stubs = {
    './media-review-controls': 'export const mediaToolIcon=()=>{};',
    './scan-searchable-review': 'export const reviewSearchableScan=async()=>undefined;',
    './scan-correction-review': 'export const reviewScanCorrection=async()=>undefined;',
    './scan-page-camera': 'export const captureScanPage=async()=>undefined;',
    '../platform-plugins': 'export const registerPlugin=()=>({exportPdf:()=>window.scanPorts.exportPdf()});',
    './files-index': 'export const filesIndex={record:()=>{window.scanPorts.indexed++;}};',
    '@capacitor/core': 'export class WebPlugin {} export const Capacitor={getPlatform:()=>"android",isNativePlatform:()=>true,convertFileSrc:()=>window.scanPorts.imageUrl};',
    '../daily': 'export const DailyApps={perform:async()=>({status:"selected",uri:"content://fixture/image",mimeType:"image/png",selectionId:"selected"}),forgetSelected:async()=>{}};',
    '../../../../.eliza/client-features/plugins/plugin-files/src/documents/scan-pdf.ts': 'export const createScanPdf=async()=>new TextEncoder().encode("%PDF-1.7 fixture");',
  };
  const result = await build({stdin: {contents: 'import {openScanDocument} from "./apps/app/src/prototype/scan-document.ts"; import {readScanDraft} from "./apps/app/src/browser/scan-draft.ts"; import {systemPickerActive} from "./apps/app/src/prototype/scan-pdf.ts";window.scanApi={openScanDocument,readScanDraft,systemPickerActive};', resolveDir: process.cwd()},
    bundle: true, write: false, metafile: true, platform: 'browser', format: 'iife', define: {'import.meta.env': '{}'}, loader: {'.css': 'empty'},
    plugins: [{name: 'scan-external-ports', setup(builder) {
      builder.onResolve({filter: /.*/}, args => Object.hasOwn(stubs, args.path) ? {path: args.path, namespace: 'scan-port'} : undefined);
      builder.onLoad({filter: /.*/, namespace: 'scan-port'}, args => ({contents: stubs[args.path], loader: 'js'}));
    }}]});
  return {code:result.outputFiles[0].text, inputs:Object.keys(result.metafile.inputs).filter(input=>existsSync(input))};
}
export async function scanRefinement() {
  const sources = ['apps/app/src/prototype/scan-document.ts', 'apps/app/src/prototype/scan-pdf.ts', 'apps/app/src/browser/scan-draft.ts', 'apps/app/src/runtime/abort-signal.ts', '.eliza/client-features/plugins/plugin-files/src/documents/scan-draft.ts', '.eliza/client-features/plugins/plugin-files/src/documents/scan-text-layer.ts', 'specs/quint/refinement/services/scan.mjs', 'specs/quint/refinement/services/support.mjs', '.eliza/client-features/plugins/plugin-native-camera/src/scan-document.ts', 'upstream.lock.json', '.eliza/client-features/.source.json', 'scripts/prepare-client-features.ts'];
  let driverHashes = captureInputs(sources);
  const compiled = await bundle();
  sources.push(...compiled.inputs.filter(input=>!sources.includes(input)));
  const next = captureInputs(sources);
  for (const [path,hash] of Object.entries(driverHashes)) assert.equal(next[path],hash,`Source changed while bundling: ${path}`);
  driverHashes=next;
  const browser = await chromium.launch({headless: true, ...(process.env.ALPHA_CHROMIUM_PATH ? {executablePath: process.env.ALPHA_CHROMIUM_PATH} : {}), args: ['--no-sandbox']});
  const code = compiled.code, traces = [];
  try {
    for (const mode of ['automatic', 'explicit', 'explicit-then-autosave', 'unverified']) {
      const context = await browser.newContext(), page = await context.newPage();
      page.setDefaultTimeout(30000);
      await page.route('https://scan.refinement.invalid/**', route => route.fulfill({contentType: 'text/html', body: '<main class="os"></main>'}));
      await page.goto('https://scan.refinement.invalid/');
      await page.evaluate(() => { window.scanPorts = {indexed: 0, exports: 0, imageUrl: '', exportPdf: async () => { window.scanPorts.exports++; await new Promise(resolve => { window.releaseExport = resolve; }); return {status: window.exportOutcome, message: 'Export completed'}; }}; });
      await page.addScriptTag({content: code});
      await page.evaluate(() => {
        window.scanImageIds = new Map(); window.scanRevisions = new Map();
        window.imageIdentity = async image => Array.from(new Uint8Array(await image.arrayBuffer())).join(',');
        window.observeScanDraft = async () => {
          const draft = await window.scanApi.readScanDraft();
          if (!draft) return {revision: 0, pages: []};
          if (!window.scanRevisions.has(draft.revision)) window.scanRevisions.set(draft.revision, window.scanRevisions.size + 1);
          const pages = [];
          for (const image of draft.pages) {
            const id = window.scanImageIds.get(await window.imageIdentity(image));
            if (!id) throw Error('Stored scan image differs from both supplied images');
            pages.push({image: id, text: 0});
          }
          return {revision: window.scanRevisions.get(draft.revision), pages};
        };
      });
      const trace = {name: `real scan UI and IndexedDB ${mode}`, init: action('initFor', true), expect: {'s.savedPages': [], 's.storedRevision': 0}, steps: []};
      await page.evaluate(async () => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2; const ctx = canvas.getContext('2d'); ctx.fillStyle = 'red'; ctx.fillRect(0, 0, 2, 2); const first = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); window.scanImageIds.set(await window.imageIdentity(first), 1); window.closeScan = window.scanApi.openScanDocument(first); });
      await expect.poll(() => page.evaluate(async () => !!await window.scanApi.readScanDraft()), {timeout: 30000}).toBe(true);
      let observed = await page.evaluate(() => window.observeScanDraft());
      trace.steps.push({label: 'normal entrypoint automatically saves first page', action: [action('add', 1), action('beginAutoSave'), action('saveCommit')], expect: {'s.savedPages': observed.pages, 's.storedRevision': observed.revision}});
      if (mode.startsWith('explicit')) {
        const before = await page.evaluate(async () => (await window.scanApi.readScanDraft()).revision);
        await page.getByText('Draft options', {exact: true}).click();
        await page.getByRole('button', {name: 'Save document draft', exact: true}).click();
        await expect.poll(() => page.evaluate(async previous => { const saved = await window.scanApi.readScanDraft(); return saved.revision !== previous && !document.querySelector('button[aria-label="Add page"]').disabled && document.querySelector('[role=status]').textContent.includes('Document draft saved'); }, before), {timeout: 30000}).toBe(true);
        observed = await page.evaluate(() => window.observeScanDraft());
        const saved = await page.evaluate(async () => ({has: !!await window.scanApi.readScanDraft(), status: document.querySelector('[role=status]').textContent}));
        assert.match(saved.status, /draft saved/);
        trace.steps.push({label: 'explicit Save uses real draft CAS', action: [action('beginManualSave'), action('saveCommit')], expect: {'s.userSaved': saved.status.includes('draft saved'), 's.storedRevision': observed.revision}});
      }
      if (mode === 'explicit-then-autosave') {
        await page.waitForFunction(() => !document.querySelector('button[aria-label="Add page"]').disabled && document.querySelector('[role=status]').textContent.includes('Document draft saved'));
        const before = await page.evaluate(async () => (await window.scanApi.readScanDraft()).revision);
        await page.evaluate(async () => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2; canvas.getContext('2d').fillRect(0, 0, 2, 2); const image = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); window.scanImageIds.set(await window.imageIdentity(image), 2); window.scanPorts.imageUrl = URL.createObjectURL(image); });
        await page.getByRole('button', {name: 'Add page', exact: true}).click();
        await expect.poll(() => page.evaluate(async previous => { const saved = await window.scanApi.readScanDraft(); return saved.revision !== previous && saved.pages.length === 2; }, before), {timeout: 30000}).toBe(true);
        observed = await page.evaluate(() => window.observeScanDraft());
        const count = await page.evaluate(async () => (await window.scanApi.readScanDraft()).pages.length);
        trace.steps.push({label: 'subsequent page change saves without surrendering explicit ownership', action: [action('beginPicker', false), action('picked', true), action('beginAutoSave'), action('saveCommit')], expect: {'s.savedPages': observed.pages, 's.storedRevision': observed.revision}});
        assert.equal(count, 2, await page.evaluate(() => document.querySelector('[role=status]').textContent));
      }
      const beforeExport = await page.evaluate(async () => (await window.scanApi.readScanDraft()).revision);
      await page.evaluate(outcome => { window.exportOutcome = outcome; }, mode === 'unverified' ? 'unverified' : 'exported');
      await page.getByRole('button', {name: 'Save document PDF', exact: true}).click();
      await page.waitForFunction(() => window.scanPorts.exports === 1);
      const picker = await page.evaluate(() => window.scanApi.systemPickerActive());
      trace.steps.push({label: 'real export wrapper owns the active system picker', action: [action('beginExport'), action('requestExport')], expect: {'s.picker': picker}});
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', {configurable: true, value: true}); document.dispatchEvent(new Event('visibilitychange')); });
      trace.steps.push({label: 'picker visibility event preserves the owning review', action: action('hide'), expect: {'s.closed': await page.getByRole('dialog', {name: 'Review scan document'}).count() === 0}});
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', {configurable: true, value: false}); document.dispatchEvent(new Event('visibilitychange')); window.releaseExport(); });
      await page.waitForFunction(() => !window.scanApi.systemPickerActive() && document.querySelector('[role=status]').textContent === 'Export completed');
      if (mode === 'automatic') await expect.poll(() => page.evaluate(async () => !await window.scanApi.readScanDraft()), {timeout: 30000}).toBe(true);
      const state = await page.evaluate(async () => { const draft = await window.scanApi.readScanDraft(); return {revision: draft?.revision ?? null, count: draft?.pages.length ?? 0, disabled: document.querySelector('button[aria-label="Save document PDF"]').disabled}; });
      const finish = [action('resume'), action('exportReply', mode === 'unverified' ? 'unverified' : 'exported')];
      if (mode === 'automatic') finish.push(action('clearAutoDraft'));
      observed = await page.evaluate(() => window.observeScanDraft());
      trace.steps.push({label: 'confirmed export retains explicitly owned drafts and locks output', action: finish, expect: {'s.storedRevision': observed.revision, 's.exported': state.disabled}});
      if (mode !== 'automatic') assert.equal(state.revision, beforeExport, 'export preserves the exact user-owned or unverified draft');
      traces.push(trace); await context.close();
    }
  } finally { await browser.close(); }
  return checkTraces({model: 'ScanDocument', sources, driverHashes, traces, scope: 'bounded-orchestration', assumptions: ['The actual UI, IndexedDB draft implementation and picker/export policy execute in Chromium.', 'Image selection and final document export are controlled external ports. PDF conversion supplies fixed bytes; geometry and PDF content need their existing tests.', 'Distinct real committed revision strings map to increasing finite revision IDs.']});
}
