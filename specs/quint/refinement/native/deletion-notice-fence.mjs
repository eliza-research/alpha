// DeletionNoticeFence against createDeletionNoticePolicy in apps/app/src/runtime/deletions.ts,
// bundled with the shared deletion-window contract it filters rows with. Ports: the native
// deletions bridge (each call is held until the model settles it) and the owner identity.
import {loadProductModule, modelTraces, replayTraces, settle, witnessTraces} from '../application/notes-files-media-itf.mjs';

const source = 'apps/app/src/runtime/deletions.ts';
const model = {path: 'specs/quint/native/DeletionNoticeFence.qnt', main: 'DeletionNoticeFence'};
const witnesses = ['StaleReadIgnoredAfterReturnWitness', 'KnownFailureSurfacedWitness', 'StaleUndoKeepsRowWitness',
  'UnconfirmedUndoKeepsRowWitness', 'QuietAfterDismissWitness'];
const entry = row => ({kind: row === 0 ? 'calendar' : 'reminder', id: `row-${row}`, phase: row === 0 ? 'queued' : 'paused', window: 'open'});
// A receipt outside the notice phases: the policy must not count it as a pending deletion.
const settled = {kind: 'calendar', id: 'history', phase: 'deleted', window: 'closed'};

export async function replayDeletionNoticeFence({rewrite, ...options} = {}) {
  const traces = [...modelTraces({...model, ...options}), ...witnessTraces({...model, witnesses})];
  const product = await loadProductModule(source, {rewrite, stubs: {'../platform-plugins': 'export const registerPlugin=()=>({});'}});
  return replayTraces(traces, {
    required: ['ownerChanges', 'startCall', 'pendingAnswers', 'pendingFails', 'undoAnswers', 'dismissAnswers', 'explicitFails'],
    reached: {
      'a failed read surfaced for a known row': ({s}) => Object.values(s.calls).some(call => call.kind === 'pending' && call.outcome === 'error'),
      'a failed read kept quiet': ({s}) => Object.values(s.calls).some(call => call.outcome === 'quiet'),
      'an answer admitted under an earlier generation': ({s}) => s.staleEffects > 0,
      'a stale answer arriving after the owner changed back': ({s}) => s.staleEffects > 0 && s.owner === 0 && s.generation === 2,
      'a known row surviving an unconfirmed or stale Undo': ({s}) => s.known.length > 0 && Object.values(s.calls).some(call => call.kind === 'undo' && call.outcome === 'returned'),
    },
    // The known set, the generation and the admission of a call are private to the policy. What
    // it lets through is compared instead: the outcome of every call, the owner it reports, and
    // whether a failing status read is surfaced now, which holds exactly when a row is known.
    project: ({s}) => ({owner: s.owner, knows: s.known.length > 0,
      calls: Object.fromEntries(Object.entries(s.calls).map(([slot, call]) => [slot, {kind: call.kind, row: call.row, outcome: call.outcome}]))}),
    start() {
      let owner = 0, held;
      const listeners = new Set(), failure = Error('bridge unavailable');
      const hold = () => { if (!held) return Promise.reject(failure);const call = held;held = undefined;return new Promise((resolve, reject) => Object.assign(call, {resolve, reject})); };
      const policy = product.createDeletionNoticePolicy({pending: hold, undo: hold, dismiss: hold},
        {read: () => owner, subscribe(listener) { listeners.add(listener);return () => listeners.delete(listener); }});
      const unsubscribe = policy.identity.subscribe(() => {});
      const calls = {0: {kind: 'none', row: -1, outcome: 'idle'}, 1: {kind: 'none', row: -1, outcome: 'idle'}};
      const answer = async (slot, value) => { calls[slot].answer = value;calls[slot].resolve(value);await settle(); };
      const fail = async ({slot}) => { calls[slot].reject(failure);await settle(); };
      return {
        actions: {
          ownerChanges() { owner = 1 - owner;for (const listener of listeners) listener(); },
          async startCall({slot, kind, row}) {
            const call = calls[slot] = held = {kind, row: kind === 'pending' ? -1 : row, outcome: 'flying'};
            policy.bridge[kind](kind === 'pending' ? undefined : entry(row)).then(
              value => { call.outcome = value === call.answer ? 'returned' : 'quiet';call.quiet = value; },
              error => { call.outcome = 'error';call.error = error; });
            await settle();
          },
          pendingAnswers: ({slot, rows}) => answer(slot, {deletions: [settled, ...rows.map(entry)]}),
          pendingFails: fail, explicitFails: fail,
          undoAnswers: ({slot, confirmed}) => answer(slot, {phase: confirmed ? 'undone' : 'deleted'}),
          dismissAnswers: ({slot}) => answer(slot, {}),
        },
        async observe() {
          for (const call of Object.values(calls)) {
            if (call.outcome === 'error' && call.error !== failure) throw call.error;
            if (call.outcome === 'quiet' && JSON.stringify(call.quiet) !== '{"deletions":[]}') throw Error(`a quiet read returned ${JSON.stringify(call.quiet)}`);
          }
          // A status read the bridge fails at once: it changes nothing and shows whether a row is known.
          const knows = await policy.bridge.pending().then(() => false, error => { if (error !== failure) throw error;return true; });
          return {owner: policy.identity.read(), knows,
            calls: Object.fromEntries(Object.entries(calls).map(([slot, call]) => [slot, {kind: call.kind, row: call.row, outcome: call.outcome}]))};
        },
        close() { unsubscribe(); },
      };
    },
  });
}
