import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import {actionCounts, modelTraces, sameState} from './calendar-itf.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const model = {path: 'specs/quint/application/CalendarLinkedLocalPort.qnt', module: 'CalendarLinkedLocalPort', traces: 30, steps: 40,
  witnesses: ['AppliedWitness', 'StagedWitness', 'StaleRefusedWitness', 'PendingBlockedWitness', 'SourceReplacedWitness',
    'WrittenThenAbortedWitness', 'AbsentDeleteWitness'],
  goals: {
    editedAfterWrite: 's.outcome == "applied" and s.known >= 0 and s.known < s.revision',
    deleteByAnotherOwner: 's.outcome == "changed" and s.writes == 0 and s.revision == 0 and s.exists and not(s.pending) and s.known == 0',
    lossyEventRefused: 's.outcome == "invalid"',
    stagedThenAborted: 's.lateAbort and s.pending and s.deletionNotices == 0',
  }};
const sources = ['apps/app/src/browser/calendar-linked-local.ts', 'apps/app/src/browser/calendar-store.ts',
  'apps/app/src/browser/calendar-deletions.ts', 'apps/app/src/browser/calendar-records.ts', 'apps/app/src/runtime/deletion-owner.ts'];

/** `mutate` rewrites the bundled port, for checks that the replay notices a changed implementation. */
export async function buildCalendarLinkedLocalPort(mutate = code => code) {
  const built = await build({absWorkingDir: root, stdin: {contents: `export {browserCalendarSyncPort} from './apps/app/src/browser/calendar-linked-local.ts';
export {calendarDeletionPending, stageCalendarDeletion, undoCalendarDeletion} from './apps/app/src/browser/calendar-deletions.ts';
export {calendarRecord, deleteCalendarRecord} from './apps/app/src/browser/calendar-records.ts';
export {bindBrowserDeletionOwner} from './apps/app/src/runtime/deletion-owner.ts';`, resolveDir: root, loader: 'ts'},
  bundle: true, platform: 'node', format: 'cjs', write: false, metafile: true,
  // Only the stored document is replaced: the calendar store's own guard, the deletion journal
  // and the record helpers in the bundle are the real sources.
  plugins: [{name: 'calendar-document-port', setup(builder) {
    builder.onResolve({filter: /\/(documents|domain-document)$/}, ({path}) => ({path: path.split('/').at(-1), namespace: 'document-port'}));
    builder.onLoad({filter: /.*/, namespace: 'document-port'}, ({path}) => ({loader: 'js', contents: `module.exports = __ports[${JSON.stringify(path)}];`}));
  }}]});
  const inputs = Object.keys(built.metafile.inputs);
  for (const needed of sources) assert.ok(inputs.includes(needed), needed);
  return {code: mutate(built.outputFiles[0].text), sources: inputs.filter(path => !path.includes(':') && !path.startsWith('node_modules/'))};
}

const turn = () => new Promise(resolve => setImmediate(resolve));
const idle = async () => { for (let index = 0; index < 6; index++) await turn(); };
const id = 'event-1', source = 'source-1';
const event = {id, calendarId: 'local', title: 'Team sync', body: 'Agenda', location: 'Room 4', begin: Date.UTC(2027, 0, 15, 10),
  end: Date.UTC(2027, 0, 15, 11), timeZone: 'UTC', revision: 'revision-0'};
const provider = (title, valid) => ({title, description: 'From the provider', location: 'Room 5', startAt: '2027-01-15T12:00:00.000Z',
  endAt: '2027-01-15T13:00:00.000Z', timeZone: valid ? 'UTC' : null, isAllDay: false, attendees: [], recurrence: null});

/**
 * The real port over a calendar document kept in memory. A document read or edit waits until the
 * replay runs it, and a committed edit's result waits again, so the stored write and the port's
 * closing check are separate steps as in the model.
 */
function portFixture(compiled) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {url: 'https://alpha.test/'});
  const {window} = dom;
  const state = {data: {sourceRevision: source, events: [structuredClone(event)]}, bound: true, owner: 'agent:owner-1',
    held: null, commit: null, writes: 0, documentNotices: 0, deletionNotices: 0,
    staleWrite: false, unboundWrite: false, heldWrite: false};
  let api;
  class BrowserDomainDocument {
    read() { return new Promise((resolve, reject) => { state.held = {run: async () => resolve(structuredClone(state.data)), reject}; }); }
    edit(initial, change) {
      return new Promise((resolve, reject) => { state.held = {run: async () => {
        const next = structuredClone(state.data), before = JSON.stringify(next);
        // What the document held when the port's change ran, read independently of the port.
        const row = api.calendarRecord(next.events, id), pending = api.calendarDeletionPending(next, id);
        let result;
        try { result = await change(next); } catch (error) { return reject(error); }
        if (JSON.stringify(next) !== before) {
          state.writes++;
          state.staleWrite ||= !row || row.revision !== state.expected;
          state.unboundWrite ||= !state.bound || next.sourceRevision !== source;
          state.heldWrite ||= pending;
          state.data = next;
        }
        state.commit = () => resolve(result);
      }, reject}; });
    }
  }
  const module = {exports: {}};
  new Function('module', 'exports', '__ports', 'window', 'document', 'localStorage', 'BroadcastChannel', 'Event', compiled.code)(
    module, module.exports, {documents: {browserDocuments: {}}, 'domain-document': {BrowserDomainDocument}}, window, window.document,
    undefined, undefined, window.Event);
  api = module.exports;
  api.bindBrowserDeletionOwner(() => state.owner);
  window.addEventListener('alpha:calendar-document-changed', () => state.documentNotices++);
  window.addEventListener('alpha:deletions-changed', () => state.deletionNotices++);
  return {window, state, api, port: api.browserCalendarSyncPort(source, () => state.bound)};
}

const outcomeOf = error => error?.name === 'AbortError' ? 'aborted' : /^Deletion pending/.test(error?.message) ? 'pending'
  : /changed before/.test(error?.message) ? 'changed' : /^(Unsupported event|Missing time zone)$/.test(error?.message) ? 'invalid' : `error: ${error?.message}`;

async function replay(compiled, trace) {
  const f = portFixture(compiled), {state, api, port} = f;
  // Revisions are opaque strings in the document; the model counts them.
  const revisions = [event.revision];
  const count = text => { if (!revisions.includes(text)) revisions.push(text); return revisions.indexOf(text); };
  let known = null, call = null, outcome = 'none', finished = 0, lateAbort = false, edits = 0, owners = 1, ownerCurrent = true;
  const row = () => api.calendarRecord(state.data.events, id);
  const observe = () => {
    const stored = row();
    if (stored) count(stored.revision);
    return {bound: state.bound, sourceSame: state.data.sourceRevision === source, exists: !!stored, revision: revisions.length - 1,
      pending: api.calendarDeletionPending(state.data, id) || unresolved(), known: known === null ? -1 : count(known),
      op: call?.kind ?? 'none', phase: !call ? 'idle' : state.commit ? 'written' : 'admitted',
      expected: call && call.kind !== 'get' ? count(call.expected) : -1, ownerCurrent,
      result: call && state.commit ? call.result() : 'none', wrote: call && state.commit && call.kind === 'apply' ? count(row().revision) - call.later : -1,
      outcome, documentNotices: state.documentNotices, deletionNotices: state.deletionNotices, finished, writes: state.writes,
      staleWrite: state.staleWrite, unboundWrite: state.unboundWrite, heldWrite: state.heldWrite, lateAbort};
  };
  // A deletion whose event is gone no longer has a row to match, but stays unresolved until undone or finished.
  const unresolved = () => Object.values(state.data.deletions ?? {}).some(entry => entry.phase === 'queued' || entry.phase === 'paused');
  const settle = promise => promise.then(value => ({value}), error => ({error}));
  sameState(observe(), trace.steps[0].state, trace, 0);
  try {
    for (let index = 1; index < trace.steps.length; index++) {
      const {action, picks, state: expected} = trace.steps[index], before = trace.steps[index - 1].state;
      if (action === 'begin') {
        const kind = picks.kind, staged = Object.keys(state.data.deletions ?? {}).length;
        state.expected = kind === 'get' ? null : known;
        const promise = kind === 'get' ? port.get(id)
          : kind === 'apply' ? port.applyProviderEvent(id, provider(`Provider title ${index}`, picks.valid), known) : port.delete(id, known);
        call = {kind, expected: known, later: 0, settled: settle(promise),
          result: () => kind === 'apply' ? 'applied' : Object.keys(state.data.deletions ?? {}).length > staged ? 'staged' : 'absent'};
        if (state.bound && (kind !== 'apply' || picks.valid)) ownerCurrent = true;
        await idle();
        if (!state.held) {
          // Refused before the calendar was read.
          const ended = await call.settled;
          assert.ok(ended.error, 'a call that reads nothing gives no result');
          outcome = outcomeOf(ended.error); call = null;
        }
      } else if (action === 'ownerChanged') { state.owner = `agent:owner-${++owners}`; ownerCurrent = false; }
      else if (action === 'transact') {
        const held = state.held; state.held = null;
        await held.run();
        await idle();
        if (!state.commit) {
          const ended = await call.settled;
          if (ended.error) outcome = outcomeOf(ended.error);
          else {
            assert.equal(call.kind, 'get', 'only a read ends without a closing check');
            outcome = ended.value ? 'snapshot' : 'missing'; finished++;
            known = ended.value ? ended.value.revision : null;
            if (ended.value) assert.equal(ended.value.eventId, id);
          }
          call = null;
        }
      } else if (action === 'finish') {
        const result = call.result(), commit = state.commit;
        commit(); await idle(); state.commit = null;
        const ended = await call.settled;
        if (ended.error) { outcome = outcomeOf(ended.error); lateAbort ||= result !== 'absent'; }
        else {
          outcome = result; finished++;
          if (result === 'applied') {
            known = ended.value.revision;
            assert.equal(ended.value.event.title.startsWith('Provider title'), true, 'the result is the stored provider event');
          }
        }
        call = null;
      } else if (action === 'localEdit') {
        row().revision = `owner-revision-${++edits}`;
        if (call && state.commit && call.kind === 'apply') call.later++;
      } else if (action === 'ownerStagesDeletion') api.stageCalendarDeletion(state.data, row(), 'event', 'manual:owner');
      else if (action === 'undoDeletion') {
        for (const entry of Object.values(state.data.deletions)) if (entry.phase === 'queued') api.undoCalendarDeletion(state.data, entry.id, () => true);
      } else if (action === 'finalizeDeletion') {
        for (const entry of Object.values(state.data.deletions)) if (entry.phase === 'queued') entry.phase = 'deleted';
        state.data.events = api.deleteCalendarRecord(state.data.events, row(), 'deleted-revision');
      } else if (action === 'sourceReplaced') state.data.sourceRevision = 'source-2';
      else if (action === 'unbind') state.bound = false;
      else assert.ok(!action, `unknown model action ${action}`);
      sameState(observe(), expected, trace, index);
      assert.equal(before.writes === expected.writes || action === 'transact', true, 'the port writes only in its document step');
    }
  } finally { f.window.close(); }
}

/** Replays CalendarLinkedLocalPort traces against the real browser calendar sync port. */
export async function checkCalendarLinkedLocalPort(mutate) {
  const [traces, compiled] = await Promise.all([modelTraces(model), buildCalendarLinkedLocalPort(mutate)]);
  let steps = 0;
  for (const trace of traces) { await replay(compiled, trace); steps += trace.steps.length - 1; }
  return {traces: traces.length, steps, actions: actionCounts(traces), sources: compiled.sources};
}
