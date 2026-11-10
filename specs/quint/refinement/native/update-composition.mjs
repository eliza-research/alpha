import assert from 'node:assert/strict';
import {mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {upstreamNativeSource} from '../../../../scripts/upstream-native-source.mjs';
import {jsonJar} from '../../../../test/fixtures/jvm-tools.mjs';
import {captureInputs, checkTraces, qset} from '../check-traces.mjs';
import {app, directory, javaTraceCampaign, root} from './java.mjs';
import {exactUpdateMembers} from './update-barrier.mjs';

const model = 'NativeUpdateComposition';
const product = app + 'AlphaDevicePlugin.java';
const journal = 'plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/updater/RuntimeUpdatePause.java';
const lease = 'plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/runtime/CredentialShutdownLease.java';
const fixtureRoot = 'test/fixtures/app-update-jvm';
const fixtures = readdirSync(join(root, fixtureRoot), {recursive: true})
  .filter(file => file.endsWith('.java') && !file.endsWith('/AlphaLocalAgentPlugin.java'))
  .map(file => join(fixtureRoot, file)).sort();
const modes = ['refused-before-pause', 'exact-canceled-release', 'ambiguous-terminal-sync',
  'cold-automatic-before-barrier', 'cold-manual-before-barrier', 'warm-process-before-barrier', 'unsupported-before-barrier'];
const setFields = ['registered', 'seen', 'waiting', 'acknowledged', 'eligible', 'preparedEligible'].map(name => 'state.activation.' + name);

export async function checkNativeUpdateComposition(extraSources = []) {
  const harness = 'UpdateCompositionHarness.java';
  const compiled = [app + 'PluginWorkers.java', 'vendor/eliza/' + journal, 'vendor/eliza/' + lease,
    'test/fixtures/UpdateFlowTest.java', ...fixtures, join(directory, 'UpdateCompositionResidentPort.java')];
  const sources = [fileURLToPath(import.meta.url), product, ...compiled, join(directory, harness),
    join(directory, 'Trace.java'), join(directory, 'java.mjs'), join(directory, 'update-barrier.mjs'),
    app + 'AlphaLocalAgentPlugin.java', 'scripts/upstream-native-source.mjs', 'upstream.lock.json',
    'test/fixtures/jvm-tools.mjs', 'specs/quint/native/NativeUpdateStaging.qnt', ...(jsonJar ? [jsonJar] : []), ...extraSources];
  const driverHashes = captureInputs(sources);
  const upstream = upstreamNativeSource(root);
  for (const path of [journal, lease]) {
    assert.equal(driverHashes[join(root, 'vendor/eliza', path)], upstream.read(path).get(path).sha256);
  }
  const temporary = mkdtempSync(join(tmpdir(), 'quint-update-composition-source-'));
  let results;
  try {
    const members = join(temporary, 'AlphaDevicePlugin.java');
    writeFileSync(members, exactUpdateMembers(readFileSync(join(root, product), 'utf8')));
    results = javaTraceCampaign(harness, [members, ...compiled], modes.map(mode => [mode]));
  } finally {
    rmSync(temporary, {recursive: true, force: true});
  }
  const traces = [], skipped = [];
  for (const [index, {trace, skip}] of results.entries()) {
    if (skip) {
      assert.equal(modes[index], 'ambiguous-terminal-sync');
      skipped.push({mode: modes[index], reason: skip});
      continue;
    }
    assert.equal(trace.name, modes[index]);
    for (const observation of [trace.expect, ...trace.steps.map(step => step.expect)]) {
      for (const field of setFields) observation[field] = qset(observation[field]);
    }
    traces.push(trace);
  }

  const receipt = await checkTraces({model, traces, sources, driverHashes, scope: 'bounded-orchestration', assumptions: [
    'The exact updater executes with the pinned journal and real CredentialShutdownLease policy. The JVM controls the resident stop observation and Android installer ports.',
    'The fixture observes the actual pre-stop durable write, confirmed stop, COMMITTING row, session handoff and exact cancellation. One activation and one session are retained across the selected cuts.',
    'After the journal rename and directory-sync refusal, the exact sealed reconnect receipt retains the logical pending session even though the physical row reads empty. Startup mount and resident lease admission are recorded separately.',
    'The admission composition uses SDK classes below31 and at-least31, uptime samples 0,26681,29999,30000,30001,35000, at most two boots and two process identities. Its process replacement/reboot cuts occur only before an activation; the unchanged standalone journal model owns in-flight process-death and durable-session recovery.',
    'Actual extracted Java calls at cold/unsupported cutpoints resolve directly and leave activation, journal, shutdown lease, resident stop and commit absent. The separate staging trace also shuts down the executor before refusal. After monotonic uptime reaches30001, the automatic path crosses the same exact barrier and durable handoff. Manual admission at uptime0 remains unchanged.',
    'These bounded safety and selected source traces do not prove boot clock progress, network availability, Android silent installation or eventual completion. Those require environment assumptions and installed-device evidence.',
    ...skipped.map(({mode, reason}) => `Host capability omitted ${mode}: ${reason}.`),
  ]});
  return {receipt, skipped, obligations: [
    {model, obligation: 'Unconfirmed terminal durability and retained resident lease',
      reason: 'The physical tombstone can release the renderer mount while the real service-lease policy still fences startup. The source provides no repeatable terminal authority for that empty record.'},
    {model, obligation: 'Other install/restart schedules and installed platform delivery',
      reason: 'Standalone campaigns cover additional journal outcomes and boot identity. This composition uses one attempt and a controlled PackageInstaller with synthetic renderer receipts.'},
  ]};
}
