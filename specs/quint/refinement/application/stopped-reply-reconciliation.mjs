/** Replay stopped-reply scenarios through the production connection send and timer callbacks. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from '../../../../test/support/strip-types.mjs';
import {modelTraces, replayTraces, repositoryRoot} from '../assistant-model-traces.mjs';
import {observedReplay} from '../observed-replay.mjs';

const path = 'specs/quint/application/StoppedReplyReconciliation.qnt';
const model = 'StoppedReplyReconciliation';
const sourcePath = 'apps/app/src/runtime/connection-ui.tsx';
const manifestPath = 'specs/quint/application/manifest.json';
const conversation = 'owned-conversation';
const flush = () => new Promise(resolve => setImmediate(resolve));

function held() {
  const deferred = Promise.withResolvers();
  void deferred.promise.catch(() => {});
  return deferred;
}

function compile() {
  const source = readFileSync(repositoryRoot + sourcePath, 'utf8');
  const between = (start, end) => {
    const first = source.indexOf(start), last = source.indexOf(end, first + start.length);
    assert.ok(first >= 0 && last > first, 'Missing source anchor ' + start);
    return source.slice(first, last);
  };
  const key = source.match(/^function conversationKey\(.*$/m)?.[0];
  assert.ok(key, 'Missing conversationKey');
  const stop = between('const STOPPED_REPLY_CHECK_MS =', 'async function conversationList(').replace(/^export /gm, '');
  const send = between('  async send(text:', '\n  },\n};');
  return new vm.Script(stripTypeScriptTypes(
    key + '\n' + stop + '\nconst connectionController = {' + send + '\n}};\n' +
    'Object.assign(globalThis, {connectionController, conversationKey, scheduleStoppedReply, cancelStoppedReply,' +
    'hasCheck: () => stoppedReply !== null});',
    {mode: 'strip'},
  ));
}

function createDriver(script, findStoppedUserTurn) {
  const session = {sessionId: 'current-session', origin: 'resident', agentId: 'agent', ownerId: 'owner'};
  const state = {session};
  const checks = [];
  let nextCancel, attempt, replacedWhileBusy = false;
  const recent = () => checks.at(-1);
  const turn = () => ({clientMessageId: 'request-' + (checks.length + 1), text: 'Repeated prompt', sentAt: 1});
  const box = {
    state, epoch: 1, operation: null, sending: null, conversationMemory: new Map(),
    requestedCameraContinuation: undefined, clientObservationSession: undefined,
    AbortController, DOMException, Date, findStoppedUserTurn,
    ownProviderSelected: () => false, isAndroid: false, testMocksEnabled: false,
    boundNavigation: () => undefined,
    phoneContextMessage: (text, context) => ({text, context}),
    ensureSelectedConversation: () => attempt.admission.promise,
    readDevicePreferences: async () => ({askBeforeAgentActions: true}),
    withResidentMapsNavigation: (_request, _id, _signal, send) => send(),
    appRecordInvalidations: () => [],
    automationsCommitted: () => false,
    expired: () => false,
    failureKindOf: () => undefined,
    AlphaClientError: class extends Error {},
    checkResidentAlive() {},
    runQueuedResidentRebind() {},
    restoredText: text => text,
    restoredMessages: messages => messages,
    update(patch) {
      if (patch.replyNotice === 'Cancelled') recent().acknowledged = true;
      if (patch.history && (box.sending || box.operation)) replacedWhileBusy = true;
      Object.assign(state, patch);
    },
    setTimeout(run, delay) {
      if (delay === 0) { queueMicrotask(run); return; }
      assert.equal(delay, 15_000, 'one 15-second reconciliation timer');
      const check = {run, cancel: nextCancel, read: undefined, cleared: false, acknowledged: false};
      nextCancel = undefined;
      checks.push(check);
      return check;
    },
    clearTimeout(check) { check.cleared = true; },
    readConversation(active, id, signal, assertCurrent) {
      const check = recent();
      assert.equal(active, box.active);
      assert.equal(id, conversation);
      assert.equal(check.read, undefined, 'only one history read per check');
      assertCurrent();
      check.read = {...held(), signal};
      return check.read.promise;
    },
  };
  box.active = {kind: 'resident', remote: {
    send(id, text, {clientMessageId, signal}) {
      assert.equal(id, conversation);
      assert.equal(text, attempt.turn.text);
      assert.equal(clientMessageId, attempt.turn.clientMessageId);
      attempt.dispatched = true;
      attempt.signal = signal;
      return attempt.wire.promise;
    },
    abortTurn(id, signal) {
      assert.equal(id, conversation);
      assert.equal(nextCancel, undefined, 'only one cancel attempt per check');
      nextCancel = {...held(), signal, settled: false};
      return nextCancel.promise;
    },
  }};
  script.runInContext(vm.createContext(box));
  box.conversationMemory.set(box.conversationKey(session), conversation);

  function settleCancel(cancel, outcome) {
    assert.ok(cancel && !cancel.settled, 'cancel attempt is pending');
    cancel.settled = true;
    cancel.resolve(outcome);
  }
  function start(input) {
    return box.connectionController.send(input.turn.text, {sensitive: false}, input.turn.clientMessageId, input.controller.signal);
  }
  async function reachTransport() {
    attempt.admission.resolve(conversation);
    await flush();
    assert.equal(attempt.dispatched, true, 'the production send reached transport');
  }
  function history(kind, stopped) {
    const user = {id: 'stopped-user', role: 'user', text: stopped.text, clientMessageId: stopped.clientMessageId};
    const other = {id: 'other-user', role: 'user', text: stopped.text, clientMessageId: 'other-request'};
    const decoy = {role: 'assistant', text: 'Reply to another identical prompt', replyToMessageId: other.id};
    const reply = {role: 'assistant', text: 'The stopped turn finished', replyToMessageId: user.id};
    return {messages: [other, decoy, ...(kind === 'unrecorded' ? [] : [user]),
      ...(kind === 'finished' ? [reply] : [])], partial: false, deliveryRevisionAtStart: 0};
  }
  const notice = new Map([
    ['', 'none'], ['May still finish', 'pending'], ['Cancelled', 'cancelled-pending'],
    ['Outcome unknown', 'unchecked'], ['The agent did not record the stopped message.', 'not-recorded'],
  ]);
  const message = new Map([
    ['', 'none'], ['The agent stopped this reply.', 'confirmed-stopped'], ['The agent finished the stopped reply.', 'finished'],
  ]);

  return {
    async sendStart() {
      const prior = box.hasCheck() ? recent() : null;
      attempt = {controller: new AbortController(), admission: held(), wire: held(), turn: turn(), dispatched: false};
      attempt.task = start(attempt);
      void attempt.task.catch(() => {});
      await Promise.race([attempt.task.then(() => assert.fail('the send settled before admission')), flush()]);
      if (prior) {
        assert.equal(prior.cleared, true, 'the new send clears the prior check timer');
        if (prior.cancel) {
          assert.equal(prior.cancel.signal.aborted, true, 'the new send retired the old check');
          if (!prior.cancel.settled) settleCancel(prior.cancel, 'aborted');
        }
        if (prior.read) {
          assert.equal(prior.read.signal.aborted, true, 'the new send retires the pending history read');
          prior.read.resolve(history('finished', prior.turn));
        }
        await flush();
      }
    },
    async busySendRefused() {
      await assert.rejects(start({turn: turn(), controller: new AbortController()}), /Finish the connection or history operation/);
    },
    async sendStopped(dispatched, withCancel) {
      assert.ok(dispatched && withCancel, 'the stopped send scenario uses the resident cancel route after dispatch');
      await reachTransport();
      attempt.controller.abort();
      assert.equal(attempt.signal.aborted, true);
      attempt.wire.reject(attempt.signal.reason);
      await assert.rejects(attempt.task, {name: 'AbortError'});
      assert.ok(recent().cancel);
      recent().turn = attempt.turn;
      await flush();
    },
    async sendSettled(dispatched) {
      await reachTransport();
      if (dispatched) {
        attempt.wire.resolve({text: 'New reply'});
        await attempt.task;
      } else {
        attempt.wire.reject(Object.assign(Error('Transport refused before turn admission'), {beforeDispatch: true}));
        await assert.rejects(attempt.task, {notDispatched: true});
      }
      await flush();
    },
    restoredAfterConnect() {
      const restored = turn();
      box.scheduleStoppedReply(box.active, session, conversation, restored, undefined, false);
      assert.equal(recent().cancel, undefined, 'a restored reply has no abort request');
      recent().turn = restored;
    },
    async cancelOutcome(aborted) {
      settleCancel(recent().cancel, aborted ? 'aborted' : 'unsupported');
      await flush();
    },
    async timerFires() {
      const check = recent();
      assert.equal(check.cleared, false);
      check.run();
      await flush();
    },
    async readSettles(kind) {
      const {read, turn: stopped} = recent();
      assert.ok(read, 'the timer issued a read');
      if (kind === 'error') read.reject(Error('History unavailable'));
      else read.resolve(history(kind, stopped));
      await flush();
    },
    operationStart() { box.operation = new AbortController(); },
    observe() {
      const last = recent();
      return {
        check: !box.hasCheck() ? 'none' : last.read ? 'reading' : 'scheduled',
        cancelled: last?.acknowledged ?? false,
        notice: notice.get(state.replyNotice ?? ''),
        message: message.get(state.message ?? ''),
        sending: Boolean(box.sending), operation: Boolean(box.operation),
        reads: Number(Boolean(last?.read)), schedules: checks.length,
        historyRevision: state.history?.revision ?? 0, replacedWhileBusy,
      };
    },
    async close() {
      box.cancelStoppedReply();
      for (const check of checks) {
        if (check.cancel && !check.cancel.settled) settleCancel(check.cancel, 'unsupported');
        check.read?.reject(Error('Fixture closed'));
      }
      if (attempt) {
        attempt.controller.abort();
        attempt.admission.reject(Error('Fixture closed'));
        attempt.wire.reject(Error('Fixture closed'));
        await attempt.task.catch(() => {});
      }
      await flush();
    },
  };
}

function project({cancelAttempt, retiredPending, ...observation}) {
  return observation;
}

export async function checkStoppedReplyReconciliation() {
  const entries = JSON.parse(readFileSync(repositoryRoot + manifestPath, 'utf8'));
  const {tests} = (entries.models ?? entries).find(entry => entry.module === model);
  return observedReplay({
    model, prefix: 's',
    projection: 'Active check slot, acknowledged abort, notices, operation/send guards, actual timer/read counts and history publication.',
    assumptions: [
      'Named model scenarios execute the unchanged send, schedule and timer source with deterministic connection and transport ports.',
      'The restore action enters at scheduleStoppedReply after a qualifying restored turn. The full conversation restore, agent switching, and explicit reload are outside this replay.',
      'The read and abort replies are synthetic. Native IPC timing, durable agent history and the chat bubble presentation are outside this replay.',
    ],
    extraSources: [path, sourcePath, manifestPath],
    run: async () => {
      const {findStoppedUserTurn} = await import('../../../../.eliza/client-features/packages/ui/src/api/conversation-turn-controller.ts');
      const script = compile();
      const traces = modelTraces({path, module: model, scenarios: tests});
      return replayTraces(traces, () => createDriver(script, findStoppedUserTurn), {project});
    },
  });
}
