import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {modelStateInventory,unobservedStateFields} from '../model-state.mjs';
import {root} from './java.mjs';
import {checkCurrentPolicies} from './current-policies.mjs';
import {checkCurrentRenderer} from './current-renderer.mjs';
import {checkRendererCoordinator} from './renderer-coordinator.mjs';
import {checkResetOrchestration} from './reset-orchestration.mjs';
import {checkResidentCoordinator} from './resident-coordinator.mjs';
import {checkDeletionCoordinator} from './deletion-coordinator.mjs';
import {checkCredentialCoordinator} from './credential-coordinator.mjs';
import {checkCredentialLeasePolicies} from './credential-leases.mjs';
import {checkProviderAdmission} from './provider-admission.mjs';
import {checkNativeNoteRecording} from './note-recording.mjs';
import {checkNoteRecordingService} from './note-recording-service.mjs';
import {checkVoiceDraft} from './voice-draft.mjs';

const boundaryObligations = [
  {model:'NativeVoiceDraft',obligation:'Physical capture and shared bridge permission lifecycle',reason:'The real staged LocalVoiceRecording executes cache cleanup, start/stop/cancel, timer and media callbacks, failure cleanup and external selection. Permission epochs and lifecycle admission in LocalSpeechBridgePlugin remain a separate source scope.'},
  {model:'NativeNoteRecording',obligation:'Physical recording, free-space exhaustion and unrestricted journal histories',reason:'Actual segmented recorder, journal bytes and file recovery execute. MediaRecorder/codec behavior is a controlled port. Two segments and four capture instances bound the source campaign; free-space exhaustion remains an explicit unexecuted source branch.'},
  {model:'NativeNoteRecordingService',obligation:'Installed foreground eligibility and full plugin permission bridge',reason:'Actual service and recorder identities execute under serialized command/notification ports. AlphaVoiceCloudPlugin permission callbacks and Android service recreation/notification visibility remain separate integration obligations.'},
  {model:'RendererRecovery',obligation:'Installed Activity/WebView and task-manager behavior',reason:'The actual MainActivity, per-task HOME ownership and recovery callbacks execute against controlled Android ports. Real task assignment, Settings visibility and renderer process death require platform observations.'},
  {model:'ResidentScheduling',obligation:'Installed broadcast and service admission',reason:'The full admission table and whole-plugin lifecycle-lock race execute. Android broadcast delivery and service-process launch remain external.'},
  {model:'VadSegmentation',obligation:'PCM model output and capture pre-roll',reason:'The real gate executes every finite probability/counter partition. Microphone frames, inference and capture pre-roll remain separate.'},
  {model:'ResidentRuntime',obligation:'Arbitrary streams, recovery combinations and resident service execution',reason:'The actual plugin and renderer wrapper execute owned/attached cancellation, stop, teardown, credential retirement and request/stream callbacks. Binder, HTTP and real process inventory are controlled ports.'},
  {model:'VoiceSession',obligation:'Dictation and unrestricted voice session schedules',reason:'The shared controller executes semantic endpoint decisions, exact reviewed replies, explicit speech interruption, playback, mute, account retirement and pending/rejected capture-close schedules. Dictation and arbitrary overlapping sessions remain unexecuted source paths.'},
  {model:'SpeechResources',obligation:'Combined microphone, engine and focus lifecycle',reason:'Capture reservation, PCM queue and audio-focus policy helpers execute. Full capture pipeline ownership and physical audio output remain separate.'},
  {model:'AlwaysOnListener',obligation:'Consent store and complete listening service lifecycle',reason:'Pairwise policy and indicator-loss cases execute. ListeningEpoch, durable consent and installed microphone/service callbacks require further source and platform adapters.'},
  {model:'ResetRecovery',obligation:'Installed authentication, durable erasure and Binder identity',reason:'The real reset coordinator executes durable attempt admission, listener-first retries, partial writes, cross-process contention and startup recovery. Device power loss and package erasure remain external.'},
  {model:'DeletionJournal',obligation:'Arbitrary multi-row scheduling and real provider persistence',reason:'The full coordinator executes bounded owner changes, partial storage failures, restart and multiple rows. Android/provider effects and power-loss durability remain external.'},
  {model:'MediaLifecycle',obligation:'Complete media catalog, edit and Activity coordinators',reason:'NativeReadEpoch and exact selected-file copy/publication execute. Catalog lifecycle, camera/video resources and Android provider permission callbacks remain separate.'},
  {model:'DeviceActions',obligation:'Telephony, Contacts, Reminders and Clock coordinators',reason:'The real SMS journal executes controlled carrier outcomes. Actual role/permission and other device-action coordinators remain separate source/platform obligations.'},
  {model:'ApplicationComposition',obligation:'Cross-domain implementation orchestration',reason:'The current composition migration is owned by the separate application integration adapter. Standalone native traces do not establish its relation.'},
  {model:'NavigationProgress',obligation:'Complete maneuver/reroute and navigation service coordinator',reason:'Current fix admission and guidance helpers execute. The maps adapter closure, retry timers and actual background service still require source-backed driving.'},
  {model:'ListenerLeaseRecovery',obligation:'Persistent crash latch, consent and capture integration',reason:'Actual lease and crash helpers execute. Store commit, process consent and microphone lifecycle are separate obligations.'},
  {model:'StreamingPlayback',obligation:'Unrestricted writer schedules and actual AudioTrack audibility',reason:'The actual writer executes partial/zero writes, completion, failed open/write and cancelled opening. Platform drain, physical audibility and every concurrent schedule remain external.'},
  {model:'VoiceIpcAssembly',obligation:'Remaining deadline/handle races and complete owner admission',reason:'Actual exchanges execute response/chunk assembly, expired deadlines before dispatch, rejected scheduler admission and cleanup. Arbitrary deadline/return races and installed native transport require further adapters.'},
  {model:'ListenerLeaseProducer',obligation:'Complete SystemUI controller and Binder identity',reason:'The real lease producer consumes controlled measured snapshots. Real view geometry, controller lifecycle and Binder identity remain external.'},
];

/** Aggregate current-source adapters. Every receipt binds this entry point before execution. */
export async function runNativeRefinement(extraSources = []) {
  const sources = [fileURLToPath(import.meta.url),join(root,'specs/quint/refinement/model-state.mjs'),...extraSources];
  const receipts = await checkCurrentPolicies([],sources);
  receipts.push(...await checkCurrentRenderer(sources));
  receipts.push(await checkProviderAdmission(sources));
  receipts.push(await checkRendererCoordinator(sources));
  const reset = await checkResetOrchestration(sources);
  if (reset.results.some(result => result.status !== 'passed')) throw Error('Reset orchestration trace checking failed');
  receipts.push(...reset.receipts);
  receipts.push(await checkResidentCoordinator(sources));
  receipts.push(await checkDeletionCoordinator(sources));
  const credential = await checkCredentialCoordinator(sources);
  receipts.push(...credential.receipts);
  receipts.push(await checkCredentialLeasePolicies(sources));
  receipts.push(await checkNativeNoteRecording(sources));
  receipts.push(await checkNoteRecordingService(sources));
  receipts.push(await checkVoiceDraft(sources));
  const obligations = [...boundaryObligations,...credential.obligations];
  for (const model of new Set(receipts.map(receipt => receipt.model))) {
    const related = receipts.filter(receipt => receipt.model === model);
    const coveredActions = new Set(related.flatMap(receipt => Object.keys(receipt.actions)));
    const coveredFields = [...new Set(related.flatMap(receipt => receipt.observedFields))];
    const initializers = new Set(related.flatMap(receipt => receipt.traceInputs.map(trace => trace.init?.name || 'init')));
    const path = join(root,'specs/quint',model === 'NativeCredentialMutation' ? 'services' : 'native',`${model}.qnt`);
    const inventory = modelStateInventory(path,model);
    const missing = inventory.actions.filter(name => !['init','check','step'].includes(name) && !initializers.has(name) && !coveredActions.has(name));
    if (missing.length) obligations.push({model,obligation:'Unexecuted model transitions',reason:missing.join(', ')});
    const unobserved = unobservedStateFields(inventory,coveredFields);
    if (unobserved.length) obligations.push({model,obligation:'Unobserved model fields',reason:unobserved.join(', ')});
  }
  return {receipts,obligations};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runNativeRefinement();
  console.log(JSON.stringify({receipts:result.receipts.map(({model,traces,checkpoints,receiptPath}) => ({model,traces,checkpoints,receiptPath})),obligations:result.obligations},null,2));
}
