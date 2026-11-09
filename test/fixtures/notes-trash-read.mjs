import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {transformSync} from 'esbuild';

const adapter = new URL('../../apps/app/src/prototype/notes-trash-adapter.ts', import.meta.url);
const sourceOwner = new URL('../../apps/app/src/prototype/agent-adapter.ts', import.meta.url);
const entry = new URL('../../apps/app/src/main.tsx', import.meta.url);
export const notesTrashReadSources = [import.meta.url, adapter, sourceOwner, entry].map(fileURLToPath);

const changed = 'alpha:notes-trash-changed';
const settled = () => new Promise(resolve => setImmediate(resolve));

export async function notesTrashReadFixture() {
  const window = new EventTarget();
  const reads = new Map();
  let started = 0, writes = 0, forbiddenCalls = 0;
  const forbidden = () => {
    forbiddenCalls++;
    assert.fail('Trash read publication must not perform storage changes');
  };
  let lastWrite = {id: 0, latest: 0, readEpoch: 0, activeEpoch: 0, live: false, mode: 'canonical'};
  const rows = {trash: [], trashError: ''};
  const runtime = {
    readNotesTrash() {
      const id = ++started;
      return new Promise((resolve, reject) => reads.set(id, {resolve, reject, epoch: shell.notesSourceEpoch}));
    },
    sortedNotesTrash: document => document.entries,
    editNotesTrash: forbidden,
    savedNoteIds: forbidden,
    savedNotes: forbidden,
    withNotesDeletionLock: forbidden,
  };
  const ports = new Map([
    ['../runtime/notes-trash', runtime],
    ['../runtime/notes-trash-policy', {}],
    ['../runtime/notes-folders', {}],
    ['../runtime/notes-view', {}],
    ['../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-trash-maintenance.ts', {maintainNotesTrash: forbidden}],
    ['../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-trash-actions.ts', {createNotesTrashActions: forbidden}],
    ['../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-trash-schedule.ts', {scheduleNotesTrashMaintenance: () => () => {}}],
    ['../daily', {}],
    ['./note-source-adapter', {releaseUnusedSourceReferences: forbidden}],
  ]);
  const {code} = transformSync(readFileSync(adapter, 'utf8'), {loader: 'ts', format: 'cjs'});
  const module = {exports: {}};
  runInNewContext(code, {module, window, document: {}, require(name) {
    assert.ok(ports.has(name), `Unexpected adapter dependency ${name}`);
    return ports.get(name);
  }}, {filename: fileURLToPath(adapter)});

  class Shell {
    live = false;
    notesSourceMode = 'canonical';
    notesSourceEpoch = 0;
    notesReady = Promise.resolve();
    api() {return {};}
    componentDidMount() {this.live = true;}
    componentWillUnmount() {this.live = false; this.notesSourceEpoch++;}
    vset(key, patch) {
      assert.equal(key, 'notes');
      assert.deepEqual(Object.keys(patch).sort(), ['trash', 'trashError']);
      Object.assign(rows, patch);
      writes++;
    }
  }
  const shell = new Shell();
  module.exports.installNotesTrashAdapter(Shell, {notes: {render: forbidden, back: forbidden}});
  shell.componentDidMount();
  await settled();
  assert.equal(started, 0, 'Canonical mount does not open the legacy Trash');

  return {
    chooseSource(mode) {
      assert.ok(shell.live && shell.notesSourceMode !== mode);
      shell.notesSourceMode = mode;
      shell.notesSourceEpoch++;
    },
    unmount() {shell.componentWillUnmount();},
    signal() {window.dispatchEvent(new Event(changed));},
    async complete(id, result) {
      const pending = reads.get(id);
      assert.ok(pending, `Read ${id} reached the storage port`);
      const before = writes;
      reads.delete(id);
      if (result === 'error') pending.reject(Error('Synthetic Trash read failure'));
      else pending.resolve({entries: result === 'empty' ? [] : [{id: result}]});
      await settled();
      assert.ok(writes === before || writes === before + 1, 'One completion publishes at most once');
      if (writes !== before) lastWrite = {id, latest: started, readEpoch: pending.epoch,
        activeEpoch: shell.notesSourceEpoch, live: shell.live, mode: shell.notesSourceMode};
    },
    observe() {
      assert.equal(forbiddenCalls, 0, 'No durable or unrelated effect was attempted');
      assert.ok(!rows.trashError || rows.trashError === 'Recently deleted could not be read.');
      return {live: shell.live, mode: shell.notesSourceMode, epoch: shell.notesSourceEpoch,
        started, pending: [...reads].map(([id, request]) => [id, request.epoch]),
        rows: Array.from(rows.trash, row => row.id), error: !!rows.trashError, writes, lastWrite};
    },
  };
}
