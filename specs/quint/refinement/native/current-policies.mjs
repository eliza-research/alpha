import {fileURLToPath} from 'node:url';
import {readdirSync} from 'node:fs';
import {join} from 'node:path';
import {captureInputs, checkTraces} from '../check-traces.mjs';
import {directory, javaTraces, root} from './java.mjs';
import {currentNativeSource, nativePatchInputs} from './current-sources.mjs';

const groups = [
  ['FinitePolicyTraces.java', ['LiveVadGate', 'RendererRecoveryBudget', 'ResidentScheduleRearm']],
  ['ComponentTraces.java', ['ResetAuthorization', 'LiveCaptureAdmission', 'SpeechPcmQueue', 'SpeechAudioFocusPolicy',
    'NativeReadEpoch', 'SelectedPhotoCopy', 'IndicatorLease', 'ListenerPolicy', 'CrashLoopBreaker']],
  ['JournalTraces.java', ['DeferredDeletionJournal', 'DeletionDeadline', 'BufferedStreamExchange']],
  ['SmsJournalTraces.java', ['SmsSendJournal']],
  ['PlaybackTraces.java', ['StreamingSpeechPlayback', 'SpeechPcmQueue', 'SpeechAudioFocusPolicy', 'VoiceLatencyTrials']],
  ['ProducerTraces.java', ['SenseListeningPolicy', 'SenseListeningLease']],
];

export async function checkCurrentPolicies(selected = [], extraSources = []) {
  const receipts = [];
  for (const [harness, names] of groups.filter(([harness]) => selected.length === 0 || selected.includes(harness))) {
    const compiled = names.map(name => currentNativeSource(name + '.java'));
    if (harness === 'ProducerTraces.java') {
      const stubs = 'vendor/eliza/packages/app/test/android/sense-fixtures/systemui-chip-jvm';
      compiled.push(...readdirSync(join(root, stubs), {recursive: true})
        .filter(name => name.endsWith('.java')).map(name => join(stubs, name)));
    }
    const sources = [...compiled, ...nativePatchInputs, directory + '/' + harness, directory + '/Trace.java',
      directory + '/java.mjs', directory + '/current-sources.mjs', fileURLToPath(import.meta.url), ...extraSources];
    const driverHashes = captureInputs(sources);
    const traces = javaTraces(harness, compiled, [], harness === 'ProducerTraces.java' ? 'com.android.systemui.privacy.ProducerTraces' : harness === 'SmsJournalTraces.java' ? 'ai.eliza.plugins.messages.SmsJournalTraces' : undefined);
    for (const [model, values] of Object.entries(traces)) receipts.push(await checkTraces({
      model, id: model + '-current-policies', sources, driverHashes, traces: values,
      scope: harness === 'FinitePolicyTraces.java' ? 'complete-finite-helper' : 'bounded-component',
      assumptions: [...(model === 'VadSegmentation'
        ? ['All18 reachable counter states and11 actual float comparison classes plus close. Inputs include NaN, both infinities,0.35f,0.5f and adjacent representative classes.']
        : model === 'RendererRecovery'
        ? ['Loss count classes0..4+ use the source saturation fix. Elapsed time classes cover below/at/above60000ms, equality and backwards time; a10000-loss prefix verifies saturation.']
        : model === 'ResidentScheduling'
        ? ['Five event classes, both unlock/package/owner values and three lifecycle classes enumerate the source admission table; admitAndStart holds one actual shared lock.'] : []),
        'The current pinned shared classes execute directly. Authenticated native staging and its manifest are bound in the receipt.',
        'Pure helper finite partitions and bounded source schedules retain their documented limits. Android providers and physical effects remain external.'],
    }));
  }
  return receipts;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await checkCurrentPolicies(process.argv.slice(2)), null, 2));
