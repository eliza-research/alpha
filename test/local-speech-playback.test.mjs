import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import {cloudVoiceViewFixture} from './fixtures/cloud-voice-view.mjs';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const note = `Weekly plan. ${'Call the school about the trip and pack the lunches for the week ahead. '.repeat(170)}`.trim();

test('a 12000-character note is read with Cloud in provider-sized pieces, one request at a time', async () => {
  assert.ok(note.length > 12000 && note.length <= 16000);
  const f = cloudVoiceViewFixture({cloudProfile: true});
  try {
    const result = await f.box.readNoteAloud(note, {noteId: 'long'});
    assert.equal(result.outcome, 'finished');
    const texts = f.speechInputs.map(input => input.text);
    assert.ok(texts.length > 2, 'a long note is not refused or sent as one request');
    assert.ok(texts.every(text => text.length <= 5000));
    assert.equal(texts.join(' '), note.replace(/\s+/g, ' '));
    assert.equal(f.localFactories, 0);
  } finally { f.close(); await f.tick(); }
});

test('a Cloud failure before audio is read on this phone; without on-device speech it names its cause; one after audio says reading stopped', async () => {
  const f = cloudVoiceViewFixture({cloudProfile: true});
  try {
    f.error = Object.assign(Error('PRIVATE_HTTP_SENTINEL'), {code: 'voice-http-401'});
    // Local models always ship: the refused Cloud request is not the end of the reading.
    const local = [];
    f.box.speakLocalText = async (text, _signal, started) => { local.push(text); started?.(); };
    const fallback = await f.box.readNoteAloud('Groceries. Milk and eggs.', {noteId: 'a'});
    assert.deepEqual({...fallback}, {outcome: 'finished', message: ''});
    assert.deepEqual(local, ['Groceries. Milk and eggs.'], 'the note is read by the on-device engine');
    assert.equal(f.box.speechRoute(), 'device', 'the next reading skips the refused account');
    // The same account is held for a while; a later reading goes straight to this phone.
    const uploads = f.cloudSpeech;
    assert.equal((await f.box.readNoteAloud('Second note.', {noteId: 'a2'})).outcome, 'finished');
    assert.equal(f.cloudSpeech, uploads, 'no Cloud request while the account is held');
    // Only when on-device speech is unavailable too does the Cloud cause reach the user.
    f.credential = 'second-credential';
    assert.equal(f.box.speechRoute(), 'cloud', 'a different account is not held');
    f.box.createOnDeviceVoice = () => null;
    const refused = await f.box.readNoteAloud('Groceries. Milk and eggs.', {noteId: 'a'});
    assert.deepEqual({...refused}, {outcome: 'failed', message: 'Couldn’t start reading · Eliza Cloud sign-in expired. Sign in again in Settings, then retry voice.'});
    f.error = null; f.credential = 'third-credential';
    const synthesize = f.driver.synthesize;
    let calls = 0;
    f.driver.synthesize = async input => { if (++calls > 1) f.error = Object.assign(Error('PRIVATE_HTTP_SENTINEL'), {code: 'voice-http-402'}); return synthesize(input); };
    const partial = await f.box.readNoteAloud(note, {noteId: 'b'});
    assert.equal(partial.outcome, 'failed');
    assert.match(partial.message, /^Stopped · Eliza Cloud declined voice for billing\./);
    assert.doesNotMatch(refused.message + partial.message, /PRIVATE_HTTP_SENTINEL/);
  } finally { f.close(); await f.tick(); }
});

test('a Notes read with unconfirmed Cloud cleanup gives restart guidance', async () => {
  const f = cloudVoiceViewFixture({cloudProfile: true});
  try {
    f.playbackCleanupError = Error('private native cleanup detail');
    const result = await f.box.readNoteAloud('Read the saved note.', {noteId: 'note'});
    assert.deepEqual({...result}, {outcome: 'failed', message: 'Speech could not be stopped. Restart Alpha.'});
    assert.equal(f.localFactories, 0, 'an unconfirmed stop does not prepare fallback speech');
    const again = await f.box.readNoteAloud('Read another saved note.', {noteId: 'other-note'});
    assert.deepEqual({...again}, {...result});
    assert.equal(f.cloudSpeech, 1, 'a second note cannot start speech while cleanup is unconfirmed');
  } finally { f.close(); await f.tick(); }
});

// Message Listen: real playback, route, refusal and chunker sources; the voices are fixtures.
function listenFixture({cloud}) {
  const f = {spoken: [], prepared: 0};
  const box = {
    developmentCartesiaVoiceEnabled: false, developmentCloudVoiceEnabled: false, testMocksEnabled: false, browserDevProfile: false,
    JSON, AbortController, DOMException, setTimeout, clearTimeout, Event: class { constructor(type) { this.type = type; } },
    Capacitor: {isNativePlatform: () => true},
    // The run-time speech route: Cloud for a signed-in account, this phone when signed out.
    connectionController: {getCloudEnvironment: () => cloud ? 'production' : null, getCloudClient: () => cloud ? {sessionId: 'cloud-session', credentialId: 'cloud-credential'} : null, getSnapshot: () => ({open: false, session: {sessionId: 'agent'}, history: {conversationId: 'c'}}), subscribe: () => () => {}, openCloudAccount() { throw Error('No sign-in expected'); }},
    window: {dispatchEvent: () => true, getSelection: () => ({isCollapsed: true})},
    document: {hidden: false, documentElement: {dataset: {}}, querySelector: () => null, addEventListener() {}, removeEventListener() {}},
    createCloudVoice: () => ({speak: async text => { f.spoken.push(text); }}),
    createOnDeviceVoice: () => ({playbackReady: async () => { f.prepared++; return true; }}),
    cloudVoiceFailure: () => null,
    planLocalSpeech: text => [text],
    speakLocalText: async (text, _signal, started) => { f.spoken.push(text); started?.(); if (f.cleanupError) throw f.cleanupError; },
    markVoiceTiming() {}, abandonVoiceTurn() {}, finishVoiceTurn() {},
  };
  // One realm for every source: Bun's runInNewContext gives an already contextified object a new
  // realm per call, so an Error from one file would not be an Error in the next.
  vm.createContext(box);
  const load = (file, names) => {
    const source = fs.readFileSync(file, 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
    vm.runInContext('{' + stripTypeScriptTypes(source, {mode:'strip'}) + '\n' + names.map(name => `globalThis.${name}=${name};`).join('') + '}', box);
  };
  load('apps/app/src/runtime/voice-states.ts', ['speechCleanupNotice']);
  load('apps/app/src/runtime/voice-selection.ts', ['selectVoiceRoute', 'speechRoute', 'noteNetworkSpeechFailure']);
  load('apps/app/src/runtime/local-speech-text.ts', ['screenSpeechText']);
  load('.eliza/client-features/packages/voice/src/cloud-speech-chunks.ts', ['speakCloudSpeechChunks']);
  load('apps/app/src/prototype/local-speech-playback.ts', ['installLocalSpeechPlayback']);
  class Shell {
    constructor() { this.state = {chat: 'sheet', msgs: []}; this.live = true; }
    S() { return this.state; }
    setState(patch) { Object.assign(this.state, patch); this.componentDidUpdate(); }
    renderVals() { return {ic: {}, msgs: this.state.msgs.map(m => ({id: m.id, text: m.text}))}; }
    componentDidUpdate() {}
  }
  box.installLocalSpeechPlayback(Shell);
  f.shell = new Shell();
  return f;
}

test('Listen refuses a message with a link on both routes, before audio and without a contradictory tail', async () => {
  for (const cloud of [false, true]) {
    const f = listenFixture({cloud});
    f.shell.setState({msgs: [{id: 'a1', from: 'agent', text: 'Your receipt is at https://example.test/r today.'}]});
    f.shell.renderVals().msgs[0].localSpeech();
    for (let i = 0; i < 5; i++) await tick();
    assert.deepEqual(f.spoken, [], cloud ? 'Cloud' : 'device');
    assert.equal(f.prepared, 0, 'nothing is prepared for refused text');
    assert.equal(f.shell.renderVals().msgs[0].localSpeechMessage, 'This message has a link or email address, so it can\'t be read aloud.');
  }
});

test('Listen on Cloud reads a long reply through the chunker', async () => {
  const f = listenFixture({cloud: true});
  f.shell.setState({msgs: [{id: 'a1', from: 'agent', text: note}]});
  f.shell.renderVals().msgs[0].localSpeech();
  for (let i = 0; i < 20; i++) await tick();
  assert.ok(f.spoken.length > 2 && f.spoken.every(text => text.length <= 5000));
  assert.equal(f.spoken.join(' '), note.replace(/\s+/g, ' '));
  assert.equal(f.shell.renderVals().msgs[0].localSpeechMessage, '', 'finished reading shows no error');
});


test('Listen reports unconfirmed cleanup after audio and fences the next read', async () => {
  const f = listenFixture({cloud: false});
  f.cleanupError = Object.assign(Error('private native cleanup detail'), {code: 'speech-cleanup-unconfirmed'});
  f.shell.setState({msgs: [{id: 'a1', from: 'agent', text: 'Read this response.'}]});
  for (let attempt = 0; attempt < 2; attempt++) {
    f.shell.renderVals().msgs[0].localSpeech();
    for (let turn = 0; turn < 5; turn++) await tick();
    assert.equal(f.shell.renderVals().msgs[0].localSpeechMessage, 'Speech could not be stopped. Restart Alpha.');
  }
  assert.deepEqual(f.spoken, ['Read this response.']);
});
