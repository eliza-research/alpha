import assert from 'node:assert/strict';
import {mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInputs, checkTraces} from '../check-traces.mjs';
import {app, javaTraceCampaign, root} from './java.mjs';
import {jsonJar} from '../../../../test/fixtures/jvm-tools.mjs';
import {upstreamNativeSource} from '../../../../scripts/upstream-native-source.ts';

const model = 'RuntimeUpdatePause';
const driver = fileURLToPath(import.meta.url);
const here = fileURLToPath(new URL('./', import.meta.url));
const plugin = app+'AlphaDevicePlugin.java';
const updater = 'vendor/eliza/plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/updater/RuntimeUpdatePause.java';
const stubs = 'test/fixtures/app-update-jvm';
const shared = [
  'vendor/eliza/packages/app/platforms/android/app/src/main/java/ai/elizaos/app/ElizaAgentService.java',
  'vendor/eliza/plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/runtime/CredentialShutdownLease.java',
];

function extractWrapper(source) {
  const start = source.indexOf(' static final class UpdatePause {');
  const end = source.indexOf(' private static final class UpdateActivation', start);
  const hex = source.match(/ static String hex\(byte\[\] digest\)\{[^\n]+/)?.[0];
  const signer = source.slice(source.indexOf(' static String appSigner('), source.indexOf(" /**\n  * A session's binding:"));
  assert.ok(start > 0 && end > start && hex && signer.includes('signingRoot'), 'actual native update wrapper anchors');
  return `package ai.elizaresearch.alphaphone;
import android.content.Context;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.os.Build;
import android.provider.Settings;
final class AlphaDevicePlugin {
 static Object activation;
${hex}
${signer}
${source.slice(start,end)}
}
`;
}

function reopen(first, next) {
  assert.notEqual(first.pid, next.pid, 'journal reopened by a fresh JVM process');
  const state = next.trace.expect;
  first.trace.steps.push({label: 'a fresh JVM configures admission against the same durable path',
    action: {name: 'reopen', args: [state['s.executingCode'], state['s.executingDigest'], state['s.evidence']]}, expect: state},
  ...next.trace.steps);
  return first.trace;
}

export async function checkRuntimeUpdatePause(extraSources = []) {
  const fixtureFiles = readdirSync(join(root, stubs), {recursive: true}).filter(path => path.endsWith('.java'))
    .map(path => join(stubs, path)).sort();
  const sources = [driver, join(here, 'RuntimeUpdatePauseTraces.java'), join(here, 'Trace.java'), join(here, 'java.mjs'),
    'test/fixtures/jvm-tools.mjs', 'scripts/upstream-native-source.ts', 'upstream.lock.json', plugin, updater, ...shared, ...fixtureFiles,
    ...(jsonJar ? [jsonJar] : []), ...extraSources];
  const driverHashes = captureInputs(sources);
  const relativeUpdater = updater.slice('vendor/eliza/'.length);
  const pinnedUpdater = upstreamNativeSource(root).read(relativeUpdater).get(relativeUpdater);
  assert.equal(driverHashes[join(root, updater)], pinnedUpdater.sha256, 'compiled journal must match its pinned blob');
  const directory = mkdtempSync(join(tmpdir(), 'quint-update-pause-'));
  const traces = [], skipped = [];
  try {
    const wrapper = join(directory, 'AlphaDevicePlugin.java');
    writeFileSync(wrapper, extractWrapper(readFileSync(join(root, plugin), 'utf8')));
    const modes = ['baseline-release', 'package-evidence', 'precommit-binding', 'different-boot',
      'trailing', 'oversize', 'symlink', 'bad', 'ambiguous-release', 'ambiguous-publication'];
    const args = [...modes.map(mode => [mode, join(directory, mode)]),
      ['old-target', join(directory, 'target')], ['new-target', join(directory, 'target')],
      ['old-baseline', join(directory, 'baseline')], ['new-baseline', join(directory, 'baseline')]];
    const outputs = javaTraceCampaign('RuntimeUpdatePauseTraces.java', [wrapper, updater, ...fixtureFiles], args);
    for (const [index, mode] of modes.entries()) {
      const result = outputs[index];
      if (result.skip) skipped.push({mode, reason: result.skip});
      else traces.push(result.trace);
    }
    traces.push(reopen(outputs.at(-4), outputs.at(-3)), reopen(outputs.at(-2), outputs.at(-1)));
  } finally {rmSync(directory, {recursive: true, force: true});}

  const receipt = await checkTraces({model, traces, sources, driverHashes, scope: 'bounded-orchestration', assumptions: [
    'The pinned RuntimeUpdatePause owns actual POSIX lock, binary record, staging, atomic rename and sync. Exact extracted AlphaDevicePlugin.UpdatePause methods run over controlled Android PackageInstaller, APK and shutdown ports.',
    'Fresh JVM processes reopen the same private filesystem path. One synthetic baseline and successor, one session and two owner symbols. The outer bridge activation is idle and worker retirement is driven at the caller boundary.',
    'On unprivileged POSIX the journal directory is writeable/searchable but cannot be opened for read. The native rename can become visible before the attempted directory force fails. Both update start admission and retained lease are observed independently.',
    ...skipped.map(({mode, reason}) => `Host capability omitted ${mode}: ${reason}.`),
  ]});
  return {receipt, skipped, obligations: [
    {model, obligation: 'Resolve a visible tombstone with unconfirmed durability and an owned service lease',
      reason: 'After an ambiguous terminal rename, update journal readback admits startup but the wrapper still owns the separate shutdown lease. Retrying a missing record proves no release authority.'},
    {model, obligation: 'Verify Android filesystem and installation ports',
      reason: 'Host filesystem and stub PackageInstaller schedules do not establish Android power-loss or install behavior.'},
  ]};
}
