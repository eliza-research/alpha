import {fileURLToPath} from 'node:url';
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {checkTraces, captureInputs} from '../check-traces.mjs';
import {app, sense, voice, directory, javaTraces, root} from './java.mjs';
import {captureRendererImplementation, voiceTraces, navigationTraces} from './renderer.mjs';
import {residentLifecycleTraces} from './local-agent.mjs';

export async function runNativeRefinement() {
  const models = ['VadSegmentation', 'RendererRecovery', 'ResidentScheduling'];
  const sources = [voice + 'LiveVadGate.java', app + 'RendererRecoveryBudget.java', app + 'ResidentScheduleRearm.java'];
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
  const componentSources = [
    'vendor/eliza/plugins/plugin-native-system/android/src/main/java/ai/eliza/plugins/system/reset/ResetAuthorization.java',
    ...['LiveCaptureAdmission.java', 'SpeechPcmQueue.java', 'SpeechAudioFocusPolicy.java'].map(name => voice + name),
    app + 'NativeReadEpoch.java',
    'vendor/eliza/plugins/plugin-native-media/android/src/main/java/ai/eliza/plugins/media/SelectedPhotoCopy.java',
    ...['IndicatorLease.java', 'ListenerPolicy.java', 'CrashLoopBreaker.java'].map(name => sense + name),
  ];
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
  const journalSources = [
    ...['DeferredDeletionJournal.java', 'DeletionDeadline.java'].map(name => 'vendor/eliza/plugins/plugin-native-action-journal/android/src/main/java/ai/eliza/plugins/actionjournal/deletion/' + name),
    'vendor/eliza/plugins/plugin-native-messages/android/src/main/java/ai/eliza/plugins/messages/SmsSendJournal.java',
    voice + 'BufferedStreamExchange.java',
  ];
  const journalInputs = [...journalSources, `${directory}/Trace.java`, `${directory}/JournalTraces.java`, fileURLToPath(import.meta.url), `${directory}/java.mjs`];
  const journalHashes = captureInputs(journalInputs);
  const journals = javaTraces('JournalTraces.java', journalSources, [], 'ai.eliza.plugins.messages.JournalTraces');
  for (const [model, modelTraces] of Object.entries(journals)) {
    results.push(await checkTraces({model, id: `${model}-native`, scope: 'bounded-component', traces: modelTraces,
      sources: journalInputs, driverHashes: journalHashes,
      assumptions: ['In-memory atomic store and serialized callback port execute the actual journal/IPC source.',
        'Multi-action checkpoints cover one synchronous source call. Internal model states between these actions are not source observations.',
        'No actual provider effect, telephony role, Binder transport, credential root or power-loss durability is exercised.']}));
  }
  const extraGroups = [
    ['PlaybackTraces.java', ['StreamingSpeechPlayback.java', 'SpeechPcmQueue.java', 'SpeechAudioFocusPolicy.java', 'VoiceLatencyTrials.java'].map(name => voice + name)],
    ['ResidentTraces.java', [
      'vendor/eliza/plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/runtime/NativeProviderAdmission.java',
      'vendor/eliza/plugins/plugin-native-agent/test/provider-admission/NativeProviderAdmissionTest.java',
    ], 'ai.eliza.plugins.agent.runtime.ResidentTraces'],
  ];
  const stubs = 'vendor/eliza/packages/app/test/android/sense-fixtures/systemui-chip-jvm';
  const producerSources = readdirSync(join(root, stubs), {recursive: true}).filter(name => name.endsWith('.java')).map(name => join(stubs, name))
    .concat(['SenseListeningPolicy.java', 'SenseListeningLease.java'].map(name => `vendor/eliza/packages/os/android/sense/systemui/chip/source/${name}`));
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
  const renderer = await captureRendererImplementation([fileURLToPath(import.meta.url)]);
  for (const [model, generate] of [
    ['VoiceSession', voiceTraces], ['NavigationProgress', navigationTraces],
  ]) {
    const modelTraces = await generate(renderer.implementation);
    results.push(await checkTraces({model, id: `${model}-native`, scope: 'bounded-component', traces: modelTraces,
      sources: renderer.sources, driverHashes: renderer.driverHashes,
      assumptions: ['Actual TypeScript and its transitive shared implementation execute with controlled capture/reply/playback/timer inputs.',
        'Voice traces bound two sentences and one submitted turn. Navigation projects fix admission and guidance helpers; the adapter closure and native service remain external.']}));
  }
  const lifecycle = await residentLifecycleTraces([fileURLToPath(import.meta.url)]);
  results.push(await checkTraces({model: 'ResidentRuntime', id: 'ResidentRuntime-lifecycle-native', scope: 'bounded-component',
    ...lifecycle, assumptions: [
      'Unmodified local-agent.ts is bundled with a synthetic Capacitor port and virtual time. All transitive implementation inputs are hashed before execution.',
      'Stop resolution, rejection and timeout are actual wrapper outcomes. Connect cancellation observes actual cancelStart calls and absent publication.',
      'The port assumes native owned-start/attached-start cancellation semantics. Actual AlphaLocalAgentPlugin lock/service behavior remains external.',
    ]}));
  const obligations = [
    {model: 'RendererRecovery', obligation: 'Activity lifecycle and visible escape behavior', reason: 'Current adapter projects the pure budget only.', requires: ['Android Activity/WebView harness']},
    {model: 'ResidentScheduling', obligation: 'Plugin lifecycle and OS broadcasts', reason: 'Current adapter proves the pure admission table and same-lock callbacks.', requires: ['Android service integration']},
    {model: 'VadSegmentation', obligation: 'PCM model output and capture pre-roll', reason: 'The gate consumes probabilities; capture/model execution is external.', requires: ['native capture integration']},
    {model: 'ResidentRuntime', obligation: 'Native plugin lifecycle and retained recovery records', reason: 'Provider helpers and actual renderer stop/connect-cancellation wrappers execute. AlphaLocalAgentPlugin lock/service behavior and the real resident remain outside this driver.'},
    {model: 'VoiceSession', obligation: 'Dictation, semantic endpoints, review resume and full barge-in interleavings', reason: 'One-turn/two-sentence actual controller traces cover mute, stop and account retirement with controlled ports.'},
    {model: 'SpeechResources', obligation: 'Combined native microphone/engine/focus lifecycle', reason: 'Capture reservation, PCM queue and focus helpers execute independently. Explicit-stop tail and native pipe ownership remain separate.'},
    {model: 'AlwaysOnListener', obligation: 'Consent store, ListeningEpoch and ListeningService integration', reason: 'Pairwise policy and indicator-loss cases execute without microphone, Android permissions or physical visibility.'},
    {model: 'ResetRecovery', obligation: 'Durable reset marker, listener-first retries and externally observed erasure', reason: 'This adapter executes ResetAuthorization only. An accepted package-clear request cannot establish erasure.'},
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
    const text = readFileSync(join(root, 'specs/quint/native', `${model}.qnt`), 'utf8');
    const missing = [...text.matchAll(/\baction\s+(\w+)/g)].map(match => match[1])
      .filter(name => !['init', 'check', 'step', 'initFor', 'counterInit', 'budgetInit'].includes(name) && !coveredActions.has(name));
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
