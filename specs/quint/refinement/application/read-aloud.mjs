/** Replays ReadAloud model traces against apps/app/src/prototype/local-speech-playback.ts: the
 * whole module is evaluated (imports removed) and installed on a small shell class, so message
 * Listen runs through the `localSpeech` handler that `renderVals` hands to a message, and note
 * read-aloud through `readNoteAloud` and `stopSpeaking`.
 *
 * Controlled ports: the on-device voice (`createOnDeviceVoice().playbackReady`, one gated
 * preparation per reading) and the playback (`speakLocalText`, one gated playback per reading).
 * An aborted preparation rejects at once. An aborted playback stays pending until the model's
 * `retirementSettles`, which is the audio confirming that it stopped. The real route selection,
 * speech text screening and retirement chain (`retainSpeechRetirement`) run unchanged.
 *
 * Correspondence notes.
 *  - The code prepares the chosen voice in the task in which the earlier audio is confirmed
 *    stopped, so `messagePrepares` and `notePrepares` are not separate steps: a model reading that
 *    is `waiting` with nothing retiring is compared as `preparing`.
 *  - A note reading that was stopped reports `stopped` when its own pending work settles. Until
 *    then the observation is `stopped` when the reading is no longer the current note reading, and
 *    the value the promise later resolves with must equal it.
 *  - `finished` on a message is shown as no status; it is compared as `none`. `messageId` is
 *    compared only while the message shows a status.
 *  - Losing the message's context alternates between a new user message, a closed chat panel and
 *    another screen; the panel and screen are put back before the next Listen.
 *
 * Not observed: `starts` and `stops` (bounds). */
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {stripTypeScriptTypes} from '../../../../test/support/strip-types.mjs';
import {modelTraces, replayTraces, repositoryRoot} from '../assistant-model-traces.mjs';

export const model = {path: 'specs/quint/application/ReadAloud.qnt', module: 'ReadAloud'};
export const scenarios = ['messageReadToEndTest', 'replacementWaitsForStoppedAudioTest', 'sameMessageTogglesOffTest', 'noteReadingStopsMessageTest',
  'editedNoteStopsReadingTest', 'lostContextStopsMessageTest'];
export const witnesses = ['WaitingBehindRetirementWitness', 'NoteReplacesMessageWitness', 'ToggledOffWitness'];

const flush = async () => { for (let turn = 0; turn < 4; turn++) await new Promise(resolve => setImmediate(resolve)); };
const sources = ['apps/app/src/runtime/voice-selection.ts', 'apps/app/src/runtime/local-speech-text.ts', 'apps/app/src/runtime/voice-states.ts', 'apps/app/src/prototype/local-speech-playback.ts']
  .map(file => stripTypeScriptTypes(readFileSync(`${repositoryRoot}/${file}`, 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, ''), {mode: 'strip'}));
const names = [['selectVoiceRoute'], ['screenSpeechText', 'planLocalSpeech'], ['speechCleanupNotice'], ['installLocalSpeechPlayback', 'readNoteAloud', 'stopSpeaking', 'currentNoteReading']];
const NOTE = 'Weekly plan for the family.', text = id => `Reply number ${id} for reading.`;

export function project(state) {
  const {starts, stops, ...rest} = state;
  const collapse = phase => phase === 'waiting' && !state.retiring ? 'preparing' : phase;
  const message = state.message === 'finished' ? 'none' : collapse(state.message);
  return {...rest, message, messageId: message === 'none' ? 0 : state.messageId, note: collapse(state.note)};
}

export function createDriver() {
  const prepares = [], playbacks = [], notes = [];
  let voiceAvailable = true, forNote = false, noteStarted = false, losses = 0, users = 0;
  const cancelled = () => new DOMException('Speech cancelled', 'AbortError');
  const gate = (list, owner, signal, settleOnAbort) => new Promise((resolve, reject) => {
    const entry = {owner, signal, open: true, resolve(result) { entry.open = false; resolve(result); }, reject(reason) { entry.open = false; reject(reason); }};
    list.push(entry);
    if (settleOnAbort) signal.addEventListener('abort', () => { if (entry.open) entry.reject(cancelled()); });
  });
  const box = {
    cloudRuntimeEnabled: false, developmentCartesiaVoiceEnabled: false, developmentCloudVoiceEnabled: false, testMocksEnabled: false, browserDevProfile: false,
    JSON, AbortController, DOMException, setTimeout, clearTimeout, Promise, Event: class { constructor(type) { this.type = type; } },
    Capacitor: {isNativePlatform: () => true},
    connectionController: {getCloudEnvironment: () => null, getCloudClient: () => null, subscribe: () => () => {}, openCloudAccount() { throw Error('No sign-in on the on-device route'); },
      getSnapshot: () => ({open: false, session: {sessionId: 'agent'}, history: {conversationId: 'c'}})},
    window: {dispatchEvent: () => true, getSelection: () => ({isCollapsed: true})},
    document: {hidden: false, documentElement: {dataset: {}}, querySelector: () => null, addEventListener() {}, removeEventListener() {}},
    createCloudVoice() { throw Error('No Cloud voice on the on-device route'); }, cloudVoiceFailure: () => null,
    speakCloudSpeechChunks() { throw Error('No Cloud pieces on the on-device route'); },
    // One preparation per reading. It reports ready or not ready, and rejects when the reading is cancelled.
    createOnDeviceVoice() {
      if (!voiceAvailable) return null;
      const owner = forNote ? 'note' : 'message';
      return {playbackReady: signal => signal.aborted ? Promise.reject(cancelled()) : gate(prepares, owner, signal, true)};
    },
    // One playback per reading; `started` is the audible start the note reading waits for.
    speakLocalText(value, signal, started) {
      if (signal.aborted) return Promise.reject(cancelled());
      const owner = value === NOTE ? 'note' : 'message';
      if (owner === 'note') noteStarted = true;
      started?.(); return gate(playbacks, owner, signal, false);
    },
    markVoiceTiming() {}, abandonVoiceTurn() {}, finishVoiceTurn() {},
  };
  sources.forEach((source, index) => vm.runInNewContext(`{${source}\n${names[index].map(name => `globalThis.${name}=${name};`).join('')}}`, box));
  // Text screening is real; the on-device plan is replaced so both passages are speakable as written.
  box.planLocalSpeech = value => [value];
  class Shell {
    constructor() { this.state = {view: 'home', chat: 'sheet', msgs: [1, 2].map(id => ({id: `m${id}`, from: 'agent', text: text(id)}))}; this.live = true; }
    S() { return this.state; }
    setState(patch) { Object.assign(this.state, patch); this.componentDidUpdate(); }
    renderVals() { return {ic: {}, msgs: this.state.msgs.map(message => ({id: message.id, text: message.text}))}; }
    componentDidUpdate() {}
  }
  box.installLocalSpeechPlayback(Shell);
  const shell = new Shell();
  const live = (list, owner) => list.filter(entry => entry.open && !entry.signal.aborted && entry.owner === owner);
  const restore = () => { if (shell.state.chat !== 'sheet' || shell.state.view !== 'home') shell.setState({chat: 'sheet', view: 'home'}); };
  const ends = async (owner, ok) => { const playback = live(playbacks, owner).at(-1); if (ok) playback.resolve(); else playback.reject(Error('The speaker stopped.')); await flush(); };
  return {
    async listenMessage(id) { restore(); shell.renderVals().msgs.find(row => row.id === `m${id}`).localSpeech(); await flush(); },
    messagePrepares() {}, notePrepares() {},
    async messageReady(ok) { live(prepares, 'message').at(-1).resolve(ok); await flush(); },
    messagePlaybackEnds: ok => ends('message', ok),
    async messageContextLost() {
      const kind = losses++ % 3;
      if (kind === 0) shell.setState({msgs: [...shell.state.msgs, {id: `u${++users}`, from: 'user', text: 'Another question'}]});
      else if (kind === 1) shell.setState({chat: 'input'});
      else shell.setState({view: 'notes'});
      await flush();
    },
    async readNote(available) {
      const entry = {result: null};
      if (available) noteStarted = false;
      voiceAvailable = available; forNote = true;
      try { entry.promise = box.readNoteAloud(NOTE, {noteId: 'note'}).then(result => { entry.result = result.outcome; }); } finally { voiceAvailable = true; forNote = false; }
      notes.push(entry); await flush();
    },
    async noteReady(ok) { live(prepares, 'note').at(-1).resolve(ok); await flush(); },
    notePlaybackEnds: ok => ends('note', ok),
    async stopNote() { box.stopSpeaking(); await flush(); },
    async retirementSettles() { for (const playback of playbacks) if (playback.open && playback.signal.aborted) playback.reject(cancelled()); await flush(); },
    observe() {
      const rows = shell.renderVals().msgs.filter(row => /^m\d$/.test(row.id));
      const active = rows.find(row => row.localSpeechActive), failed = rows.find(row => !row.localSpeechActive && row.localSpeechMessage);
      if (active) assert.equal(active.localSpeechControlLabel, 'Stop reading');
      // An active reading shows only its Stop control; its phase is what it has asked of the voice.
      const shown = active ? (live(playbacks, 'message').length ? 'reading' : live(prepares, 'message').length ? 'preparing' : 'waiting') : failed ? 'failed' : 'none';
      const reading = box.currentNoteReading(), latest = notes.at(-1);
      const note = !reading ? 'none' : reading.state === 'reading' ? 'reading' : live(prepares, 'note').length ? 'preparing' : 'waiting';
      const retiring = playbacks.some(playback => playback.open && playback.signal.aborted);
      const collapse = phase => phase === 'waiting' && !retiring ? 'preparing' : phase;
      if (latest?.result && latest.predicted) assert.equal(latest.result, latest.predicted, 'a stopped note reading reports that it was stopped');
      if (latest && !latest.result && !reading) latest.predicted = 'stopped';
      return {message: collapse(shown), messageId: shown === 'none' ? 0 : Number((active || failed).id.slice(1)), messagePlaying: live(playbacks, 'message').length > 0,
        note: collapse(note), notePlaying: live(playbacks, 'note').length > 0, retiring, noteStarted,
        noteOutcome: !latest ? 'none' : latest.result ?? (reading ? 'none' : 'stopped')};
    },
    async close() {
      shell.live = false; box.stopSpeaking();
      for (const entry of [...prepares, ...playbacks]) if (entry.open) entry.reject(cancelled());
      await flush();
      for (const entry of notes) assert.ok(entry.result, 'every note reading reports an outcome');
    },
  };
}

export async function runReadAloudReplay({random = 80, steps = 40} = {}) {
  const traces = modelTraces({...model, scenarios, witnesses, random, steps});
  return replayTraces(traces, () => createDriver(), {project});
}
