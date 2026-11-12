import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from './fixtures/ts-source.mjs';
import {modelTraces, replayTraces, repositoryRoot} from '../specs/quint/refinement/assistant-model-traces.mjs';

/** Replays RendererSpeechChunk model traces against `playOwnedSpeech` (and through it `speakChunk`).
 *
 * Controlled ports: the native voice plugin (listener registration, cancel, play, stop), the
 * caller's preparation, the abort signal and the timers of the renderer context. Product code:
 * apps/app/src/local-speech-playback.ts, evaluated from source.
 *
 * Correspondence of grouped transitions. A terminal event that arrives while the chunk is playing
 * or waiting for the speaker retires it in the same task; such a model state is observed as the
 * state after `observeFinished`, which is then an implementation stutter.
 *
 * Not observed: `finishedSignal`, `pendingOutcome` (internal latches, visible through `result`),
 * `cleanupFailed`, `strict` and `queue` (inputs of the replay). */

const model = {path: 'specs/quint/native/RendererSpeechChunk.qnt', module: 'RendererSpeechChunk'};
const scenarios = ['playsToEndTest', 'busySpeakerRetryTest', 'abortDuringPrepareStopsLatePlaybackTest', 'strictCleanupFailureTest',
  'boundedCleanupKeepsOutcomeTest', 'finishedWhileWaitingForSpeakerTest', 'unqueuedBusyFailsTest'];
const witnesses = ['StrictFailureWitness', 'LatePlaybackWitness', 'BusyRetryWitness', 'InterruptedWitness', 'BoundedCleanupWitness'];

const flush = async () => { for (let turn = 0; turn < 4; turn++) await new Promise(resolve => setImmediate(resolve)); };
const gate = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); promise.catch(() => {}); return {promise, resolve, reject, settled: false}; };

function project(state) {
  const retiring = state.active && state.finishedSignal !== 'none' && ['started', 'play-wait'].includes(state.phase);
  return {
    phase: retiring ? 'disposing' : state.phase,
    active: retiring ? false : state.active,
    listeners: retiring ? 0 : state.listeners,
    retries: state.retries,
    preparePending: state.preparePending,
    playback: state.playback,
    nativePlayback: state.nativePlayback,
    cancelRequested: state.cancelRequested || retiring,
    stopRequested: state.stopRequested || retiring,
    result: state.result,
    startedCalls: state.startedCalls,
  };
}

function compile() {
  const source = readFileSync(`${repositoryRoot}/apps/app/src/local-speech-playback.ts`, 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  return `{${stripTypeScriptTypes(source, {mode: 'strip'})};Object.assign(globalThis,{playOwnedSpeech});}`;
}

function createDriver(code) {
  const timers = [], callbacks = new Map(), registrations = [], cleanups = [];
  let prepare, play, prepares = 0, plays = 0, starts = 0, cancels = 0, stops = 0, native = false, lastBusy = '';
  let begun = false, attached = 0, removed = 0, playbackId;
  const result = {settled: false, value: 'none'};
  const interrupted = new DOMException('interrupted by the replay', 'AbortError'), controller = new AbortController();
  const voice = {
    addListener(event, callback) {
      callbacks.set(event, callback);
      const pending = gate(); registrations.push(pending);
      return pending.promise;
    },
    cancel() { cancels++; const pending = gate(); cleanups.push(pending); return pending.promise; },
    stopPlayback() { stops++; const pending = gate(); cleanups.push(pending); return pending.promise; },
    play() { plays++; play = gate(); return play.promise; },
  };
  const box = {AbortController, DOMException, crypto, console,
    setTimeout(run, delay) { const timer = {run, delay, done: false}; timers.push(timer); return timer; },
    clearTimeout(timer) { if (timer) timer.done = true; },
    Capacitor: {isNativePlatform: () => false}, registerPlugin: () => voice, planLocalSpeech: text => [text], nativeVoiceTurnId: () => undefined};
  vm.runInNewContext(code, box);
  const settle = (pending, error, value) => { pending.settled = true; if (error) pending.reject(error); else pending.resolve(value); };
  return {
    async begin(strict, queue) {
      begun = true;
      box.playOwnedSpeech(voice, controller.signal, () => { prepares++; prepare = gate(); return prepare.promise; }, () => {}, () => { starts++; }, strict, queue)
        .then(() => { result.value = 'ended'; }, error => {
          result.value = error === interrupted ? 'interrupted' : error?.code === 'speech-cleanup-unconfirmed' ? 'cleanup-unconfirmed'
            : error?.message === 'Speech playback failed.' ? 'failed' : 'error';
        }).finally(() => { result.settled = true; });
      await flush();
    },
    async listenerRegistered() {
      const pending = registrations.find(item => !item.settled);
      settle(pending, null, {remove: async () => { removed++; }}); attached++;
      await flush();
    },
    async abort() { controller.abort(interrupted); await flush(); },
    async prepareResult(kind) {
      if (kind === 'ok') { native = true; playbackId = `playback-${prepares}`; settle(prepare, null, {playbackId}); }
      else { lastBusy = 'prepare'; settle(prepare, Object.assign(Error('prepare refused'), kind === 'busy' ? {code: 'playback-busy'} : {})); }
      await flush();
    },
    async latePrepare(ok) {
      if (ok) { native = true; settle(prepare, null, {playbackId: `playback-${prepares}`}); } else settle(prepare, Error('prepare failed late'));
      await flush();
    },
    async waitElapsed() {
      for (const timer of timers.filter(item => item.delay === 100 && !item.done)) { timer.done = true; timer.run(); }
      await flush();
    },
    async playResult(kind) {
      if (kind === 'ok') settle(play, null, undefined);
      else { lastBusy = 'play'; settle(play, Object.assign(Error('play refused'), kind === 'busy' ? {code: 'playback-busy'} : {})); }
      await flush();
    },
    async terminalEvent(kind) {
      callbacks.get(kind === 'ended' ? 'playbackEnded' : 'playbackFailed')({playbackId});
      await flush();
    },
    async observeFinished() { await flush(); },
    async disposeSettled(confirmed) {
      for (const pending of cleanups.filter(item => !item.settled)) settle(pending, confirmed ? null : Error('native refused'), undefined);
      await flush();
    },
    observe() {
      const preparePending = !!prepare && !prepare.settled, playPending = !!play && !play.settled;
      const phase = !begun ? 'new' : result.settled ? 'settled' : cancels > 0 ? 'disposing' : starts > 0 ? 'started' : playPending ? 'play'
        : preparePending ? 'preparing' : attached < 3 ? 'listeners' : lastBusy === 'prepare' ? 'prepare-wait' : 'play-wait';
      return {phase, active: begun && cancels === 0, listeners: attached - removed,
        retries: timers.filter(timer => timer.delay === 100).length, preparePending, playback: plays > 0, nativePlayback: native,
        cancelRequested: cancels > 0, stopRequested: stops > 0, result: result.value, startedCalls: starts};
    },
    async close() {
      controller.abort(interrupted);
      for (const pending of [...cleanups, ...(prepare ? [prepare] : []), ...(play ? [play] : [])].filter(item => !item.settled)) settle(pending, Error('closed'));
      await flush();
    },
  };
}

async function runRendererSpeechChunkReplay({random = 80, steps = 40} = {}) {
  const code = compile(), traces = modelTraces({...model, scenarios, witnesses, random, steps});
  return replayTraces(traces, () => createDriver(code), {project});
}

// RendererSpeechChunk model traces (scenarios, witnesses and random walks from the pinned Quint
// CLI) replayed step by step against playOwnedSpeech over a synthetic voice plugin. No audio.
test('owned renderer speech follows every RendererSpeechChunk model trace', {timeout: 240000}, async () => {
  const receipt = await runRendererSpeechChunkReplay();
  assert.equal(receipt.traces, 92);
  assert.ok(receipt.checkpoints > 2000, `checkpoints ${receipt.checkpoints}`);
  for (const action of ['begin', 'listenerRegistered', 'abort', 'prepareResult', 'latePrepare', 'waitElapsed', 'playResult', 'terminalEvent',
    'observeFinished', 'disposeSettled']) assert.ok(receipt.actions[action] > 0, `${action} was replayed`);
});
