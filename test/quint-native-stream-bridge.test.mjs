import test from 'node:test';
import assert from 'node:assert/strict';
import {loadBrowserModule} from './fixtures/browser-source.mjs';
import {modelTraces, replayTraces} from '../specs/quint/refinement/assistant-model-traces.mjs';

/** Replays NativeStreamBridge model traces against `streamNativeAgent`.
 *
 * Controlled ports: the Capacitor stream port (listener registration, request, cancel), the
 * caller's abort signal and the text/ready callbacks. Product code: the bridge and the local reply
 * reader it feeds.
 *
 * Correspondence of grouped transitions. The bridge returns or throws in the same task as its
 * terminal transition, so a model state that is terminal and still active is observed as the state
 * after `finish`; the model's `finish` is then an implementation stutter. A listener registration
 * that resolves is observed as attached, and the bridge's own continuation (the request) runs with
 * the model's `requestStream`, or loses to an `abort` issued before that continuation.
 *
 * Not observed: `responded` (internal; constrained through the outcomes of later frames). */

const model = {path: 'specs/quint/native/NativeStreamBridge.qnt', module: 'NativeStreamBridge'};
const scenarios = ['completedReplyTest', 'busyRefusalIsNotDispatchedTest', 'busyAfterResponseIsUnknownTest',
  'interruptedAfterResponseTest', 'abortCancelsStartedStreamTest', 'abortBeforeListenerRemovesLateListenerTest'];
const witnesses = ['RefusedBeforeDispatchWitness', 'InterruptedReplyWitness', 'CompletedWitness', 'LateListenerWitness'];

const flush = async () => { for (let turn = 0; turn < 4; turn++) await new Promise(resolve => setImmediate(resolve)); };
const sse = value => Buffer.from(`data: ${JSON.stringify(value)}\n\n`).toString('base64');

/** The state the implementation shows for a model state: a terminal call has already finished. */
function project(state) {
  const finished = state.terminal && state.active;
  return {
    active: finished ? false : state.active,
    listener: finished && state.listener === 'attached' ? 'removed' : state.listener,
    started: state.started,
    terminal: state.terminal,
    outcome: state.outcome,
    failure: state.failure,
    chunks: state.chunks,
    cancelRequested: state.cancelRequested || (finished && state.started),
    readyRevoked: state.readyRevoked,
    settled: state.settled || finished,
  };
}

async function createDriver(streamNativeAgent) {
  let callback, streamId, resolveListener, attachHeld = false, attached = false, removed = false;
  let dispatch, dispatchSettled = false, text = 0, revoked = false;
  const cancels = [], result = {settled: false, outcome: 'none', failure: 'none'};
  const controller = new AbortController();
  const port = {
    addListener(name, listener) {
      callback = listener;
      return new Promise(resolve => { resolveListener = () => resolve({remove: async () => { removed = true; }}); });
    },
    requestStream(input) {
      streamId = input.streamId;
      return new Promise((resolve, reject) => { dispatch = {resolve, reject}; });
    },
    async cancelStream(input) { cancels.push(input.streamId); },
  };
  const call = streamNativeAgent(port, {path: '/api/conversations/room/messages/stream', ownerId: 'owner', headers: {}, body: '{}'},
    controller.signal, () => { text++; }, results => { if (results === undefined) revoked = true; });
  call.then(() => { result.settled = true; result.outcome = 'completed'; },
    error => { result.settled = true; result.outcome = 'failed'; result.failure = error?.beforeDispatch === true ? 'before-dispatch' : 'unknown'; });
  await flush();
  const releaseListener = () => { if (attachHeld) { attachHeld = false; resolveListener(); } };
  const emit = async event => { releaseListener(); callback({streamId, event}); await flush(); };
  let tokens = '';
  return {
    async listenerAttached() {
      attached = true;
      if (result.settled) { resolveListener(); await flush(); } else attachHeld = true;
    },
    async requestStream() { releaseListener(); await flush(); },
    async requestRejected() {
      if (dispatchSettled) return;
      dispatchSettled = true; dispatch.reject(Error('native refused the request')); await flush();
    },
    async responseEvent(status) {
      if (!dispatchSettled) { dispatchSettled = true; dispatch.resolve({streamId}); }
      await emit({type: 'response', status, headers: {'content-type': 'text/event-stream'}});
    },
    async chunkEvent(valid) {
      tokens += 'x';
      await emit(valid ? {type: 'chunk', dataBase64: sse({type: 'token', fullText: tokens})} : {type: 'chunk', dataBase64: 7});
    },
    async completeEvent(error) {
      if (error) return emit({type: 'complete', error: 'runtime stopped'});
      // The reader returns the reply from its terminal frame; the bridge then waits for completion.
      callback({streamId, event: {type: 'chunk', dataBase64: sse({type: 'done', fullText: tokens, agentName: 'Agent'})}});
      await emit({type: 'complete'});
    },
    async abort() {
      releaseListener();
      controller.abort(new DOMException('stopped', 'AbortError'));
      await flush();
    },
    async finish() { await flush(); },
    observe() {
      return {active: !result.settled, listener: removed ? 'removed' : attached ? 'attached' : 'pending',
        started: dispatch !== undefined, terminal: result.settled, outcome: result.outcome, failure: result.failure,
        chunks: text, cancelRequested: cancels.length > 0, readyRevoked: revoked, settled: result.settled};
    },
    async close() { releaseListener(); controller.abort(new DOMException('closed', 'AbortError')); await flush(); },
  };
}

/** Terminal states are observed as finished, so `terminal` is compared only through `settled`
 * until the model has reached a terminal state. */
async function runNativeStreamBridgeReplay({random = 60, steps = 30} = {}) {
  const {streamNativeAgent} = await loadBrowserModule('apps/app/src/runtime/local-agent-native-stream.ts');
  const traces = modelTraces({...model, scenarios, witnesses, random, steps});
  return replayTraces(traces, () => createDriver(streamNativeAgent), {project});
}

// NativeStreamBridge model traces (scenarios, witnesses and random walks from the pinned Quint
// CLI) replayed step by step against streamNativeAgent over a synthetic Capacitor port. No device
// or agent runtime.
test('the native stream bridge follows every NativeStreamBridge model trace', {timeout: 240000}, async () => {
  const receipt = await runNativeStreamBridgeReplay();
  assert.equal(receipt.traces, 70);
  assert.ok(receipt.checkpoints > 1500, `checkpoints ${receipt.checkpoints}`);
  for (const action of ['listenerAttached', 'requestStream', 'requestRejected', 'responseEvent', 'chunkEvent', 'completeEvent', 'abort', 'finish'])
    assert.ok(receipt.actions[action] > 0, `${action} was replayed`);
});
