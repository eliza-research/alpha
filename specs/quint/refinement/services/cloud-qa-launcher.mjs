import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {CORE_STATE_MANIFEST, coreStateReceipt} from '../../../../scripts/core-state-patch.ts';
import {captureInputs, checkTraces} from '../check-traces.mjs';

const root = resolve(import.meta.dirname, '../../../..');
const probe = join(import.meta.dirname, 'cloud-qa-launcher-probe.mjs');
const scenarios = [
  'relative-profile', 'protected-port', 'key-mode', 'missing-model', 'personal-profile', 'missing-entry',
  'wrong-route', 'invalid-token', 'fresh-default', 'saved-profile', 'exit-seven', 'no-pid',
  'revision-read', 'receipt-write', 'pending-signal', 'running-signal', 'linked-log', 'hardlinked-log', 'fifo-log',
  'preload-matches-receipt', 'preload-admits-before-late-head', 'preload-rejects-after-receipt',
];

function runScenario(name) {
  const scratch = mkdtempSync(join(realpathSync(tmpdir()), 'cloud-qa-fixture-'));
  const home = join(scratch, 'home');
  try {
    mkdirSync(home, {mode: 0o700});
    const result = spawnSync(process.execPath, [probe, scratch, name], {
      cwd: scratch, encoding: 'utf8', timeout: 12000, maxBuffer: 256*1024,
      env: {PATH: '/usr/bin:/bin', HOME: home, TMPDIR: scratch, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_ALLOW_PROTOCOL: 'file', GIT_OPTIONAL_LOCKS: '0'},
    });
    if (result.error) throw result.error;
    assert.equal(result.signal, null, name+' failed: '+result.stderr);
    assert.equal(result.stderr, '', name);
    const trace = JSON.parse(readFileSync(join(scratch, 'report.json'), 'utf8'));
    assert.equal(trace.name, name);
    assert.equal(result.status, trace.steps.at(-1).expect['s.exitCode']);
    return trace;
  } finally {rmSync(scratch, {recursive: true, force: true});}
}

export async function checkCloudQaLauncher(extraSources = []) {
  const core = coreStateReceipt(root);
  const sources = [
    fileURLToPath(import.meta.url), probe, 'test/fixtures/core-state-root.mjs',
    'scripts/start-cloud-qa.ts', 'scripts/local-agent-source.ts', 'scripts/copy-file-clone.ts',
    'scripts/cloud-sdk-authority.ts', 'scripts/native-view-policy.ts',
    'scripts/cloud-deployment-policy.ts', 'upstream.lock.json',
    'vendor/eliza/packages/agent/native-host/private-runtime-launch.mjs',
    'vendor/eliza/packages/agent/native-host/private-runtime-json.mjs',
    'vendor/eliza/packages/app/scripts/lib/immutable-workspace-source.mjs',
    'vendor/eliza/packages/app/scripts/lib/committed-source.mjs',
    CORE_STATE_MANIFEST, ...Object.keys(core.inputHashes), ...Object.keys(core.files).map(name => 'vendor/eliza/'+name),
    ...extraSources,
  ];
  const driverHashes = captureInputs(sources);
  const traces = scenarios.map(runScenario);
  return checkTraces({model: 'CloudQaLauncher', sources, driverHashes, traces, scope: 'bounded-orchestration', assumptions: [
    'The exact product launcher, authority config, core argument preparation and pinned private profile, atomic writer and runtime supervisor execute against private synthetic files.',
    'The child process is a closed EventEmitter with explicit spawn, error, stop and close events. The source supervisor and launcher signal listeners remain exact. No runtime entry or service executes.',
    'Receipt failures and held rename are selected fixture schedules. A published receipt records the launch attempt, and may remain after close. It does not establish readiness, identity verification or model execution.',
    'Log custody checks selected symlink, hardlink, FIFO and regular-file layouts with physical scratch paths. Single invocation and a representative prior profile/receipt only. Kernel signals, forced kill timeout, simultaneous profile ownership, OS port availability and Cloud or Android acceptance remain separate.',
  ]});
}
