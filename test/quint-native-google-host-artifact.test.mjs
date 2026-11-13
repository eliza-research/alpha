import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, realpathSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {coreStateReceipt} from '../scripts/core-state-patch.ts';
import {captureInputs, checkTraces} from '../specs/quint/refinement/check-traces.mjs';

const repository = resolve(fileURLToPath(new URL('../specs/quint/refinement/services', import.meta.url)), '../../../..');
const probe = join(fileURLToPath(new URL('../specs/quint/refinement/services', import.meta.url)), 'native-google-host-artifact-probe.mjs');

function runProbe(args = []) {
  // Node reports the physical cwd on macOS; pass the same owned directory to the probe.
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'quint-native-google-host-')));
  try {
    const home = join(scratch, 'home');
    mkdirSync(home, {mode: 0o700});
    const identity = {NAME: 'Fixture', EMAIL: 'fixture@example.invalid'};
    const result = spawnSync(process.execPath, [probe, scratch, ...args], {
      cwd: scratch, encoding: 'utf8', maxBuffer: 2*1024*1024, timeout: scaledTimeout(90000),
      env: {PATH: '/usr/bin:/bin', HOME: home, TMPDIR: scratch, GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null', GIT_ALLOW_PROTOCOL: 'file',
        GIT_AUTHOR_NAME: identity.NAME, GIT_AUTHOR_EMAIL: identity.EMAIL,
        GIT_COMMITTER_NAME: identity.NAME, GIT_COMMITTER_EMAIL: identity.EMAIL},
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  } finally {rmSync(scratch, {recursive: true, force: true});}
}

function checkNativeGoogleHostLoaderCompatibility(bun) {
  return runProbe([resolve(bun)]);
}

async function checkNativeGoogleHostArtifact(extraSources = []) {
  const core = coreStateReceipt(repository);
  const sources = [
    fileURLToPath(import.meta.url), probe, 'specs/quint/refinement/timeouts.mjs', 'test/fixtures/native-google-host-builder-port.mjs', 'test/fixtures/core-state-root.mjs',
    'scripts/native-google-host-artifact.ts', 'scripts/build-native-google-host.ts', 'scripts/workflow-worker-artifact.ts',
    'scripts/local-agent-source.ts', 'scripts/copy-file-clone.ts', 'scripts/prepare-client-features.ts',
    'scripts/upstream-native-source.ts', 'vendor/eliza/packages/app/src/runtime/managed-google-agent/managed-google-agent-host.ts',
    'package.json', 'tsconfig.json', 'upstream.lock.json', 'vendor/eliza/tsconfig.json',
    'vendor/eliza/packages/app/scripts/lib/immutable-workspace-source.mjs',
    'vendor/eliza/packages/app/scripts/lib/committed-source.mjs',
    ...Object.keys(core.inputHashes), ...Object.keys(core.files).map(name => 'vendor/eliza/'+name),
    ...extraSources,
  ];
  const driverHashes = captureInputs(sources);
  for (const [name, digest] of Object.entries(core.inputHashes)) assert.equal(driverHashes[resolve(repository,name)], digest);
  const traces = runProbe();
  return checkTraces({model: 'NativeGoogleHostArtifact', sources, driverHashes, traces, scope: 'bounded-orchestration',
    assumptions: [
      'The actual native Google host artifact producer wrapper, TypeScript builder, immutable SDK verification and worker/host readback execute with a synthetic Git SDK and private worker output. Client projection, compiler output and version are controlled ports.',
      'The compiler port invokes actual resolver, source capture and selected core interception callbacks. Output embeds the digest of the bytes those callbacks returned, while the actual wrapper validates the exact source binding and candidate.',
      'One product input, two file identities, one selected worker output and one representative optional core source observation. The other generic worker inputs remain fixed.',
      'Build outcomes group actual port events and definite serial publication refusals. The old pair is checked by exact bytes and mode. Concurrent writers, crash recovery, full product compiler graph, Android staging and installed host execution remain separate.',
    ]});
}

test('native Google host candidate binds emitted and compiled source bytes and preserves the previous pair', {timeout: scaledTimeout(120000)}, async () => {
  const receipt = await checkNativeGoogleHostArtifact([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.traces, 18);
  assert.ok(receipt.passed && receipt.driverInputsBound && receipt.inputsUnchanged);
  const drift = receipt.traceInputs.find(trace => trace.name.startsWith('coherent drift'));
  assert.ok(drift.steps.some(step => step.expect['s.outcome'].result === 'source'
    && step.expect.ReceiptBindsCompiledSource && step.expect.workerReady));
  const preservedPairs = receipt.traceInputs.filter(trace => trace.name.endsWith('previous exact pair intact'));
  assert.equal(preservedPairs.length, 12);
  assert.ok(preservedPairs.every(trace => trace.steps.some(step => step.expect['s.outcome'].operation === 'build'
    && step.expect['s.outcome'].result !== 'accepted' && step.expect.workerReady && step.expect.FailedBuildPreservesPriorPair)));
  const outputDrift = preservedPairs.find(trace => trace.name.startsWith('output-drift'));
  assert.ok(outputDrift.steps.some(step => step.expect['s.outcome'].result === 'candidate'
    && step.expect['s.attempt'].metadata));
});

test('pinned Bun preserves real loader semantics and the exact reviewed core bytes in the host graph', {
  skip: !process.env.ALPHA_QUINT_BUN && 'set ALPHA_QUINT_BUN to the pinned Bun 1.4.2 binary',
  timeout: scaledTimeout(30000),
}, () => {
  const result = checkNativeGoogleHostLoaderCompatibility(process.env.ALPHA_QUINT_BUN);
  assert.equal(result.bun, '1.4.2');
  assert.equal(result.graphInputsChecked, 13);
  assert.equal(result.rawCoreInput, result.effectiveCoreInput);
});
