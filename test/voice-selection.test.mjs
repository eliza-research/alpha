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
    cloudRuntimeEnabled: f.cloud === true, testMocksEnabled: f.mocks === true, localStorage: store, Date, JSON, Number, Event: class { constructor(type) { this.type = type; } },
    window: {dispatchEvent: event => { events.push(event.type); return true; }},
    get browserDevProfile() { return f.dev; },
    connectionController: {getSnapshot:()=>({residentInference:(f.own||f.direct)?'direct':'cloud',providerStatus:{voiceConfigured:f.voice===true}}),getCloudEnvironment: () => f.account ? 'production' : null, getCloudClient: () => f.account ? {sessionId: 'synthetic-session', credentialId: 'synthetic-credential'} : null},
  };
  const source = fs.readFileSync('apps/app/src/runtime/voice-selection.ts', 'utf8').replace(/^import .*;\n/gm, '').replaceAll('export function', 'function').replaceAll('export type', 'type');
  vm.runInNewContext('{' + stripTypeScriptTypes(source, {mode: 'strip'}) + '\nglobalThis.api={selectVoiceRoute,chooseVoiceRoute,voiceRoutePreference,cloudVoiceAvailable,voicePreferenceKeys,cloudSpeechDisclosure,voiceSendPolicy,setVoiceSendPolicyForTests};}', box);
  return {...box.api, events, f};
}

test('production keeps speech local regardless of account or requested fallback', () => {
  for (const account of [true, false]) for (const dev of [true, false]) {
    const v=load(storage(), {account,dev});
    for(const requested of ['default','device','manual','agent']) assert.equal(v.selectVoiceRoute(requested),'device');
    assert.equal(v.selectVoiceRoute(),'device');
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
  store.bytes.set('alphaphone:voice-route:v1', JSON.stringify({version: 1, route: 'cloud', disclosed: 'cloud-speech-uses-plan', chosenAt: 1}));
  assert.doesNotMatch(fs.readFileSync('apps/app/src/runtime/voice-selection.ts', 'utf8'), /speak-replies|speakReplies/);
  store.bytes.set('alphaphone:speak-replies:v1', '{"version":1,"enabled":true}');
  const reloaded = load(store);
  assert.equal(reloaded.selectVoiceRoute(), 'device');
  assert.deepEqual(reloaded.events, []);
});

test('explicit production Cloud profile never silently selects local speech or enables mocks', () => {
  for(const account of [true,false]) {
    const v=load(storage(),{cloud:true,account,dev:false});
    for(const route of ['default','device','agent','manual'])assert.equal(v.selectVoiceRoute(route),'cloud');
    assert.equal(v.setVoiceSendPolicyForTests('review'),false);
  }
});

test('own keys with a Cartesia key choose the resident network voice route without a Cloud account',()=>{
 const v=load(storage(),{direct:true,voice:true,account:false});
 assert.equal(v.selectVoiceRoute('default'),'cloud');assert.equal(v.selectVoiceRoute('agent'),'cloud');assert.equal(v.selectVoiceRoute('device'),'device');
});

test('own keys without a Cartesia key keep voice on this phone',()=>{
 for(const account of [true,false]){
  const v=load(storage(),{direct:true,voice:false,account});
  for(const requested of ['default','agent','device'])assert.equal(v.selectVoiceRoute(requested),'device');
 }
 const cloud=load(storage(),{direct:true,voice:false,account:true,cloud:true});
 assert.equal(cloud.selectVoiceRoute('default'),'cloud','a Cloud-runtime build has no on-device route to fall back to');
});
