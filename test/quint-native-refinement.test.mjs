import assert from 'node:assert/strict';
import test from 'node:test';
import {readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import {captureInputs, checkTraces} from '../specs/quint/refinement/check-traces.mjs';
import {app, sense, voice, directory, javaTraces, root} from '../specs/quint/refinement/native/java.mjs';
import {captureRendererImplementation, voiceTraces} from '../specs/quint/refinement/native/renderer.mjs';
import {residentLifecycleTraces} from '../specs/quint/refinement/native/local-agent.mjs';
import {checkResetOrchestration} from '../specs/quint/refinement/native/reset-orchestration.mjs';
import {checkDeletionCoordinator} from '../specs/quint/refinement/native/deletion-coordinator.mjs';
import {checkCredentialCoordinator} from '../specs/quint/refinement/native/credential-coordinator.mjs';
import {checkKeyboardDictation} from '../specs/quint/refinement/native/keyboard-dictation.mjs';
import {checkTelephonyAttention, checkTelephonyContactsBook, checkTelephonyMessageThreads, checkTelephonyPhoneCalls, checkTelephonyVoicemail} from '../specs/quint/refinement/native/telephony.mjs';

// Native source campaigns whose Java or TypeScript harness covers several models at once. Each
// compiles and runs the product source against the models' transitions; a model with a single
// adapter has its own test file.
const driver = fileURLToPath(import.meta.url);
const options = {timeout: scaledTimeout(600000)};
const passed = receipts => {
  assert.ok(receipts.length > 0);
  for (const receipt of receipts) {
    assert.ok(receipt.checkpoints > 0, receipt.model);
    assert.equal(receipt.driverInputsBound, true, `${receipt.model} driver inputs`);
    assert.equal(receipt.passed, true, receipt.model);
  }
};
const producerSources = () => {
  const stubs = 'vendor/eliza/packages/app/test/android/sense-fixtures/systemui-chip-jvm';
  return readdirSync(join(root, stubs), {recursive: true}).filter(name => name.endsWith('.java')).map(name => join(stubs, name))
    .concat(['SenseListeningPolicy.java', 'SenseListeningLease.java'].map(name => `vendor/eliza/packages/os/android/sense/systemui/chip/source/${name}`));
};
const actionJournal = 'vendor/eliza/plugins/plugin-native-action-journal/android/src/main/java/ai/eliza/plugins/actionjournal/deletion/';
const javaGroups = [
  ['FinitePolicyTraces.java', [voice + 'LiveVadGate.java', app + 'RendererRecoveryBudget.java', app + 'ResidentScheduleRearm.java']],
  ['ComponentTraces.java', [
    'vendor/eliza/plugins/plugin-native-system/android/src/main/java/ai/eliza/plugins/system/reset/ResetAuthorization.java',
    ...['LiveCaptureAdmission.java', 'SpeechPcmQueue.java', 'SpeechAudioFocusPolicy.java'].map(name => voice + name),
    app + 'NativeReadEpoch.java',
    'vendor/eliza/plugins/plugin-native-media/android/src/main/java/ai/eliza/plugins/media/SelectedPhotoCopy.java',
    ...['IndicatorLease.java', 'ListenerPolicy.java', 'CrashLoopBreaker.java'].map(name => sense + name),
  ]],
  ['JournalTraces.java', [
    ...['DeferredDeletionJournal.java', 'DeletionDeadline.java'].map(name => actionJournal + name),
    'vendor/eliza/plugins/plugin-native-messages/android/src/main/java/ai/eliza/plugins/messages/SmsSendJournal.java',
    voice + 'BufferedStreamExchange.java',
  ], 'ai.eliza.plugins.messages.JournalTraces'],
  ['PlaybackTraces.java', ['StreamingSpeechPlayback.java', 'SpeechPcmQueue.java', 'SpeechAudioFocusPolicy.java', 'VoiceLatencyTrials.java'].map(name => voice + name)],
  ['ResidentTraces.java', [
    'vendor/eliza/plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/runtime/NativeProviderAdmission.java',
    'vendor/eliza/plugins/plugin-native-agent/test/provider-admission/NativeProviderAdmissionTest.java',
  ], 'ai.eliza.plugins.agent.runtime.ResidentTraces'],
  ['ProducerTraces.java', producerSources, 'com.android.systemui.privacy.ProducerTraces'],
];

for (const [harness, sourceList, main] of javaGroups) {
  test(`${harness} runs the Java sources against each model it traces`, options, async () => {
    const sources = typeof sourceList === 'function' ? sourceList() : sourceList;
    const inputs = [...sources, `${directory}/${harness}`, `${directory}/Trace.java`, `${directory}/java.mjs`, driver];
    const driverHashes = captureInputs(inputs);
    const receipts = [];
    for (const [model, traces] of Object.entries(javaTraces(harness, sources, [], main))) {
      receipts.push(await checkTraces({model, id: `${model}-native`, sources: inputs, driverHashes, traces,
        scope: ['VadSegmentation', 'ResidentScheduling'].includes(model) ? 'complete-finite-helper' : 'bounded-component',
        assumptions: ['Production Java helpers execute with controlled environment inputs; Android services and devices are outside this check.']}));
    }
    passed(receipts);
  });
}

test('the voice assistant session follows VoiceSession', options, async () => {
  const renderer = await captureRendererImplementation([driver]);
  passed([await checkTraces({model: 'VoiceSession', id: 'VoiceSession-native', scope: 'bounded-component',
    traces: await voiceTraces(renderer.implementation), sources: renderer.sources, driverHashes: renderer.driverHashes,
    assumptions: ['The TypeScript session runs with controlled capture, reply, playback and timer inputs, bounded to two sentences and one turn.']})]);
});

test('the local agent wrapper follows ResidentRuntime', options, async () => {
  passed([await checkTraces({model: 'ResidentRuntime', id: 'ResidentRuntime-lifecycle-native', scope: 'bounded-component',
    ...await residentLifecycleTraces([driver]),
    assumptions: ['local-agent.ts is bundled with a synthetic Capacitor port and virtual time; the native plugin is outside this check.']})]);
});

test('reset orchestration follows ResetRecovery', options, async () => {
  const reset = await checkResetOrchestration([driver]);
  assert.deepEqual(reset.results.filter(result => result.status !== 'passed'), []);
  passed(reset.receipts);
});

for (const check of [checkDeletionCoordinator, checkCredentialCoordinator, checkKeyboardDictation, checkTelephonyMessageThreads,
  checkTelephonyVoicemail, checkTelephonyAttention, checkTelephonyPhoneCalls, checkTelephonyContactsBook]) {
  test(`${check.name} runs the native source against its model`, options, async () => {
    const result = await check([driver]);
    passed(result?.receipts ?? (Array.isArray(result) ? result : [result?.receipt ?? result]));
  });
}
