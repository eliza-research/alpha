import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium, expect as baseExpect} from '@playwright/test';
import {createServer} from 'vite';
import {checkClientFeatures} from '../../../../scripts/prepare-client-features.mjs';
import {filesWithin, sha256, repositoryRoot as root} from '../../../../scripts/quint-lib.mjs';
import {fenceNetwork} from '../../../../test/browser/flag-off-android.ts';
import {preloadPageModules} from '../../../../test/browser/helpers/page-modules.ts';
import {captureInputs, checkTraces, qmap, qset} from '../../refinement/check-traces.mjs';

const model = 'FilesBrowserReplay';
const modelPath = 'test/fixtures/quint/FilesBrowserComparison.qnt';
const cacheDir = resolve(root, 'test-results/quint-refinement/legacy-files-vite-cache');
const expect = baseExpect.configure({timeout: 15000});
const files = page => page.getByRole('region', {name: 'Files', exact: true});
const detail = page => page.locator('[data-alpha-subview="files-folder"]');
const button = (page, name) => files(page).getByRole('button', {name, exact: true});
const dialog = (page, name) => page.getByRole('dialog', {name, exact: true});
const toolbar = page => page.getByRole('toolbar', {name: 'Selection actions'});
const action = (name, ...args) => ({name, args});
const photoPath = 'DCIM/Camera/shared.bin';
const names = new Map([['shared.bin', 1], ['shared (1).bin', 2]]);

async function seed(page) {
  await preloadPageModules(page, ['/src/platform-plugins.ts', '/src/prototype/model.js', '/src/runtime/alpha-client.ts']);
  await page.evaluate(async () => {
    const {registerPlugin} = window.__alphaModules['/src/platform-plugins.ts'];
    const storage = registerPlugin('AlphaFiles');
    const dirs = {};
    for (const [parent, name] of [['', 'DCIM'], ['DCIM', 'Camera'], ['', 'Download'], ['', 'Documents']]) {
      const created = await storage.storageCreateFolder({parent, name});
      if (created.status !== 'ready') throw Error('Fixture folder creation failed');
      const parentId = dirs[parent];
      const row = (await storage.list({id: parentId})).entries.find(entry => entry.name === name);
      if (!row?.directory) throw Error('Fixture folder identity missing');
      dirs[parent ? parent+'/'+name : name] = row.id;
    }
    const ids = {};
    const image = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9XQAAAAASUVORK5CYII='), char => char.charCodeAt(0));
    for (const [kind, folder, mime, content] of [
      ['photo', 'DCIM/Camera', 'image/png', image], ['pdf', 'Download', 'application/pdf', '%PDF synthetic fixture bytes'],
    ]) {
      const selected = await storage.importFile(new File([content], 'shared.bin', {type: mime}), dirs[folder]);
      await storage.forgetSelected({selectionId: selected.selectionId});
      ids[kind] = (await storage.list({id: dirs[folder]})).entries.find(entry => entry.name === 'shared.bin').id;
    }
    window.filesFixture = {storage, dirs, ids};
  });
}

async function readStorage(page) {
  return page.evaluate(async () => {
    const {storage, dirs, ids} = window.filesFixture;
    const hidden = (await storage.list({})).entries.find(entry => entry.name === '.Trash-alpha');
    const trash = await storage.storageTrashList();
    if (trash.status !== 'ready') throw Error('Actual Trash read failed');
    const rows = await Promise.all([...Object.entries(dirs), ...(hidden ? [['trash', hidden.id]] : [])].map(async ([folder, id]) =>
      [folder, (await storage.list({id})).entries]));
    const actualIds = rows.flatMap(([, entries]) => entries.filter(row => !row.directory).map(row => row.id));
    if (actualIds.some(id => !Object.values(ids).includes(id))) throw Error('Unexpected file in bounded fixture');
    const current = Object.fromEntries(Object.entries(ids).map(([file, id]) => {
      const listing = rows.find(([, entries]) => entries.some(entry => entry.id === id));
      if (!listing) return [file, {place: 'gone'}];
      const [place, entries] = listing;
      const item = entries.find(entry => entry.id === id);
      const tombstone = place === 'trash' ? trash.items.find(entry => entry.id === item.name) : null;
      if (place === 'trash' && !tombstone) throw Error('Canonical trashed ID lacks a Trash record');
      return [file, {place, name: tombstone?.name ?? item.name, origin: tombstone?.origin ?? null}];
    }));
    const membership = Object.fromEntries(await Promise.all(['Downloads', 'Images', 'Documents', 'Audio'].map(async category => {
      const result = await storage.storageCategory({category: category.toLowerCase()});
      if (result.status !== 'ready') throw Error('Actual category read failed');
      return [category, result.entries.map(entry => {
        const matched = Object.entries(current).find(([, row]) => row.place+'/'+row.name === entry.path);
        if (!matched) throw Error('Category read included an unrecognized fixture file: '+entry.path);
        return matched[0];
      })];
    })));
    return {current, membership};
  });
}

async function observe(page) {
  const state = await readStorage(page);
  const pressed = await detail(page).locator('button[aria-pressed="true"][aria-label^="Deselect "]').evaluateAll(rows =>
    rows.map(row => row.getAttribute('aria-label').slice('Deselect '.length)));
  // The selected folder still owns its paths while the modal makes it inert.
  const breadcrumbs = await detail(page).locator('nav[aria-label="Folder path"]').evaluateAll(rows =>
    rows.map(row => [...row.querySelectorAll('button,[aria-current="location"]')].map(node => node.textContent.trim()).slice(1).join('/')));
  const observation = {
    's.loc': qmap([['scan', 'gone'], ...Object.entries(state.current).map(([file, row]) => [file, row.place])]),
    's.sel': qset(pressed.map(name => {
      const owner = Object.entries(state.current).find(([, row]) => row.place === breadcrumbs[0] && row.name === name);
      assert.ok(owner, 'Mounted selected row binds to a canonical ID in the visible folder');
      return owner[0];
    })),
    ProfileSafety: true,
  };
  if (['DCIM/Camera', 'Download', 'Documents'].includes(breadcrumbs[0])) observation['s.cwd'] = breadcrumbs[0];
  for (const [label, members] of Object.entries(state.membership)) observation[label] = qset(members);
  for (const [file, field] of [['photo', 'PhotoName'], ['pdf', 'PdfName']]) {
    const row = state.current[file];
    if (row.name) {
      assert.ok(names.has(row.name), 'File has a recognized fixture name');
      observation[field] = names.get(row.name);
    }
  }
  if (state.current.photo.origin) observation.PhotoOrigin = state.current.photo.origin;
  return observation;
}

async function returnBrowse(page) {
  for (let depth = 0; depth < 4 && await detail(page).isVisible(); depth++)
    await detail(page).getByRole('button', {name: 'Back', exact: true}).click();
  await expect(detail(page)).toHaveCount(0);
  await expect(button(page, 'Internal storage')).toBeVisible();
}

async function openCamera(page) {
  await button(page, 'Images').click();
  const group = button(page, 'Open Camera');
  await expect(group).toContainText('DCIM/Camera');
  await expect(group).toContainText('1');
  await expect(button(page, 'Open shared.bin')).toHaveCount(0);
  await group.click();
  await expect(detail(page).locator('[aria-current="location"]')).toHaveText('Camera');
  await expect(button(page, 'Open shared.bin')).toBeVisible();
}

async function openDownload(page) {
  await button(page, 'Internal storage').click();
  await button(page, 'Open Download').click();
  await expect(detail(page).locator('[aria-current="location"]')).toHaveText('Download');
}

async function select(page, name) {
  await button(page, 'Sort files').click();
  await button(page, 'Select').click();
  await button(page, 'Select '+name).click();
  await expect(button(page, 'Deselect '+name)).toHaveAttribute('aria-pressed', 'true');
  await expect(detail(page).getByText('1 selected', {exact: true})).toBeVisible();
}

async function schedule(page, name) {
  const trace = {name, init: action('TestInit', 'Design'), expect: await observe(page), steps: []};
  assert.equal(trace.expect['s.cwd'], 'DCIM/Camera');
  return {trace, async point(label, actions, extra = {}) {
    trace.steps.push({label, action: actions, expect: {...await observe(page), ...extra}});
  }};
}

function negative(trace, name, profile, prefixLength, replaceLast) {
  const copy = structuredClone(trace);
  copy.name = name;
  copy.init = action('TestInit', profile);
  copy.steps = copy.steps.slice(0, prefixLength);
  delete copy.expect.ProfileSafety;
  for (const step of copy.steps) delete step.expect.ProfileSafety;
  if (replaceLast) copy.steps.at(-1).action = replaceLast;
  return copy;
}

async function collisionAndTrash(page) {
  await button(page, 'Downloads').click();
  await expect(detail(page).getByRole('heading', {name: 'Downloads', exact: true})).toBeVisible();
  await expect(button(page, 'Open shared.bin')).toHaveCount(1);
  await returnBrowse(page);
  await openCamera(page);
  const t = await schedule(page, 'grouped_images_download_query_collision_trash_and_restore');
  await select(page, 'shared.bin');
  await t.point('Visible selection identifies the canonical image', action('Toggle', 'photo'));
  await toolbar(page).getByRole('button', {name: 'Move', exact: true}).click();
  await dialog(page, 'Move to').getByRole('button', {name: 'Open Download', exact: true}).click();
  await t.point('Opening and navigating the destination chooser leaves both canonical rows unchanged', null);
  await dialog(page, 'Move to').getByRole('button', {name: 'Move here', exact: true}).click();
  await expect(dialog(page, 'Move to')).toHaveCount(0);
  await expect(button(page, 'Open shared.bin')).toHaveCount(0);
  await t.point('Confirmed move creates a distinct name and retains the destination PDF', action('MoveSel', 'Download'));
  const collision = t.trace.steps.length;
  await returnBrowse(page);
  await openDownload(page);
  await expect(button(page, 'Open shared.bin')).toBeVisible();
  await expect(button(page, 'Open shared (1).bin')).toBeVisible();
  await t.point('Physical Download folder lists both canonical IDs', action('Navigate', 'Download'));
  await select(page, 'shared (1).bin');
  await t.point('Only the moved image is selected', action('Toggle', 'photo'));
  await toolbar(page).getByRole('button', {name: 'Delete', exact: true}).click();
  await expect(toolbar(page)).toHaveCount(0);
  await expect(button(page, 'Open shared (1).bin')).toHaveCount(0);
  await t.point('Delete moves the selected ID into reversible Trash', action('TrashSel'));
  await returnBrowse(page);
  await button(page, 'Trash').click();
  await button(page, 'shared (1).bin').click();
  await dialog(page, 'shared (1).bin').getByRole('button', {name: 'Restore', exact: true}).click();
  await expect(dialog(page, 'shared (1).bin')).toHaveCount(0);
  await expect(button(page, 'shared (1).bin')).toHaveCount(0);
  await t.point('Restore returns the same canonical ID to its prior folder', action('Restore', 'photo'));
  await returnBrowse(page);
  await openDownload(page);
  await select(page, 'shared (1).bin');
  await t.point('The restored file can be selected again', action('Toggle', 'photo'));
  await toolbar(page).getByRole('button', {name: 'Delete', exact: true}).click();
  await expect(button(page, 'Open shared (1).bin')).toHaveCount(0);
  await t.point('A second Trash operation still leaves the PDF intact', action('TrashSel'));
  await returnBrowse(page);
  await button(page, 'Trash').click();
  await button(page, 'Empty').click();
  await dialog(page, 'Empty Trash?').getByRole('button', {name: 'Cancel', exact: true}).click();
  await expect(button(page, 'shared (1).bin')).toBeVisible();
  await t.point('Cancelling Empty Trash retains the reversible item', null);
  await button(page, 'Empty').click();
  await dialog(page, 'Empty Trash?').getByRole('button', {name: 'Empty', exact: true}).click();
  await expect(dialog(page, 'Empty Trash?')).toHaveCount(0);
  await expect(button(page, 'shared (1).bin')).toHaveCount(0);
  await t.point('Confirmed Empty retires only the trashed ID', action('EmptyTrash', 'photo'));
  return {trace: t.trace, differences: [
    ['FilesBrowserHistoricalDownloads', negative(t.trace, 'downloads_is_a_real_location_query', 'AsBuilt_Categories', 0)],
    ['FilesBrowserHistoricalOverwrite', negative(t.trace, 'collision_preserves_both_existing_ids', 'Ablate_Conflict', collision)],
  ]};
}

async function review(page) {
  await openCamera(page);
  const t = await schedule(page, 'mounted_review_token_rejects_rewrite_then_accepts_fresh_owner');
  const execute = reviewed => page.evaluate(async ({path, reviewed}) => {
    const runner = window.__alphaModules['/src/prototype/model.js'].Component.prototype.filesAgent;
    return runner.run({type: 'files_move', paths: [path], dest: 'Download', ...(reviewed ? {reviewed} : {})}, new AbortController().signal);
  }, {path: photoPath, reviewed});
  const token = () => page.evaluate(async path =>
    window.__alphaModules['/src/prototype/model.js'].Component.prototype.filesAgent.reviewedIdentities([path], new AbortController().signal), photoPath);
  assert.equal((await execute()).status, 'failed');
  await t.point('Effect with no reviewed canonical identity refuses before storage mutation', null);
  const reviewed = await token();
  assert.equal(reviewed.length, 1);
  await t.point('The visible folder admits one exact canonical identity for review', action('AgentPropose', 'photo', 'Download'));
  const reissue = await page.evaluate(async path => {
    const {storage} = window.filesFixture;
    const away = await storage.storageRename({path, name: 'rewritten.bin'});
    const back = await storage.storageRename({path: away.path, name: 'shared.bin'});
    return [away.status, back.status];
  }, photoPath);
  assert.deepEqual(reissue, ['ready', 'ready']);
  await expect(button(page, 'Open shared.bin')).toBeVisible();
  const fresh = await token();
  assert.notDeepEqual(fresh, reviewed, 'A changed revision keeps the path and retires the exact token');
  await t.point('An external same-path rewrite changes the actual review token', action('Rewrite', 'photo'),
    {PhotoVersion: Number(fresh[0] !== reviewed[0])});
  assert.deepEqual(await execute(reviewed), {status: 'failed', summary: 'Moved 0 of 1.'});
  await expect(button(page, 'Sort files')).toBeVisible();
  await expect(button(page, 'Open shared.bin')).toBeVisible();
  await t.point('Dispatch with the old token refuses without moving the rewritten file',
    [action('AgentRefused'), action('Refresh')]);
  const stale = t.trace.steps.length;
  await t.point('The same folder admits a freshly observed review token', action('AgentPropose', 'photo', 'Download'));
  assert.deepEqual(await execute(fresh), {status: 'succeeded', summary: 'Moved 1 of 1.'});
  await expect(button(page, 'Open shared.bin')).toHaveCount(0);
  await t.point('Fresh exact review moves only the reviewed canonical file', action('AgentApply'));
  return {trace: t.trace, differences: [
    ['FilesBrowserHistoricalStaleReview', negative(t.trace, 'same_path_rewrite_does_not_inherit_review', 'AsBuilt_Identity', stale,
      [action('AgentApply'), action('Refresh')])],
  ]};
}

async function removedSelection(page) {
  await openCamera(page);
  const t = await schedule(page, 'mounted_preview_and_storage_refresh_retire_stale_selection');
  await button(page, 'Open shared.bin').click();
  const context = () => page.evaluate(() => window.__alphaModules['/src/runtime/alpha-client.ts'].alphaClient.getState().context);
  await expect.poll(async () => (await context()).selectedObject?.kind).toBe('document');
  const opened = (await context()).selectedObject;
  assert.ok(opened.id && opened.revision);
  await page.evaluate(() => window.dispatchEvent(new Event('alpha-back', {cancelable: true})));
  await expect(button(page, 'Open shared.bin')).toBeVisible();
  await expect.poll(async () => (await context()).selectedObject?.id === opened.id).toBe(false);
  await t.point('Preview identity belongs to the open document and retires on Back', null);
  await select(page, 'shared.bin');
  await t.point('A physical folder selection precedes a peer removal', action('Toggle', 'photo'));
  const removed = await page.evaluate(async path => {
    const {storage} = window.filesFixture;
    const trashed = await storage.storageTrash({paths: [path]});
    if (trashed.outcomes?.[0]?.status !== 'trashed') return false;
    return (await storage.storageEmptyTrash({ids: [trashed.outcomes[0].to], confirmed: true})).count === 1;
  }, photoPath);
  assert.equal(removed, true);
  await expect(button(page, 'Deselect shared.bin')).toHaveCount(0);
  await expect(toolbar(page).getByRole('button', {name: 'Delete', exact: true})).toBeDisabled();
  await t.point('Real storage notification reload drops the removed selection and disables Delete',
    [action('Remove', 'photo'), action('Refresh')]);
  return {trace: t.trace, differences: []};
}

async function mounted(extraSources) {
  checkClientFeatures();
  const watched = new Set([
    'apps/app/src/main.tsx', 'apps/app/src/browser/files.ts', 'apps/app/src/prototype/selection-adapter.ts',
    '.eliza/client-features/plugins/plugin-files/src/browser/files-browser-adapter.ts',
    '.eliza/client-features/plugins/plugin-files/src/browser/storage-volume.ts',
  ].map(path => resolve(root, path)));
  const sources = [...new Set([
    ...filesWithin(resolve(root, 'apps/app/src')), ...filesWithin(resolve(root, '.eliza/client-features')),
    ...filesWithin(resolve(root, 'config')), ...filesWithin(resolve(root, 'patches/eliza')),
    ...filesWithin(resolve(root, 'vendor/eliza/plugins/plugin-native-passwords/src')),
    ...filesWithin(resolve(root, 'vendor/eliza/plugins/plugin-native-system/src')),
    'vendor/eliza/packages/core/src/utils/uuid.ts',
    'apps/app/index.html', 'vite.config.ts', 'package.json', 'package-lock.json', 'upstream.lock.json',
    'scripts/prepare-client-features.mjs', 'scripts/quint-lib.mjs', modelPath, fileURLToPath(import.meta.url),
    'test/browser/flag-off-android.ts', 'test/browser/helpers/native-navigation-protocol.ts',
    'test/browser/helpers/page-modules.ts', ...extraSources,
  ])];
  const driverHashes = captureInputs(sources);
  const loaded = new Set();
  const previousMocks = process.env.ELIZA_DEV_ALLOW_TEST_MOCKS;
  let server, browser;
  try {
    process.env.ELIZA_DEV_ALLOW_TEST_MOCKS = '';
    server = await createServer({configFile: resolve(root, 'vite.config.ts'), logLevel: 'error', cacheDir,
      server: {host: '127.0.0.1', port: 0, strictPort: false},
      define: {'import.meta.env.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS': JSON.stringify('')},
      plugins: [{name: 'quint-legacy-files-inputs', enforce: 'pre', transform(code, id) {
        const path = id.split('?')[0];
        if (path.startsWith(root+'/') && !path.startsWith(cacheDir+'/') && !path.includes('/node_modules/') && existsSync(path)) {
          assert.ok(driverHashes[path], 'Mounted source captured before execution: '+path);
          if (watched.has(path)) {
            assert.equal(sha256(Buffer.from(code)), driverHashes[path], 'Mounted source matches its before-driver capture');
            loaded.add(path);
          }
        }
      }}]});
    await server.listen();
    browser = await chromium.launch({headless: true});
    const base = 'http://127.0.0.1:'+server.httpServer.address().port;
    const results = [];
    for (const run of [collisionAndTrash, review, removedSelection]) {
      const page = await browser.newPage({viewport: {width: 412, height: 915}, hasTouch: true, reducedMotion: 'reduce'});
      page.setDefaultTimeout(30000);
      const foreign = await fenceNetwork(page), errors = [], downloads = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('download', event => downloads.push(event.suggestedFilename()));
      await page.addInitScript(() => {
        localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({kind: 'offline'}));
        if (navigator.mediaDevices)
          navigator.mediaDevices.getUserMedia = async () => {throw Error('Files fixture forbids physical capture');};
        window.fileShareCalls = 0;
        Object.defineProperty(navigator, 'share', {configurable: true, value: async () => {
          window.fileShareCalls++;
          throw Error('Files fixture forbids sharing');
        }});
      });
      try {
        await page.goto(base+'/', {waitUntil: 'domcontentloaded'});
        await seed(page);
        await page.getByRole('button', {name: 'Files', exact: true}).click();
        await expect(button(page, 'Internal storage')).toBeVisible();
        results.push(await run(page));
        assert.deepEqual(foreign, [], 'External requests are fenced');
        assert.deepEqual(downloads, [], 'File mutations do not download');
        assert.equal(await page.evaluate(() => window.fileShareCalls), 0, 'File mutations do not share');
        assert.deepEqual(errors, [], 'Mounted Files reports no uncaught errors');
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

export async function checkFilesBrowserRefinement(extraSources = []) {
  const {results, sources, driverHashes} = await mounted(extraSources);
  const shared = {model, modelPath, sources, driverHashes, scope: 'bounded-orchestration', assumptions: [
    'Actual flag-off Files, selection context, shared Files adapter and IndexedDB BrowserStorageVolume execute. Files and revisions belong to isolated synthetic browser storage; outside network, physical media, and downloads are fenced or asserted absent.',
    'Canonical file IDs are assigned by real imports and observed in actual physical folders or the hidden Trash folder. Filename classes abstract the requested basename and its distinct conflict suffix. Category membership comes from actual storage queries and the mounted Images group/Downloads list are checked.',
    'Intermediate browse, category, preview and confirmation UI stays outside the historical state until it changes a modeled directory, selection or operation. The checked reviewed effect starts at the installed Files runner with exact reviewed identities; earlier agent proposal transport and installed Android are separate.',
    'One same-path rewrite is projected onto the historical single external revision change. The historical revision counts that external change and does not encode every browser storage revision increment.',
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
