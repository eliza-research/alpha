import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {captureInputs, checkTraces} from '../specs/quint/refinement/check-traces.mjs';
import {parseBuildPolicy} from '../scripts/build-policy-source.ts';

const root = resolve(fileURLToPath(new URL('../specs/quint/refinement/services', import.meta.url)), '../../../..');
const probe = join(fileURLToPath(new URL('../specs/quint/refinement/services', import.meta.url)), 'combined-agent-launcher-probe.mjs');
const manifest = 'scripts/upstream-core-sources.ts';
const scenarios = [
  'node-version', 'source-mismatch', 'port-busy', 'profile-source', 'key-mode', 'speech',
  'unmarked', 'bad-marker', 'bad-routing', 'validate', 'validate-bad-marker', 'empty-input', 'core-refused',
  'independent', 'pinned', 'child-seven', 'signal-int', 'signal-term', 'spawn-error', 'metadata-write', 'metadata-stubborn',
];

function sourceInputs(extraSources) {
  const {files} = parseBuildPolicy(readFileSync(join(root, manifest)));
  return [
    'scripts/launcher-child.ts', 'scripts/start-combined-agent.ts', 'scripts/combined-agent-source.ts',
    'scripts/private-runtime-launch.ts', 'scripts/host-speech-admission.ts', 'scripts/speech-env.ts', 'scripts/host-speech-assets.json', 'scripts/agent-model.ts',
    'scripts/agent-identity.ts', 'apps/app/src/product/alpha-product-registration.ts',
    'scripts/core-state-patch.ts', 'scripts/core-state-preload.ts', 'scripts/build-policy-source.ts',
    'scripts/local-agent-source.ts', 'scripts/copy-file-clone.ts', manifest, 'upstream.lock.json',
    'vendor/eliza/packages/agent/native-host/private-runtime-launch.mjs',
    'vendor/eliza/packages/agent/native-host/private-runtime-json.mjs',
    'vendor/eliza/packages/app/scripts/lib/immutable-workspace-source.mjs',
    'vendor/eliza/packages/app/scripts/lib/committed-source.mjs',
    ...Object.keys(files).map(name => 'vendor/eliza/'+name),
    'test/fixtures/core-state-root.mjs', probe, fileURLToPath(import.meta.url), ...extraSources,
  ];
}

function runScenario(scenario) {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'combined-launch-')));
  const home = join(scratch, 'home');
  try {
    mkdirSync(home, {mode: 0o700});
    const env = {PATH: '/usr/bin:/bin', HOME: home, TMPDIR: scratch,
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null'};
    const result = spawnSync(process.execPath, [probe, scratch, scenario], {
      cwd: scratch, env, encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024,
    });
    if (result.error) throw result.error;
    assert.equal(result.signal, null, scenario+' failed: '+result.stderr);
    const trace = JSON.parse(readFileSync(join(scratch, 'report.json'), 'utf8'));
    assert.equal(trace.name, scenario);
    assert.equal(result.status, trace.steps.at(-1).expect['s.exitCode']);
    return trace;
  } finally {rmSync(scratch, {recursive: true, force: true});}
}

async function checkCombinedAgentLauncher(extraSources = []) {
  const sources = sourceInputs(extraSources);
  const driverHashes = captureInputs(sources);
  const traces = scenarios.map(runScenario);
  return checkTraces({model: 'CombinedAgentLauncher', sources, driverHashes, traces, scope: 'bounded-orchestration',
    assumptions: [
      'The exact launcher and its manifest, profile identity, routing, speech verification and core source admission helpers execute in a disposable repository. The Git workspace and speech bytes are synthetic.',
      'Module hooks replace only the launcher version, loopback probe and spawn ports, and observe its real private file operations. Each child is an actual synthetic Node process with a private IPC channel. External files, providers, and listeners are outside the fixture.',
      'Boot denotes the synthetic child acknowledging script execution over IPC. Launch metadata precedes that acknowledgment. Endpoint readiness requires a separate authenticated check.',
      'Receipt failure is captured before the launcher signals its returned child. A stubborn synthetic child ignores SIGTERM and is reaped after the bounded fallback. Competing launchers, external termination, HTTP readiness and actual agent execution are separate obligations.',
    ]});
}

test('combined launcher matches closed preflight, child custody and signal schedules', {timeout: 120000}, async () => {
  const receipt = await checkCombinedAgentLauncher([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.model, 'CombinedAgentLauncher');
  assert.equal(receipt.traces, 21);
  assert.ok(receipt.passed && receipt.driverInputsBound && receipt.inputsUnchanged);
  const last = name => receipt.traceInputs.find(trace => trace.name === name).steps.at(-1).expect;
  for (const [name, signal] of [['metadata-write', 'SIGTERM'], ['metadata-stubborn', 'SIGKILL']]) {
    const trace = receipt.traceInputs.find(row => row.name === name);
    const writeFailure = trace.steps.find(step => step.action.name === 'metadataFailure').expect;
    assert.equal(writeFailure['s.supervised'], true);
    assert.equal(writeFailure['s.childClosed'], false);
    const failure = last(name);
    assert.equal(failure['s.cleanupSignal'], signal);
    assert.equal(failure['s.childClosed'], true);
    assert.equal(failure['s.metadata'], false);
    assert.equal(failure['s.supervised'], false);
    assert.equal(failure['s.logOpen'], false);
    assert.equal(failure.ChildCustodyAfterLaunch, true);
  }
  assert.equal(last('core-refused')['s.spawnRequested'], false);
  assert.equal(last('core-refused')['s.logOpen'], false);
  assert.equal(last('empty-input')['s.token'], true);
  assert.equal(last('empty-input')['s.logOpen'], false);
  assert.equal(last('spawn-error')['s.metadataPid'], 0);
  assert.equal(last('spawn-error')['s.logOpen'], false);
  assert.equal(last('signal-term')['s.exitCode'], 1);
  assert.equal(last('child-seven')['s.exitCode'], 7);
});
