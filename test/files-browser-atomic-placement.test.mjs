import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {before, test} from 'node:test';
import {chromium} from '@playwright/test';
import {build} from 'esbuild';
import {checkClientFeatures} from '../scripts/prepare-client-features.ts';

const root = resolve(import.meta.dirname, '..');
const fixtureOrigin = 'https://files-placement.refinement.invalid/';

// Authenticate the prepared projection before starting the browser scenario's deadline.
before(() => {checkClientFeatures({root});}, {timeout: 600000});

test('Browser Files placement preserves exact rows and Trash markers on IndexedDB refusal', {timeout: 90000}, async () => {
  const {outputFiles: [bundle]} = await build({
    stdin: {resolveDir: root, contents: `
      import {BrowserFiles} from './.eliza/client-features/plugins/plugin-files/src/browser/files.ts';
      import {BrowserStorageVolume} from './.eliza/client-features/plugins/plugin-files/src/browser/storage-volume.ts';
      globalThis.placementFixture = {BrowserFiles, BrowserStorageVolume};
    `},
    bundle: true, write: false, platform: 'browser', format: 'iife',
    external: ['pdfjs-dist'],
  });
  const browser = await chromium.launch({headless: true, args: ['--no-sandbox']});
  try {
    const context = await browser.newContext({serviceWorkers: 'block'});
    await context.route('**/*', route => route.request().url() === fixtureOrigin
      ? route.fulfill({contentType: 'text/html', body: '<title>Files placement fixture</title>'})
      : route.abort());
    const page = await context.newPage();
    await page.goto(fixtureOrigin);
    await page.addScriptTag({content: bundle.text});
    const result = await page.evaluate(async () => {
      const {BrowserFiles, BrowserStorageVolume} = globalThis.placementFixture;
      const closed = () => {throw Error('Unscripted fixture port');};
      const options = {databaseName: 'files-placement-fixture', archiveName: 'fixture.zip',
        pdfWorkerUrl: '', pdfAssetsBase: '', openSelectedDocumentViewer: closed,
        runFilePicker: closed, inputFiles: closed};
      const library = new BrowserFiles(options), peer = new BrowserFiles(options);
      const namespace = {trashFolder: '.Trash-alpha', trashKey: 'fixture.files.trash'};
      const volume = new BrowserStorageVolume(library, namespace);
      const journal = () => JSON.parse(localStorage.getItem(namespace.trashKey) ?? '{}');
      const entries = async (id = 'root') => (await peer.list({id})).entries;
      const row = async (parent, name) => (await entries(parent)).find(item => item.name === name);
      const importFile = (parent, name, text) =>
        peer.importFile(new File([text], name, {type: 'application/pdf'}), parent);

      async function holdPlacement(work, concurrentWrite) {
        const original = library.place.bind(library);
        const entered = Promise.withResolvers(), release = Promise.withResolvers();
        let refusal;
        library.place = async input => {
          entered.resolve(input);
          await release.promise;
          try {await original(input);}
          catch (error) {refusal = error.message; throw error;}
        };
        const settled = work();
        let concurrent;
        try {
          const input = await Promise.race([entered.promise, settled.then(() => {
            throw Error('Operation settled before reaching the IndexedDB placement');
          })]);
          concurrent = await concurrentWrite(input);
        } finally {
          library.place = original;
          release.resolve();
        }
        const {outcomes: [outcome]} = await settled;
        return {concurrent, outcome, refusal};
      }

      await peer.createFolder({id: 'root', name: 'Download'});
      const {id: download} = await row('root', 'Download');
      await importFile('root', 'owner.pdf', 'owner');
      const initial = await row('root', 'owner.pdf');
      const directMove = await library.move({id: initial.id, expectedRevision: initial.revision, destinationId: download});
      const original = await row(download, 'owner.pdf');
      const deniedTrash = await holdPlacement(() => volume.trash(['Download/owner.pdf']), async input => {
        const folder = await row('root', namespace.trashFolder);
        const before = await row(download, 'owner.pdf');
        const provisional = journal()[input.name];
        await peer.delete({id: folder.id, expectedRevision: folder.revision, confirmPermanent: true});
        return {input, folder, before, provisional};
      });
      const afterDeniedTrash = await row(download, 'owner.pdf');
      const afterDeniedTrashJournal = journal();

      const reviewed = await volume.reviewedIdentities(['Download/owner.pdf']);
      const staleTrash = await holdPlacement(() => volume.trash(['Download/owner.pdf'], reviewed), async input => {
        await peer.rename({id: original.id, expectedRevision: original.revision, name: original.name});
        return {input, changed: await row(download, 'owner.pdf')};
      });
      const afterStaleTrash = await row(download, 'owner.pdf');
      const afterStaleTrashJournal = journal();

      const {outcomes: [trashed]} = await volume.trash(['Download/owner.pdf']);
      const {id: trash} = await row('root', namespace.trashFolder);
      const stored = await row(trash, trashed.to), storedJournal = journal();
      const deniedRestore = await holdPlacement(() => volume.restore([trashed.to]), async input => {
        await importFile(download, input.name, 'collision');
        return {input, peerRow: await row(download, input.name)};
      });
      const afterDeniedRestore = await row(trash, trashed.to), afterDeniedRestoreJournal = journal();
      const {items: visible} = await volume.trashList();
      const {outcomes: [restored]} = await volume.restore([trashed.to]);
      return {initial, directMove, original, deniedTrash, afterDeniedTrash, afterDeniedTrashJournal,
        staleTrash, afterStaleTrash, afterStaleTrashJournal, trashed, stored, storedJournal,
        deniedRestore, afterDeniedRestore, afterDeniedRestoreJournal, visible, restored,
        restoredOwner: await row(download, 'owner (1).pdf'), peerRow: await row(download, 'owner.pdf'),
        finalJournal: journal(), trashEntries: await entries(trash)};
    });
    const {original, deniedTrash, staleTrash, trashed, stored, deniedRestore, restored} = result;
    assert.deepEqual(result.directMove, {status: 'moved', message: 'Moved.'});
    assert.equal(original.id, result.initial.id);
    assert.equal(deniedTrash.outcome.status, 'failed');
    assert.equal(deniedTrash.refusal, 'Choose a destination folder.');
    assert.equal(deniedTrash.concurrent.input.id, original.id);
    assert.equal(deniedTrash.concurrent.input.expectedRevision, original.revision);
    assert.equal(deniedTrash.concurrent.input.destinationId, deniedTrash.concurrent.folder.id);
    assert.equal(deniedTrash.concurrent.provisional.name, original.name);
    assert.deepEqual(deniedTrash.concurrent.before, original);
    assert.deepEqual(result.afterDeniedTrash, original);
    assert.deepEqual(result.afterDeniedTrashJournal, {});

    assert.equal(staleTrash.outcome.status, 'failed');
    assert.equal(staleTrash.refusal, 'This file changed. Refresh and try again.');
    assert.equal(staleTrash.concurrent.input.expectedRevision, original.revision);
    assert.notEqual(staleTrash.concurrent.changed.revision, original.revision);
    assert.deepEqual(result.afterStaleTrash, staleTrash.concurrent.changed);
    assert.deepEqual(result.afterStaleTrashJournal, {});

    assert.equal(trashed.status, 'trashed');
    assert.equal(stored.id, original.id);
    assert.equal(deniedRestore.outcome.status, 'failed');
    assert.equal(deniedRestore.refusal, 'Choose a different name.');
    assert.equal(deniedRestore.concurrent.input.expectedRevision, stored.revision);
    assert.deepEqual(result.afterDeniedRestore, stored);
    assert.deepEqual(result.afterDeniedRestoreJournal, result.storedJournal);
    assert.deepEqual(result.visible, [{id: trashed.to, ...result.storedJournal[trashed.to]}]);
    assert.equal(restored.status, 'restored');
    assert.equal(restored.to, 'Download/owner (1).pdf');
    assert.equal(result.restoredOwner.id, original.id);
    assert.deepEqual(result.peerRow, deniedRestore.concurrent.peerRow);
    assert.deepEqual(result.trashEntries, []);
    assert.deepEqual(result.finalJournal, {});
  } finally {await browser.close();}
});
