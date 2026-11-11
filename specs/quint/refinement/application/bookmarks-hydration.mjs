/** Replays BookmarksHydration traces against the browser adapter's real bookmark queue:
 * `refreshBookmarks`, `saveBookmark`, `loadBookmarks` and the recovery check.
 *
 * Controlled ports: the Browser plugin's `bookmarks` and `setBookmark` calls (settled when the
 * model says so), the web build's bookmark document (unreadable while the list is damaged), the
 * platform flag and the shell's toast. Abstraction: `stage` is the port call in flight
 * ("reading" a list, "writing" one, or "idle"); `stored` and `marks` count the addresses in the
 * store and in the view; `notices` counts the recovery messages shown and `errorShown` is any
 * message shown. The queue itself is the adapter's promise chain: it shows as the order in which
 * port calls arrive. `episodes` and `marksAtDispose` are model-only. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import vm from 'node:vm';
import {stripTypeScriptTypes} from '../../../../test/support/strip-types.mjs';
import {modelTraces, replayTraces, repositoryRoot, settle} from './browser-model-traces.mjs';

const model = {path: 'specs/quint/application/BookmarksHydration.qnt', module: 'BookmarksHydration'};
const scenarios = ['saveReadsFirstTest', 'refreshCoalescedTest', 'damagedListTest', 'disposedReadChangesNothingTest', 'nativeReadFailureReportedTest'];
const witnesses = ['RecoveryOfferedWitness', 'SaveWaitsForReadWitness', 'UnreadWriteAttemptWitness'];

export async function bookmarksHydrationDriver() {
  const adapter = readFileSync(join(repositoryRoot, 'apps/app/src/prototype/browser-adapter.ts'), 'utf8');
  const start = adapter.indexOf('  let bookmarkRead:'), end = adapter.indexOf('  const state = () =>', start);
  const titlesStart = adapter.indexOf('  function retainedTitles(', end), titlesEnd = adapter.indexOf('  let reading:', titlesStart);
  assert.ok(start >= 0 && end > start && titlesStart > end && titlesEnd > titlesStart,
    'the adapter no longer has the bookmark region or its title helper');
  // The region's one dynamic import (the web build's bookmark document) is given as a port,
  // because a script run in a separate context cannot import modules.
  const documentImport = "await import('../browser/preference-documents')";
  const source = [adapter.slice(start, end), adapter.slice(titlesStart, titlesEnd)].join('\n');
  assert.equal(source.split(documentImport).length, 2, 'the bookmark region imports the bookmark document once');
  const script = new vm.Script(stripTypeScriptTypes(source.replace(documentImport, 'await bookmarkDocuments()')));
  return trace => {
    const store = [], view = {marks: []}, toasts = [], calls = [];
    let damaged = false, saves = 0, external = 0;
    const call = kind => { const item = {kind}; item.promise = new Promise((resolve, reject) => { item.resolve = resolve; item.reject = reject; }); calls.push(item); return item; };
        class CapacitorException extends Error {}
    const context = vm.createContext({bookmarkDocuments: async () => ({bookmarkDocument: {read: async () => { if (damaged) throw new Error('Saved bookmarks are damaged'); return [...store]; }}}),
      session: 'session', disposed: false, Capacitor: {isNativePlatform: () => !trace.init.web}, CapacitorException, ExceptionCode: {Unimplemented: 'UNIMPLEMENTED'},
      Browser: {bookmarks: () => call('reading').promise, setBookmark: input => { const item = call('writing'); item.input = input; return item.promise; }},
      state: () => view, refresh() {}, report: error => { if (!context.disposed) toasts.push(error.message); },
      shell: {vset(_view, patch) { Object.assign(view, patch); }, S: () => ({view: 'browser'})}});
    script.runInContext(context);
    const read = name => vm.runInContext(name, context);
    const pending = () => calls.filter(item => !item.settled);
    return {
      async requestRefresh() { read('refreshBookmarks')(); await settle(); },
      async requestSave() { read('saveBookmark')(`https://example.test/saved-${++saves}`, true); await settle(); },
      async readSettles(ok) {
        const [item] = pending(); assert.equal(item.kind, 'reading'); item.settled = true;
        if (ok) item.resolve({urls: [...store]}); else item.reject(new Error('Bookmarks could not be read'));
        await settle();
      },
      async writeSettles(ok) {
        const [item] = pending(); assert.equal(item.kind, 'writing'); item.settled = true;
        if (ok) { store.unshift(item.input.url); item.resolve({urls: [...store]}); } else item.reject(new Error('Bookmarks could not be saved'));
        await settle();
      },
      externalChange() { store.push(`https://example.test/elsewhere-${++external}`); },
      damage() { damaged = true; },
      repair() { damaged = false; },
      dispose() { context.disposed = true; },
      observe() {
        const open = pending();
        assert.ok(open.length <= 1, 'one bookmark operation runs at a time');
        return {web: trace.init.web, disposed: context.disposed, stage: open[0]?.kind ?? 'idle', refreshQueued: read('bookmarkRefreshQueued'), hydrated: read('bookmarkHydrated'),
          recovery: read('bookmarkRecovery'), damaged, stored: store.length, marks: view.marks.length,
          notices: toasts.filter(message => message.startsWith('Saved bookmarks need recovery')).length, errorShown: toasts.length > 0};
      },
    };
  };
}

export async function checkBookmarksHydration({random = 40, steps = 30} = {}) {
  const create = await bookmarksHydrationDriver();
  const traces = modelTraces({...model, scenarios, witnesses, random, steps});
  return replayTraces(traces, create, {project: s => ({web: s.web, disposed: s.disposed, stage: s.stage, refreshQueued: s.refreshQueued, hydrated: s.hydrated,
    recovery: s.recovery, damaged: s.damaged, stored: s.stored, marks: s.marks, notices: s.notices, errorShown: s.errorShown})});
}
