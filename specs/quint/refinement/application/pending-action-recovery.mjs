/** Replays PendingActionRecovery model traces against `recoverPendingActions` and the review
 * cards it builds (`proposalCard`), evaluated from apps/app/src/prototype/agent-adapter.ts.
 *
 * Controlled ports: the connection snapshot (the binding is its history revision; `blocked` is
 * connection work in progress), the pending-action read, the expiry timer and the clock.
 *
 * Correspondence notes. A model read that returns `cards` reviewable proposals with an expiry is a
 * read that returns exactly those, plus one proposal without an expiry that marks the read, so an
 * applied result is visible in the transcript. `continuation` applies the two assignments its
 * caller (`completeReadReply`) makes before calling `recoverPendingActions`.
 *
 * Not observed: `triggers` (a bound) and `dropped`. */
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import {modelTraces, replayTraces, repositoryRoot} from '../assistant-model-traces.mjs';

export const model = {path: 'specs/quint/application/PendingActionRecovery.qnt', module: 'PendingActionRecovery'};
export const scenarios = ['recoveredOnceTest', 'failedReadDoesNotPollTest', 'staleResultDroppedTest', 'expiryReadsAgainOnceTest',
  'blockedForgetsFailureTest', 'blockedDropsReadInFlightTest'];
export const witnesses = ['FailedQuietWitness', 'StaleResultDroppedWitness', 'ExpiryRereadWitness'];

const flush = async () => { for (let turn = 0; turn < 3; turn++) await new Promise(resolve => setImmediate(resolve)); };

export function compile() {
  const source = readFileSync(`${repositoryRoot}/apps/app/src/prototype/agent-adapter.ts`, 'utf8');
  const between = (start, end) => { const a = source.indexOf(start), b = source.indexOf(end, a); if (a < 0 || b <= a) throw Error(`missing source anchor ${start}`); return source.slice(a, b); };
  const card = between('  function proposalCard(', '  p.cancelReadReplyCompletions=function'), recover = between('  function recoverPendingActions(', '  /** The stopped-reply');
  return transformSync(`${card}\n${recover}`, {loader: 'ts', format: 'cjs'}).code + ';return recoverPendingActions;';
}

export function project(state) {
  const {triggers, dropped, ...observed} = state;
  return observed;
}

export function createDriver(code) {
  let revision = 0, busy = false, clock = 1_000_000, uuid = 0;
  const session = {sessionId: 'session', ownerId: 'owner'}, context = {view: 'home', sensitive: false};
  const reads = [], timers = [];
  let msgs = [];
  const shell = {live: true, S: () => ({msgs, typing: false}), toast() { throw Error('background recovery never toasts'); },
    setState(value, done) { const patch = typeof value === 'function' ? value({msgs}) : value; if (patch?.msgs) msgs = patch.msgs; done?.(); }};
  const connectionController = {
    getSnapshot: () => ({session, history: {revision}, phoneActionsAvailable: true, open: false, busy}),
    pendingActions(_context, signal) { return new Promise((resolve, reject) => { reads.push({resolve, reject, signal, revision, pending: true}); }); },
  };
  const recover = new Function('connectionController', 'alphaClient', 'document', 'setTimeout', 'clearTimeout', 'retainReadReply', 'crypto', 'Date', code)(
    connectionController, {getState: () => ({context})}, {hidden: false},
    (run, delay) => { const timer = {run, delay, revision, live: true}; timers.push(timer); return timer; },
    timer => { if (timer) timer.live = false; }, () => {}, {randomUUID: () => `card-${++uuid}`}, {now: () => clock});
  const keyOf = value => value ? JSON.parse(value)[1] : -1;
  const expiring = () => msgs.filter(message => message.card?.proposalId && !message.card.done && !message.card.reviewUnavailable && Number.isFinite(message.card.expiresAt));
  const marks = () => msgs.filter(message => message.card?.proposalId?.startsWith('read-'));
  return {
    async sync() { recover(shell); await flush(); },
    bindingChanged() { revision++; },
    async block() { busy = true; recover(shell); await flush(); },
    async unblock() { busy = false; recover(shell); await flush(); },
    async readSettles(ok, cards) {
      const read = reads.at(-1); read.pending = false;
      if (ok) read.resolve([...Array.from({length: cards}, (_, index) => ({id: `expiring-${index + 1}`, title: 'Review', description: 'Review this action', expiresAt: clock + 1000 * (index + 1)})),
        {id: `read-${reads.length}@${read.revision}`, title: 'Review', description: 'Review this action', expiresAt: Infinity}]);
      else read.reject(Error('offline'));
      await flush();
    },
    async timerFires() {
      const timer = timers.findLast(item => item.live); timer.live = false;
      // The clock reaches the nearest expiry, which is what this timer was armed for.
      const due = expiring().map(message => message.card.expiresAt);
      clock = due.length ? Math.max(clock, Math.min(...due)) + 1 : clock + 1;
      timer.run(); await flush();
    },
    async continuation() { shell.pendingActionRecoveryKey = null; shell.pendingActionRecoveryFailedKey = null; recover(shell); await flush(); },
    observe() {
      const read = reads.at(-1), armed = timers.findLast(item => item.live), applied = marks();
      return {binding: revision, blocked: busy, key: keyOf(shell.pendingActionRecoveryKey), failedKey: keyOf(shell.pendingActionRecoveryFailedKey),
        read: !!read && read.pending && !read.signal.aborted, readKey: read ? read.revision : -1,
        timer: armed && shell.pendingActionExpiryTimer === armed ? armed.revision : -1, expiring: expiring().length, reads: reads.length,
        applied: applied.length, appliedKey: applied.length ? Number(applied.at(-1).card.proposalId.split('@')[1]) : -1};
    },
    async close() { shell.live = false; for (const read of reads) if (read.pending) read.reject(Error('closed')); await flush(); },
  };
}

export async function runPendingActionRecoveryReplay({random = 80, steps = 40} = {}) {
  const code = compile(), traces = modelTraces({...model, scenarios, witnesses, random, steps});
  return replayTraces(traces, () => createDriver(code), {project});
}
