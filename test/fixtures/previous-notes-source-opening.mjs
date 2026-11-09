import assert from 'node:assert/strict';
import {AsyncLocalStorage} from 'node:async_hooks';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {stripTypeScriptTypes} from '../support/strip-types.mjs';
import {deferred, read, sourceContext, tick} from '../../specs/quint/refinement/application/support.mjs';

const adapter = 'apps/app/src/prototype/agent-adapter.ts';
const access = 'apps/app/src/prototype/legacy-notes-access.ts';
export const previousNotesSourceOpeningSources = [fileURLToPath(import.meta.url), adapter, access,
  fileURLToPath(new URL('../support/strip-types.mjs', import.meta.url)),
  'specs/quint/refinement/application/support.mjs'];
const textStates = new Map([
  ['Opening Notes…', 'opening'], ['', 'ready'], ['Note text encrypted on this device', 'ready'],
  ['Unsaved changes from an earlier session are kept on this phone.', 'kept'],
  ['An unsaved draft from an earlier session could not be read. It is kept on this phone.', 'unreadable'],
  ['An unsaved draft from an earlier session is kept on this phone. Review recovery before changing it.', 'draft-only'],
  ['There are no previous notes on this phone.', 'absent'],
  ['Previous notes need a recovery review. Nothing was moved or changed.', 'recovery'],
]);
const records = (id, empty = false) => ({revision: `document-${id}`, raw: JSON.stringify({id,
  records: empty ? [] : [{id: `note-${id}`, body: `Saved body ${id}`} ]})});

export function previousNotesSourceOpeningFixture(device = false) {
  const source = read(adapter), start = source.indexOf('  function canonicalNotesKey(');
  const end = source.indexOf('  function context(shell: Shell)', start);
  assert.ok(start >= 0 && end > start, 'Expected the installed Notes source selection functions');
  const operations = new AsyncLocalStorage(), pending = new Map(), finished = new Map(), retentions = new Map(), retired = new Set();
  const state = {list: [], open: null}, toasts = [], cancellations = [];
  let owner = 'a', sequence = 0, task = 0, refreshes = 0, writes = 0;
  const forbidden = () => {writes++; throw Error('Opening Previous Notes must not write storage');};
  function hold(phase) {
    const request = operations.getStore();
    assert.ok(request, `The ${phase} call belongs to an actual selection`);
    request.phase = phase;
    request.epoch = shell.notesSourceEpoch;
    request.signal ??= shell.notesOpenAbort.signal;
    request.gate = deferred();
    return request.gate.promise;
  }
  function opened(record) {
    assert.ok(record?.raw, 'The store projection uses the record returned by its read port');
    const {id, records: list} = JSON.parse(record.raw), request = operations.getStore();
    request.document = id;
    request.rows = list.length ? id : 0;
    return {raw: record.raw, list, async target(noteId) {
      assert.equal(noteId, `note-${id}`);
      return hold('target');
    }};
  }
  const localStorage = {getItem: () => null, setItem: forbidden, removeItem: forbidden};
  const vault = {read: slot => hold(slot === 'draft' ? 'draftPresence' : slot), compareExchange: forbidden};
  const browserNotesPort = {read: () => hold('collection'), compareExchange: forbidden};
  const SecureNotesStore = {
    async open(guarded) {return opened(await guarded.read('snapshot'));},
    readDraft(port) {assert.equal(port, vault); return hold('draft');},
  };
  const raw = sourceContext([access], ['openExistingBrowserNotes', 'openExistingDeviceNotes', 'LegacyNotesAbsent', 'LegacyNotesDraftOnly'], {
    localStorage, SecureNotesStore, SECURE_NOTES_SLOT: 'collection', SECURE_NOTES_DRAFT_SLOT: 'draft', LEGACY_NOTES_SOURCE_KEYS: ['old-notes'],
    DocumentNotesStore: {async open(port, _initial, signal) {return opened(await port.initialize(forbidden, signal));}},
  });
  const appPort = () => ({sessionId: owner, identity: {ownerId: owner, agentId: 'synthetic-agent', sessionId: owner, origin: 'https://alpha.invalid'}});
  class CanonicalNotesUi {
    current = true;
    constructor(port) {this.owner = port.identity.ownerId;}
    retire() {this.current = false;}
    async refresh() {refreshes++;}
  }
  const shell = {live: true, notesSourceMode: 'canonical', notesSourceEpoch: 0, notesStorageFailed: true,
    notesPending: 0, notesOpenAbort: new AbortController(), previousNotesProbeKey: null, canonicalNotesUi: new CanonicalNotesUi(appPort()),
    vget: () => state, S: () => ({view: 'home'}), setState() {}, toast: text => toasts.push(text),
    cancelReadReplyCompletions: () => cancellations.push('selected')};
  const ports = {...raw, AbortController, DOMException, clearTimeout, isAndroid: device, SecureNotesStore,
    secureConnectionStore: vault, browserNotesPort, localStorage, CanonicalNotesUi, document: {hidden: false},
    connectionController: {getSnapshot: () => ({session: {sessionId: owner}}), getAppRecordClient: appPort},
    originalSet(key, patch) {assert.equal(key, 'notes'); Object.assign(state, patch);},
    notesDraftBase(bytes) {assert.equal(JSON.parse(bytes).id, operations.getStore().document); return hold('fingerprint');},
    notesDataset() {}, context() {}, notesRecovery: {abort: () => cancellations.push('owner')},
    browserPreviousNotesAvailability: forbidden, devicePreviousNotesAvailability: forbidden,
  };
  runInNewContext(stripTypeScriptTypes(source.slice(start, end), {mode: 'strip'}), ports);
  shell.canonicalNotesKey = ports.canonicalNotesKey(appPort());

  return {
    async choose(target) {
      const id = ++sequence, request = {id, target, phase: 'wait', owner, epoch: shell.notesSourceEpoch, task, document: 0, rows: 0};
      pending.set(id, request);
      const call = operations.run(request, () => ports.selectNotesSource(shell, target));
      call.then(value => {pending.delete(id); finished.set(id, value);}, error => {request.error = error;});
      await tick();
      assert.ifError(request.error);
      return id;
    },
    async settle(id, result) {
      const request = pending.get(id), gate = request?.gate;
      assert.ok(gate, `Selection ${id} has a concrete ${request?.phase} read`);
      const phase = request.phase;
      request.gate = null;
      if (result === 'failed') gate.reject(Error('Synthetic read unavailable'));
      else if (phase === 'collection' || phase === 'snapshot') gate.resolve(result === 'absent' ? null : records(id, result === 'empty'));
      else if (phase === 'target') gate.resolve(result === 'target' ? {sourceId: `source-${id}`, sourceRevision: `target-${id}`} : null);
      else if (phase === 'fingerprint') gate.resolve(`fingerprint-${id}`);
      else gate.resolve(result === 'kept' ? {token: `draft-${id}`, records: [{body: 'Unapplied retained body'}]} : null);
      await tick();
      assert.ifError(request.error);
    },
    startRetention(id) {
      const wait = deferred();
      task = id;
      retentions.set(id, wait);
      shell.notesDraftTask = wait.promise;
    },
    async finishRetention(id) {
      const wait = retentions.get(id);
      assert.ok(wait);
      retentions.delete(id);
      wait.resolve();
      await tick();
    },
    changeOwner(next) {owner = next; ports.syncPreviousNotesAvailability(shell);},
    failEdit(saved) {
      shell.notesStorageFailed = true;
      shell.notesDraftSaved = saved ? {token: 'confirmed-current-draft'} : null;
      state.list = [{id: 'edited', body: 'Unretained newest text'}];
    },
    inspect() {return {toasts: [...toasts], cancellations: [...cancellations], rows: structuredClone(state.list),
      aborts: [...pending.values()].filter(request => request.signal?.aborted).map(request => request.id)};},
    observe() {
      assert.equal(writes, 0, 'Opening and source selection attempted no storage writes');
      for (const request of pending.values()) if (request.signal?.aborted) retired.add(request.id);
      const source = shell.notesLegacySource;
      const document = shell.notesRaw ? JSON.parse(shell.notesRaw).id : 0;
      if (source?.kind === 'note-source') {
        assert.equal(source.id, `source-${document}`);
        assert.equal(source.accountId, source.id);
        assert.equal(source.revision, `target-${document}`);
        assert.equal(source.revision, source.sourceRevision);
      } else if (source) {
        assert.equal(source.kind, 'legacy-app-notes-source');
        assert.equal(source.id, 'previous-notes');
        assert.equal(source.accountId, 'device-local-legacy');
        assert.equal(source.revision, `fingerprint-${document}`);
      }
      const row = state.list[0];
      if (row?.id.startsWith('note-')) assert.equal(row.body, `Saved body ${row.id.slice(5)}`);
      const legacy = shell.notesSourceMode === 'legacy';
      const status = legacy ? textStates.get(state.storageStatus) : 'canonical';
      if (legacy) {
        assert.ok(status, 'The visible storage status belongs to an observed opening outcome');
        assert.equal(!!shell.notesLegacyAbsent, status === 'absent');
        assert.equal(!!shell.notesDraftUnreadable, ['unreadable', 'draft-only'].includes(status));
        assert.equal(!!shell.notesOpenFailed, status === 'recovery');
      }
      return {device, owner, mode: shell.notesSourceMode, epoch: shell.notesSourceEpoch,
        legacyOwner: legacy ? JSON.parse(shell.notesLegacyOwnerKey)[0].sessionId : '',
        status, failed: shell.notesStorageFailed, editedSaved: !!shell.notesDraftSaved,
        document, storeEpoch: shell.notesStoreEpoch ?? 0,
        rows: row ? row.id === 'edited' ? 9 : Number(row.id.slice(5)) : 0,
        source: source?.kind === 'note-source' ? 'target' : source ? 'fingerprint' : '', kept: Number(shell.notesDraftKept?.token?.slice(6) ?? 0),
        canonical: shell.canonicalNotesUi?.current ? shell.canonicalNotesUi.owner : '', refreshes,
        last: sequence, task, retention: [...retentions.keys()], finished: [...finished], retired: [...retired],
        pending: [...pending.values()].map(({id, phase, target, owner, epoch, task, document, rows}) =>
          [id, {phase, target, owner, epoch, task, document, rows}]),
      };
    },
  };
}
