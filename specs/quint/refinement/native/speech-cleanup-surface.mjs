import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {deferred} from '../../../../test/fixtures/wait-for.mjs';
import {captureReplayClosure} from '../observed-replay.mjs';
import {checkTraces} from '../check-traces.mjs';

const voiceView = new URL('../../../../test/fixtures/cloud-voice-view.mjs', import.meta.url);
const batchVoice = new URL('../../../../test/fixtures/shared-batch-voice.mjs', import.meta.url);
const action = (name, ...args) => ({name, args});

function mediaFixture(cloudVoiceViewFixture, voiceFakeClock) {
  const clock = voiceFakeClock();
  const f = cloudVoiceViewFixture({cloudProfile:true, clock, holdPlayback:true, transcript:'Synthetic spoken question'});
  const {shell} = f, stops = [], readingResults = [];
  let voiceFailure, entryMessage, disposing = false;
  f.box.React = {createElement: () => null};
  f.box.VoiceActivity = () => null;
  f.box.HTMLElement = class {};
  f.box.nativeLiveVoiceReady = async () => false;
  shell.setState({chat:'input'});

  const actualStop = f.driver.stopPlayback.bind(f.driver);
  f.driver.stopPlayback = async args => {
    if (disposing) return actualStop(args);
    const gate = deferred(), stop = {args, gate, pending:true};
    stops.push(stop);
    try { await gate.promise; return await actualStop(args); }
    finally { stop.pending = false; }
  };
  const flush = async () => { for (let index = 0; index < 4; index++) await clock.flush(); };
  const refused = () => readingResults.some(result => result.message === f.box.MEDIA_UNCONFIRMED_NOTICE);
  return {
    f, stops, shell,
    async voiceStart() {
      await shell.startVoice();
      await flush();
      assert.equal(f.renderChat().state, 'listening');
    },
    async speakReply() {
      f.peak = .5;
      await clock.advance(700);
      f.peak = 0;
      await clock.advance(1200);
      await flush();
      assert.equal(f.sends, 1);
      assert.ok(f.activePlayback);
      assert.equal(f.renderChat().state, 'speaking');
    },
    stopVoice() {
      const pending = shell.stopVoiceConversation();
      assert.ok(pending);
      return pending.then(() => true, failure => { voiceFailure = failure; return false; });
    },
    readNote(passage, id) {
      return f.box.readNoteAloud(passage, {noteId:id}).then(result => {
        readingResults.push(result);
        return result;
      });
    },
    async enterTranscribe() {
      const before = shell.messages.length;
      shell.startTranscription();
      await flush();
      const notice = shell.messages[before];
      if (notice === undefined) entryMessage = 'none';
      else if (notice === f.box.MEDIA_UNCONFIRMED_NOTICE) entryMessage = 'media-not-stopped';
      else {
        assert.equal(notice, 'Finish or discard the current recording before transcribing.');
        entryMessage = 'finish-or-discard';
      }
    },
    observe(chain) {
      const panel = f.renderChat();
      if (chain === 'voice') {
        const stage = voiceFailure?.code === 'speech-cleanup-unconfirmed' ? 'latched'
          : panel?.state === 'stopping' ? 'retiring' : f.activePlayback ? 'playing' : 'idle';
        return {VoiceStage:stage, 's.recorderOpen':!!panel,
          ...(entryMessage === undefined ? {} : {'s.entryMessage':entryMessage, 's.entryLatched':entryMessage === 'media-not-stopped'})};
      }
      const pendingStop = stops.some(stop => stop.pending);
      const stage = refused() ? 'latched' : pendingStop ? 'retiring'
        : f.activePlayback ? 'playing' : 'idle';
      return {ReadingStage:stage, ReadingWaiting:pendingStop && f.box.currentNoteReading()?.state === 'preparing',
        ReadingRefused:refused()};
    },
    flush,
    async dispose() {
      disposing = true;
      for (const stop of stops) stop.gate.resolve();
      f.close();
      await flush();
    },
  };
}

function assertOwnedStop(h, playbackId, synthIndex) {
  const stop = h.stops.at(-1);
  assert.ok(stop?.pending, 'Actual owned cleanup is waiting on native stop');
  assert.equal(stop.args.playbackId, playbackId);
  assert.equal(stop.args.requestId, h.f.speechInputs[synthIndex].requestId);
  return stop;
}

async function replay(chain, confirmed, restart, fresh) {
  let h = fresh();
  const previousRealm = h.f.box;
  const observe = () => ({...h.observe(chain), 's.epoch': Number(h.f.box !== previousRealm)});
  const trace = {name: chain + (confirmed ? '-confirmed' : '-unconfirmed') + (restart ? '-restart' : ''),
    expect:observe(), steps:[]};
  const point = (label, action) => trace.steps.push({label, action, expect:observe()});
  const failure = Error('Synthetic native stop did not confirm');
  try {
    if (chain === 'reading') {
      const first = h.readNote('First fixture passage', 'first');
      await h.flush();
      assert.equal(h.f.box.currentNoteReading().noteId, 'first');
      assert.equal(h.f.box.currentNoteReading().state, 'reading');
      point('The first note owns the playing request', action('speak', chain));
      const firstPlayback = h.f.activePlayback;
      const next = h.readNote('Second fixture passage', 'second');
      await h.flush();
      const stop = assertOwnedStop(h, firstPlayback, 0);
      assert.equal(h.f.cloudSpeech, 1);
      assert.equal(h.f.box.currentNoteReading().noteId, 'second');
      assert.equal(h.f.box.currentNoteReading().state, 'preparing');
      point('A new reading waits on the exact stopped utterance', action('speak', chain));

      if (confirmed) stop.gate.resolve(); else stop.gate.reject(failure);
      assert.equal((await first).outcome, 'stopped');
      if (confirmed) {
        await h.flush();
        assert.equal(h.f.cloudSpeech, 2);
        assert.equal(h.f.box.currentNoteReading().state, 'reading');
        point('Confirmed stop starts the waiting reading', action('cleanupSettled', chain, true));
        const secondPlayback = h.f.activePlayback;
        h.f.finishPlayback();
        await h.flush();
        const lastStop = assertOwnedStop(h, secondPlayback, 1);
        point('The completed utterance awaits its own cleanup', action('finishPlayback', chain));
        lastStop.gate.resolve();
        assert.equal((await next).outcome, 'finished');
        point('Confirmed second cleanup leaves the chain idle', action('cleanupSettled', chain, true));
      } else {
        assert.deepEqual(structuredClone(await next), {outcome:'failed', message:h.f.box.MEDIA_UNCONFIRMED_NOTICE});
        point('Failed stop refuses the waiting reading with the cleanup notice', action('cleanupSettled', chain, false));
        assert.deepEqual(structuredClone(await h.readNote('Later fixture passage', 'later')),
          {outcome:'failed', message:h.f.box.MEDIA_UNCONFIRMED_NOTICE});
        assert.equal(h.f.cloudSpeech, 1);
        assert.equal(h.stops.length, 1);
        point('Later reading stays closed without another synthesis or retry stop', action('speak', chain));
      }
    } else {
      await h.voiceStart();
      point('The conversation recorder opens', action('enterVoice'));
      await h.speakReply();
      point('The owned conversation reply is playing', action('speak', chain));
      const playback = h.f.activePlayback, starts = h.f.starts;
      const stopping = h.stopVoice();
      await h.flush();
      const stop = assertOwnedStop(h, playback, 0);
      point('Stopping the conversation waits for real reply-speech cleanup', action('finishPlayback', chain));
      await h.enterTranscribe();
      assert.equal(h.f.starts, starts, 'No new microphone while speech retirement is held');
      point('Transcribe refuses while the stop is held', action('enterVoice'));

      if (confirmed) stop.gate.resolve(); else stop.gate.reject(failure);
      assert.equal(await stopping, confirmed);
      await h.flush();
      if (confirmed) {
        assert.equal(h.f.renderChat(), null);
        point('Confirmed speech retirement closes the old recorder', [action('cleanupSettled', chain, true), action('closeRecorder')]);
      } else {
        assert.equal(h.f.renderChat().state, 'error');
        assert.equal(h.f.renderChat().lines[0].t, h.f.box.MEDIA_UNCONFIRMED_NOTICE);
        point('Unconfirmed reply cleanup holds the error recorder', action('cleanupSettled', chain, false));
        h.shell.back();
        assert.equal(h.f.renderChat(), null);
        point('Back dismisses the recorder and retains the latch', action('closeRecorder'));
      }
      await h.enterTranscribe();
      if (confirmed) assert.ok(h.f.renderChat(), 'Confirmed cleanup admits Transcribe in the same realm');
      else {
        assert.equal(h.f.renderChat(), null);
        assert.equal(h.f.starts, starts);
        assert.equal(h.f.cloudSpeech, 1);
        assert.equal(h.stops.length, 1);
      }
      point('Attempt Transcribe with the settled chain', action('enterVoice'));
    }

    if (restart) {
      await h.dispose();
      h = fresh();
      point('A newly installed source realm clears the earlier process latch', action('restart'));
      await h.enterTranscribe();
      assert.ok(h.f.renderChat());
      point('The fresh voice realm can admit Transcribe', action('enterVoice'));
    }
    return trace;
  } finally {
    await h.dispose();
  }
}

export async function checkSpeechSurfaceCleanup(owner) {
  const sources = ['apps/app/src/prototype/voice-adapter.ts', 'apps/app/src/prototype/local-speech-playback.ts',
    'apps/app/src/local-speech-playback.ts', 'apps/app/src/runtime/cloud-voice.ts',
    fileURLToPath(voiceView), fileURLToPath(batchVoice), fileURLToPath(import.meta.url), owner];
  const driverHashes = captureReplayClosure(sources);
  const {cloudVoiceViewFixture} = await import(voiceView.href);
  const {voiceFakeClock} = await import(batchVoice.href);
  const fresh = () => mediaFixture(cloudVoiceViewFixture, voiceFakeClock);
  const traces = [];
  for (const [chain, confirmed, restart] of [
    ['reading', true, false], ['reading', false, false], ['voice', true, false], ['voice', false, true],
  ]) traces.push(await replay(chain, confirmed, restart, fresh));
  return checkTraces({model:'SpeechCleanupLatch', id:'SpeechCleanupLatch-voice-reading',
    traces, sources, driverHashes, scope:'bounded-component', assumptions:[
      'The installed whole voice/playback adapters, reply conversation, and owned Cloud playback path run under synthetic native speech, recording and account ports.',
      'Stop requests bind the actual prepared playback and synthesis ids. Observations use native-call ownership, the actual retirement promise or read outcome, and the shown recorder or entry notice.',
      'The directed voice and note paths use strict Cloud-driver cleanup. The on-device route and cross-chain handoff remain separate scopes.',
      'Restart is represented by a fresh fixture realm. Native audio and provider interactions are synthetic.',
    ]});
}
