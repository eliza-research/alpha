/** Replays SpeechRouteHold model traces against apps/app/src/runtime/voice-selection.ts: the whole
 * module is evaluated (imports removed) and `speechRoute`, `noteNetworkSpeechFailure` and
 * `clearNetworkSpeechHold` are called with an explicit clock.
 *
 * Controlled ports: the connection controller's snapshot (own keys, speech key and its revision,
 * the stored Cloud limit), the Cloud environment and credential, and the time passed to each call.
 *
 * Correspondence notes.
 *  - One model minute is 60 000 ms. A rate limit's wait is its `retryAfterSeconds`.
 *  - Each failure kind is one of several errors of that kind, taken in turn: `offline` is a
 *    connect, upload, bridge or fetch failure, `server` an HTTP 408 or 5xx, `account` an HTTP 401,
 *    402, 403 or 404, `refusedBody` an HTTP 400 or 422, `cancelled` an abort or an unconfirmed
 *    speech cleanup.
 *  - A fetch failure is a TypeError of the module's own realm.
 *  - The hold is private to the module. It is observed as the account or key for which
 *    `speechRoute` answers `device` with no Cloud limit stored; the model's `holdKey` is compared
 *    while its `holdUntil` is in the future, and `holdUntil` through the minute the hold lapses.
 *  - A stored limit is an allowance refusal with no stated reset, which stays in force.
 *
 * Not observed: `lastKind` and `failures` (the driver's own inputs). */
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from '../../../../test/support/strip-types.mjs';
import {modelTraces, replayTraces, repositoryRoot} from '../assistant-model-traces.mjs';

export const model = {path: 'specs/quint/application/SpeechRouteHold.qnt', module: 'SpeechRouteHold'};
export const scenarios = ['briefHoldLapsesTest', 'accountRefusalHoldsLongerTest', 'rateLimitHoldsForStatedWaitTest', 'otherAccountIsNotHeldTest',
  'ownFailureChangesNothingTest', 'signInFallsBackWithoutHoldTest', 'signedOutFailureRecordsNoHoldTest', 'clearedHoldReturnsToNetworkTest',
  'ownKeyIgnoresCloudLimitTest'];
export const witnesses = ['HoldLapsedWitness', 'OtherAccountNotHeldWitness', 'CappedWaitWitness', 'SignInFallsBackWithoutHoldWitness', 'OwnKeyHeldWitness',
  'ChangedKeyNotHeldWitness'];

const source = stripTypeScriptTypes(readFileSync(`${repositoryRoot}/apps/app/src/runtime/voice-selection.ts`, 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, ''), {mode: 'strip'});
const MINUTE = 60000, START = 1800000000000, KEYS = ['cloudA', 'cloudB', 'direct1', 'direct2'];
const coded = (code, data) => Object.assign(Error('Synthetic speech failure'), {code, ...(data ? {data} : {})});
const errors = {
  cancelled: [() => new DOMException('Speech cancelled', 'AbortError'), () => coded('speech-cleanup-unconfirmed')],
  noSpeech: [() => coded('no-speech')],
  refusedBody: [() => coded('voice-http-400'), () => coded('cloud-http-422')],
  offline: [() => coded('voice-stt-connect'), box => new box.FetchFailure('fetch failed'), () => coded('connection-lost'), () => coded('voice-stt-upload'), () => coded('startup-timeout')],
  server: [() => coded('voice-http-503'), () => coded('cloud-http-500'), () => coded('voice-http-408')],
  account: [() => coded('cloud-http-402'), () => coded('voice-http-401'), () => coded('voice-http-403'), () => coded('cloud-http-404')],
  signIn: [() => coded('sign-in')],
};

export function project(state) {
  const {holdKey, holdUntil, lastKind, failures, ...observed} = state;
  return {...observed, held: holdUntil > state.now ? holdKey : ''};
}

export function createDriver() {
  let account = 'none', limited = false, minutes = 0, fell = false, used = 0;
  const snapshot = () => ({
    ...(account.startsWith('direct') ? {residentInference: 'direct', providerStatus: {voiceConfigured: account !== 'directNoKey', revision: account === 'direct2' ? 2 : 1}} : {}),
    lastServiceLimit: limited ? {kind: 'allowance-exhausted', observedAt: START} : null,
  });
  const cloud = () => account === 'cloudA' || account === 'cloudB';
  const box = {testMocksEnabled: false, connectionController: {getSnapshot: snapshot, getCloudEnvironment: () => cloud() ? 'production' : null,
    getCloudClient: () => cloud() ? {credentialId: account} : null}};
  vm.runInNewContext(`{${source}\n${['speechRoute', 'noteNetworkSpeechFailure', 'clearNetworkSpeechHold'].map(name => `globalThis.${name}=${name};`).join('')}globalThis.FetchFailure=TypeError;}`, box);
  const now = () => START + minutes * MINUTE;
  // The key the module holds now: the one for which the phone is chosen with nothing else in the way.
  const heldKey = () => {
    const saved = [account, limited];
    try { limited = false; return KEYS.filter(key => { account = key; return box.speechRoute(now()) === 'device'; }).join('+'); }
    finally { [account, limited] = saved; }
  };
  return {
    accountChanges(next) { account = next; },
    limitChanges(next) { limited = next; },
    timePasses(passed) { minutes += passed; },
    failure(kind, wait) {
      const error = kind === 'rate' ? coded(used % 2 ? 'cloud-http-429' : 'voice-http-429', wait > 0 ? {retryAfterSeconds: wait * 60} : undefined) : errors[kind][used % errors[kind].length](box);
      used++; fell = box.noteNetworkSpeechFailure(error, now());
    },
    clearHold() { box.clearNetworkSpeechHold(); },
    observe() { return {account, limited, now: minutes, route: box.speechRoute(now()), fell, held: heldKey()}; },
  };
}

export async function runSpeechRouteHoldReplay({random = 80, steps = 40} = {}) {
  const traces = modelTraces({...model, scenarios, witnesses, random, steps});
  return replayTraces(traces, () => createDriver(), {project});
}
