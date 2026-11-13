/** Replays SpeechCleanupLatch model traces against the two recoverable owned-speech chains:
 * reviewed app speech (`speakAppText`) and Cloud app speech (`speakCloudText`), each with the real
 * retirement gate (`confirmSpeechRetirement`), evaluated from source.
 *
 * Controlled ports: the selected voice's `speak` (it settles when playback and its native cleanup
 * have, and rejects with the coded cleanup error when the cleanup was not confirmed) and the native
 * `stopPlayback` the gate calls for a closed chain. A restart is a fresh evaluation of the modules.
 *
 * Scope. The voice-surface and read-aloud chains, Transcribe entry and the recorder are not driven
 * here: their actions are skipped and their state is projected away. Playback that ended and
 * playback still audible are one busy state to the chain (`playing` and `retiring` are observed as
 * `busy`). `everLatched`, `stopConfirmed`, `starts` and `refusal` are not observed; each refusal's
 * wording is checked when it happens. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from '../../../../test/support/strip-types.mjs';
import {modelTraces, replayTraces, repositoryRoot} from '../assistant-model-traces.mjs';

export const model = {path: 'specs/quint/native/SpeechCleanupLatch.qnt', module: 'SpeechCleanupLatch'};
export const scenarios = ['replacementWaitsForCleanupTest', 'unconfirmedCleanupLatchesTest', 'confirmedStopReopensAppSpeechTest', 'refusedStopAsksForRestartTest',
  'latchedEntryNamesCleanupTest', 'busyRecorderMessageTest', 'waitingSuccessorRejectedTest', 'waitingAppSuccessorStopsOnceTest', 'restartOpensChainsTest'];
export const witnesses = ['LatchedVoiceWitness', 'RefusedSuccessorWitness', 'WaitingSuccessorWitness', 'LatchedEntryWitness', 'RecoveredChainWitness',
  'RestartNeededWitness', 'RestartedWitness'];
export const driven = ['app', 'cloud'];

const flush = async () => { for (let turn = 0; turn < 4; turn++) await new Promise(resolve => setImmediate(resolve)); };
const gate = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); promise.catch(() => {}); return {promise, resolve, reject, pending: true}; };
const read = path => readFileSync(`${repositoryRoot}/${path}`, 'utf8');
const strip = source => stripTypeScriptTypes(source.replace(/^import .*;\n/gm, '').replace(/^export /gm, ''), {mode: 'strip'});

export function compile() {
  const playback = read('apps/app/src/local-speech-playback.ts');
  const retirementGate = strip(playback.slice(playback.indexOf('export async function confirmSpeechRetirement')));
  const cloud = read('apps/app/src/runtime/cloud-voice.ts');
  const voiceStates = strip(read('apps/app/src/runtime/voice-states.ts'));
  const slice = (start, end) => { const a = cloud.indexOf(start), b = end ? cloud.indexOf(end, a) : cloud.length; if (a < 0 || b <= a) throw Error(`missing source anchor ${start}`); return cloud.slice(a, b); };
  return {
    app: `${voiceStates};${retirementGate};${strip(read('apps/app/src/runtime/app-speech.ts'))};globalThis.speak=speakAppText;`,
    cloud: `${retirementGate};${strip(slice('export function cloudVoiceServiceLimit(', '/** Product registration only'))};${strip(slice('let appSpeechRetirement:Promise<void>=Promise.resolve();'))};globalThis.speak=speakCloudText;`,
  };
}

export function project(state) {
  const stage = Object.fromEntries(driven.map(chain => [chain, ['playing', 'retiring'].includes(state.stage[chain]) ? 'busy' : state.stage[chain]]));
  return {stage, waiting: state.waiting.filter(chain => driven.includes(chain)), refused: state.refused.filter(chain => driven.includes(chain)), epoch: state.epoch};
}

function chain(code) {
  const calls = [], stops = [], speaks = [];
  const voice = {playbackReady: async () => true, speak() { const pending = gate(); speaks.push(pending); return pending.promise; }};
  const listeners = {addEventListener() {}, removeEventListener() {}};
  const box = {AbortController, DOMException, console,
    registerPlugin: () => ({stopPlayback() { const pending = gate(); stops.push(pending); return pending.promise; }}),
    window: listeners, document: {hidden: false, documentElement: {dataset: {}}, querySelectorAll: () => [], ...listeners},
    connectionController: {getSnapshot: () => ({residentInference: 'cloud', open: false}), getCloudEnvironment: () => 'production',
      getCloudClient: () => ({sessionId: 'cloud-session', credentialId: 'cloud-credential'}), openCloudAccount() {}, subscribe: () => () => {}},
    markTtsPlaybackStarted() {}, markTtsPlaybackEnded() {}, cloudRuntimeEnabled: false, testMocksEnabled: false,
    // The app chain is explicitly on-device; the Cloud chain is exercised separately below.
    speechRoute: () => 'device', noteNetworkSpeechFailure: () => {throw Error('Network fallback outside local-chain replay');},
    developmentCloudVoiceEnabled: false, browserCloudResidentEnabled: false, cloudServiceName: () => 'Eliza Cloud',
    cloudVoiceLimitOf: () => null, readServiceLimit: () => null, retryDuration: () => '',
    createOnDeviceVoice: () => voice, createCloudVoice: () => voice, speakCloudText: async () => { throw Error('app speech must stay on its own chain'); }};
  vm.runInNewContext(code, box);
  const pendingSpeak = () => speaks.find(item => item.pending), pendingStop = () => stops.find(item => item.pending);
  return {
    async speak() {
      const call = {outcome: 'pending', speaksBefore: speaks.length};
      calls.push(call);
      box.speak('Reviewed text', new AbortController().signal).then(() => { call.outcome = 'ok'; }, error => {
        call.outcome = error?.code === 'speech-cleanup-unconfirmed' ? 'cleanup' : 'error'; call.message = error?.message;
      });
      await flush();
    },
    async cleanupSettled(confirmed) {
      const pending = pendingSpeak(); pending.pending = false;
      if (confirmed) pending.resolve(); else pending.reject(Object.assign(Error('Owned speech cleanup could not be confirmed.'), {code: 'speech-cleanup-unconfirmed'}));
      await flush();
    },
    async recoveryStopSettled(confirmed) {
      const pending = pendingStop(); pending.pending = false;
      if (confirmed) pending.resolve(); else pending.reject(Error('native stop refused'));
      await flush();
      if (!confirmed) {
        const refused = calls.findLast(call => call.outcome === 'cleanup');
        assert.equal(refused?.message, 'Speech could not be stopped. Restart Alpha.');
        refused.recoveryRefused = true;
      }
    },
    observe() {
      const unsettled = calls.filter(call => call.outcome === 'pending'), last = calls.findLast(call => call.outcome !== 'pending');
      const stage = pendingStop() ? 'recovering' : pendingSpeak() ? 'busy' : last?.outcome === 'cleanup' ? 'latched' : 'idle';
      // A call that is neither speaking nor behind a native stop waits for the cleanup before it.
      const waiting = unsettled.length - (pendingSpeak() ? 1 : 0) - (pendingStop() ? 1 : 0) > 0;
      // The chain is closed and its most recent answer was the request for a restart.
      const refused = ['latched', 'recovering'].includes(stage) && last?.recoveryRefused === true;
      return {stage, waiting, refused};
    },
    async close() { for (const pending of [...speaks, ...stops]) if (pending.pending) { pending.pending = false; pending.reject(Error('closed')); } await flush(); },
  };
}

export function createDriver(code) {
  let epoch = 0, chains = Object.fromEntries(driven.map(name => [name, chain(code[name])]));
  const on = name => chains[name];
  return {
    async speak(name) { if (on(name)) await on(name).speak(); },
    finishPlayback() {},
    async cleanupSettled(name, confirmed) { if (on(name)) await on(name).cleanupSettled(confirmed); },
    async recoveryStopSettled(name, confirmed) { if (on(name)) await on(name).recoveryStopSettled(confirmed); },
    enterVoice() {}, closeRecorder() {},
    async restart() {
      for (const name of driven) await chains[name].close();
      epoch++; chains = Object.fromEntries(driven.map(name => [name, chain(code[name])]));
    },
    observe() {
      const seen = Object.fromEntries(driven.map(name => [name, chains[name].observe()]));
      return {stage: Object.fromEntries(driven.map(name => [name, seen[name].stage])), waiting: driven.filter(name => seen[name].waiting),
        refused: driven.filter(name => seen[name].refused), epoch};
    },
    async close() { for (const name of driven) await chains[name].close(); },
  };
}

export async function runSpeechCleanupLatchReplay({random = 80, steps = 40} = {}) {
  const code = compile(), traces = modelTraces({...model, scenarios, witnesses, random, steps});
  return replayTraces(traces, () => createDriver(code), {project});
}
