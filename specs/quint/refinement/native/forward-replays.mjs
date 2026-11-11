/** Register the existing source-executing MBT adapters without replacing their
 * equality, action, witness or mutation oracles with summary-counter claims. */
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {observedReplay} from '../observed-replay.mjs';
import {modelNames} from '../services/maps-model-traces.mjs';
import {runSpeechCleanupLatchReplay} from './speech-cleanup-latch.mjs';
import {runRendererSpeechChunkReplay} from './renderer-speech-chunk.mjs';
import {runNativeStreamBridgeReplay} from './native-stream-bridge.mjs';
import {replayNativeMapsLocation} from './maps-location.mjs';
import {replayVideoRecorder} from './video-recorder.mjs';
import {replayVideoEditReview} from './video-edit-review.mjs';
import {checkResidentStartCancel} from './resident-start-cancel.mjs';
import {checkHomeInstanceHandoff} from './home-instance-handoff.mjs';
import {checkRendererBackgroundRebuild} from './renderer-background-rebuild.mjs';
import {checkSavedSignInRecovery} from './saved-sign-in-recovery.mjs';

const definitions = [
  ['SpeechCleanupLatch', runSpeechCleanupLatchReplay, 'speechProjection',
    'The existing project function observes app speech and Cloud app speech with their real retirement gates; voice-surface and read-aloud chains remain outside this projection.'],
  ['RendererSpeechChunk', runRendererSpeechChunkReplay, 'chunkProjection',
    'The existing project function groups a terminal signal with synchronous disposal and observes playOwnedSpeech; internal completion latches and cleanup inputs remain outside the projection.'],
  ['NativeStreamBridge', runNativeStreamBridgeReplay, 'streamProjection',
    'The existing project function groups terminal stream completion and listener disposal; it observes the real Capacitor stream bridge over closed plugin ports.'],
  ['NativeMapsLocation', () => replayNativeMapsLocation(modelNames('specs/quint/native/NativeMapsLocation.qnt')), 'locationProjection',
    'The existing project function normalizes repeated delivered fix identities and observes the real native location owner over closed permission, callback and watch ports.'],
  ['VideoRecorder', () => replayVideoRecorder({traces: 400, maxSteps: 20}), 'recorderProjection',
    'The existing recorder-session projection observes BrowserVideoCapture with synthetic media, the retained-prefix read port, timers and capture tracks; DOM camera-view state remains outside this projection.'],
  ['VideoEditReview', () => replayVideoEditReview({traces: 600, maxSteps: 16}), 'editorProjection',
    'The existing DOM editor projection observes its actual controls, media calls, save callback and disposal; decoding and real filesystem writes remain external.'],
  ['ResidentStartCancel', checkResidentStartCancel, 's',
    'All state fields are compared with actual AlphaLocalAgentPlugin observations through the existing Java harness; credential mutation, Android execution and arbitrary worker schedules remain external.'],
  ['HomeInstanceHandoff', checkHomeInstanceHandoff, 's',
    'All state fields are compared with actual MainActivity observations through the existing Java harness over closed task and WebView ports.'],
  ['RendererBackgroundRebuild', checkRendererBackgroundRebuild, 's',
    'All state fields are compared with actual MainActivity/shared-budget observations through the existing two-surface Java harness.'],
  ['SavedSignInRecovery', checkSavedSignInRecovery, 's',
    'All state fields are compared with actual AlphaCloudSignInPlugin restore observations through the existing Java harness; credential storage and transport are controlled ports.'],
];

/** Retain the outer owning tests' positive bounds as well as the drivers' own
 * equality, required-action and witness assertions. Mutation canaries continue
 * to run separately; their expected failures are never positive receipts. */
function owningAssertions(model, result) {
  const counts = {SpeechCleanupLatch: 96, RendererSpeechChunk: 92, NativeStreamBridge: 70,
    NativeMapsLocation: 79, VideoRecorder: 400, VideoEditReview: 600, ResidentStartCancel: 76,
    HomeInstanceHandoff: 64, RendererBackgroundRebuild: 65, SavedSignInRecovery: 122};
  assert.equal(result.traces, counts[model], model + ' owning trace bound');
  const required = {
    SpeechCleanupLatch: ['speak', 'finishPlayback', 'cleanupSettled', 'recoveryStopSettled', 'restart'],
    RendererSpeechChunk: ['begin', 'listenerRegistered', 'abort', 'prepareResult', 'latePrepare', 'waitElapsed', 'playResult', 'terminalEvent', 'observeFinished', 'disposeSettled'],
    NativeStreamBridge: ['listenerAttached', 'requestStream', 'requestRejected', 'responseEvent', 'chunkEvent', 'completeEvent', 'abort', 'finish'],
    NativeMapsLocation: ['start', 'stop', 'cleanupSettles', 'permissionChecked', 'permissionAnswered', 'hide', 'show', 'listenersAdded', 'watchSettles', 'nativeFix', 'nativeError'],
    VideoRecorder: ['startResolved', 'chunk', 'limitOrTrackEnded', 'recorderStopped', 'prefixRead', 'recorderError', 'stopDeadline', 'finish', 'finalized', 'stopPreview'],
    VideoEditReview: ['sourceLoaded', 'sourceError', 'trim', 'rotate', 'toggleCrop', 'play', 'pause', 'commit', 'saveSettled', 'close', 'hide', 'show'],
    HomeInstanceHandoff: ['frontStartArrives'],
  };
  for (const action of required[model] ?? []) assert.ok(result.actions[action] > 0, model + ' required action ' + action);
  const checkpointMinimum = {SpeechCleanupLatch: 2500, RendererSpeechChunk: 2000, NativeStreamBridge: 1500, NativeMapsLocation: result.traces * 5};
  if (Object.hasOwn(checkpointMinimum, model)) assert.ok(result.checkpoints > checkpointMinimum[model], model + ' checkpoint bound');
  const stepMinimum = {VideoRecorder: 3000, VideoEditReview: 3000, ResidentStartCancel: 1000,
    HomeInstanceHandoff: 500, RendererBackgroundRebuild: 1000, SavedSignInRecovery: 1000};
  if (Object.hasOwn(stepMinimum, model)) assert.ok(result.steps > stepMinimum[model], model + ' step bound');
  if (model === 'VideoEditReview') assert.equal(result.framesLeftRunning, 0, 'A closed editor requests no more frames');
  if (model === 'ResidentStartCancel') {
    assert.ok(result.actions.finishRetry >= 10 && result.actions.retryShutdown >= 50 && result.actions.start >= 50);
    assert.equal(result.reached.length, 11);
  }
  if (model === 'HomeInstanceHandoff') assert.equal(result.reached.length, 6);
  if (model === 'RendererBackgroundRebuild') {
    assert.ok(result.actions.report > 100 && result.actions.recreated > 50);
    assert.equal(result.reached.length, 7);
  }
  if (model === 'SavedSignInRecovery') {
    assert.ok(result.actions.restoreEnds >= 10 && result.actions.restoreReads >= 50);
    assert.equal(result.reached.length, 7);
  }
  return result;
}

export function forwardReplayCampaigns(extraSources = []) {
  return definitions.map(([model, run, prefix, projection]) => ['forwardReplay' + model, async () => {
    const receipt = await observedReplay({model, run: async () => owningAssertions(model, await run()), prefix, projection,
      extraSources: [fileURLToPath(import.meta.url), ...extraSources],
      assumptions: [projection,
        'Existing declared scenarios, directed witnesses, random bounds and per-checkpoint source/model comparisons are retained. A passing bounded replay is not a universal refinement or device qualification.',
        'The receipt binds an over-approximation of tracked product source, fixture modules and generated client source before replay. JVM ports, trace arguments and compiler inputs are captured before use and retained when temporary.',
        'Node, esbuild, JDK and installed test dependencies are trusted execution tools. The product dependency lock and the org.json compiler input are bound; real provider, audio and device acceptance remain separate.']});
    return {receipt, obligations: [{model, obligation: 'Unbounded source refinement and installed acceptance', reason: projection}]};
  }]);
}
