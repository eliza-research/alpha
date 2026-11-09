import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {fileURLToPath} from 'node:url';
import {captureInputs, checkTraces, qmap, qset} from '../check-traces.mjs';
import {compilePhotosWindow, createPhotosWindowFixture} from './photos-window.mjs';
import {call, checkpoint, deferred, root, tick, trace} from './support.mjs';

const origin = 'https://closed-albums.invalid/';
const camera = 'apps/app/src/prototype/browser-camera.ts';
const documents = 'apps/app/src/browser/documents.ts';
const preferences = 'apps/app/src/browser/preference-documents.ts';
const projection = '.eliza/client-features';
const upstreamPath = 'packages/ui/src/platform/browser-document-store.ts';
const upstream = projection + '/' + upstreamPath;
const stampPath = projection + '/.source.json';
const lock = 'alpha.browser.photos.mutation.v1';
const model = 'BrowserAlbumStorage';
const modelPath = 'specs/quint/application/' + model + '.qnt';
const support = 'specs/quint/refinement/application/support.mjs';
const windowDriver = 'specs/quint/refinement/application/photos-window.mjs';

async function withBrowserAlbumStorage(browser, run, extraSources = []) {
  const read = path => readFileSync(resolve(root, path));
  const stamp = JSON.parse(read(stampPath));
  const hash = createHash('sha256').update(read(upstream)).digest('hex');
  assert.equal(stamp.baseCommit, JSON.parse(read('upstream.lock.json')).commit);
  assert.equal(hash, stamp.sourceFiles[upstreamPath]);
  assert.equal(hash, stamp.files[upstreamPath]);
  const built = await build({
    absWorkingDir: root,
    stdin: {resolveDir: root, contents: `
      import {browserPhotoLibrary, importBrowserPhoto} from './${camera}';
      import {browserDocuments} from './${documents}';
      import {albumDocument} from './${preferences}';
      const photos = browserPhotoLibrary;
      const compare = browserDocuments.compareExchange.bind(browserDocuments);
      const pending = new Map();
      let hold, release;
      browserDocuments.compareExchange = async (key, expected, raw, signal) => {
        if (key !== 'alpha.browser.albums.v1') throw Error('Unexpected document');
        if (hold) {
          hold = false;
          await new Promise(resolve => { release = resolve; });
          release = undefined;
        }
        return compare(key, expected, raw, signal);
      };
      globalThis.albumsFixture = {
        photos, albumDocument,
        seed: () => importBrowserPhoto({image:'data:image/jpeg;base64,AA==',width:1,height:1},new AbortController().signal),
        hold: () => { hold = true; },
        held: () => Boolean(release),
        release: () => release(),
        start(id, kind, input) {
          pending.set(id, photos[kind](input).then(value=>({value}), error=>({error:error.message})));
        },
        finish: id => pending.get(id),
      };
    `},
    bundle: true, write: false, format: 'iife', platform: 'browser', metafile: true,
    loader: {'.css': 'empty'}, define: {'import.meta.env': JSON.stringify({DEV: false})},
  });
  const sources = [...new Set([fileURLToPath(import.meta.url), camera, documents, preferences, upstream, stampPath,
    modelPath, support, 'upstream.lock.json', ...Object.keys(built.metafile.inputs).filter(path => !path.startsWith('<') && !path.includes('node_modules/')),
    ...extraSources])];
  const driverHashes = captureInputs(sources);
  const context = await browser.newContext({serviceWorkers: 'block'});
  try {
    await context.route('**/*', route => route.request().url() === origin
      ? route.fulfill({contentType: 'text/html', body: '<!doctype html><title>Closed albums fixture</title>'})
      : route.abort());
    const pages = await Promise.all([context.newPage(), context.newPage()]);
    await Promise.all(pages.map(async page => {
      await page.goto(origin, {waitUntil: 'domcontentloaded', timeout: 90_000});
      await page.addScriptTag({content: built.outputFiles[0].text});
    }));
    const [first, other] = pages;
    const call = (page, method, ...args) => page.evaluate(([method, args]) => globalThis.albumsFixture[method](...args), [method, args]);
    const photo = (page, method, input) => page.evaluate(([method, input]) => globalThis.albumsFixture.photos[method](input), [method, input]);
    const outcome = (page, method, input) => page.evaluate(async ([method, input]) => {
      try {return {value: await globalThis.albumsFixture.photos[method](input)};}
      catch (error) {return {error: error.message};}
    }, [method, input]);
    const capture = page => page.evaluate(() => globalThis.albumsFixture.albumDocument.capture());
    return await run({first, other, invoke: call, photo, outcome, capture, sources, driverHashes});
  } finally {await context.close();}
}

const errorClass = error => {
  if (!error) return 'updated';
  if (error.startsWith('Photo changed.') || error.startsWith('Photo changed in another tab.')) return 'media-changed';
  if (error.startsWith('Album changed.')) return 'album-changed';
  throw Error(error);
};

export async function checkBrowserAlbumStorage(extraSources = []) {
  const browser = await chromium.launch();
  try {return await runBrowserAlbumStorage(browser, extraSources);}
  finally {await browser.close();}
}

async function runBrowserAlbumStorage(browser, extraSources) {
  const renderer = await compilePhotosWindow([windowDriver]);
  const traces = [];
  let sources, driverHashes;
  async function scenario(name, run) {
    await withBrowserAlbumStorage(browser, async ports => {
      ({sources, driverHashes} = ports);
      const {first, other, invoke, photo, outcome, capture} = ports;
      const media = new Map();
      for (const id of [1, 2, 3]) media.set(id, await invoke(first, 'seed'));
      const ids = new Map([...media].map(([id, row]) => [row.id, id]));
      const mediaRevs = new Map([...media].map(([id, row]) => [id, new Map([[row.mutationRevision, 1]])]));
      const revisions = new Map();
      let serial = 0, albumId, held = 0, heldRevision = 0, waiting = 0;
      let albumResult = 'none', mediaResult = 'none';
      const token = (id, revision) => {
        const value = mediaRevs.get(id).get(revision);
        assert.ok(value, 'A request used an observed media mutation revision');
        return value;
      };
      const mediaPayload = (id, revision) => {
        const entry = [...mediaRevs.get(id)].find(([, value]) => value === revision);
        assert.ok(entry, 'Fixture has the requested media revision');
        return {mediaId: media.get(id).id, mediaRevision: entry[0]};
      };
      const albumPayload = (expected) => {
        const entry = [...revisions].find(([, value]) => value === expected);
        assert.ok(entry && albumId, 'Fixture has the requested album revision');
        return {id: albumId, revision: entry[0]};
      };
      const recordAlbum = result => {
        albumResult = errorClass(result.error);
        if (result.value) {
          const {id, revision, status} = result.value;
          if (albumId) assert.equal(id, albumId);
          albumId = id;
          assert.equal(status, 'updated');
          assert.ok(!revisions.has(revision), 'Album revision advances even for duplicate adds');
          revisions.set(revision, ++serial);
        }
      };
      const recordMedia = (id, result) => {
        mediaResult = errorClass(result.error);
        if (result.value) {
          const {mutationRevision, id: rawId} = result.value;
          assert.equal(rawId, media.get(id).id);
          const known = mediaRevs.get(id);
          assert.ok(!known.has(mutationRevision), 'Photo revision advances');
          known.set(mutationRevision, known.size + 1);
        }
      };
      const lockQueue = () => other.evaluate(async name =>
        (await navigator.locks.query()).pending.filter(request => request.name === name).length, lock);
      const observe = async () => {
        const saved = await capture(first);
        const [album, ...extra] = JSON.parse(saved.raw ?? '[]');
        assert.equal(extra.length, 0);
        if (album) {
          assert.equal(album.id, albumId);
          assert.equal(album.count, album.memberIds.length);
          assert.ok(revisions.has(album.revision));
        }
        const rows = await Promise.all([...media].map(async ([id, row]) => [id, await photo(other, 'read', {id: row.id})]));
        const {items} = await photo(first, 'albums');
        assert.equal(items.length, album ? 1 : 0);
        const count = items[0]?.count ?? 0;
        const seenHeld = await invoke(first, 'held');
        const seenQueue = await lockQueue();
        assert.equal(seenHeld, Boolean(held));
        assert.equal(seenQueue, waiting ? 1 : 0);
        return {'s.media': qmap(rows.map(([id, row]) => [id, token(id, row.mutationRevision)])),
          's.trashed': qset(rows.filter(([, row]) => row.trashed).map(([id]) => id)),
          's.album': album ? revisions.get(album.revision) : 0, 's.serial': serial,
          's.name': album?.name ?? '', 's.members': qset((album?.memberIds ?? []).map(id => {
            assert.ok(ids.has(id), 'Durable membership is for exact selected media');
            return ids.get(id);
          })),
          's.held': seenHeld ? held : 0, 's.heldRevision': seenHeld ? heldRevision : 0,
          's.waiting': seenQueue ? waiting : 0, 's.albumResult': albumResult, 's.mediaResult': mediaResult,
          visibleCount: count};
      };
      const replay = trace(name, await observe());
      const mark = async (label, action) => checkpoint(replay, label, action, await observe());
      const change = async (operation, expected = 0, id = 0, revision = 0, name = '') => {
        const input = {operation, name, ...(expected ? albumPayload(expected) : {}),
          ...(id ? mediaPayload(id, revision) : {})};
        const result = await outcome(first, 'changeAlbum', input);
        recordAlbum(result);
        await mark(operation, call('changeAlbum', operation, expected, id, revision, name));
      };
      const write = async (id, revision, trashed) => {
        const {mediaId, mediaRevision} = mediaPayload(id, revision);
        const result = await outcome(other, trashed ? 'setTrashed' : 'setFavorite', {
          id: mediaId, revision: mediaRevision, ...(trashed ? {trashed: true} : {favorite: true}),
        });
        recordMedia(id, result);
        await mark('second tab writes exact media revision', call('writeMedia', id, revision, trashed));
      };
      const holdAdd = async (id, expected, revision) => {
        await invoke(first, 'hold');
        await invoke(first, 'start', 'album', 'changeAlbum', {
          operation: 'add', ...albumPayload(expected), ...mediaPayload(id, revision),
        });
        await first.waitForFunction(() => globalThis.albumsFixture.held(), null, {timeout: 90_000});
        held = id; heldRevision = revision;
        await mark('media validated and album CAS held', call('holdAdd', id, expected, revision));
      };
      const queueTrash = async (id, revision) => {
        const {mediaId, mediaRevision} = mediaPayload(id, revision);
        await invoke(other, 'start', 'media', 'setTrashed', {id: mediaId, revision: mediaRevision, trashed: true});
        await other.waitForFunction(async name =>
          (await navigator.locks.query()).pending.some(request => request.name === name), lock, {timeout: 90_000});
        waiting = id;
        await mark('second tab queues trash before album can commit', call('queueTrash', id));
      };
      const settle = async () => {
        await invoke(first, 'release');
        recordAlbum(await invoke(first, 'finish', 'album'));
        recordMedia(waiting, await invoke(other, 'finish', 'media'));
        held = 0; heldRevision = 0; waiting = 0;
        await mark('album commit releases custody to queued trash', [call('settleAdd'), call('settleQueuedTrash')]);
      };
      const batch = async () => {
        const complete = deferred();
        let calls = 0;
        const fixture = await createPhotosWindowFixture(renderer, {
          albumPort: {
            albums: () => photo(first, 'albums'),
            async changeAlbum(input) {
              try {
                const result = await outcome(first, 'changeAlbum', input);
                const selected = ids.get(input.mediaId);
                assert.equal(selected, ++calls, 'Each shown item dispatched exactly once in order');
                assert.equal(input.operation, 'add');
                assert.equal(input.id, albumId);
                const expected = revisions.get(input.revision);
                assert.equal(expected, calls === 1 ? 1 : 2, 'Batch carries the current album receipt');
                const selectedRevision = token(selected, input.mediaRevision);
                assert.equal(selectedRevision, 1, 'Batch preserves the selected media revision');
                recordAlbum(result);
                await mark('rendered batch member ' + calls, call('changeAlbum', 'add', expected, selected, selectedRevision, ''));
                if (calls === 3) complete.resolve();
                if (result.error) throw Error(result.error);
                return result.value;
              } catch (error) {
                if (calls < 3 && !(error instanceof Error && error.message.startsWith('Photo changed.'))) complete.reject(error);
                throw error;
              }
            },
          },
        });
        let timer;
        try {
          await fixture.render();
          await fixture.access(0);
          await fixture.page(0, [...media.values()].map((row, index) => ({...row, date: 3-index})));
          (await fixture.render()).selStart();
          (await fixture.render()).selAll();
          const button = fixture.document.createElement('button');
          (await fixture.render()).selAlbum({currentTarget: button});
          // The renderer reads the real durable album list through the closed library port.
          let choice;
          for (let attempt = 0; attempt < 30 && !choice; attempt++) {
            choice = (await fixture.render()).am.items.find(item => item.id === 'custom:' + albumId);
            if (!choice) await new Promise(resolve => setTimeout(resolve, 20));
          }
          assert.ok(choice);
          choice.go();
          await Promise.race([complete.promise, new Promise((_, reject) => {
            timer = setTimeout(() => reject(Error('Closed Photos batch did not settle')), 30_000);
          })]);
          await tick();
          assert.ok(fixture.toasts.some(value => String(value).includes('Added 2 to “Album” · 1 not added')),
            JSON.stringify(fixture.toasts));
        } finally {clearTimeout(timer); await fixture.close();}
      };
      await run({change, write, holdAdd, queueTrash, settle, batch});
      traces.push(replay);
    }, [...renderer.sources, windowDriver, ...extraSources]);
  }
  await scenario('album commit orders before the other tab changes selected media', async c => {
    await c.change('create', 0, 0, 0, 'Album'); await c.holdAdd(1, 1, 1); await c.queueTrash(1, 1); await c.settle();
  });
  await scenario('a prior media mutation refuses stale membership and a retry can use its new revision', async c => {
    await c.change('create', 0, 0, 0, 'Album'); await c.write(1, 1, false);
    await c.change('add', 1, 1, 1); await c.change('add', 1, 1, 2);
    await c.change('add', 2, 1, 2); await c.change('remove', 3, 1, 2);
  });
  await scenario('rename retires the old album revision and deletion removes only metadata', async c => {
    await c.change('create', 0, 1, 1, 'Album'); await c.change('rename', 1, 0, 0, 'Renamed');
    await c.change('add', 1, 2, 1); await c.change('delete', 1); await c.change('delete', 2);
  });
  await scenario('rendered multi-item membership skips stale media then continues with the current receipt', async c => {
    await c.change('create', 0, 0, 0, 'Album'); await c.write(2, 1, true); await c.batch();
  });
  return checkTraces({model, modelPath, sources, driverHashes, traces, scope: 'bounded-orchestration',
    assumptions: [
      'Two isolated Chromium tabs execute the real BrowserDocumentStore, browser photo library, and Photos IndexedDB. All browser requests stay within an intercepted synthetic origin.',
      'A held compareExchange executes the real album CAS after release. Lock-queue and durable snapshots are observed. Other platform versions, process loss and actual device libraries are separate.',
      'The real renderer batch runs with controlled UI and native ports, forwarding exact album requests to the closed browser library. Three selected photos, one stale revision, one album and bounded writes.',
    ]});
}
