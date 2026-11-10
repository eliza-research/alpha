import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInputs, checkTraces} from '../check-traces.mjs';

const root = resolve(import.meta.dirname, '../../../..');
const probe = join(import.meta.dirname, 'combined-agent-launcher-probe.mjs');
const manifest = 'patches/eliza/core-state-manifest.json';
const scenarios = [
  'node-version', 'source-mismatch', 'port-busy', 'profile-source', 'key-mode', 'speech',
  'unmarked', 'bad-marker', 'bad-routing', 'validate', 'validate-bad-marker', 'empty-input', 'core-refused',
  'independent', 'pinned', 'child-seven', 'signal-int', 'signal-term', 'spawn-error', 'metadata-write', 'metadata-stubborn',
];

function sourceInputs(extraSources) {
  const {patches} = JSON.parse(readFileSync(join(root, manifest), 'utf8'));
  return [
    'scripts/launcher-child.ts', 'scripts/start-combined-agent.ts', 'scripts/combined-agent-source.ts',
    'scripts/host-speech-admission.ts', 'scripts/host-speech-assets.json', 'scripts/agent-model.ts',
    'scripts/agent-identity.ts', 'config/alpha-product.json',
    'scripts/core-state-patch.ts', 'scripts/core-state-preload.ts',
    'scripts/local-agent-source.ts', 'scripts/copy-file-clone.ts', manifest, 'upstream.lock.json',
    'vendor/eliza/packages/agent/native-host/private-runtime-launch.mjs',
    'vendor/eliza/packages/agent/native-host/private-runtime-json.mjs',
    'vendor/eliza/packages/app/scripts/lib/immutable-workspace-source.mjs',
    'vendor/eliza/packages/app/scripts/lib/committed-source.mjs',
    ...patches.flatMap(patch => ['patches/eliza/'+patch.file, ...patch.targets.map(target => 'vendor/eliza/'+target.path)]),
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

export async function checkCombinedAgentLauncher(extraSources = []) {
  const sources = sourceInputs(extraSources);
  const driverHashes = captureInputs(sources);
  const traces = scenarios.map(runScenario);
  return checkTraces({model: 'CombinedAgentLauncher', sources, driverHashes, traces, scope: 'bounded-orchestration',
    assumptions: [
      'The exact launcher and its manifest, profile identity, routing, speech verification and core patch admission helpers execute in a disposable repository. The Git workspace and speech bytes are synthetic.',
      'Module hooks replace only the launcher version, loopback probe and spawn ports, and observe its real private file operations. Each child is an actual synthetic Node process with a private IPC channel. External files, providers, and listeners are outside the fixture.',
      'Boot denotes the synthetic child acknowledging script execution over IPC. Launch metadata precedes that acknowledgment. Endpoint readiness requires a separate authenticated check.',
      'Receipt failure is captured before the launcher signals its returned child. A stubborn synthetic child ignores SIGTERM and is reaped after the bounded fallback. Competing launchers, external termination, HTTP readiness and actual agent execution are separate obligations.',
    ]});
}
