import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium, expect as baseExpect} from '@playwright/test';
import {createServer} from 'vite';
import {checkClientFeatures} from '../../../../scripts/prepare-client-features.mjs';
import {filesWithin, sha256, repositoryRoot as root} from '../../../../scripts/quint-lib.mjs';
import {canonicalNotesFixture, openCanonicalNotes} from '../../../../test/browser/helpers/canonical-notes.ts';
import {preloadPageModules} from '../../../../test/browser/helpers/page-modules.ts';
import {installCloudVoiceFixture} from '../../../../test/browser/cloud-voice-fixture.ts';
import {captureInputs, checkTraces, qmap, qset} from '../../refinement/check-traces.mjs';

const model = 'NotesViewReplay';
const modelPath = 'test/fixtures/quint/NotesViewComparison.qnt';
const cacheDir = resolve(root, 'test-results/quint-refinement/legacy-notes-vite-cache');
const main = resolve(root, 'apps/app/src/main.tsx');
const expect = baseExpect.configure({timeout: 15000});
const button = (page, name) => page.getByRole('button', {name, exact: true});
const editor = page => page.locator('[data-alpha-subview="notes-editor"]');
const trash = page => page.locator('[data-alpha-subview="notes-trash"]');
const recorder = page => page.locator('[data-alpha-subview="notes-recorder"]');
const action = (name, ...args) => ({name, args});
const firstFolder = 'f-retained-a';
const secondFolder = 'f-retained-b';
const noteIds = new Map([['notes-first', 'n1'], ['notes-second', 'n2']]);
const notes = [
  {id: 'notes-first', title: 'Canonical first', body: '\nOriginal canonical content.', color: 'yellow',
    createdAt: '2026-11-08T00:00:00.000Z', updatedAt: '2026-11-08T00:00:00.000Z',
    format: {kind: 'text', data: {folderId: firstFolder}}},
  {id: 'notes-second', title: 'Canonical second', body: '\nOther canonical content.', color: 'yellow',
    createdAt: '2026-11-08T00:00:00.000Z', updatedAt: '2026-11-08T00:00:00.000Z'},
];
const notePaths = ['/src/runtime/alpha-client.ts', '/src/runtime/connection-ui.tsx',
  '/src/runtime/browser-notes-document.ts', '/src/runtime/notes-folders.ts', '/src/runtime/notes-trash.ts'];

async function seedRetained(page) {
  await page.evaluate(async ({firstFolder, secondFolder}) => {
    const {openBrowserNotes} = window.__alphaModules['/src/runtime/browser-notes-document.ts'];
    const {editNotesFolders, addNotesFolder} = window.__alphaModules['/src/runtime/notes-folders.ts'];
    const store = await openBrowserNotes();
    await store.replace([
      {id: 'notes-first', kind: 'text', title: 'Retained first', body: 'Previous content.', folderId: firstFolder},
      {id: 'notes-second', kind: 'text', title: 'Retained second', body: 'Other previous content.'},
    ]);
    for (const [id, name] of [[firstFolder, 'a'], [secondFolder, 'b']])
      await editNotesFolders(current => addNotesFolder(current, {id, name, createdAt: 0}));
  }, {firstFolder, secondFolder});
}

function context(page) {
  return page.evaluate(() => window.__alphaModules['/src/runtime/alpha-client.ts'].alphaClient.getState().context);
}

async function selection(page, kind, id) {
  await expect.poll(async () => {
    const selected = (await context(page)).selectedObject;
    return [selected?.kind, selected?.id];
  }).toEqual([kind, id]);
  const selected = (await context(page)).selectedObject;
  assert.ok(selected.revision);
  return selected;
}

const noSelection = page => expect.poll(async () => (await context(page)).selectedObject).toBeUndefined();

async function readState(page) {
  return page.evaluate(async () => {
    const shell = window.quintLegacyNotes;
    const shown = shell.S().view === 'notes' && !document.hidden;
    if (shell.notesSourceMode === 'legacy') {
      const raw = await window.__alphaModules['/src/runtime/browser-notes-document.ts'].readBrowserNotesRaw();
      const {entries} = await window.__alphaModules['/src/runtime/notes-trash.ts'].readNotesTrash();
      const folders = await window.__alphaModules['/src/runtime/notes-folders.ts'].readNotesFolders();
      return {shown, live: JSON.parse(raw).records, trash: entries.map(entry => entry.note), folders: folders.folders};
    }
    const snapshot = shell.canonicalNotesUi?.controller.snapshot;
    return {shown, live: snapshot?.notes, trash: snapshot?.trash?.map(entry => entry.note)};
  });
}

async function observe(page) {
  const {shown, live, trash: deleted, folders} = await readState(page);
  const projected = {'s.shown': shown, ProfileSafety: true};
  if (live && deleted) {
    assert.ok([...live, ...deleted].every(row => noteIds.has(row.id)), 'Bounded note identities match the observed source');
    projected['s.live'] = qset(live.map(row => noteIds.get(row.id)));
    projected['s.trash'] = qset(deleted.map(row => noteIds.get(row.id)));
  }
  if (folders) {
    const mapped = new Map([[firstFolder, 'f1'], [secondFolder, 'f2']]);
    assert.ok(folders.every(row => mapped.has(row.id)));
    projected['s.folders'] = qset(folders.map(row => mapped.get(row.id)));
    if (folders.length === 2) projected['s.folderName'] = qmap(folders.map(row => [mapped.get(row.id), row.name]));
    projected['s.noteFolder'] = qmap([...live, ...deleted].map(row => {
      assert.ok(row.folderId === undefined || mapped.has(row.folderId));
      return [noteIds.get(row.id), mapped.get(row.folderId) ?? 'None'];
    }));
  }
  return projected;
}

async function schedule(page, name, profile = 'Design') {
  const trace = {name, init: action('TestInit', profile), expect: await observe(page), steps: []};
  return {trace, async point(label, next = null, extra = {}) {
    trace.steps.push({label, action: next, expect: {...await observe(page), ...extra}});
  }};
}

function divergent(trace, name, profile, length = trace.steps.length) {
  const copy = structuredClone(trace);
  copy.name = name;
  copy.init = action('TestInit', profile);
  copy.steps = copy.steps.slice(0, length);
  delete copy.expect.ProfileSafety;
  for (const step of copy.steps) delete step.expect.ProfileSafety;
  return copy;
}

async function remove(page, title) {
  await button(page, 'Open '+title).click();
  await expect(editor(page)).toBeVisible();
  await button(page, 'More').click();
  await page.getByRole('dialog', {name: 'Note actions'}).getByRole('button', {name: 'Delete', exact: true}).click();
  await expect(editor(page)).toHaveCount(0);
  await expect(button(page, 'Open '+title)).toHaveCount(0);
  await expect(button(page, 'Recently deleted')).toBeVisible();
}

async function recover(page, title, legacy = false) {
  await button(page, 'Recently deleted').click();
  await expect(trash(page)).toBeVisible();
  if (!legacy) await expect(button(page, 'Empty Recently deleted')).toHaveCount(0);
  await trash(page).getByRole('button', {name: legacy ? new RegExp('^'+title+', ') : title, exact: !legacy}).click();
  const review = page.getByRole('dialog', {name: title, exact: true});
  if (!legacy) await expect(review.getByRole('button', {name: 'Delete now', exact: true})).toHaveCount(0);
  await review.getByRole('button', {name: 'Recover', exact: true}).click();
  await expect(trash(page)).toHaveCount(0);
  await expect(button(page, 'Open '+title)).toBeVisible();
}

async function canonical(page) {
  await seedRetained(page);
  await openCanonicalNotes(page);
  const t = await schedule(page, 'canonical_selection_trash_route_source_switch_and_owner_retirement');
  await expect(page.getByRole('group', {name: 'Folders', exact: true})).toHaveCount(0);
  await expect(button(page, 'New folder')).toHaveCount(0);
  const second = button(page, 'Open Canonical second');
  await second.click();
  const original = await selection(page, 'canonical-note', 'notes-second');
  await t.point('Opening canonical Notes publishes the committed second record at its accepted revision');
  await button(page, 'Back to notes').click();
  await noSelection(page);
  await t.point('Back closes the editor and retires the selected canonical object');
  await button(page, 'Back to apps').click();
  await expect(page.locator('html')).toHaveAttribute('data-active-view', 'home');
  await noSelection(page);
  await t.point('Leaving Notes hides it and retains the canonical collection', action('Hide'));
  await openCanonicalNotes(page);
  await t.point('Reopening shows the same canonical collection without selecting an object', action('Show'));

  await remove(page, 'Canonical first');
  await t.point('Canonical delete moves the first committed identity to Recently deleted', action('TrashNote', 'n1'));
  await recover(page, 'Canonical first');
  await t.point('Restore-only Recently deleted returns the same canonical identity', action('Restore', 'n1'));
  await second.click();
  const after = await selection(page, 'canonical-note', 'notes-second');
  assert.notEqual(after.revision, original.revision, 'An unrelated mutation retires the earlier collection revision');
  await t.point('Unchanged second record now carries the new accepted collection revision');
  const revisionDiff = divergent(t.trace, 'canonical_selection_revision_is_collection_wide', 'Design');
  revisionDiff.steps.at(-1).expect.OtherRevisionChanged = after.revision !== original.revision;
  await button(page, 'Back to notes').click();
  await noSelection(page);

  await button(page, 'Previous notes').click();
  await expect(page.getByRole('heading', {name: 'Previous notes', exact: true})).toBeVisible();
  await button(page, 'Open Retained first').click();
  await expect(editor(page).getByRole('textbox', {name: 'Note', exact: true})).toHaveValue('Previous content.');
  const retained = await selection(page, 'note', 'notes-first');
  assert.ok(retained.accountId && retained.sourceRevision);
  await t.point('The same string ID in Previous notes has a different source and identity envelope');
  await button(page, 'Back to notes').click();
  await expect.poll(async () => (await context(page)).selectedObject?.kind).toBe('note-source');
  await button(page, 'Return to Notes').click();
  await expect(second).toBeVisible();
  await noSelection(page);
  await second.click();
  await selection(page, 'canonical-note', 'notes-second');
  await t.point('Returning retires the Previous notes source and reselects the canonical identity');

  await page.evaluate(() => {
    const {connectionController} = window.__alphaModules['/src/runtime/connection-ui.tsx'];
    const before = connectionController.getAppRecordClient();
    const state = structuredClone(window.canonicalNotesFixture.state);
    state.notes = state.notes.map(note => ({...note, title: 'Replacement '+note.id}));
    let release;
    const gate = new Promise(resolve => {release = resolve;});
    const sessionId = 'replacement-notes-session';
    const owner = window.replacementNotes = {reads: 0, release};
    connectionController.getAppRecordClient = () => ({
      ...before, sessionId, identity: {...before.identity, ownerId: 'replacement-notes-owner', sessionId},
      async request(path, method, body, signal) {
        if (path === '/api/notes/state' && method === 'GET') {
          owner.reads++;
          await gate;
          signal.throwIfAborted();
          return {success: true, data: state};
        }
        throw Error('Replacement fixture allows only the closed Notes read');
      },
    });
    void connectionController.offline();
  });
  await expect.poll(() => page.evaluate(() => window.replacementNotes.reads)).toBeGreaterThan(0);
  await expect(editor(page)).toHaveCount(0);
  await noSelection(page);
  await t.point('Replacement owner clears the old selected object before its held snapshot returns');
  await page.evaluate(() => window.replacementNotes.release());
  await button(page, 'Open Replacement notes-second').click();
  await selection(page, 'canonical-note', 'notes-second');
  await expect(editor(page).getByRole('textbox', {name: 'Title', exact: true})).toHaveValue('Replacement notes-second');
  await t.point('Only a newly selected record from the accepted replacement snapshot can publish');
  return {traces: [t.trace], differences: [['NotesViewCanonicalCollectionRevision', revisionDiff]]};
}

async function retained(page) {
  await seedRetained(page);
  await openCanonicalNotes(page);
  await button(page, 'Previous notes').click();
  await expect(page.getByRole('heading', {name: 'Previous notes', exact: true})).toBeVisible();
  await expect(button(page, 'Open Retained first')).toBeVisible();
  const renaming = await schedule(page, 'retained_folder_rename_keeps_the_same_note_membership', 'Rename');
  const renamed = await page.evaluate(id => window.quintLegacyNotes.api('notes').notesFolders.rename(id, 'c'), firstFolder);
  assert.equal(renamed, true);
  await renaming.point('The actual retained folder adapter renames its saved ID without moving either note',
    action('RenameFolder', 'f1', 'c'));

  // Start the Design restore profile from its original names via the same storage port.
  const reset = await page.evaluate(id => window.quintLegacyNotes.api('notes').notesFolders.rename(id, 'a'), firstFolder);
  assert.equal(reset, true);
  const restoring = await schedule(page, 'retained_restore_clears_a_deleted_folder_reference');
  await remove(page, 'Retained first');
  await restoring.point('Previous notes trashes the exact first identity while retaining its folder reference',
    action('TrashNote', 'n1'));
  const removed = await page.evaluate(id => window.quintLegacyNotes.api('notes').notesFolders.remove(id), firstFolder);
  assert.equal(removed, true);
  await restoring.point('Removing a folder leaves the trashed note and the other live note in place',
    action('DeleteFolder', 'f1'));
  await recover(page, 'Retained first', true);
  await restoring.point('Recover keeps the note ID and clears its now-missing folder reference', action('Restore', 'n1'));
  await button(page, 'Open Retained first').click();
  await expect(editor(page).getByRole('textbox', {name: 'Note', exact: true})).toHaveValue('Previous content.');
  await selection(page, 'note', 'notes-first');
  await restoring.point('Recovered text and the selected local identity remain attached to the original note');
  return {traces: [renaming.trace, restoring.trace], differences: [
    ['NotesViewHistoricalRestoreFolder', divergent(restoring.trace, 'restored_note_releases_deleted_folder_reference', 'Ablate_RestoreFolder', 3)],
  ]};
}

async function audioStatus(page) {
  return page.evaluate(async () => {
    const {registerPlugin} = window.__alphaModules['/src/platform-plugins.ts'];
    const status = await registerPlugin('AlphaVoiceCloud').noteRecordingStatus();
    const stopped = window.notesStoppedStatus ?? null;
    const activeId = status.recordingId ?? stopped?.recordingId;
    const audio = activeId ? await window.__alphaModules['/src/browser/note-audio-store.ts'].audioRecord(activeId).catch(error => {
      if (error.message !== 'Recording not found.') throw error;
      return null;
    }) : null;
    return {state: status.state, segments: status.segments ?? [], stopped, durable: audio ? {
      audioId: audio.audioId, noteId: audio.noteId, durationMs: audio.durationMs, bytes: audio.blob.size,
    } : null, transcripts: window.cloudVoiceFixture.transcriptions.length};
  });
}

async function recording(page) {
  await preloadPageModules(page, ['/src/platform-plugins.ts', '/src/browser/audio-capture.ts', '/src/browser/note-audio-store.ts']);
  await installCloudVoiceFixture(page);
  await page.evaluate(async () => {
    const {BrowserAudioCapture} = window.__alphaModules['/src/browser/audio-capture.ts'];
    const {registerPlugin} = window.__alphaModules['/src/platform-plugins.ts'];
    const realStart = BrowserAudioCapture.prototype.start;
    BrowserAudioCapture.prototype.start = function (input) {
      // Use the real MediaRecorder and rollover with a shorter fixture interval.
      return realStart.call(this, input?.unlimited && input.onSegment ? {...input, segmentMs: 4000} : input);
    };
    const context = new AudioContext(), oscillator = context.createOscillator();
    const stream = context.createMediaStreamDestination();
    oscillator.connect(stream);
    oscillator.start();
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {configurable: true, value: async () => {
      await context.resume();
      return stream.stream;
    }});
    window.stopNotesSignal = async () => {oscillator.stop(); await context.close();};
    await registerPlugin('AlphaVoiceCloud').addListener('noteRecordingChanged', status => {
      if (status.state === 'stopped') window.notesStoppedStatus = status;
    });
  });
  try {
    await openCanonicalNotes(page);
    const initial = await audioStatus(page);
    assert.equal(initial.state, 'idle');
    const trace = {name: 'mounted_browser_records_segments_but_durably_saves_on_stop',
      init: action('TestInit', 'AsBuilt_Segments'),
      expect: {'s.rec': initial.state, 's.recorded': initial.segments.length, 's.durable': 0}, steps: []};
    async function point(label, next, status, rec = status.state) {
      assert.equal(status.transcripts, 0, 'Recording and saving must not transcribe automatically');
      const segments = status.stopped?.segments ?? status.segments;
      trace.steps.push({label, action: next, expect: {'s.rec': rec, 's.recorded': segments.length,
        's.durable': status.durable ? segments.length : 0, 's.asr': segments.filter(segment => segment.text !== undefined).length}});
    }
    await button(page, 'Record voice note').click();
    await expect(recorder(page)).toHaveAttribute('data-recorder-state', 'recording');
    const started = await audioStatus(page);
    assert.deepEqual(started.segments, []);
    await point('Actual mounted recorder starts with no finished segment', action('Record'), started);
    await expect.poll(async () => (await audioStatus(page)).segments.length).toBe(1);
    const first = await audioStatus(page);
    assert.equal(first.durable, null);
    await point('The first real browser segment stays in the live recorder without a persisted audio record',
      action('Segment'), first);
    await recorder(page).getByRole('button', {name: 'Pause', exact: true}).click();
    await expect(recorder(page)).toHaveAttribute('data-recorder-state', 'paused');
    await point('Pause keeps the finished segment without creating a saved note', action('Pause'), await audioStatus(page));
    await recorder(page).getByRole('button', {name: 'Resume', exact: true}).click();
    await expect(recorder(page)).toHaveAttribute('data-recorder-state', 'recording');
    await point('Resume continues the same browser capture', action('Resume'), await audioStatus(page));
    await recorder(page).getByRole('button', {name: 'Stop recording', exact: true}).click();
    await expect(recorder(page)).toHaveCount(0);
    await expect(button(page, 'Play recording')).toBeVisible();
    await expect(button(page, 'Generate transcript')).toBeVisible();
    const saved = await audioStatus(page);
    assert.equal(saved.stopped.stopReason, 'user');
    assert.equal(saved.stopped.segments.length, 2);
    assert.ok(saved.durable.bytes > 0);
    assert.equal(saved.durable.durationMs, saved.stopped.durationMs);
    const note = await page.evaluate(id => window.canonicalNotesFixture.state.notes.find(row => row.id === id), saved.durable.noteId);
    assert.equal(note.format.data.audio.audioId, saved.durable.audioId);
    assert.equal(note.body, '');
    await point('User Stop finalizes the partial segment and retains audio before any transcription',
      [action('Segment'), action('Stop')], saved, 'saved');
    trace.steps.at(-1).expect['s.stopCause'] = saved.stopped.stopReason;

    const streamProjection = divergent(trace, 'historical_post_stop_asr_phase_projection', 'AsBuilt_StreamAsr');
    for (const step of streamProjection.steps.slice(0, -1)) delete step.expect['s.durable'];
    return {traces: [trace, streamProjection], differences: [
      ['NotesViewHistoricalRecordingCap', divergent(trace, 'current_recording_continues_after_first_finished_segment', 'AsBuilt_Cap', 2)],
      ['NotesViewHistoricalLiveDurability', divergent(trace, 'browser_finished_live_segment_is_not_yet_durable', 'Design', 2)],
    ]};
  } finally {await page.evaluate(() => window.stopNotesSignal());}
}

async function mounted(extraSources) {
  checkClientFeatures();
  const watched = new Set([main, ...[
    'prototype/agent-adapter.ts', 'prototype/canonical-notes-ui.ts', 'prototype/notes-trash-adapter.ts',
    'prototype/notes-folders-adapter.ts', 'prototype/voice-adapter.ts', 'browser/voice.ts', 'browser/audio-capture.ts',
  ].map(path => resolve(root, 'apps/app/src/'+path))]);
  const sources = [...new Set([
    ...filesWithin(resolve(root, 'apps/app/src')), ...filesWithin(resolve(root, '.eliza/client-features')),
    ...filesWithin(resolve(root, 'config')), ...filesWithin(resolve(root, 'patches/eliza')),
    ...filesWithin(resolve(root, 'vendor/eliza/plugins/plugin-native-passwords/src')),
    ...filesWithin(resolve(root, 'vendor/eliza/plugins/plugin-native-system/src')),
    'vendor/eliza/packages/core/src/utils/uuid.ts',
    'apps/app/index.html', 'vite.config.ts', 'package.json', 'package-lock.json', 'upstream.lock.json',
    'scripts/prepare-client-features.mjs', 'scripts/quint-lib.mjs', modelPath, fileURLToPath(import.meta.url),
    'test/browser/helpers/canonical-notes.ts', 'test/browser/helpers/page-modules.ts',
    'test/browser/cloud-voice-fixture.ts', ...extraSources,
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
      plugins: [{name: 'quint-legacy-notes-inputs', enforce: 'pre', transform(code, id) {
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
          return code.replace(anchor, anchor+' window.quintLegacyNotes = value;');
        }
      }}]});
    await server.listen();
    browser = await chromium.launch({headless: true});
    const baseURL = 'http://127.0.0.1:'+server.httpServer.address().port;
    const results = [];
    for (const run of [canonical, retained, recording]) {
      const page = await browser.newPage({baseURL, viewport: {width: 412, height: 915}, hasTouch: true, reducedMotion: 'reduce'});
      page.setDefaultTimeout(45000);
      await page.addInitScript(() => {
        window.__name = (value, name) => Object.defineProperty(value, 'name', {value: name, configurable: true});
        if (navigator.mediaDevices)
          navigator.mediaDevices.getUserMedia = async () => {throw Error('Notes fixture forbids physical capture');};
      });
      try {
        const fixturePage = {
          on: page.on.bind(page), route: page.route.bind(page),
          addInitScript: page.addInitScript.bind(page), evaluate: page.evaluate.bind(page),
          goto: path => page.goto(path, {waitUntil: 'domcontentloaded', timeout: 60000}),
        };
        const {foreign, errors} = await canonicalNotesFixture(fixturePage, {notes});
        await page.waitForFunction(() => window.quintLegacyNotes?.live);
        await preloadPageModules(page, notePaths);
        results.push(await run(page));
        assert.deepEqual(foreign, [], 'External requests are fenced');
        assert.deepEqual(errors, [], 'Mounted Notes reports no uncaught errors');
      } catch (error) {
        throw new Error('Mounted Notes '+run.name+' schedule failed: '+error.message, {cause: error});
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

export async function checkNotesViewRefinement(extraSources = []) {
  const {results, sources, driverHashes} = await mounted(extraSources);
  const shared = {model, modelPath, sources, driverHashes, scope: 'bounded-orchestration', assumptions: [
    'Actual flag-off Notes, canonical owner, editor and retained browser storage execute in Chromium. The canonical app-record provider is closed and synthetic. Mounted canonical state is read from its actual accepted controller snapshot.',
    'The historical Notes view has no collection source or selected-object record. Those identity checks are separate source assertions; the replay projects only Notes visibility and accepted membership. Unknown membership during owner replacement is left unobserved.',
    'Retained folder rename and removal execute through the mounted shell folder API and real browser folder store. The current UI is flat. The actual retained Trash restore runs through visible controls.',
    'The recording is a synthetic oscillator through real browser capture, with only the rollover interval shortened. Before Stop durable means actual saved audio exists; after Stop the saved whole recording covers the finalized segment count. No microphone hardware or transcript provider is used.',
    'Recorder profiles project the supported phase and segment observations, with the post-stop ASR profile omitting differing live durability. No universal claims about crash, native segment retention or temporal fairness are made.',
  ]};
  const receipt = await checkTraces({...shared, traces: results.flatMap(result => result.traces)});
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
