import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from './support/strip-types.mjs';

// Real voice-selection source with a synthetic Cloud session and an in-memory Storage.
// "Restart" evaluates the source again in a fresh context over the same stored bytes.
function storage(bytes = new Map()) {
  return {bytes, getItem: key => bytes.has(key) ? bytes.get(key) : null, setItem: (key, value) => { bytes.set(key, String(value)); }, removeItem: key => { bytes.delete(key); }};
}
function load(store, f = {account: true, dev: false}) {
  if (typeof f === 'boolean') f = {account: true, dev: false, mocks: f};
  const events = [];
  const box = {
    testMocksEnabled: f.mocks === true, localStorage: store, Date, JSON, Number, Math, Error, TypeError, Event: class { constructor(type) { this.type = type; } },
    window: {dispatchEvent: event => { events.push(event.type); return true; }},
    connectionController: {getSnapshot:()=>({residentInference:(f.own||f.direct)?'direct':'cloud',providerStatus:{voiceConfigured:f.voice===true,revision:f.revision??'r1'},lastServiceLimit:f.limit??null}),getCloudEnvironment: () => f.account ? 'production' : null, getCloudClient: () => f.account ? {sessionId: 'synthetic-session', credentialId: f.credential === undefined ? 'synthetic-credential' : f.credential} : null},
  };
  const source = fs.readFileSync('apps/app/src/runtime/voice-selection.ts', 'utf8').replace(/^import .*;\n/gm, '').replaceAll('export function', 'function').replaceAll('export type', 'type');
  vm.runInNewContext('{' + stripTypeScriptTypes(source, {mode: 'strip'}) + '\nglobalThis.api={selectVoiceRoute,speechRoute,cloudSpeechLimited,networkSpeechFailureHoldMs,noteNetworkSpeechFailure,clearNetworkSpeechHold,voicePreferenceKeys,voiceSendPolicy,setVoiceSendPolicyForTests};}', box);
  return {...box.api, events, f};
}
const NOW = 1_800_000_000_000;

test('one build: the speech route is chosen at run time from the account and the Cartesia key', () => {
  // Signed in to Cloud with a usable credential: Cloud speech.
  assert.equal(load(storage(), {account: true}).speechRoute(NOW), 'cloud');
  // Signed out, or a session without a credential: this phone.
  assert.equal(load(storage(), {account: false}).speechRoute(NOW), 'device');
  assert.equal(load(storage(), {account: true, credential: ''}).speechRoute(NOW), 'device');
  // Own provider with a Cartesia key: direct, with or without a Cloud account.
  for (const account of [true, false]) assert.equal(load(storage(), {direct: true, voice: true, account}).speechRoute(NOW), 'direct');
  // Own provider without a Cartesia key stays on this phone even when a Cloud account is signed in.
  for (const account of [true, false]) assert.equal(load(storage(), {direct: true, voice: false, account}).speechRoute(NOW), 'device');
  const source = fs.readFileSync('apps/app/src/runtime/voice-selection.ts', 'utf8');
  assert.doesNotMatch(source, /cloudRuntimeEnabled|RUNTIME_PROFILE/, 'no build-time profile decides the route');
  assert.doesNotMatch(source, /voiceRoutePreference|chooseVoiceRoute|cloudVoiceAvailable|cloudSpeechDisclosure/, 'the test-only route helpers are gone');
  assert.doesNotMatch(fs.readFileSync('apps/app/src/build-flags.ts', 'utf8'), /cloudRuntimeEnabled|RUNTIME_PROFILE/);
});

test('a stored plan or rate limit in force keeps speech on this phone until it lapses', () => {
  const route = limit => load(storage(), {account: true, limit}).speechRoute(NOW);
  // A rate limit holds for its stated wait, then Cloud is back.
  assert.equal(route({kind: 'rate-limited', retryAfterMs: 3_000, resetsAt: null, observedAt: NOW - 1_000}), 'device');
  assert.equal(route({kind: 'rate-limited', retryAfterMs: 3_000, resetsAt: null, observedAt: NOW - 3_000}), 'cloud');
  // With no stated wait it lapses after a minute.
  assert.equal(route({kind: 'rate-limited', retryAfterMs: null, resetsAt: null, observedAt: NOW - 59_000}), 'device');
  assert.equal(route({kind: 'rate-limited', retryAfterMs: null, resetsAt: null, observedAt: NOW - 61_000}), 'cloud');
  // An exhausted allowance holds until its reset.
  assert.equal(route({kind: 'allowance-exhausted', retryAfterMs: null, resetsAt: NOW + 86_400_000, observedAt: NOW - 3_600_000}), 'device');
  assert.equal(route({kind: 'allowance-exhausted', retryAfterMs: null, resetsAt: NOW - 1, observedAt: NOW - 3_600_000}), 'cloud');
  // A plan or billing refusal with no time stands until the account's record is cleared.
  for (const kind of ['subscription-required', 'billing-refused']) assert.equal(route({kind, retryAfterMs: null, resetsAt: null, observedAt: NOW - 86_400_000}), 'device');
  assert.equal(route(null), 'cloud');
  // A limit never moves own-key speech: it is the Cloud plan's.
  assert.equal(load(storage(), {direct: true, voice: true, account: true, limit: {kind: 'billing-refused', retryAfterMs: null, resetsAt: null, observedAt: NOW}}).speechRoute(NOW), 'direct');
});

test('a network speech failure before audio falls back to this phone and holds that account or key off the network', () => {
  const code = (value, data) => Object.assign(Error('PRIVATE_PROVIDER_BODY'), {code: value}, data ? {data} : {});
  const v = load(storage(), {account: true});
  // Offline, sign-in, billing, plan, missing route, rate limit and 5xx fall back; the hold is bounded.
  for (const status of [401, 402, 403, 404]) assert.equal(v.networkSpeechFailureHoldMs(code('voice-http-' + status)), 600_000, String(status));
  for (const status of [408, 500, 502, 503]) assert.equal(v.networkSpeechFailureHoldMs(code('voice-http-' + status)), 60_000, String(status));
  assert.equal(v.networkSpeechFailureHoldMs(code('cloud-http-404')), 600_000, 'no streaming route');
  assert.equal(v.networkSpeechFailureHoldMs(code('voice-http-429', {retryAfterSeconds: 3})), 3_000);
  assert.equal(v.networkSpeechFailureHoldMs(code('voice-http-429')), 60_000);
  assert.equal(v.networkSpeechFailureHoldMs(code('voice-http-429', {retryAfterSeconds: 999_999})), 3_600_000, 'a long wait is capped');
  for (const value of ['voice-stt-connect', 'voice-tts-connect', 'voice-stt-upload', 'connect', 'connection-lost', 'startup-timeout', 'unavailable']) assert.equal(v.networkSpeechFailureHoldMs(code(value)), 60_000, value);
  assert.equal(v.networkSpeechFailureHoldMs(code('sign-in')), 0);
  assert.equal(v.networkSpeechFailureHoldMs(new TypeError('Failed to fetch')), 60_000, 'offline');
  // Not the network route's failure: no fallback, no hold.
  for (const failure of [code('voice-http-400'), code('voice-http-422'), code('no-speech'), code('speech-cleanup-unconfirmed'), code('permission-denied'), code('protocol'), code('capture'), code('voice-http-503-extra'), Object.assign(Error('stopped'), {name: 'AbortError', code: 'voice-http-503'}), Error('anything'), null, undefined, 'voice-http-503'])
    assert.equal(v.networkSpeechFailureHoldMs(failure), null, String(failure?.code ?? failure));
  assert.equal(v.noteNetworkSpeechFailure(code('no-speech'), NOW), false);
  assert.equal(v.speechRoute(NOW), 'cloud');
  // A 503 holds this account for a minute, then Cloud is tried again.
  assert.equal(v.noteNetworkSpeechFailure(code('voice-http-503'), NOW), true);
  assert.equal(v.speechRoute(NOW + 59_000), 'device');
  assert.equal(v.selectVoiceRoute('default'), 'device', 'the recorder follows the same route');
  assert.equal(v.speechRoute(NOW + 60_000), 'cloud');
  // The hold belongs to the account that was refused: another account is not held.
  assert.equal(v.noteNetworkSpeechFailure(code('voice-http-402'), NOW), true);
  assert.equal(v.speechRoute(NOW + 1), 'device');
  v.f.credential = 'another-credential';
  assert.equal(v.speechRoute(NOW + 1), 'cloud');
  v.f.credential = 'synthetic-credential';
  assert.equal(v.speechRoute(NOW + 1), 'device');
  // On-device speech turned out to be unavailable: the network is all there is.
  v.clearNetworkSpeechHold();
  assert.equal(v.speechRoute(NOW + 1), 'cloud');
  // Own keys: a Cartesia refusal holds that key revision, not the next one.
  const own = load(storage(), {direct: true, voice: true, account: false});
  assert.equal(own.noteNetworkSpeechFailure(code('voice-http-401'), NOW), true);
  assert.equal(own.speechRoute(NOW + 1), 'device');
  own.f.revision = 'r2';
  assert.equal(own.speechRoute(NOW + 1), 'direct');
  // Signed out there is nothing to hold; the failure still falls back.
  const out = load(storage(), {account: false});
  assert.equal(out.noteNetworkSpeechFailure(code('voice-http-503'), NOW), true);
  assert.equal(out.speechRoute(NOW), 'device');
});

test('the recorder route follows speechRoute in production; test-mocks builds keep explicit device and manual routes', () => {
  // Production: no stored or requested preference changes the route.
  for (const requested of ['default', 'device', 'manual', 'agent']) {
    assert.equal(load(storage(), {account: true}).selectVoiceRoute(requested), 'cloud', requested);
    assert.equal(load(storage(), {account: false}).selectVoiceRoute(requested), 'device', requested);
  }
  assert.equal(load(storage(), {account: false}).selectVoiceRoute(), 'device');
  // Test-mocks builds default to network speech and honour the explicit routes.
  for (const account of [true, false]) {
    const mocks = load(storage(), {account, mocks: true});
    assert.equal(mocks.selectVoiceRoute('default'), 'cloud'); assert.equal(mocks.selectVoiceRoute('agent'), 'cloud');
    assert.equal(mocks.selectVoiceRoute('device'), 'device'); assert.equal(mocks.selectVoiceRoute('manual'), 'manual');
  }
});

test('the voice send policy defaults to auto-send and only test-mocks builds can exercise review', () => {
  const production = load(storage());
  assert.equal(production.voiceSendPolicy(), 'auto-send');
  assert.equal(production.setVoiceSendPolicyForTests('review'), false);
  assert.equal(production.voiceSendPolicy(), 'auto-send');
  const mocks = load(storage(), true);
  assert.equal(mocks.voiceSendPolicy(), 'auto-send');
  assert.equal(mocks.setVoiceSendPolicyForTests('review'), true);
  assert.equal(mocks.voiceSendPolicy(), 'review');
  assert.equal(mocks.setVoiceSendPolicyForTests('anything'), true);
  assert.equal(mocks.voiceSendPolicy(), 'auto-send', 'an unknown policy falls back to the constant');
});

test('spoken replies and the route have no stored preference: old values are not read', () => {
  const store = storage();
  store.bytes.set('alphaphone:voice-route:v1', JSON.stringify({version: 1, route: 'device', disclosed: 'cloud-speech-uses-plan', chosenAt: 1}));
  const source = fs.readFileSync('apps/app/src/runtime/voice-selection.ts', 'utf8');
  assert.doesNotMatch(source, /speak-replies|speakReplies/);
  assert.doesNotMatch(source, /localStorage|getItem|setItem/, 'the route is never read from or written to storage');
  store.bytes.set('alphaphone:speak-replies:v1', '{"version":1,"enabled":true}');
  const reloaded = load(store);
  assert.equal(reloaded.selectVoiceRoute(), 'cloud', 'a stored device choice does not override the signed-in route');
  assert.equal(load(store, {account: false}).selectVoiceRoute(), 'device');
  assert.deepEqual(reloaded.events, []);
});

test('own keys with a Cartesia key choose the resident network voice route without a Cloud account',()=>{
 const v=load(storage(),{direct:true,voice:true,account:false});
 assert.equal(v.selectVoiceRoute('default'),'cloud');assert.equal(v.selectVoiceRoute('agent'),'cloud');assert.equal(v.selectVoiceRoute('device'),'device','own-key dictation asks for the phone and keeps it');
});

test('own keys without a Cartesia key keep voice on this phone',()=>{
 for(const account of [true,false]){
  const v=load(storage(),{direct:true,voice:false,account});
  for(const requested of ['default','agent','device'])assert.equal(v.selectVoiceRoute(requested),'device');
  assert.equal(v.speechRoute(),'device');
 }
});
