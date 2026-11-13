import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkTraces, qset, qmap} from '../specs/quint/refinement/check-traces.mjs';
import {loadNotesSource} from '../specs/quint/refinement/services/notes-store/module.mjs';
import {notesFixture, deferred} from '../specs/quint/refinement/services/notes-store/fixture.mjs';

const action = (name, ...args) => ({name, args});
const commit = first => [first, action('write'), action('confirmed'), action('delivered')];
const identity = note => Number(note.id.split('-').at(-1));
const members = notes => qset(notes.map(identity));
const values = (document, select) => qmap([1, 2].map(id => {
  const note = [...(document?.notes ?? []), ...(document?.trash ?? []).map(entry => entry.note)]
    .find(note => identity(note) === id);
  return [id, note ? select(note, document) : 0];
}));
async function until(predicate) {
  for (let index = 0; index < 2000 && !predicate(); index++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(predicate(), 'Actual source reached controlled boundary');
}

async function runCanonicalNotesRefinement(extraSources = []) {
  const loaded = await loadNotesSource([fileURLToPath(import.meta.url), fileURLToPath(new URL('../specs/quint/refinement/services/notes-store/fixture.mjs', import.meta.url)), ...extraSources]);
  const traces = [];
  async function scenario(name, body, {legacy, clock = Array(100).fill(0)} = {}) {
    const f = await notesFixture(loaded, {mode: 'encrypted', clock});
    let last = null, failure = null;
    if (legacy) f.backend.replace(JSON.stringify({schemaVersion: 3, revision: 2,
      persistedAt: '2023-11-14T22:13:20.000Z', notes: [2, 1].map(id => ({
        id: 'note-fixture-' + id, title: 'Alpha', body: '', color: 'yellow',
        createdAt: '2023-11-14T22:13:20.000Z', updatedAt: new Date(1700000000000 + 1000 * legacy[id - 1]).toISOString(),
      })), trash: []}));
    await f.open();
    async function observe(includeReply = true) {
      const service = f.selected, cache = service.store.shared.document;
      const durable = await f.raw();
      const status = service.status();
      const fenced = status.error?.code === 'NOTES_STORE_WRITE_FAILED';
      let visible = [];
      if (status.phase === 'ready') visible = service.snapshot().notes;
      else assert.throws(() => service.snapshot(), {code: fenced ? 'NOTES_STORE_WRITE_FAILED' : 'NOTES_STORE_UNAVAILABLE'});
      const state = {'s.phase': status.phase, 's.handles': service.store.shared.references, 's.fenced': fenced,
        CacheRevision: status.revision ?? -1, DurableRevision: durable.revision,
        CacheNotes: members(cache?.notes ?? []), DurableNotes: members(durable.notes),
        VisibleNotes: members(visible),
        's.cache.trashPresent': !!cache && Object.hasOwn(cache, 'trash'), 's.durable.trashPresent': Object.hasOwn(durable, 'trash'),
        's.cache.notes': (cache?.notes ?? []).map(identity), 's.cache.trash': members((cache?.trash ?? []).map(entry => entry.note)),
        's.durable.notes': durable.notes.map(identity), 's.durable.trash': members((durable.trash ?? []).map(entry => entry.note))};
      for (const [name, document] of [['cache', cache], ['durable', durable]]) {
        state[`s.${name}.body`] = values(document, note => ({Alpha: 1, Beta: 2})[note.title]);
        state[`s.${name}.order`] = values(document, (note, document) => document.noteRevisions?.[note.id] ?? 0);
        state[`s.${name}.clock`] = values(document, note => (Date.parse(note.updatedAt) - 1700000000000) / 1000);
      }
      if (includeReply) {
        state.ReplyOutcome = failure ? failure : last ? last.success ? last.data?.replayed ? 'noop' : 'success' : last.error.code === 'NOTES_EDIT_CONFLICT' ? 'conflict' : 'error' : 'none';
        state.ReplyRevision = last?.success ? last.state.revision : 0;
        state.ReplyId = last?.success && last.data?.note ? identity(last.data.note) : 0;
        state.ReplyNotes = members(last?.success ? last.state.notes : []);
      }
      return state;
    }
    const trace = {name, ...(legacy ? {init: {name: 'legacyInit', args: legacy}} : {}), expect: await observe(), steps: []};
    const record = async (label, actions, includeReply = true) => trace.steps.push({label, action: actions, expect: await observe(includeReply)});
    async function invoke(capability, params) {
      failure = null;
      try { last = await f.interact(capability, params); }
      catch (error) { last = null; failure = 'error'; return {error}; }
      if (last.success && last.data?.note) {
        const client = loaded.createNotesClient({async fetch() { return {requestId: 'notes-refinement', success: true, result: last}; }});
        const decoded = await client.interact(capability, params);
        assert.equal(decoded.note.id, last.data.note.id);
      }
      return last;
    }
    const create = async (id, content, force = true, time = 0) => {
      clock.fill(time);
      await invoke('create-note', {content, forceNew: force});
      await record('create commit and decoded reply', commit(action('create', id, content === 'Alpha' ? 1 : 2, time, force)));
    };
    try { await body({f, record, invoke, create, clock, setLast(value) {last = value; failure = null;}}); traces.push(trace); }
    finally { await f.close(); }
  }

  for (const times of [[0, 0, 0], [2, 1, 0]]) await scenario('canonical edit and no-op replay at clocks ' + times.join(','), async ({record, invoke, create, clock}) => {
    await create(1, 'Alpha', true, times[0]); await create(2, 'Beta', true, times[1]); clock.fill(times[2]);
    await invoke('update-note', {id: 'note-fixture-1', content: 'Beta', expectedRevision: 2});
    await record('edited physical identity remains visible', commit(action('edit', 1, 2, times[2], 2)));
    const replay = await invoke('create-note', {content: 'Beta'}); assert.equal(replay.data.replayed, true);
    await record('replay preserves exact durable bytes', action('create', 2, 2, times[2], false));
  });
  for (const order of [[1, 2], [2, 1]]) await scenario('restore exact raw identities in order ' + order.join(','), async ({record, invoke, create}) => {
    await create(1, 'Alpha'); await create(2, 'Alpha');
    await invoke('delete-note', {id: 'note-fixture-1'}); await record('delete logical duplicates', commit(action('remove', 1)));
    for (const [index, id] of order.entries()) {
      await invoke('restore-note', {id: 'note-fixture-' + id, expectedRevision: 3 + index});
      await record('restore raw reply preserves original ID', commit(action('restore', id, 3 + index)));
    }
  });
  for (const legacy of [[2, 1], [0, 0]]) await scenario('legacy fallback then versioned edit ' + legacy.join(','), async ({record, invoke}) => {
    await invoke('update-note', {id: 'note-fixture-1', content: 'Alpha', expectedRevision: 2});
    await record('versioned edit supersedes legacy timestamp representative', commit(action('edit', 1, 1, 0, 2)));
  }, {legacy});
  await scenario('uncertain encrypted write fences all shared handles until authoritative reopen', async ({f, record, invoke, create}) => {
    await create(1, 'Alpha');
    const first = f.selected, peer = await f.open();
    await record('second handle opens the same cache', action('openShared'));
    const broadcasts = f.events.length;
    f.backend.nextRead = 'fail';
    const {error} = await invoke('create-note', {content: 'Beta', forceNew: true});
    assert.equal(error.code, 'NOTES_STORE_WRITE_FAILED');
    assert.equal(error.cause?.message, 'controlled encrypted read failure');
    assert.throws(() => first.snapshot(), actual => actual === error);
    assert.throws(() => peer.snapshot(), actual => actual === error);
    await record('committed bytes diverge from the fenced private cache', [action('create', 2, 2, 0, true), action('write'), action('lostAcknowledgement')]);
    assert.equal(f.events.length, broadcasts);
    const durable = f.backend.raw, calls = f.backend.calls.length;
    await first.stop();
    await record('surviving handle retains the same failure', action('closeShared'));
    await assert.rejects(peer.initialize(), actual => actual === error);
    const refused = await invoke('clear-notes', {expectedRevision: 1, confirm: true});
    assert.equal(refused.error, error);
    assert.equal(f.backend.raw, durable);
    assert.equal(f.backend.calls.length, calls);
    assert.equal(f.events.length, broadcasts);
    await record('refused operation reaches neither storage nor listeners', action('refuseFenced'));
    await peer.stop(); await record('last handle releases the cache and failure', [action('requestStop'), action('stopped')]);
    await f.open(); await record('reopen reads the durable committed document', action('restart'), false);
  });
  await scenario('independent stale writer and readback preserve its cache', async ({f, record, invoke}) => {
    const stale = f.selected, winner = await f.open({freshPort: true});
    await f.interact('create-note', {content: 'Alpha', forceNew: true}, winner); f.selected = stale;
    await record('other instance commits its own document', action('rivalCreate', 1, 1, 0));
    const result = await invoke('create-note', {content: 'Beta', forceNew: true}); assert.equal(result.error.code, 'NOTES_EDIT_CONFLICT');
    await record('CAS rejects stale serialized view', [action('create', 2, 2, 0, true), action('conflict')]);
    const readback = await stale.store.persistedSnapshot(); assert.equal(readback.revision, 1);
    await record('explicit readback does not refresh cache', null);
  });
  await scenario('projection and expected revision failures preserve durable data', async ({f, record, invoke, create}) => {
    await create(1, 'Alpha');
    const stale = await invoke('update-note', {id: 'note-fixture-1', content: 'Beta', expectedRevision: 0}); assert.equal(stale.success, false);
    await record('stale edit rejected inside serialized transaction', action('rejectRevision', 0));
    await assert.rejects(f.selected.store.transact(draft => {draft.notes[0].title = 'Beta';}, () => {throw Error('projection refused');}), /projection refused/);
    await record('throwing projection commits nothing', action('rejectProjection'), false);
  });
  await scenario('held broadcast reply retains its own committed revision', async ({f, record, create, setLast}) => {
    const hold = deferred(); f.holdBroadcast = hold;
    const earlier = f.interact('create-note', {content: 'Alpha', forceNew: true});
    await until(() => f.selected.snapshot().revision === 1);
    await record('first commit waits in broadcast', [action('create', 1, 1, 0, true), action('write'), action('confirmed'), action('holdReply')], false);
    await create(2, 'Beta');
    hold.resolve(); setLast(await earlier);
    await record('first response contains original committed snapshot', action('deliverHeldReply'));
  });
  await scenario('empty clear reports applied with unchanged collection revision', async ({record, invoke}) => {
    await invoke('clear-notes', {expectedRevision: 0, confirm: true});
    await record('first empty clear initializes optional Trash field', commit(action('clear', 0)));
    await invoke('clear-notes', {expectedRevision: 1, confirm: true});
    await record('repeat empty clear preserves document revision', action('clear', 1));
  });

  const receipt = await checkTraces({model: 'CanonicalNotesStore', modelPath: 'specs/quint/services/CanonicalNotesStore.qnt',
    sources: loaded.sources, driverHashes: loaded.driverHashes, traces, scope: 'bounded-component',
    assumptions: ['Two physical plain-note IDs, two content equality classes and three wall-clock classes. Real NotesStore/NotesService/interact and client decoder execute over controlled encrypted-port CAS.',
      'The port advertises required authenticated encryption, but its fixture implements atomic string CAS only. Cryptography remains external.',
      'The model observes raw active/Trash membership, visible IDs, private note revision order, note wall times, cache/durable revisions and exact response identity.',
      'Rich-note identity, arbitrary content/ID space, initializer publication races, all provider authorization paths and multiple concurrent stop owners remain explicit obligations.']});
  return {receipts: [receipt], obligations: [
    {model: 'CanonicalNotesStore', obligation: 'Rich note formats, lookup mutation ambiguity, attachment/client text limits and unlimited note collections.', reason: 'Current source schedules project two plain-note identities and two content classes.'},
    {model: 'CanonicalNotesStore', obligation: 'Filesystem crash durability, cross-process single-owner enforcement and encrypted-port cryptographic/atomic guarantees.', reason: 'The model uses an atomic string-CAS host boundary. Separate focused tests execute real filesystem persistence and shared in-process instances.'},
    {model: 'CanonicalNotesStore', obligation: 'Complete initialization, cancellation/stop reference counts, schema parse failure and provider authorization state.', reason: 'These source fields are not all observed by the bounded collection model. Focused lifecycle/schema regressions cover selected cases.'},
  ]};
}

test('actual Notes mutations refine raw, visible and committed identities', {timeout: 240000}, async () => {
  const result = await runCanonicalNotesRefinement();
  assert.equal(result.receipts.length, 1);
  assert.ok(result.obligations.length > 0);
});
