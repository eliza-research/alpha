import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {captureInputs, checkTraces} from '../specs/quint/refinement/check-traces.mjs';
import {app, directory, javaTraceCampaign} from '../specs/quint/refinement/native/java.mjs';

const model = 'ReviewedCopies';
const harness = 'ReviewedCopiesTraces.java';
const media = 'vendor/eliza/plugins/plugin-native-media/android/src/main/java/ai/eliza/plugins/media/';
const stubs = 'test/fixtures/reviewed-copies-jvm/';
const compiled = [app + 'ReviewedCopies.java', app + 'AlphaMailFileProvider.java',
  media + 'ReviewedFileHandoff.java', media + 'DocumentExport.java',
  ...['android/content/Context.java', 'android/content/Intent.java', 'android/net/Uri.java',
    'android/os/ParcelFileDescriptor.java', 'androidx/core/content/FileProvider.java'].map(name => stubs + name)];
const scenarios = ['concurrent-load', 'concurrent-write', 'retry-first-sweep', 'owner-cancel', 'expiry', 'provider', 'failed-write'];

async function checkReviewedCopies(extraSources = []) {
  const sources = [...compiled, `${directory}/${harness}`, `${directory}/Trace.java`, `${directory}/java.mjs`,
    app + 'AlphaMailAttachmentsPlugin.java', 'android/app/src/main/res/xml/mail_attachment_paths.xml',
    'android/app/src/main/AndroidManifest.xml', fileURLToPath(import.meta.url), ...extraSources];
  const driverHashes = captureInputs(sources);
  const traces = javaTraceCampaign(harness, compiled, scenarios.map(name => [name]));
  return checkTraces({model, sources, driverHashes, traces, scope: 'bounded-component', assumptions: [
    'One process, two ReviewedCopies owners and at most five unique cache paths. Each scenario has a fresh JVM with real host files.',
    'Actual cache synchronization, exact-byte writes, expiry and provider methods execute. The Android base provider and grant-revocation call are controlled ports.',
    'Latch schedules independently hold the first directory listing against a peer load and peer write. The port observes blocking, then actual file and registry ownership.',
    'The provider cases exercise read-only access, path validation, physically expired and future timestamps. Kernel descriptor transfer and Binder/grant enforcement remain external.',
    'Synchronous write entry/settlement are recorded together. Off-lock cancellation during byte I/O and physical deletion failure remain separate source obligations.',
  ]});
}

const reviewedCopiesObligations = [
  {model, obligation: 'Installed review, viewer lifecycle and Android URI grants', reason: 'The actual helper and FileProvider override execute on a host. Capacitor/Activity timing, Binder permission enforcement, Android descriptor ownership and restart are separate evidence.'},
  {model, obligation: 'Mid-write cancellation, unlink failures and wider filesystem schedules', reason: 'The host checks held listings against peer loads/writes, successful unlink and a failed byte write. It does not force a cancellation inside real filesystem write/sync or emulate Android filesystem failures.'},
];

test('real reviewed attachment cache and provider observations match the bounded model', async () => {
  const receipt = await checkReviewedCopies();
  assert.equal(receipt.traces, 7);
  assert.equal(receipt.driverInputsBound, true);
  assert.ok(receipt.actions.providerOpen > 0);
  assert.ok(receipt.observedFields.includes('s.owners'));
});
