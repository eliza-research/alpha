import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';

// Real playback, selection and timing sources; the speech engine boundary is a fixture.
function load(file, name, box) {
  const source = fs.readFileSync('apps/app/src/' + file, 'utf8').replace(/^import .*;\n/gm, '').replaceAll('export function', 'function').replaceAll('export const', 'const').replaceAll('export type', 'type');
  vm.runInNewContext('{' + stripTypeScriptTypes(source, {mode: 'transform'}) + '\nglobalThis.' + name + '=' + name + ';}', box);
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture({native = true} = {}) {
  const f = {spoken: [], signals: [], hold: false, releases: [], store: new Map(), session: 'agent-session', conversation: 'conversation-1', open: false, events: []};
  const box = {
    cloudRuntimeEnabled:false,    developmentCartesiaVoiceEnabled:false,developmentCloudVoiceEnabled:false, testMocksEnabled: false, browserDevProfile: false, Date, JSON, Number, Set, console, AbortController, DOMException, setTimeout, clearTimeout,
    crypto, performance,
    Event: class { constructor(type) { this.type = type; } },
    Capacitor: {isNativePlatform: () => native, getPlatform: () => native ? 'android' : 'web'},
    connectionController: {getCloudEnvironment: () => 'production', getCloudClient: () => ({sessionId: 'cloud-session', credentialId: 'cloud-credential'}), getSnapshot: () => ({open: f.open, session: {sessionId: f.session}, history: {conversationId: f.conversation}}), subscribe: () => () => {}},
    registerPlugin: () => ({}),
    localStorage: {getItem: k => f.store.has(k) ? f.store.get(k) : null, setItem: (k, v) => f.store.set(k, String(v)), removeItem: k => f.store.delete(k)},
    window: {dispatchEvent: event => { f.events.push(event.type); return true; }, addEventListener() {}, removeEventListener() {}},
    document: {hidden: false, documentElement: {dataset: {}}, querySelector: () => null, addEventListener() {}, removeEventListener() {}},
    // Recognition readiness (ready) and read-aloud readiness (playbackReady) are separate checks.
    createOnDeviceVoice: () => ({ready: async () => false, playbackReady: async () => true}),
    createCloudVoice: () => ({speak: async (text,signal,started) => box.speakLocalText(text,signal,started,false,{execution:'cloud'})}),
    nativeVoiceTurnId: () => undefined,
    planLocalSpeech: text => { if (/🙂/.test(text)) throw Error('Unsupported'); return [text]; },
    speakLocalText: async (text, signal, started, _queue, requirements) => {
      f.spoken.push({text, execution: requirements?.execution}); f.signals.push(signal);
      if (f.hold) await new Promise((resolve, reject) => { f.releases.push(resolve); signal.addEventListener('abort', () => reject(signal.reason), {once: true}); });
      started?.();
    },
  };
  // voice-timing.ts configures the shared recorder projected from the pin, evaluated in this realm.
  for (const [file, name] of [['../../../.eliza/client-features/packages/voice/src/voice-turn-timing.ts', 'createVoiceTurnTiming'], ['runtime/voice-selection.ts', 'selectVoiceRoute'], ['runtime/voice-timing.ts', 'markVoiceTiming'], ['prototype/local-speech-playback.ts', 'installLocalSpeechPlayback']]) load(file, name, box);
  class Shell {
    constructor() { this.state = {chat: 'sheet', msgs: []}; this.live = true; }
    S() { return this.state; }
    setState(patch) { Object.assign(this.state, typeof patch === 'function' ? patch(this.state) : patch); this.componentDidUpdate(); }
    renderVals() { return {ic:{copy:'copy',check:'check',wave:'wave',stop:'stop'},msgs: this.state.msgs.map(m => ({id: m.id, text: m.text}))}; }
    componentDidUpdate() {}
    componentWillUnmount() {}
  }
  box.installLocalSpeechPlayback(Shell);
  f.box = box; f.shell = new Shell();
  f.say = (message) => f.shell.setState({msgs: [...f.shell.state.msgs, message]});
  f.replace = (id, patch) => f.shell.setState({msgs: f.shell.state.msgs.map(m => m.id === id ? {...m, ...patch} : m)});
  f.voiceTurn = (text = 'What is on my calendar?') => { box.beginVoiceTurn({route: 'on-device', cold: false}); box.markVoiceTiming('transcript-ready'); box.noteVoiceDraft(text, f.shell.state.msgs); return text; };
  f.row = () => box.voiceTimingRecords().at(-1);
  return f;
}

// Replies are spoken only in the voice conversation (voice-adapter.ts). A message dictated with
// Transcribe and sent from the composer is timed through its reply but never read aloud, and a
// Read replies aloud value stored by an earlier build changes nothing.
const oldReadRepliesAloud = f => f.store.set('alphaphone:speak-replies:v1', JSON.stringify({version: 1, enabled: true}));

test('a dictated and sent message is timed through its final reply, and the reply is never spoken', async () => {
  for (const stored of [false, true]) {
    const f = fixture(); if (stored) oldReadRepliesAloud(f);
    const text = f.voiceTurn();
    f.say({id: 'u1', from: 'user', text});
    f.say({id: 'a1', from: 'agent', text: 'Partial', streaming: true});
    f.replace('a1', {text: 'You have two events today.', streaming: false});
    await tick(); await tick();
    assert.deepEqual(f.spoken, [], stored ? 'an old stored Read replies aloud value is ignored' : 'no reply is spoken');
    assert.deepEqual(Object.keys(f.row().marks), ['recording-end', 'transcript-ready', 'send', 'first-token', 'final-reply']);
    assert.equal(f.row().outcome, undefined);
    assert.equal(f.shell.renderVals().msgs[1].localSpeechControlLabel, 'Read aloud');
  }
});

test('a reply read with Read aloud can be stopped from its Stop reading control and by the next message', async () => {
  const f = fixture(); f.hold = true;
  f.say({id: 'u1', from: 'user', text: 'First'}); f.say({id: 'a1', from: 'agent', text: 'Long reply.'});
  f.shell.renderVals().msgs[1].localSpeech(); await tick(); await tick();
  assert.equal(f.spoken.length, 1);
  const row = f.shell.renderVals().msgs[1];
  assert.equal(row.localSpeechControlLabel, 'Stop reading');
  assert.equal(row.localSpeechLabel, 'Read aloud');
  assert.equal(row.localSpeechMessage, '');
  row.localSpeech(); await tick();
  assert.equal(f.signals[0].aborted, true);
  f.shell.renderVals().msgs[1].localSpeech(); await tick(); await tick();
  assert.equal(f.spoken.length, 2);
  f.say({id: 'u2', from: 'user', text: 'Typed follow-up'});
  await tick();
  assert.equal(f.signals[1].aborted, true, 'a new user message stops the reply being read');
});

test('Listen on an earlier reply is not stopped by user messages that were already there', async () => {
  const f = fixture(); f.hold = true;
  f.say({id: 'u1', from: 'user', text: 'First'}); f.say({id: 'a1', from: 'agent', text: 'Earlier reply.'});
  f.say({id: 'u2', from: 'user', text: 'Second'}); f.say({id: 'a2', from: 'agent', text: 'Latest reply.'});
  // The renderer preserves message order: index 1 is the earlier reply.
  f.shell.renderVals().msgs[1].localSpeech(); await tick(); await tick();
  assert.deepEqual(f.spoken.map(item => item.text), ['Earlier reply.']);
  f.shell.setState({}); await tick();
  assert.equal(f.signals[0].aborted, false, 'an older user message does not stop Listen');
  assert.equal(f.shell.renderVals().msgs[1].localSpeechControlLabel, 'Stop reading');
  f.say({id: 'u3', from: 'user', text: 'Third'}); await tick();
  assert.equal(f.signals[0].aborted, true, 'a user message sent after Listen began stops it');
});

test('an edited, superseded, interrupted or other-conversation dictated turn is abandoned and never spoken', async () => {
  for (const scenario of ['edited', 'newer-turn', 'interrupted', 'conversation']) {
    const f = fixture(); oldReadRepliesAloud(f);
    const text = f.voiceTurn();
    if (scenario === 'edited') f.say({id: 'u1', from: 'user', text: text + ' and tomorrow'});
    else f.say({id: 'u1', from: 'user', text});
    if (scenario === 'newer-turn') f.say({id: 'u2', from: 'user', text: 'Never mind'});
    if (scenario === 'conversation') f.conversation = 'conversation-2';
    f.say({id: 'a1', from: 'agent', text: 'Reply.', ...(scenario === 'interrupted' ? {interrupted: true} : {})});
    await tick(); await tick();
    assert.equal(f.spoken.length, 0, scenario);
    assert.equal(f.row().outcome, 'abandoned', scenario);
    assert.equal(f.row().marks['final-reply'], undefined, scenario);
  }
});

test('note read-aloud uses only the local route, reports state and stops on request', async () => {
  const f = fixture(); f.hold = true;
  const reading = f.box.speakNote('Groceries. Milk and eggs', {noteId: 'note-1'});
  await tick(); await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(f.box.currentNoteReading())), {noteId: 'note-1', text: 'Groceries. Milk and eggs', state: 'preparing'});
  assert.deepEqual(f.spoken, [{text: 'Groceries. Milk and eggs', execution: 'device'}]);
  f.box.stopSpeaking();
  assert.equal(await reading, 'stopped');
  assert.equal(f.signals[0].aborted, true);
  assert.equal(f.box.currentNoteReading(), null);
  assert.ok(f.events.includes('alpha:note-reading'));
  f.hold = false;
  assert.equal(await f.box.speakNote('Done reading', {noteId: 'note-2'}), 'finished');
  assert.equal(await f.box.speakNote('Smile 🙂'), 'unsupported', 'unsupported native text is refused before audio');
  assert.equal(await f.box.speakNote('   '), 'unsupported');
  f.box.createOnDeviceVoice = () => ({ready: async () => true, playbackReady: async () => false});
  assert.equal(await f.box.speakNote('Playback not ready'), 'unavailable', 'read-aloud follows playback readiness, not recognition readiness');
  f.box.createOnDeviceVoice = () => null;
  assert.equal(await f.box.speakNote('No engine'), 'unavailable');
  assert.equal(f.spoken.length, 2);
});

test('browser note read-aloud applies the Listen preflight before any audio or local-agent request', async () => {
  const f = fixture({native: false});
  const screened = [];
  f.box.planLocalSpeech = text => { screened.push(text); if (/password|https?:/i.test(text)) throw Error('Refused'); return [text]; };
  assert.equal(await f.box.speakNote('Wifi. password: hunter2', {noteId: 'secret'}), 'unsupported');
  assert.equal(await f.box.speakNote('Read https://example.test later', {noteId: 'link'}), 'unsupported');
  assert.equal(f.spoken.length, 0, 'refused text never reaches the speech engine');
  assert.equal(await f.box.speakNote('Groceries. Milk and eggs', {noteId: 'ok'}), 'finished');
  assert.deepEqual(f.spoken, [{text: 'Groceries. Milk and eggs', execution: 'browser'}]);
  assert.equal(screened.length, 3);
});

test('starting another reading or message playback stops note read-aloud', async () => {
  const f = fixture(); f.hold = true;
  const first = f.box.speakNote('First note', {noteId: 'a'});
  await tick(); await tick();
  const second = f.box.speakNote('Second note', {noteId: 'b'});
  assert.equal(await first, 'stopped');
  await tick(); await tick();
  f.box.stopLocalSpeechPlayback();
  assert.equal(await second, 'stopped');
});
