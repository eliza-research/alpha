import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {Script} from 'node:vm';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import {checkTraces} from '../check-traces.mjs';
import {captureReplayClosure} from '../observed-replay.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const self = fileURLToPath(import.meta.url);
const dialogs = {
  review: 'Review scanned text',
  document: 'Review scan document',
  searchable: 'Review searchable PDF',
  correction: 'Correct document page',
  capture: 'Capture document page',
};

async function compile(removeSearchableException) {
  const ports = {
    '@capacitor/core': 'export const Capacitor={isNativePlatform:()=>true,getPlatform:()=>"android"};',
    '../platform-plugins': 'export const registerPlugin=name=>globalThis.scanFixture.plugin(name);',
    '../daily': 'export const DailyApps={perform:input=>globalThis.scanFixture.pickImage(input)};',
    './local-ocr': 'export const recognizeLocalText=async()=>({text:"Fixture text",lines:[]});',
    './files-index': 'export const filesIndex={record(){throw Error("No fixture PDF was exported");}};',
    '../../../../.eliza/client-features/plugins/plugin-files/src/documents/scan-pdf.ts':
      'export const createScanPdf=async()=>new TextEncoder().encode("%PDF-1.7 fixture");',
    '../browser/scan-draft': [
      'export {copyScanTextLayers} from "./.eliza/client-features/plugins/plugin-files/src/documents/scan-draft.ts";',
      'export const readScanDraft=(...args)=>globalThis.scanFixture.readDraft(...args);',
      'export const saveScanDraft=(...args)=>globalThis.scanFixture.saveDraft(...args);',
      'export const deleteScanDraft=()=>{throw Error("This replay never deletes a scan draft");};',
    ].join('\n'),
    '../runtime/browser-note-documents': 'export class BrowserNoteDocuments{constructor(){throw Error("Native port expected");}}',
  };
  const {outputFiles} = await build({
    absWorkingDir:root,
    stdin:{
      contents:[
        'export {openScanReview} from "./apps/app/src/prototype/scan-review";',
        'export {duringSystemPicker,systemPickerActive} from "./apps/app/src/prototype/scan-pdf";',
      ].join('\n'),
      resolveDir:root,
    },
    bundle:true, write:false, platform:'browser', format:'iife', globalName:'scanDialogs',
    define:{'import.meta.env':'{}'}, loader:{'.css':'empty'},
    plugins:[{name:'scan-dialog-fixture-ports', setup(builder) {
      builder.onResolve({filter:/.*/}, ({path}) => Object.hasOwn(ports, path) ? {path, namespace:'scan-fixture'} : undefined);
      builder.onLoad({filter:/.*/, namespace:'scan-fixture'}, ({path}) => ({contents:ports[path], loader:'js', resolveDir:root}));
      if (removeSearchableException) builder.onLoad({filter:/\/scan-searchable-review\.ts$/}, async ({path}) => {
        const {readFile} = await import('node:fs/promises');
        const code = await readFile(path, 'utf8');
        const mutated = code.replace('document.hidden&&!systemPickerActive()', 'document.hidden');
        assert.notEqual(mutated, code, 'The canary removes the searchable dialog picker exception');
        return {contents:mutated, loader:'ts'};
      });
    }}],
  });
  return new Script(outputFiles[0].text, {filename:'scan-picker-dialogs.js'});
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {resolve, promise};
}

const settle = () => new Promise(resolve => setImmediate(resolve));

const scenarios = [
  ['searchable export retains all three dialogs until the next genuine hide',
    ['openReview', 'openDocument', 'openSearchable', 'exportSearchable', 'hide', 'settlePicker', 'show', 'hide']],
  ['parent photo export retains text review until the next genuine hide',
    ['openReview', 'exportPhoto', 'hide', 'show', 'settlePicker', 'hide']],
  ['the native image picker settles while hidden without an automatic close',
    ['openReview', 'openDocument', 'pickImage', 'hide', 'settlePicker', 'pageHide']],
  ['correction closes while a platform picker remains in flight',
    ['openReview', 'openDocument', 'openCorrection', 'otherPicker', 'hide', 'settlePicker', 'pageHide']],
  ['capture closes and cannot publish a late image under a platform picker',
    ['openReview', 'openDocument', 'openCapture', 'takePhoto', 'otherPicker', 'hide', 'finishCapture', 'settlePicker', 'pageHide']],
  ['pagehide closes all three exempt dialogs even before their picker settles',
    ['openReview', 'openDocument', 'openSearchable', 'exportSearchable', 'hide', 'pageHide', 'settlePicker']],
  ['disposing the owning text review closes its nested document and correction',
    ['openReview', 'openDocument', 'openCorrection', 'closeReview']],
];

async function replay(script, name, steps) {
  const dom = new JSDOM('<main class="os" data-screen><div id="viewfinder"></div></main>', {
    url:'https://scan-picker.invalid', pretendToBeVisual:true, runScripts:'outside-only',
  });
  const {window} = dom;
  const {document} = window;
  const image = new Blob(['synthetic image'], {type:'image/png'});
  const cancellation = {status:'cancelled', message:'Fixture picker cancelled'};
  const photo = deferred(), failures = [];
  const urls = new Set();
  let hidden = false, closeReview, picker, captureSignal, revision = 0, draft, generated = 0;
  function refuseNetwork() { failures.push('Unexpected access outside fixture ports'); throw Error(failures.at(-1)); }
  function holdPicker(kind) {
    assert.equal(picker, undefined);
    const call = deferred();
    picker = {...call, kind};
    return call.promise;
  }
  function releasePicker() {
    assert.ok(picker);
    picker.resolve(cancellation);
    picker = undefined;
  }
  Object.assign(window, {
    AbortController, AbortSignal, Blob, TextEncoder, structuredClone,
    fetch:refuseNetwork, XMLHttpRequest:refuseNetwork, WebSocket:refuseNetwork,
    scanFixture:{
      plugin(name) {
        assert.equal(name, 'AlphaNoteDocuments');
        return {exportPdf(input) {
          assert.match(input.title, /^Alpha /);
          assert.match(window.atob(input.dataBase64), /^%PDF-1\.7 fixture$/);
          return holdPicker('export');
        }};
      },
      pickImage(input) {
        assert.equal(input.action, 'photos');
        return holdPicker('image');
      },
      async readDraft() { return draft; },
      async saveDraft(pages, expected, signal, textLayers) {
        signal.throwIfAborted();
        assert.equal(expected, draft?.revision);
        draft = {revision:'draft-' + ++revision, pages, textLayers};
        return draft;
      },
    },
  });
  Object.defineProperty(document, 'hidden', {get:() => hidden});
  // JSDOM does not supply the platform dialog methods, so only expose their open state.
  window.HTMLDialogElement.prototype.showModal = function() { this.open = true; };
  window.URL.createObjectURL = () => {
    const url = 'blob:fixture-' + ++generated;
    urls.add(url);
    return url;
  };
  window.URL.revokeObjectURL = url => { urls.delete(url); };
  const dialog = name => document.querySelector('dialog[open][aria-label="' + dialogs[name] + '"]');
  const observe = () => ({
    's.hidden':document.hidden,
    ...Object.fromEntries(Object.keys(dialogs).map(name => ['s.' + name, !!dialog(name)])),
  });
  const trace = {name, expect:observe(), steps:[]};
  const mark = (name, ...args) => trace.steps.push({action:{name,args}, expect:observe()});
  async function click(dialogName, label) {
    const element = [...dialog(dialogName).querySelectorAll('button')].find(button => (button.getAttribute('aria-label') ?? button.textContent) === label);
    assert.ok(element && !element.disabled, 'Enabled ' + label + ' control in ' + dialogName);
    element.click();
    await settle();
  }
  function visibility(value) {
    hidden = value;
    document.dispatchEvent(new window.Event('visibilitychange'));
    mark(value ? 'hideEvent' : 'showEvent');
  }

  try {
    script.runInContext(dom.getInternalVMContext());
    const api = window.scanDialogs;
    for (const step of steps) {
      if (step === 'openReview') {
        closeReview = api.openScanReview(image, refuseNetwork, undefined, 'captured', undefined, {
          current:() => true,
          viewfinder:() => document.getElementById('viewfinder'),
          capture(signal) {
            assert.equal(signal.aborted, false);
            captureSignal = signal;
            return photo.promise;
          },
        });
        await settle();
        mark('openReview');
      } else if (step === 'openDocument') {
        await click('review', 'Multi-page');
        mark('openDocument');
      } else if (step === 'openSearchable') {
        await click('document', 'Save searchable PDF');
        mark('openSearchable');
      } else if (step === 'openCorrection') {
        await click('document', 'Correct page 1');
        mark('openCorrection');
      } else if (step === 'openCapture') {
        await click('document', 'Capture new page');
        assert.equal(dialog('document').style.visibility, 'hidden', 'Camera covers the document during capture');
        mark('openCapture');
      } else if (step === 'takePhoto') {
        await click('capture', 'Capture page');
        assert.equal(captureSignal?.aborted, false);
      } else if (step === 'finishCapture') {
        assert.equal(captureSignal?.aborted, true, 'Closing capture retires its native request');
        const before = generated;
        photo.resolve(image);
        await settle();
        assert.equal(generated, before, 'A late capture cannot create a preview after teardown');
        assert.equal(dialog('document').style.visibility, '', 'Capture restored the document visibility');
      } else if (step === 'hide' || step === 'show') {
        visibility(step === 'hide');
        await settle();
      } else if (step === 'pageHide') {
        window.dispatchEvent(new window.Event('pagehide'));
        await settle();
        mark('pageHide');
      } else if (step === 'closeReview') {
        closeReview();
        await settle();
        mark('closeDialog', 'review');
      } else if (step === 'settlePicker') {
        releasePicker();
        await settle();
        assert.equal(api.systemPickerActive(), false);
        mark('pickerEnd');
      } else {
        if (step === 'exportSearchable') await click('searchable', 'Save reviewed searchable PDF');
        else if (step === 'exportPhoto') await click('review', 'Save photo PDF');
        else if (step === 'pickImage') await click('document', 'Add page');
        else {
          assert.equal(step, 'otherPicker');
          void api.duringSystemPicker(() => holdPicker('other'));
        }
        assert.equal(picker?.kind, {exportSearchable:'export', exportPhoto:'export', pickImage:'image', otherPicker:'other'}[step]);
        assert.equal(api.systemPickerActive(), true);
        mark('pickerStart');
      }
    }
    assert.equal(picker, undefined);
    assert.equal(urls.size, 0, 'Every closed scan dialog released its preview URL');
    return trace;
  } finally {
    if (picker) releasePicker();
    photo.resolve(image);
    closeReview?.();
    await settle();
    window.close();
    assert.deepEqual(failures, []);
  }
}

export async function checkSystemPickerDialogs(owningTest, {removeSearchableException = false} = {}) {
  const driverHashes = captureReplayClosure([self, owningTest]);
  const script = await compile(removeSearchableException);
  const traces = [];
  for (const [name, steps] of removeSearchableException ? scenarios.slice(0, 1) : scenarios) traces.push(await replay(script, name, steps));
  return checkTraces({
    model:'SystemPickerVisibility', id:removeSearchableException ? 'SystemPickerDialogsMutation' : 'SystemPickerDialogs',
    sources:Object.keys(driverHashes), driverHashes, traces, scope:'bounded-component',
    assumptions:[
      'Whole scan dialog and shared picker modules execute together in a synthetic native-shaped DOM. The replay observes actual open elements, not visual layer opacity.',
      'The PDF creator, OCR, native picker, draft IO and owned Camera preview are closed ports. The user-facing export and image controls call the actual picker wrapper. The correction and capture cases hold a separate synthetic platform picker to cover overlap explicitly.',
      'The old counter and browser file picker replays still own their sampled schedules. Android Activity transitions and real native picker and Camera behavior are separate evidence.',
    ],
  });
}
