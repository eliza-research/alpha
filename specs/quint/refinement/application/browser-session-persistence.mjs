/** Replays BrowserSessionPersistence traces against the browser adapter's own saved-tabs writer:
 * its `restoreSession`, `clearBrowsingData` and poll-driven `saveSession` with its generation fence, native-write drain and publication callback; the native bridge,
 * review dialog, React commit and clock are controlled ports.
 *
 * Abstraction: a model content identity k is a history of the first k addresses; identity 0 is the
 * empty record. `disk` is 1 until the bridge accepts a write or a clear, then the identity it stored.
 * One model `tick` advances the clock by the saver's real delay divided by the model's wait.
 * Not observed: the saver's private `lastSaved`, `failed`, `failures` and the queued write, which
 * show only through the writes the bridge receives on later steps. */
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import vm from 'node:vm';
import {stripTypeScriptTypes} from '../../../../test/support/strip-types.mjs';
import {browsingSnapshot, restoreBrowsing, DEFAULT_BROWSING_LIMITS} from '../../../../.eliza/client-features/plugins/plugin-native-browser-surface/src/browsing-session.ts';
import {BrowserTabSession} from '../../../../.eliza/client-features/plugins/plugin-native-browser-surface/src/tab-host.ts';
import {modelTraces, replayTraces, repositoryRoot, settle} from './browser-model-traces.mjs';

const model = {path: 'specs/quint/application/BrowserSessionPersistence.qnt', module: 'BrowserSessionPersistence'};
const scenarios = ['rejectedWriteBacksOffTest', 'changedSnapshotSkipsBackoffTest', 'failedReadNeverWritesTest', 'backoffGrowsTest', 'idlePollTest', 'writeDuringClearIsRejectedTest', 'failedClearRetriesUnchangedSnapshotTest'];
const witnesses = ['BackoffWaitingWitness', 'UnreadKeptWitness', 'QueuedBehindWriteWitness', 'FailedClearRetryWitness'];
const history = count => Array.from({length: count}, (_, index) => `https://example.test/v${index + 1}`);

export async function sessionPersistenceDriver() {
  const adapter = readFileSync(join(repositoryRoot, 'apps/app/src/prototype/browser-adapter.ts'), 'utf8');
  const start = adapter.indexOf('  function forgetTabs(ids'), end = adapter.indexOf('  async function clearSiteData() {');
  if (start < 0 || end < start) throw Error('The adapter no longer has the saved-tabs region');
  const region = stripTypeScriptTypes(adapter.slice(start, end));
  return () => {
    const state = {tabs: [{id: 'b0', hist: ['newtab'], pos: 0}], visits: [], cur: 'b0', editing: false};
    const tabs = new BrowserTabSession({session: 'session'});
    const h = {time: 0, disk: 1, writes: [], read: null, clear: null, tickSize: 0, failures: 0, fresh: 0, reports: []};
    const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return {promise, resolve, reject}; };
    const context = {MAX_TABS: DEFAULT_BROWSING_LIMITS.tabs, browsingSnapshot, restoreBrowsing, tabs, session: 'session', restored: new Map(),
      Date: {now: () => h.time}, Promise,
      snapshotRevision: 0, snapshotInputs: undefined, snapshotValue: null, snapshotJson: '',
      lastSaved: '', saveQueue: Promise.resolve(), saveEpoch: 0, failedSnapshot: '', retryAt: 0, retryDelay: 2000, saveWarning: false,
      sessionRead: false, sessionHydrated: false, clearingData: false, disposed: false, confirming: false, lastGeometry: '',
      Capacitor: {isNativePlatform: () => true}, state: () => state, tabInfo: id => tabs.info(id), unimplemented: () => false,
      report: error => h.reports.push(error.message), newTabId: () => `fresh${++h.fresh}`, update: async () => {},
      reviews: {confirm: async () => true},
      shell: {vset(_view, patch, options) { Object.assign(state, patch); options?.afterCommit?.(); }, toast() {}},
      Browser: {
        browsingState: () => (h.read = deferred()).promise,
        saveBrowsingState: input => { const write = {...deferred(), content: Array.from(input.history).length, settled: false}; h.writes.push(write); return write.promise; },
        clearBrowsingData: () => (h.clear = deferred()).promise,
      }};
    const run = vm.runInNewContext('(function(){' + region + ';return {restoreSession, saveSession, clearBrowsingData};})()', context);
    const inflight = () => h.writes.find(write => !write.settled);
    return {
      edit(content) { state.visits = history(content); },
      touch() { state.visits = [...state.visits]; },
      async restoreSettles(ok, merged) {
        const reading = run.restoreSession();
        await settle();
        if (ok) h.read.resolve({history: history(merged), tabs: [], cur: ''}); else h.read.reject(new Error('unreadable'));
        await reading; await settle();
      },
      async poll() { run.saveSession(); await settle(); },
      tick() { h.time += h.tickSize; },
      async writeSettles(ok, step) {
        const write = inflight();
        write.settled = true;
        if (ok) { h.disk = write.content; write.resolve(); } else write.reject(new Error('store'));
        await settle();
        // One finite wait tick spans the retained writer's actual exponential delay.
        if (step.after.wait > 0 && context.retryAt > h.time)
          h.tickSize = (context.retryAt - h.time) / step.after.wait;
      },
      async clearStart() { h.clearing = run.clearBrowsingData(); await settle(); },
      async clearSettles(ok) {
        if (ok) { h.disk = 0; h.clear.resolve({closed: []}); } else h.clear.reject(new Error('clear refused'));
        await h.clearing; await settle();
      },
      observe: () => ({readDone: context.sessionRead, hydrated: context.sessionHydrated, clearing: context.clearingData,
        content: state.visits.length, inflight: inflight()?.content ?? -1, disk: h.disk}),
    };
  };
}

export async function checkBrowserSessionPersistence({random = 40, steps = 30} = {}) {
  const create = await sessionPersistenceDriver();
  const traces = modelTraces({...model, scenarios, witnesses, random, steps});
  const receipt = await replayTraces(traces, create, {project: s => ({readDone: s.readDone, hydrated: s.hydrated, clearing: s.clearing, content: s.content, inflight: s.inflight, disk: s.disk})});
  return {...receipt, scenarios, witnesses};
}
