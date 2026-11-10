import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {tsImport} from 'tsx/esm/api';
import {prepareClientFeatures} from '../scripts/prepare-client-features.ts';

const root = prepareClientFeatures();
const {createScanDocument} = await tsImport(pathToFileURL(`${root}/plugins/plugin-native-camera/src/scan-document.ts`).href, import.meta.url);
const image = () => ({type:'image/png', size:10});
function fixture() {
  let saved, serial = 0, removed = 0;
  const drafts = {
    async save(pages, revision, signal, textLayers) {
      signal.throwIfAborted();
      assert.equal(revision, saved?.revision);
      saved = {pages:[...pages], textLayers, revision:String(++serial)};
      return saved;
    },
    async read() { return saved; },
    async remove(revision, signal) {
      signal.throwIfAborted();
      assert.equal(revision, saved?.revision);
      saved = undefined;
      removed++;
    },
  };
  return {drafts, saved:() => saved, removed:() => removed};
}
async function exported(doc) {
  await doc.exportPages(async () => ({status:'exported', message:'Saved'}));
  await doc.settled();
  await new Promise(setImmediate);
}

test('an automatic scan draft is removed after its confirmed export', async () => {
  const f = fixture(), doc = createScanDocument({drafts:f.drafts, autosave:true});
  doc.put(image());
  await doc.settled();
  await exported(doc);
  assert.equal(f.saved(), undefined);
  assert.equal(f.removed(), 1);
});

test('an explicitly saved scan stays saved after more pages and text are autosaved and exported', async () => {
  const f = fixture(), doc = createScanDocument({drafts:f.drafts, autosave:true});
  doc.put(image());
  await doc.settled();
  assert.equal(await doc.saveDraft(), true);
  doc.put(image());
  doc.setTextLayers([null, [{text:'Retained text'}]]);
  await doc.settled();
  assert.equal(doc.snapshot().autoSaved, false);
  await exported(doc);
  assert.equal(f.saved().pages.length, 2);
  assert.equal(f.removed(), 0);
});

test('a loaded scan stays saved after edits and its confirmed export', async () => {
  const f = fixture();
  await f.drafts.save([image()], undefined, new AbortController().signal, [null]);
  const doc = createScanDocument({drafts:f.drafts, autosave:true});
  assert.equal(await doc.loadDraft(() => true), 'loaded');
  doc.put(image());
  await doc.settled();
  await exported(doc);
  assert.equal(f.saved().pages.length, 2);
  assert.equal(f.removed(), 0);
});

test('explicit deletion lets a later automatic scan draft be cleared after export', async () => {
  const f = fixture(), doc = createScanDocument({drafts:f.drafts, autosave:true});
  doc.put(image());
  assert.equal(await doc.saveDraft(), true);
  assert.equal(await doc.deleteDraft(() => true), true);
  doc.put(image());
  await doc.settled();
  await exported(doc);
  assert.equal(f.saved(), undefined);
  assert.equal(f.removed(), 2);
});
