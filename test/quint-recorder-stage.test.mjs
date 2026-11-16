import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {runRecorderStageReplay} from '../specs/quint/refinement/application/recorder-stage.mjs';
import {captureInputs, checkTraces, verifyRefinementReceiptInputs} from '../specs/quint/refinement/check-traces.mjs';

// RecorderStage model traces (scenarios, witnesses and random walks from the pinned Quint CLI)
// replayed step by step against chat Transcribe in the installed voice adapter, with the recording
// driver's start, stop, transcription and stop events as held ports.
test('chat Transcribe follows every RecorderStage model trace', {timeout: scaledTimeout(300000)}, async () => {
  const receipt = await runRecorderStageReplay();
  assert.equal(receipt.traces, 95);
  assert.ok(receipt.checkpoints > 2000, `checkpoints ${receipt.checkpoints}`);
  for (const action of ['enter', 'close', 'staleSettled', 'primaryStart', 'startSettled', 'primaryStop', 'stopSettled', 'maxDuration', 'captureLost',
    'primaryTranscribe', 'transcribeSettled', 'cancelTranscribe', 'apply'])
    assert.ok(receipt.actions[action] > 0, `${action} was replayed`);
});

const voiceSource = '.eliza/client-features/packages/voice/src/';
const alreadyRecording = 'A transcription is already recording.';

async function replayNativeDictation(createNativeLiveVoice, {timer, timers}) {
  const ownerId = 'synthetic-recorder-owner';
  const starts = [], stops = [], listeners = new Set();
  const finishing = Promise.withResolvers(), closeReply = Promise.withResolvers();
  let active = null, driverStage = 'none', stopFailed = false, refusedAsRecording = false;
  const voice = createNativeLiveVoice({
    available: () => true,
    resident: () => ({sessionId: 'synthetic-recorder-session', ownerId,
      request() { throw Error('Native capture does not use the agent request port'); }}),
    port: {
      async liveCaptureStatus() { return {available: true, nativeTransport: true}; },
      async addListener(event, listener) {
        const handle = {event, listener};
        listeners.add(handle);
        return {async remove() { listeners.delete(handle); }};
      },
      async startLiveCapture(input) {
        assert.equal(active, null, 'The preceding capture was released before a new native start');
        assert.equal(input.ownerId, ownerId);
        assert.equal(input.nativeAsr, true);
        active = input.captureId;
        starts.push(active);
        driverStage = 'recording';
        return {captureId: active, sampleRate: 16_000, nativeAsr: true};
      },
      async stopLiveCapture(input) {
        assert.equal(input.captureId, active, 'Finalize and discard address the owned capture');
        stops.push({captureId: input.captureId, discard: input.discard});
        if (!input.discard) {
          driverStage = 'stopping';
          finishing.resolve();
          return closeReply.promise;
        }
        active = null;
        driverStage = 'none';
        return {captureId: input.captureId, serverClosed: true};
      },
    },
  });
  const dictation = voice.dictation({maxDurationMs: 1_000});
  const observe = () => ({
    's.driver': driverStage, 's.stopFailed': stopFailed, 's.refusedAsRecording': refusedAsRecording,
  });
  const trace = {name: timer ? 'failedTimerStopAllowsRetryTest' : 'failedStopAllowsRetryTest', expect: observe(), steps: []};
  const mark = (...action) => trace.steps.push({action, expect: observe()});
  const start = async () => {
    try { return {value: await dictation.startRecording()}; }
    catch (error) {
      refusedAsRecording ||= error.message === alreadyRecording;
      return {error};
    }
  };
  const ended = Promise.withResolvers();
  const event = await dictation.addListener('recordingStopped', ended.resolve);
  try {
    const first = await start();
    assert.ok(first.value, 'The first actual recording is admitted');
    mark({name: 'enter'}, {name: 'primaryStart'}, {name: 'startSettled', args: [true]});

    // Calibrate the observation with the actual guard while still recording. Chat does not dispatch
    // this duplicate request, so it does not advance the owner-facing model trace.
    await assert.rejects(dictation.startRecording(), {message: alreadyRecording});
    assert.equal(starts.length, 1);

    const failure = timer ? ended.promise.then(clip => {
      assert.equal(clip.recordingId, first.value.recordingId);
      return !Number.isFinite(clip.durationMs);
    }) : dictation.stopRecording().then(() => false, error => error.message === 'Native transcription close was not confirmed.');
    if (timer) timers.tick(first.value.maxDurationMs);
    await finishing.promise;
    if (!timer) mark({name: 'primaryStop'});
    closeReply.resolve({serverClosed: false});
    stopFailed = await failure;
    mark({name: timer ? 'maxDuration' : 'stopSettled', args: [false]});

    const retry = await start();
    mark({name: 'primaryStart'}, {name: 'startSettled', args: [true]});
    trace.retryAdmitted = !!retry.value;
    if (retry.value) assert.notEqual(retry.value.recordingId, first.value.recordingId);
  } finally {
    closeReply.resolve({serverClosed: false});
    await event.remove();
    await dictation.cancelRecording();
  }
  assert.equal(listeners.size, 0, 'Retirement leaves no native listeners');
  trace.transportObservations = {captureStarts: starts.length, requestedStops: stops.map(stop => ({
    capture: starts.indexOf(stop.captureId) + 1, discard: stop.discard,
  })), duplicateStartRefused: true};
  return trace;
}

test('the native dictation driver releases a failed stop before the next recording', {timeout: scaledTimeout(30000)}, async t => {
  const sources = [fileURLToPath(import.meta.url), 'upstream.lock.json', '.eliza/client-features/.source.json',
    ...['native-live-voice.ts', 'live-voice-session.ts', 'random-id.ts'].map(name => voiceSource + name)];
  const driverHashes = captureInputs(sources);
  const {createNativeLiveVoice} = await import('../.eliza/client-features/packages/voice/src/native-live-voice.ts');
  const traces = [];
  t.mock.timers.enable({apis: ['setTimeout']});
  try {
    for (const timer of [false, true]) {
      traces.push(await replayNativeDictation(createNativeLiveVoice, {timer, timers: t.mock.timers}));
    }
  } finally {
    t.mock.timers.reset();
  }
  const receipt = await checkTraces({
    model: 'RecorderStage', id: 'RecorderNativeStopRetry', traces, sources, driverHashes, scope: 'bounded-component',
    assumptions: [
      'Actual pinned native live transport and dictation run with a closed native bridge and resident binding. No audio is captured.',
      'Both a user Stop and a duration-limit Stop fail to confirm finalization. The fake native bridge confirms the subsequent discard. The checkpoint observes driver state, failed stop and actual already-recording refusal; the existing chat adapter replay owns panel state.',
      'A duplicate start while actively recording is a boundary canary outside the UI-admitted schedule. An unconfirmed discard is outside these two recovery traces.',
    ],
  });
  assert.equal(receipt.traces, 2);
  assert.equal(receipt.checkpoints, 9);
  assert.deepEqual(receipt.observedFields, ['s.driver', 's.refusedAsRecording', 's.stopFailed']);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(verifyRefinementReceiptInputs(receipt), true);
  for (const trace of traces) {
    assert.equal(trace.retryAdmitted, true, 'The retry returned a recording receipt');
    assert.deepEqual(trace.transportObservations, {
      captureStarts: 2, requestedStops: [{capture: 1, discard: false}, {capture: 1, discard: true}, {capture: 2, discard: true}],
      duplicateStartRefused: true,
    });
  }
});
