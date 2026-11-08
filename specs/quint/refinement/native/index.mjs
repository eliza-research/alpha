import {fileURLToPath} from 'node:url';
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {checkTraces, captureInputs} from '../check-traces.mjs';
import {app, sense, directory, javaTraces, root} from './java.mjs';
import {voiceTraces, navigationTraces} from './renderer.mjs';
import {residentLifecycleTraces} from './local-agent.mjs';
import {checkResetOrchestration} from './reset-orchestration.mjs';
import {checkResidentCoordinator} from './resident-coordinator.mjs';

export async function runNativeRefinement() {
  const models = ['VadSegmentation', 'RendererRecovery', 'ResidentScheduling'];
  const sources = ['LiveVadGate.java', 'RendererRecoveryBudget.java', 'ResidentScheduleRearm.java'].map(name => app + name);
  const finiteSources = [...sources, `${directory}/Trace.java`, `${directory}/FinitePolicyTraces.java`, fileURLToPath(import.meta.url), `${directory}/java.mjs`];
  const finiteHashes = captureInputs(finiteSources);
  const traces = javaTraces('FinitePolicyTraces.java', sources);
  const results = [];
  for (const model of models) {
    const assumptions = model === 'VadSegmentation'
      ? ['All 18 reachable gate counter states and all 11 probability classes plus close are covered.', 'Float classes use the actual 0.35f and 0.5f comparisons. PCM generation and capture buffers remain external.']
      : model === 'RendererRecovery'
        ? ['Helper projection covers count classes 0..4+ and elapsed deltas below/at/above 60000ms, equality and backwards time, with reachable prefixes including a fifth loss.', 'Elapsed realtime is nonnegative. The source counter saturates at four; a 10000-loss run and MAX_VALUE defensive regression verify overflow does not revive immediate recreation.', 'Model Activity recreation actions frame the observed helper state. MainActivity lifecycle and Settings launches remain separate obligations.']
        : ['Complete five-event/two-unlock/two-package/two-owner/three-lifecycle admission table, with one actual admitAndStart invocation per fresh case.', 'Environment setup is external input. Running-service idempotency and plugin lifecycle mutation remain separate obligations.'];
    results.push(await checkTraces({model, id: `${model}-native`, sources: finiteSources, driverHashes: finiteHashes,
      scope: 'complete-finite-helper', assumptions, traces: traces[model]}));
  }
  const componentSources = ['ResetAuthorization.java', 'LiveCaptureAdmission.java', 'SpeechPcmQueue.java',
    'SpeechAudioFocusPolicy.java', 'NativeReadEpoch.java', 'PhotoAttachmentSource.java'].map(name => app + name)
    .concat(['IndicatorLease.java', 'ListenerPolicy.java', 'CrashLoopBreaker.java'].map(name => sense + name));
  const componentInputs = [...componentSources, `${directory}/Trace.java`, `${directory}/ComponentTraces.java`, fileURLToPath(import.meta.url), `${directory}/java.mjs`];
  const componentHashes = captureInputs(componentInputs);
  const components = javaTraces('ComponentTraces.java', componentSources);
  for (const [model, modelTraces] of Object.entries(components)) {
    results.push(await checkTraces({model, id: `${model}-native`, sources: componentInputs, driverHashes: componentHashes,
      scope: 'bounded-component', traces: modelTraces, assumptions: [
        'Actual Java helper methods execute against controlled environment inputs. Observed fields are listed in this receipt.',
        'Model macro setup may include external admission/review actions whose implementation is outside this component projection.',
        'Android services, permission observers, UI lifecycle and physical devices remain integration obligations.',
      ]}));
  }
  const journalSources = ['DeferredDeletionJournal.java', 'DeletionDeadline.java', 'SmsSendJournal.java', 'NativeVoiceIpc.java'].map(name => app + name);
  const journalInputs = [...journalSources, `${directory}/Trace.java`, `${directory}/JournalTraces.java`, fileURLToPath(import.meta.url), `${directory}/java.mjs`];
  const journalHashes = captureInputs(journalInputs);
  const journals = javaTraces('JournalTraces.java', journalSources);
  for (const [model, modelTraces] of Object.entries(journals)) {
    results.push(await checkTraces({model, id: `${model}-native`, scope: 'bounded-component', traces: modelTraces,
      sources: journalInputs, driverHashes: journalHashes,
      assumptions: ['In-memory atomic store and serialized callback port execute the actual journal/IPC source.',
        'Multi-action checkpoints cover one synchronous source call. Internal model states between these actions are not source observations.',
        'No actual provider effect, telephony role, Binder transport, credential root or power-loss durability is exercised.']}));
  }
  const extraGroups = [
    ['PlaybackTraces.java', ['StreamingSpeechPlayback.java', 'SpeechPcmQueue.java', 'SpeechAudioFocusPolicy.java', 'VoiceLatencyTrials.java'].map(name => app + name)],
    ['ResidentTraces.java', ['CloudDeployment.java', 'LocalAgentProviderAdmission.java'].map(name => app + name).concat('test/fixtures/LocalAgentProviderAdmissionTest.java')],
  ];
  const stubs = 'test/fixtures/systemui-chip-jvm';
  const producerSources = readdirSync(join(root, stubs), {recursive: true}).filter(name => name.endsWith('.java')).map(name => join(stubs, name))
    .concat(['AlphaListeningPolicy.java', 'AlphaListeningLease.java'].map(name => `android/aosp/listener/systemui/chip/source/${name}`));
  extraGroups.push(['ProducerTraces.java', producerSources, 'com.android.systemui.privacy.ProducerTraces']);
  for (const [harness, groupSources, main] of extraGroups) {
    const inputs = [...groupSources, `${directory}/${harness}`, `${directory}/Trace.java`, `${directory}/java.mjs`, fileURLToPath(import.meta.url)];
    const hashes = captureInputs(inputs);
    const group = javaTraces(harness, groupSources, [], main);
    for (const [model, modelTraces] of Object.entries(group)) results.push(await checkTraces({model, id: `${model}-native`,
      sources: inputs, driverHashes: hashes,
      scope: 'bounded-component', traces: modelTraces, assumptions: [
        'Actual production helper/class executes with controlled ports and source-executing fixture utilities.',
        'Only fields present in observedFields are claimed. Multi-action checkpoints map one synchronous call or one completed worker execution.',
        'External startup, Android observations, provider authenticity and unrestricted scheduler interleavings remain explicit obligations.',
      ]}));
  }
  for (const [model, generate, sourceNames] of [
    ['VoiceSession', voiceTraces, ['apps/app/src/runtime/voice-assistant.ts']],
    ['NavigationProgress', navigationTraces, ['apps/app/src/maps/navigation-fix.ts', 'apps/app/src/maps/guidance.ts']],
  ]) {
    const inputs = [...sourceNames, `${directory}/renderer.mjs`, fileURLToPath(import.meta.url)];
    const hashes = captureInputs(inputs);
    const modelTraces = await generate();
    results.push(await checkTraces({model, id: `${model}-native`, scope: 'bounded-component', traces: modelTraces,
    sources: inputs, driverHashes: hashes,
    assumptions: ['Actual TypeScript executes with controlled capture/reply/playback/timer inputs.',
      'Voice traces bound two sentences and one submitted turn. Navigation projects fix admission and guidance helpers, not the adapter closure or native service.']}));
  }
  const lifecycle = await residentLifecycleTraces([fileURLToPath(import.meta.url)]);
  results.push(await checkTraces({model: 'ResidentRuntime', id: 'ResidentRuntime-lifecycle-native', scope: 'bounded-component',
    ...lifecycle, assumptions: [
      'Unmodified local-agent.ts is bundled with a synthetic Capacitor port and virtual time. All transitive implementation inputs are hashed before execution.',
      'Stop resolution, rejection and timeout are actual wrapper outcomes. Connect cancellation observes actual cancelStart calls and absent publication.',
      'The port assumes native owned-start/attached-start cancellation semantics. Actual AlphaLocalAgentPlugin lock/service behavior remains external.',
    ]}));
  const reset = await checkResetOrchestration([fileURLToPath(import.meta.url)]);
  if (reset.results.some(result => result.status !== 'passed')) throw Error('Reset orchestration trace checking failed');
  results.push(...reset.receipts);
  results.push(await checkResidentCoordinator([fileURLToPath(import.meta.url)]));
  const obligations = [
    {model: 'RendererRecovery', obligation: 'Activity lifecycle and visible escape behavior', reason: 'Current adapter projects the pure budget only.', requires: ['Android Activity/WebView harness']},
    {model: 'ResidentScheduling', obligation: 'Plugin lifecycle and OS broadcasts', reason: 'Current adapter proves the pure admission table and same-lock callbacks.', requires: ['Android service integration']},
    {model: 'VadSegmentation', obligation: 'PCM model output and capture pre-roll', reason: 'The gate consumes probabilities; capture/model execution is external.', requires: ['native capture integration']},
    {model: 'ResidentRuntime', obligation: 'Broader credential/recovery/stream schedules and actual resident service', reason: 'Whole-plugin start, cancellation, stop, status, destruction and broadcast admission execute under controlled ports. Credential mutation, arbitrary streams, retained recovery combinations and the installed resident service remain separate obligations.'},
    {model: 'VoiceSession', obligation: 'Dictation, semantic endpoints, review resume and full barge-in interleavings', reason: 'One-turn/two-sentence actual controller traces cover mute, stop and account retirement with controlled ports.'},
    {model: 'SpeechResources', obligation: 'Combined native microphone/engine/focus lifecycle', reason: 'Capture reservation, PCM queue and focus helpers execute independently. Explicit-stop tail and native pipe ownership remain separate.'},
    {model: 'AlwaysOnListener', obligation: 'Consent store, ListeningEpoch and ListeningService integration', reason: 'Pairwise policy and indicator-loss cases execute without microphone, Android permissions or physical visibility.'},
    {model: 'ResetRecovery', obligation: 'Android durability, installed credential approval and externally observed erasure', reason: 'Actual reset authorization, durable reservation, listener-first retry and process-exit paths execute against controlled ports, including cross-process contention. Device power-loss behavior, Binder identity and actual package erasure require platform observations.'},
    {model: 'DeletionJournal', obligation: 'Coordinator identity admission, multi-row scheduling and provider persistence', reason: 'One row and controlled atomic store/provider outcomes execute. Power-loss durability and actual provider effects are external.'},
    {model: 'MediaLifecycle', obligation: 'Catalog, edit review, temporary camera resources and video lifecycle', reason: 'NativeReadEpoch and exact attachment copy/publication guards execute. MediaStore, camera and Activity lifecycle remain external.'},
    {model: 'DeviceActions', obligation: 'AOSP image/role, Contacts, Reminders and Clock', reason: 'Only the real SMS journal executes in these traces. Carrier outcomes are fixture inputs.'},
    {model: 'ApplicationComposition', obligation: 'Cross-domain implementation orchestration', reason: 'Root integration driver owns this combined scope. Standalone native receipts do not establish composition.'},
    {model: 'NavigationProgress', obligation: 'Maneuver cursor, reroute timers and background service', reason: 'Fix admission and guidance helpers execute. The maps-adapter closure and Android service are outside the current projection.'},
    {model: 'ListenerLeaseRecovery', obligation: 'Persistent crash latch, consent and capture integration', reason: 'Actual lease and crash helpers execute. Store commit, process consent and microphone lifecycle remain separate.'},
    {model: 'StreamingPlayback', obligation: 'All writer interleavings, actual AudioTrack and audibility', reason: 'Five writer traces cover completion, partial writes, failed open/write and canceled opening. Detailed failure-code mapping is unobserved.'},
    {model: 'VoiceIpcAssembly', obligation: 'Deadline scheduling races and actual owner/binding admission', reason: 'Eight actual exchanges check return/cleanup. Static deadline scheduling and local assembly state need a deterministic observer seam.'},
    {model: 'ListenerLeaseProducer', obligation: 'Controller measurement and real SystemUI/Binder identity', reason: 'Actual lease delivery consumes fixture snapshots. Controller/view geometry and real identity checks remain external.'},
  ];
  for (const model of new Set(results.map(receipt => receipt.model))) {
    const related = results.filter(receipt => receipt.model === model);
    const coveredActions = new Set(related.flatMap(receipt => Object.keys(receipt.actions)));
    const coveredFields = new Set(related.flatMap(receipt => receipt.observedFields));
    const initializers = new Set(related.flatMap(receipt => receipt.traceInputs.map(trace => trace.init?.name || 'init')));
    const text = readFileSync(join(root, 'specs/quint/native', `${model}.qnt`), 'utf8');
    const missing = [...text.matchAll(/\baction\s+(\w+)/g)].map(match => match[1])
      .filter(name => !['init', 'check', 'step'].includes(name) && !initializers.has(name) && !coveredActions.has(name));
    if (missing.length) obligations.push({model, obligation: 'Unexecuted model transitions', reason: missing.join(', ')});
    const state = text.match(/type\s+(?:State|Gate|Recovery|Navigation)\s*=\s*\{([\s\S]*?)\n  \}/)?.[1] || '';
    const fields = [...state.matchAll(/\b([A-Za-z]\w*)\s*:/g)].map(match => match[1]);
    const unobserved = fields.filter(field => ![...coveredFields].some(path => path === `s.${field}` || path.startsWith(`s.${field}.`)));
    if (unobserved.length) obligations.push({model, obligation: 'Unobserved model fields', reason: unobserved.join(', ')});
  }
  return {receipts: results, obligations};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runNativeRefinement();
  console.log(JSON.stringify({receipts: result.receipts.map(({model, traces, checkpoints, receiptPath}) => ({model, traces, checkpoints, receiptPath})), obligations: result.obligations}, null, 2));
}
