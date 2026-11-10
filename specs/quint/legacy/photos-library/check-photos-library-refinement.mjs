import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium, expect as baseExpect} from '@playwright/test';
import {createServer} from 'vite';
import {checkClientFeatures} from '../../../../scripts/prepare-client-features.ts';
import {filesWithin, sha256, repositoryRoot as root} from '../../../../scripts/quint-lib.ts';
import {preloadPageModules} from '../../../../test/browser/helpers/page-modules.ts';
import {captureInputs, checkTraces, qmap, qset} from '../../refinement/check-traces.mjs';

const model = 'PhotosLibraryReplay';
const modelPath = 'test/fixtures/quint/PhotosLibraryComparison.qnt';
const cacheDir = resolve(root, 'test-results/quint-refinement/legacy-photos-vite-cache');
const main = resolve(root, 'apps/app/src/main.tsx');
const expect = baseExpect.configure({timeout: 15000});
const button = (page, name) => page.getByRole('button', {name, exact: true});
const view = (page, kind) => page.locator('[data-alpha-subview="photos-'+kind+'"]');
const library = '/src/prototype/browser-camera.ts';
const agent = '/src/prototype/photo-library-adapter.ts';
const action = (name, ...args) => ({name, args});

async function seed(page) {
  await preloadPageModules(page, [library, agent]);
  return page.evaluate(async path => {
    const {importBrowserPhoto, browserPhotoLibrary} = window.__alphaModules[path];
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 48;
    const draw = canvas.getContext('2d');
    const rows = [];
    for (const color of ['#b22', '#2a2', '#229']) {
      draw.fillStyle = color; draw.fillRect(0, 0, 64, 48);
      draw.fillStyle = '#fff'; draw.fillRect(0, 0, 20, 15);
      const row = await importBrowserPhoto({original: new File([], 'synthetic.jpg', {type: 'image/jpeg'}),
        image: canvas.toDataURL('image/jpeg'), width: 64, height: 48}, new AbortController().signal);
      await browserPhotoLibrary.setFavorite({id: row.id, revision: row.mutationRevision, favorite: true});
      rows.push(await browserPhotoLibrary.read({id: row.id}));
    }
    if (new Set(rows.map(row => row.id)).size !== 3) throw Error('Canonical import identities collided');
    // The actual store sorts by capture time and then identity. Use its order even on a timestamp tie.
    return (await browserPhotoLibrary.list()).items.reverse();
  }, library);
}

function tiles(page, kind = 'list') {
  return view(page, kind).locator('button[data-owned-media-id^="native-camera-"]');
}
const tile = (page, id, kind = 'list') => view(page, kind).locator('button[data-owned-media-id="native-camera-'+id+'"]');
const toast = page => page.locator('[data-alpha-toast] > .drop');
const review = page => page.getByRole('alertdialog', {name: 'Share 1 item?', exact: true});
const readRows = page => page.evaluate(async path => {
  const {browserPhotoLibrary} = window.__alphaModules[path];
  return [...(await browserPhotoLibrary.list()).items, ...(await browserPhotoLibrary.list({trashed: true})).items];
}, library);

async function state(page) {
  return page.evaluate(() => {
    const shell = window.quintLegacyPhotos;
    const value = shell.vget('photos');
    const root = document.querySelector('[data-alpha-subview="photos-'+(value.album === 'trash' ? 'album' : 'list')+'"]');
    const rows = [...root.querySelectorAll('button[data-owned-media-id^="native-camera-"]')];
    return {
      album: value.album,
      viewer: value.open ? String(value.open).replace(/^native-camera-/, '') : null,
      selecting: !!root.querySelector('button[aria-label="Cancel selection"]'),
      selected: rows.filter(row => row.getAttribute('aria-pressed') === 'true').map(row => row.dataset.ownedMediaId.replace(/^native-camera-/, '')),
      window: rows.map(row => row.dataset.ownedMediaId.replace(/^native-camera-/, '')),
      filter: !!root.querySelector('button[aria-label="Clear filter Favorites"]'),
      reviewed: !!document.querySelector('[role="alertdialog"][aria-label="Share 1 item?"]'),
    };
  });
}

async function schedule(page, name, seedRows) {
  const ids = new Map(seedRows.map((row, index) => [row.id, index+1]));
  const revisions = new Map(seedRows.map(row => [row.id, [row.mutationRevision]]));
  const number = id => {
    assert.ok(ids.has(id), 'Observed ID is one of the actual imported fixture rows');
    return ids.get(id);
  };
  async function project() {
    const ui = await state(page);
    const rows = await readRows(page);
    const map = new Map(rows.map(row => [number(row.id), row]));
    const props = {
      's.exists': qmap([1, 2, 3].map(id => [id, map.has(id)])),
      's.tab': ui.album === 'trash' ? 'trash' : 'lib',
      's.filter': ui.filter ? 'fav' : 'none',
      's.sel': qset(ui.selected.map(number)),
      's.selecting': ui.selecting,
      's.viewer': ui.viewer === null ? 0 : number(ui.viewer),
      Live: qset(rows.filter(row => !row.trashed).map(row => number(row.id))),
      InTrash: qset(rows.filter(row => row.trashed).map(row => number(row.id))),
      Window: qset(ui.window.slice(0, 2).map(number)),
      Reviewed: ui.reviewed,
      ProfileSafety: true,
    };
    for (const row of rows) {
      const history = revisions.get(row.id);
      if (!history.includes(row.mutationRevision)) history.push(row.mutationRevision);
      props['Favorite'+number(row.id)] = row.favorite;
      props['Revision'+number(row.id)] = Math.min(2, history.indexOf(row.mutationRevision));
    }
    return props;
  }
  const trace = {name, init: action('TestInit', 'Design'), expect: await project(), steps: []};
  return {trace, async point(label, next = null) {
    trace.steps.push({label, action: next, expect: await project()});
  }};
}

function divergence(trace, name, profile, count = trace.steps.length) {
  const copy = structuredClone(trace);
  copy.name = name;
  copy.init = action('TestInit', profile);
  copy.steps = copy.steps.slice(0, count);
  delete copy.expect.ProfileSafety;
  for (const step of copy.steps) delete step.expect.ProfileSafety;
  return copy;
}

async function openPhotos(page, rows) {
  await button(page, 'Photos').click();
  await expect(tiles(page)).toHaveCount(rows.length);
  const ids = await tiles(page).evaluateAll(nodes => nodes.map(node => node.dataset.ownedMediaId.replace(/^native-camera-/, '')));
  assert.deepEqual(ids, rows.map(row => row.id).reverse(), 'Actual mounted grid is newest first');
}

async function enterSelect(page, t, where = 'list') {
  await expect(toast(page)).toHaveCount(0);
  await page.locator(`summary[aria-label="${where === 'list' ? 'Photos tools' : 'Album options'}"]`).click();
  await button(page, where === 'list' ? 'Select photos' : 'Select items').click();
  await expect(view(page, where).getByRole('button', {name: 'Cancel selection', exact: true})).toBeVisible();
  await t.point('Mounted '+where+' selection mode opens empty', action('EnterSelect'));
}

async function toggle(page, t, row, id, where = 'list') {
  const control = tile(page, row.id, where);
  await control.click();
  await expect(control).toHaveAttribute('aria-pressed', 'true');
  await t.point('The exact visible photo '+id+' becomes selected', action('Toggle', id));
}

async function openTrash(page, t, row) {
  await expect(toast(page)).toHaveCount(0);
  await button(page, 'Albums').click();
  await button(page, 'Recently deleted').click();
  await expect(tile(page, row.id, 'album')).toBeVisible();
  await t.point('Recently deleted is a distinct mounted list', action('SwitchTab', 'trash'));
}

async function batch(page, rows) {
  await openPhotos(page, rows);
  const t = await schedule(page, 'visible_selection_patch_favorites_trash_restore_and_confirmed_delete', rows);
  const oldestWindow = divergence(t.trace, 'the_mounted_prefix_is_newest_not_oldest', 'AsBuilt_Window', 0);
  const wideWindow = divergence(t.trace, 'mounted_window_contains_more_than_historical_bound', 'Design', 0);
  const mountedIds = (await state(page)).window;
  wideWindow.expect.Window = qset(mountedIds.map(id => rows.findIndex(row => row.id === id)+1));
  await enterSelect(page, t);
  await toggle(page, t, rows[2], 3);
  await toggle(page, t, rows[1], 2);
  const cap = divergence(t.trace, 'mounted_selection_accepts_the_second_item', 'AsBuilt_Cap');
  await button(page, 'Unfavorite selected').click();
  await expect(page.locator('summary[aria-label="Photos tools"]')).toBeVisible();
  await expect(page.getByText('Removed 2 from Favorites', {exact: true})).toBeVisible();
  await t.point('All-favorite selection toggles both exact rows off', action('BatchFavorite'));
  const favorites = divergence(t.trace, 'favorite_is_reversible_for_a_selected_batch', 'AsBuilt_FavToggle');

  await enterSelect(page, t);
  await toggle(page, t, rows[2], 3);
  await page.evaluate(async id => {
    // A peer deletes one test-created row in the actual installed browser store.
    await new Promise((resolve, reject) => {
      const open = indexedDB.open('alpha.browser.photos.v1');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result, tx = db.transaction('photos', 'readwrite');
        tx.objectStore('photos').delete(id);
        tx.oncomplete = () => {db.close(); resolve();};
        tx.onabort = () => {db.close(); reject(tx.error);};
      };
    });
    window.quintLegacyPhotos.renderVals().photos.libraryRetry();
  }, rows[0].id);
  await expect(tile(page, rows[0].id)).toHaveCount(0);
  await expect(tile(page, rows[2].id)).toHaveAttribute('aria-pressed', 'true');
  await t.point('Real browser catalog readback preserves an unrelated selected identity', action('Remove', 1));
  const patch = divergence(t.trace, 'unrelated_removal_preserves_selection', 'AsBuilt_Patch');

  await button(page, 'Delete selected').click();
  await expect(tile(page, rows[2].id)).toHaveCount(0);
  await expect(page.locator('summary[aria-label="Photos tools"]')).toBeVisible();
  await t.point('Deleting the selection puts only that photo in Recently deleted', action('BatchTrash'));
  await openTrash(page, t, rows[2]);
  await enterSelect(page, t, 'album');
  await toggle(page, t, rows[2], 3, 'album');
  await button(page, 'Recover selected').click();
  await expect(tile(page, rows[2].id, 'album')).toHaveCount(0);
  await expect(button(page, 'Back to albums')).toBeVisible();
  await t.point('Recover selected restores the exact ID and exits selection', action('BatchRestore'));
  await button(page, 'Back to albums').click();
  await button(page, 'Library').click();
  await expect(tile(page, rows[2].id)).toBeVisible();
  await t.point('Returning from Albums exposes the restored image in Library', action('SwitchTab', 'lib'));
  await enterSelect(page, t);
  await toggle(page, t, rows[2], 3);
  await button(page, 'Delete selected').click();
  await expect(tile(page, rows[2].id)).toHaveCount(0);
  await expect(page.locator('summary[aria-label="Photos tools"]')).toBeVisible();
  await t.point('A second Trash action keeps the other surviving photo live', action('BatchTrash'));
  await openTrash(page, t, rows[2]);
  await enterSelect(page, t, 'album');
  await toggle(page, t, rows[2], 3, 'album');
  const confirmation = page.getByRole('dialog', {name: 'Delete photos forever', exact: true});
  await button(page, 'Delete selected forever').click();
  await confirmation.getByRole('button', {name: 'Cancel', exact: true}).click();
  await expect(confirmation).toHaveCount(0);
  await expect(tile(page, rows[2].id, 'album')).toHaveAttribute('aria-pressed', 'true');
  await t.point('Cancelling permanent deletion leaves the reviewed Trash item intact');
  await button(page, 'Delete selected forever').click();
  await confirmation.getByRole('button', {name: 'Delete forever', exact: true}).click();
  await expect(confirmation).toHaveCount(0);
  await expect(tile(page, rows[2].id, 'album')).toHaveCount(0);
  await expect(button(page, 'Back to albums')).toBeVisible();
  await t.point('Confirmed permanent deletion removes only the selected Trash identity', action('DeleteForever'));
  return {trace: t.trace, differences: [
    ['PhotosLibraryHistoricalOldestWindow', oldestWindow], ['PhotosLibraryMountedWindowWidth', wideWindow],
    ['PhotosLibraryHistoricalSelectionCap', cap], ['PhotosLibraryHistoricalFavoriteToggle', favorites],
    ['PhotosLibraryHistoricalSelectionClear', patch],
  ]};
}

async function reviewAndViewer(page, rows) {
  await openPhotos(page, rows);
  const t = await schedule(page, 'actual_viewer_filter_review_and_stale_share_guard', rows);
  const runView = operation => page.evaluate(async ({path, operation}) =>
    window.__alphaModules[path].deviceLibraryAgent().runView(operation, new AbortController().signal),
  {path: agent, operation});
  const target = rows[2];
  assert.equal((await runView({type: 'photos_open', id: target.id})).opened, true);
  await expect(view(page, 'viewer')).toBeVisible();
  await t.point('Opening exact imported identity selects its viewer', action('AgentOpen', 3));
  const viewport = await view(page, 'viewer').locator('[data-alpha-photo-viewport]').boundingBox();
  assert.ok(viewport, 'The current photo has a mounted swipe surface');
  await page.mouse.move(viewport.x+viewport.width*.7, viewport.y+viewport.height*.5);
  await page.mouse.down();
  await page.mouse.move(viewport.x+viewport.width*.3, viewport.y+viewport.height*.5, {steps: 8});
  await page.mouse.up();
  await expect.poll(async () => (await state(page)).viewer).toBe(rows[1].id);
  await t.point('Viewer horizontal swipe selects the adjacent canonical photo', action('Swipe', 2));
  const back = button(page, 'Back from photo');
  // The viewer tap reveals hidden chrome; use that public surface before its Back control.
  if (await back.evaluate(element => getComputedStyle(element.parentElement).pointerEvents) === 'none')
    await view(page, 'viewer').locator('[data-alpha-photo-viewport]').click();
  await back.click();
  await expect(view(page, 'viewer')).toHaveCount(0);
  await t.point('Back closes the viewer', action('CloseViewer'));

  await enterSelect(page, t);
  await toggle(page, t, target, 3);
  await button(page, 'Unfavorite selected').click();
  await expect(page.locator('summary[aria-label="Photos tools"]')).toBeVisible();
  await t.point('Owner unfavorites only the newest item', action('BatchFavorite'));
  const filtered = await runView({type: 'photos_filter', favorite: true});
  assert.equal(filtered.shown, 2);
  await expect(tile(page, target.id)).toHaveCount(0);
  await expect(button(page, 'Clear filter Favorites')).toBeVisible();
  await t.point('Actual agent filter excludes the unfavorited row without writing the library',
    action('AgentFilter', 'fav'));
  await button(page, 'Clear filter Favorites').click();
  await expect(tile(page, target.id)).toBeVisible();
  await t.point('Clearing the filter restores the original catalog', action('AgentFilter', 'none'));

  assert.equal((await runView({type: 'photos_share', ids: [target.id]})).status, 'review_opened');
  await expect(review(page)).toBeVisible();
  await t.point('Mounted agent review binds one visible ID before any handoff', action('ShareReview', 3));
  await review(page).getByRole('button', {name: 'Share', exact: true}).click();
  await expect(review(page)).toHaveCount(0);
  const shares = () => page.evaluate(() => window.closedPhotoShares);
  const accepted = await shares();
  assert.equal(accepted.length, 1);
  const expectedHash = await page.evaluate(async image => {
    const bytes = await (await fetch(image)).arrayBuffer();
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).join(',');
  }, target.image);
  assert.deepEqual(accepted, [[expectedHash]]);
  await t.point('The closed chooser gets exactly the reviewed bytes and the library stays unchanged', action('AgentApply'));

  assert.equal((await runView({type: 'photos_share', ids: [target.id]})).status, 'review_opened');
  await expect(review(page)).toBeVisible();
  await t.point('A second review still binds the existing exact revision', action('ShareReview', 3));
  await page.evaluate(async ({path, id}) => {
    const {browserPhotoLibrary} = window.__alphaModules[path];
    const before = await browserPhotoLibrary.read({id});
    await browserPhotoLibrary.setFavorite({id, revision: before.mutationRevision, favorite: true});
    window.quintLegacyPhotos.renderVals().photos.libraryRetry();
  }, {path: library, id: target.id});
  await expect(tile(page, target.id).locator('.photo-favorite-badge')).toHaveCount(1);
  await t.point('Peer mutation changes the actual reviewed revision while the confirmation remains open',
    action('StoreFavorite', 3));
  await review(page).getByRole('button', {name: 'Share', exact: true}).click();
  await expect(review(page)).toHaveCount(0);
  await expect(page.getByText('An item changed. Nothing was shared; ask again.', {exact: true})).toBeVisible();
  assert.deepEqual(await shares(), accepted);
  await t.point('Confirming the stale review refuses without another chooser call',
    [{...action('AgentApply'), reject: true}, action('AgentReject')]);
  return {trace: t.trace, differences: []};
}

async function editPhoto(page, rows, replace) {
  await openPhotos(page, rows);
  const t = await schedule(page, replace ? 'owned_browser_editor_replaces_exact_revision' : 'current_editor_can_save_a_distinct_copy', rows);
  await tile(page, rows[2].id).click();
  await expect(view(page, 'viewer')).toBeVisible();
  await t.point('Original photo opens in the actual viewer', action('OpenViewer', 3));
  await button(page, 'Edit photo').click();
  await expect(button(page, 'Save copy')).toBeEnabled();
  await expect(button(page, 'Replace original')).toBeEnabled();
  await button(page, 'Rotate').click();
  await expect(button(page, 'Save copy')).toBeEnabled();
  await button(page, replace ? 'Replace original' : 'Save copy').click();
  await expect(toast(page)).toContainText(replace ? 'Saved' : 'Copy saved');
  const result = await readRows(page);
  const original = result.find(row => row.id === rows[2].id);
  if (replace) {
    assert.equal(result.length, rows.length);
    assert.notEqual(original.mutationRevision, rows[2].mutationRevision);
    assert.notEqual(original.image, rows[2].image);
    await expect(view(page, 'edit')).toHaveCount(0);
    await expect.poll(async () => (await state(page)).viewer).toBe(original.id);
    await t.point('Replace original updates the exact owned ID without creating a copy', action('EditReplace'));
    return {trace: t.trace, differences: []};
  }
  const copy = result.find(row => !rows.some(prior => prior.id === row.id));
  assert.deepEqual(original, rows[2]);
  assert.ok(copy && copy.image !== original.image);
  assert.equal(result.length, rows.length+1);
  const diff = divergence(t.trace, 'save_copy_retains_the_original_revision', 'Design');
  diff.steps.push({label: 'Mounted Save copy creates a distinct ID and leaves the original revision intact',
    action: action('EditReplace'), expect: {Revision3: Number(original.mutationRevision !== rows[2].mutationRevision)}});
  return {trace: t.trace, differences: [['PhotosLibraryCurrentEditCopy', diff]]};
}

async function mounted(extraSources) {
  checkClientFeatures();
  const watched = new Set([main, ...['camera-adapter.ts', 'browser-camera.ts', 'photo-library-adapter.ts']
    .map(path => resolve(root, 'apps/app/src/prototype/'+path))]);
  const sources = [...new Set([
    ...filesWithin(resolve(root, 'apps/app/src')), ...filesWithin(resolve(root, '.eliza/client-features')),
    ...filesWithin(resolve(root, 'vendor/eliza/plugins/plugin-native-passwords/src')),
    ...filesWithin(resolve(root, 'vendor/eliza/plugins/plugin-native-system/src')),
    'vendor/eliza/packages/core/src/utils/uuid.ts',
    'apps/app/index.html', 'vite.config.ts', 'package.json', 'package-lock.json', 'upstream.lock.json',
    'scripts/prepare-client-features.ts', 'scripts/quint-lib.ts', 'scripts/browser-full-reload.ts',
    modelPath, fileURLToPath(import.meta.url),
    'test/browser/helpers/page-modules.ts', ...extraSources,
  ])];
  const driverHashes = captureInputs(sources), loaded = new Set();
  const previousMocks = process.env.ELIZA_DEV_ALLOW_TEST_MOCKS;
  let server, browser;
  try {
    process.env.ELIZA_DEV_ALLOW_TEST_MOCKS = '';
    server = await createServer({configFile: resolve(root, 'vite.config.ts'), logLevel: 'error', cacheDir,
      server: {host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: null},
      define: {'import.meta.env.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS': JSON.stringify('')},
      plugins: [{name: 'quint-legacy-photos-inputs', enforce: 'pre', transform(code, id) {
        const path = id.split('?')[0];
        if (path.startsWith(root+'/') && !path.startsWith(cacheDir+'/') && !path.includes('/node_modules/') && existsSync(path)) {
          assert.ok(driverHashes[path], 'Mounted source captured before execution: '+path);
          if (watched.has(path)) {
            assert.equal(sha256(Buffer.from(code)), driverHashes[path], 'Mounted source matches its before-driver capture');
            loaded.add(path);
          }
        }
        if (path === main) {
          const anchor = 'shell = value;';
          assert.equal(code.split(anchor).length, 2);
          return code.replace(anchor, anchor+' window.quintLegacyPhotos = value;');
        }
      }}]});
    await server.listen();
    browser = await chromium.launch({headless: true});
    const base = 'http://127.0.0.1:'+server.httpServer.address().port;
    const results = [];
    const replaceOriginal = (page, rows) => editPhoto(page, rows, true);
    const saveCopy = (page, rows) => editPhoto(page, rows, false);
    for (const run of [batch, reviewAndViewer, replaceOriginal, saveCopy]) {
      const page = await browser.newPage({viewport: {width: 412, height: 915}, hasTouch: true, reducedMotion: 'reduce'});
      page.setDefaultTimeout(40000);
      const foreign = [], errors = [], downloads = [];
      await page.route('**/*', route => {
        const request = route.request(), url = new URL(request.url());
        if (['data:', 'blob:'].includes(url.protocol)) return route.continue();
        if (url.origin === base && request.method() === 'GET'
            && !url.pathname.startsWith('/__alpha-') && !url.pathname.startsWith('/api/')) return route.continue();
        foreign.push(request.method()+' '+url.origin+url.pathname);
        return route.abort();
      });
      await page.routeWebSocket(/.*/, socket => {
        const url = new URL(socket.url());
        // Vite tries the selected HTTP port, then falls back to configured port 0.
        // Both disabled development sockets are closed without connecting.
        const vite = [base.replace(/^http:/, 'ws:'), 'ws://127.0.0.1:0'].includes(url.origin)
          && url.pathname === '/' && url.searchParams.has('token');
        if (!vite)
          foreign.push('WS '+url.origin+url.pathname);
        return socket.close();
      });
      page.on('pageerror', error => errors.push(error.message));
      page.on('download', event => downloads.push(event.suggestedFilename()));
      await page.addInitScript(() => {
        localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({kind: 'offline'}));
        if (navigator.mediaDevices)
          navigator.mediaDevices.getUserMedia = async () => {throw Error('Photos fixture forbids physical capture');};
        window.closedPhotoShares = [];
        Object.defineProperty(navigator, 'canShare', {configurable: true, value: ({files}) => Array.isArray(files) && files.length > 0});
        Object.defineProperty(navigator, 'share', {configurable: true, value: async ({files}) => {
          window.closedPhotoShares.push(await Promise.all(files.map(async file =>
            Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))).join(','))));
        }});
      });
      try {
        await page.goto(base+'/', {waitUntil: 'domcontentloaded', timeout: 60000});
        await page.waitForFunction(() => window.quintLegacyPhotos?.live);
        const rows = await seed(page);
        const navigations = [];
        page.on('framenavigated', frame => {if (frame === page.mainFrame()) navigations.push(frame.url());});
        results.push(await run(page, rows));
        assert.deepEqual(navigations, [], 'Replay retains its original mounted document and fixture');
        assert.deepEqual(foreign, [], 'External requests are fenced');
        assert.deepEqual(downloads, [], 'No browser download was opened');
        assert.deepEqual(errors, [], 'Mounted Photos reports no uncaught errors');
      } catch (error) {
        throw new Error('Mounted Photos '+run.name+' schedule failed: '+error.message, {cause: error});
      } finally {await page.close();}
    }
    assert.deepEqual([...loaded].sort(), [...watched].sort());
    return {results, sources, driverHashes};
  } finally {
    if (previousMocks === undefined) delete process.env.ELIZA_DEV_ALLOW_TEST_MOCKS;
    else process.env.ELIZA_DEV_ALLOW_TEST_MOCKS = previousMocks;
    try {await browser?.close();} finally {await server?.close();}
  }
}

export async function checkPhotosLibraryRefinement(extraSources = []) {
  const {results, sources, driverHashes} = await mounted(extraSources);
  const shared = {model, modelPath, sources, driverHashes, scope: 'bounded-orchestration', assumptions: [
    'Actual flag-off Photos and browser IndexedDB storage execute in Chromium with isolated synthetic pixels. Media capture and outside network are fenced. The share chooser is closed and records exact bytes.',
    'Historical media IDs rank the three actual imported identities oldest to newest. The original two-row window compares the newest-two mounted prefix; the full current three-row window has separate evidence. Mutation revisions are equality classes capped at the original bound.',
    'Albums is an intermediate route to Recently deleted. Selection, viewer and applied media changes are read from the actual mounted DOM, route owner and library. Peer removal is a controlled mutation of one fixture row followed by the real catalog refresh.',
    'The review begins at the installed Photos agent host and uses the visible confirmation. Remote transport and installed Android remain separate. Save copy is a discrete difference from the original EditReplace action.',
  ]};
  const receipt = await checkTraces({...shared, traces: results.map(result => result.trace)});
  const mismatches = [];
  for (const [id, trace] of results.flatMap(result => result.differences)) {
    const out = 'test-results/quint-refinement/'+id+'.json', receiptPath = resolve(root, out);
    await assert.rejects(checkTraces({...shared, id, out, traces: [trace]}), /Source\/model trace mismatch/);
    const mismatch = JSON.parse(readFileSync(receiptPath, 'utf8'));
    assert.equal(mismatch.results[0].kind, 'observation-mismatch');
    assert.ok(mismatch.driverInputsBound);
    mismatches.push({...mismatch, id, receiptPath});
  }
  return {receipts: [receipt], mismatches};
}
