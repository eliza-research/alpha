import assert from 'node:assert/strict';
import {mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInputs, checkTraces, qset} from '../check-traces.mjs';
import {app, directory, javaTraceCampaign, root} from './java.mjs';

const model = 'NativeUpdateActivation';
const driver = fileURLToPath(import.meta.url);
const product = app + 'AlphaDevicePlugin.java';
const journal = 'vendor/eliza/plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/updater/RuntimeUpdatePause.java';
const stubRoot = 'test/fixtures/app-update-jvm';
const fixtures = [app + 'PluginWorkers.java', journal, 'test/fixtures/UpdateFlowTest.java',
  ...readdirSync(join(root, stubRoot), {recursive: true}).filter(file => file.endsWith('.java')).map(file => join(stubRoot, file))];
const scenarioNames = [
  'foreign-and-duplicate-with-pre-ready-join',
  'new-bridge-after-ready-before-seal',
  'retirement-cannot-satisfy-draft-barrier',
  'stale-receipt-after-a-refused-attempt',
  'post-seal-confirmation-preserves-initiating-reconnect',
  'eligible-mounted-sibling-keeps-confirmation-reconnect',
  'retired-confirmation-owner-cannot-nominate-arbitrary-settler',
  'old-and-startup-ack-can-prepare-but-cannot-reconnect',
];

export function exactUpdateMembers(source) {
  const start = source.indexOf(' static final long UPDATE_MAX_BYTES=');
  const end = source.lastIndexOf('}');
  const handOff = /^ private static Intent handOff\(Intent intent\)\{[^\n]*$/m.exec(source)?.[0];
  const foreground = / static boolean shareForeground\(android\.app\.Activity activity\)\{[\s\S]*?\n \}/.exec(source)?.[0];
  assert.ok(start > 0 && end > start && handOff && foreground, 'Exact updater method slice exists');
  return `package ai.alphacompute.alphaphone;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.*;
final class AlphaDevicePlugin extends Plugin {
 private final java.util.concurrent.ExecutorService diagnosticsWorker=java.util.concurrent.Executors.newSingleThreadExecutor();
${handOff}
${foreground}
${source.slice(start, end)}}
`;
}

export async function runNativeUpdateActivationRefinement(extraSources = []) {
  const harness = 'UpdateBarrierHarness.java';
  const sources = [driver, product, ...fixtures, join(directory, 'java.mjs'),
    join(directory, 'Trace.java'), join(directory, harness), ...extraSources];
  const driverHashes = captureInputs(sources);
  const temporary = mkdtempSync(join(tmpdir(), 'alpha-update-barrier-source-'));
  let traces;
  try {
    const members = join(temporary, 'AlphaDevicePlugin.java');
    writeFileSync(members, exactUpdateMembers(readFileSync(join(root, product), 'utf8')));
    traces = javaTraceCampaign(harness, [members, ...fixtures], scenarioNames.map(name => [name])).flat();
  } finally {
    rmSync(temporary, {recursive: true, force: true});
  }
  assert.deepEqual(traces.map(trace => trace.name), scenarioNames);
  for (const trace of traces) {
    for (const observation of [trace.expect, ...trace.steps.map(step => step.expect)]) {
      for (const key of ['s.registered', 's.seen', 's.waiting', 's.acknowledged', 's.eligible', 's.preparedEligible']) observation[key] = qset(observation[key]);
    }
  }
  const receipt = await checkTraces({model, traces, sources, driverHashes, scope: 'bounded-orchestration', assumptions: [
    'The unmodified updater methods execute with synthetic Android/Capacitor ports and the real pinned RuntimeUpdatePause implementation. Network input comes from an in-memory fixture; no APK is installed.',
    'Three bridge instance classes, two exact activation UUID classes, one staged attempt and one pending synthetic installer session. Sealing and the observed stop request are two model actions in one source checkpoint.',
    'The exact sealed reconnect receipt is independent of Android confirmation ownership. Old or startup ACKs can prepare without granting reconnect. The terminal audience is retired without a handoff.',
  ]});
  return {receipts: [receipt], obligations: [
    {model, obligation: 'Installed activity lifecycle and Android session delivery',
      reason: 'The source harness controls bridge notifications, stop confirmation and installer status. Actual PackageInstaller and WebView lifecycles require their own acceptance evidence.'},
    {model, obligation: 'Mounted resume eligibility and one-shot reconnect',
      reason: 'This model observes exact native resume readback. MountedUpdateAdmission and StartupUpdateAdmission check the patched renderer request shapes separately. Installed cross-bridge callback delivery remains external.'},
  ]};
}
