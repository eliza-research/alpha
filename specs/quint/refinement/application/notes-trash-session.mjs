// NotesTrashSession against installNotesTrashAdapter in apps/app/src/prototype/notes-trash-adapter.ts.
// The adapter is installed on a shell class and a Notes view the driver owns. Ports: the shared
// Trash maintenance pass and Trash actions (each answered by a model step), Trash storage reads
// (answered at once) and the maintenance schedule (its `run` callback is the background pass).
// The view is rendered again after every step until it stops changing, as the shell does.
import assert from 'node:assert/strict';
import {loadProductModule, modelTraces, replayTraces, settle, witnessTraces} from './notes-files-media-itf.mjs';

const source = 'apps/app/src/prototype/notes-trash-adapter.ts';
const shared = '../../../../.eliza/client-features/plugins/plugin-notes/src/client/';
const port = names => `const p=()=>globalThis.__notesTrashPorts;${names.map(name => `export const ${name}=(...a)=>p().${name}(...a);`).join('')}`;
const stubs = {
  '../runtime/notes-trash': port(['editNotesTrash', 'notesTrashDaysLabel', 'readNotesTrash', 'savedNoteIds', 'savedNotes', 'sortedNotesTrash', 'withNotesDeletionLock']),
  '../runtime/notes-trash-policy': 'export const notesTrashPolicy={};export const notesTrashDaysShort=()=>"30d";',
  '../runtime/notes-folders': 'export const readNotesFolders=async()=>({folders:[]});export const restoredNoteFolder=note=>note;',
  '../runtime/notes-view': 'export const notePreview=note=>note.body??"";',
  [`${shared}notes-trash-maintenance.ts`]: port(['maintainNotesTrash']),
  [`${shared}notes-trash-actions.ts`]: port(['createNotesTrashActions']),
  [`${shared}notes-trash-schedule.ts`]: port(['scheduleNotesTrashMaintenance']),
  '../daily': 'export const DailyApps={addListener:async()=>({remove(){}})};',
  './note-source-adapter': 'export const releaseUnusedSourceReferences=async()=>{};',
};
const witnesses = ['ForegroundJoinedBackgroundWitness', 'RefusalPendingWitness', 'ChoiceDismissedDuringDeleteWitness',
  'RestoreWaitsForMaintenanceWitness', 'DeletedForeverWitness', 'EmptyTrashStaysOpenWhileBusyWitness'];

export async function replayNotesTrashSession({rewrite, ...options} = {}) {
  const model = {path: 'specs/quint/application/NotesTrashSession.qnt', main: 'NotesTrashSession'};
  const traces = [...modelTraces({...model, ...options}), ...witnessTraces({...model, witnesses})];
  // Trash storage reads are answered at once, so a re-read the model owes has happened by the end
  // of the step that owes it: a finished maintenance pass when the model says so, and every
  // finished destructive action.
  for (const trace of traces) for (const [at, step] of trace.entries())
    step.state.s.loaded = at > 0 && (step.action === 'maintenanceDone' ? step.state.s.reloadOwed : step.action === 'operationDone');
  const product = await loadProductModule(source, {rewrite, stubs});
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'window');
  try {
    return await replayTraces(traces, {
      required: ['backgroundPass', 'notesOpened', 'maintenanceDone', 'trashRefusesNote', 'openTrash', 'closeTrash', 'askErase', 'cancel',
        'back', 'noteLeaves', 'noteReturns', 'confirmGo', 'restore', 'operationDone', 'storageFails'],
      reached: {
        'a foreground caller joining a background pass': ({s}) => s.joinReload,
        'a restore waiting for maintenance': ({s}) => s.busy === 'restore' && s.maintaining,
        'a permanent deletion in flight': ({s}) => s.busy === 'forever',
        'a permanent deletion whose choice was dismissed': ({s}) => s.busy === 'forever' && !s.full,
        'a note deleted forever': ({s}) => s.forever === 1,
        'an empty Recently deleted kept open by a running action': ({s}) => s.trashOpen && s.rows === 0 && s.busy !== 'none',
        'an erase refused on failed storage': ({s}) => s.storageFailed && s.busy === 'none' && s.operations === 0 && s.trashOpen,
      },
      // `background`, `joinReload` and `reloadOwed` show as whether the step re-read Trash; the
      // refused note is closure state that equals the full-Trash choice in every model state.
      project: ({s}) => ({storageFailed: s.storageFailed, noteOpen: s.noteOpen, rows: s.rows, maintaining: s.maintaining, passes: s.passes,
        busy: s.busy, operations: s.operations, trashOpen: s.trashOpen, confirm: s.confirm, full: s.full, forever: s.forever, loaded: s.loaded}),
      async start() {
        Object.defineProperty(globalThis, 'window', {configurable: true, writable: true, value: new EventTarget()});
        Object.defineProperty(globalThis, 'document', {configurable: true, writable: true, value: {hidden: false}});
        const note = {id: 'note-1', kind: 'text', title: 'Groceries', body: 'Milk'};
        const rows = [{id: 'trash-1', deletedAt: 1, note: {id: 'note-0', kind: 'text', title: 'Old', body: ''}}];
        const notes = {list: [note], open: note.id, folder: null, trashChecked: true};
        let passes = [], operation, schedule, loads = 0, mark = 0, operations = 0, forever = 0;
        globalThis.__notesTrashPorts = {
          readNotesTrash: async () => ({entries: [...rows]}), sortedNotesTrash: doc => doc.entries, notesTrashDaysLabel: () => '30 days left',
          savedNoteIds: async () => notes.list.map(item => item.id), savedNotes: async () => notes.list, withNotesDeletionLock: work => work(),
          editNotesTrash: () => assert.fail('the adapter edits Trash only through the shared actions'),
          maintainNotesTrash: () => new Promise(resolve => passes.push(resolve)),
          scheduleNotesTrashMaintenance: host => { schedule = host;return () => {}; },
          createNotesTrashActions: () => ({
            moveToTrash: async () => ({status: 'full'}),
            restore: () => new Promise((resolve, reject) => { assert.equal(operation, undefined, 'two destructive actions at once');operation = {kind: 'restore', resolve, reject}; }),
            erase: () => new Promise(resolve => { assert.equal(operation, undefined, 'two destructive actions at once');operation = {kind: 'erase', resolve}; }),
            deleteForever: () => new Promise(resolve => { assert.equal(operation, undefined, 'two destructive actions at once');operation = {kind: 'forever', resolve}; }),
          }),
        };
        class Shell {
          live = false;notesStore = {list: notes.list, target: () => ({})};notesStorageFailed = false;notesPending = false;
          notesSourceMode = 'legacy';notesSourceEpoch = 0;notesReady = Promise.resolve();
          api() { return {set: patch => this.vset('notes', patch), get: () => notes, toast() {}}; }
          componentDidMount() { this.live = true; }
          componentWillUnmount() { this.live = false; }
          vget() { return notes; }
          vset(key, patch) {
            assert.equal(key, 'notes');
            if ('trash' in patch) loads++;
            if (patch.trashBusy === true) operations++;
            Object.assign(notes, patch);return true;
          }
          toast() {}
        }
        const views = {notes: {render: () => ({}), back: () => false}};
        product.installNotesTrashAdapter(Shell, views);
        const shell = new Shell(), view = () => views.notes.render(notes, shell.api('notes'));
        /** The shell renders after every change; render effects run in microtasks. */
        const rendered = async () => {
          for (let turn = 0; turn < 6; turn++) {
            await settle();const before = JSON.stringify(notes);view();await settle();
            if (JSON.stringify(notes) === before) return;
          }
          assert.fail('the Notes view never stopped changing');
        };
        const act = work => async (...args) => { await work(...args);await rendered(); };
        // Startup: the first pass runs once saved Notes are open and reads Trash.
        shell.componentDidMount();await settle();
        assert.equal(passes.length, 1, 'startup runs one maintenance pass');
        passes.shift()({removed: []});await rendered();
        assert.deepEqual(notes.trash, rows);
        mark = loads;operations = 0;
        const answers = {
          erase: {done: () => { rows.pop();return {status: 'done', erased: 1, failed: 0}; }, changed: () => ({status: 'done', erased: 0, failed: 0}),
            unconfirmed: () => ({status: 'unconfirmed', erased: 0, failed: 0})},
          restore: {done: () => { rows.pop();return 'restored'; }, changed: () => 'live', unconfirmed: () => 'failed'},
          forever: {done: () => { notes.list = [];notes.open = null;forever++;return 'deleted'; }, changed: () => 'changed', unconfirmed: () => 'unconfirmed'},
        };
        return {
          actions: {
            backgroundPass: act(() => schedule.run()),
            notesOpened: act(() => { notes.trashChecked = false;view(); }),
            maintenanceDone: act(({flag}) => {
              assert.equal(passes.length, 1, 'one maintenance pass in flight');
              if (flag) rows.pop();
              passes.shift()({removed: flag ? ['trash-1'] : []});
            }),
            reload() {},
            trashRefusesNote: act(() => shell.api('notes').moveNoteToTrash(note, 0)),
            openTrash: act(() => view().openTrash()),
            closeTrash: act(() => view().closeTrash()),
            askErase: act(({kind}) => kind === 'all' ? view().emptyTrash() : view().trashRows[0].erase()),
            cancel: act(() => view().trashCancel()),
            back: act(() => assert.equal(views.notes.back(notes, shell.api('notes')), true)),
            noteLeaves: act(() => { notes.open = null; }),
            noteReturns: act(() => { notes.list = [note];notes.open = note.id; }),
            confirmGo: act(() => view().trashConfirmGo()),
            restore: act(() => view().trashRows[0].restore()),
            operationDone: act(({outcome}) => {
              const call = operation;operation = undefined;
              assert.ok(call, 'no destructive action reached its shared action');
              if (call.kind === 'restore' && outcome === 'unconfirmed' && operations % 2) call.reject(Error('Restore failed.'));
              else call.resolve(answers[call.kind][outcome]());
            }),
            storageFails: act(() => { shell.notesStorageFailed = true; }),
          },
          observe() {
            const loaded = loads > mark;mark = loads;
            return {storageFailed: shell.notesStorageFailed, noteOpen: notes.list.some(item => item.id === note.id) && notes.open === note.id,
              rows: rows.length, maintaining: passes.length > 0, passes: passes.length,
              busy: notes.trashBusy ? operation?.kind ?? 'restore' : 'none', operations,
              trashOpen: notes.folder === 'deleted', confirm: !notes.trashConfirm ? 'none' : notes.trashConfirm.id === 'all' ? 'all' : 'one',
              full: !!notes.trashFull, forever, loaded};
          },
          close() { shell.componentWillUnmount();delete globalThis.__notesTrashPorts; },
        };
      },
    });
  } finally {
    if (saved) Object.defineProperty(globalThis, 'window', saved);else delete globalThis.window;
    delete globalThis.document;
  }
}
