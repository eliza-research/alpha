import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';

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
    connectionController: {getCloudEnvironment: () => f.account ? 'production' : null, getCloudClient: () => f.account ? {sessionId: 'synthetic-session', credentialId: 'synthetic-credential'} : null},
  };
  const source = fs.readFileSync('apps/app/src/runtime/voice-selection.ts', 'utf8').replace(/^import .*;\n/gm, '').replaceAll('export function', 'function').replaceAll('export type', 'type');
  vm.runInNewContext('{' + stripTypeScriptTypes(source, {mode: 'strip'}) + '\nglobalThis.api={selectVoiceRoute,chooseVoiceRoute,voiceRoutePreference,speakRepliesEnabled,setSpeakReplies,cloudVoiceAvailable,voicePreferenceKeys,cloudSpeechDisclosure,voiceSendPolicy,setVoiceSendPolicyForTests};}', box);
  return {...box.api, events, f};
}

test('production keeps speech local regardless of account, legacy preferences or requested fallback', () => {
  for (const account of [true, false]) for (const dev of [true, false]) {
    const v=load(storage(), {account,dev});
    for(const requested of ['default','device','manual','agent']) assert.equal(v.selectVoiceRoute(requested),'device');
    assert.equal(v.chooseVoiceRoute('cloud'),false);
    assert.equal(v.chooseVoiceRoute('cloud',{disclosed:'cloud-speech-uses-plan'}),false);
    assert.equal(v.chooseVoiceRoute('device'),true);assert.equal(v.cloudVoiceAvailable(),false);assert.equal(v.voiceRoutePreference(),'device');
    assert.equal(v.selectVoiceRoute(),'device','legacy preference cannot silently override current production policy');
    assert.match(v.cloudSpeechDisclosure(),/counts toward your plan allowance/);
  }
});

test('legacy preference persistence detects dropped or unavailable storage', () => {
  for(const store of [{getItem:()=>null,setItem(){}},{getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}}]) {
    const v=load(store);assert.equal(v.chooseVoiceRoute('cloud',{disclosed:'cloud-speech-uses-plan'}),false);assert.equal(v.selectVoiceRoute(),'device');
  }

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

});

test('Speak replies is opt-in, persisted and off for anything but an explicit enable', () => {
  const store = storage(), v = load(store);
  assert.equal(v.speakRepliesEnabled(), false);
  assert.equal(v.setSpeakReplies(true), true);
  assert.equal(load(store).speakRepliesEnabled(), true);
  assert.equal(v.setSpeakReplies(false), true);
  assert.equal(load(store).speakRepliesEnabled(), false);
  store.bytes.set('alphaphone:speak-replies:v1', '{"version":1,"enabled":"yes"}');
  assert.equal(load(store).speakRepliesEnabled(), false);
});

test('explicit production Cloud profile never silently selects local speech or enables mocks', () => {
  for(const account of [true,false]) {
    const v=load(storage(),{cloud:true,account,dev:false});
    for(const route of ['default','device','agent','manual'])assert.equal(v.selectVoiceRoute(route),'cloud');
    assert.equal(v.cloudVoiceAvailable(),account);assert.equal(v.voiceRoutePreference(),'cloud');
    assert.equal(v.setVoiceSendPolicyForTests('review'),false);
  }
});
