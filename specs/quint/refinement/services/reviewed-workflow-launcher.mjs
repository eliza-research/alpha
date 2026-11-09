import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {isAbsolute, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInputs, checkTraces} from '../check-traces.mjs';
import {parseBuildPolicy} from '../../../../scripts/build-policy-source.mjs';

const root = resolve(import.meta.dirname, '../../../..');
const probe = join(import.meta.dirname, 'reviewed-workflow-launcher-probe.mjs');
const manifest = 'scripts/upstream-core-sources.mjs';
const cases = [
  'relative-default', 'missing-deps', 'invalid-port', 'input-mode', 'unreviewed-profile', 'missing-entry',
  'routing', 'embedding-path', 'default-source', 'existing-profile', 'spawn-error', 'signal-int', 'signal-term',
  'exit-seven', 'git-metadata', 'write-metadata',
];

function sourceInputs(extraSources) {
  const {files} = parseBuildPolicy(readFileSync(join(root, manifest)));
  return [
    'scripts/launcher-child.mjs', 'scripts/start-reviewed-workflow-agent.mjs', 'scripts/agent-embeddings.mjs', 'scripts/agent-identity.mjs',
    'scripts/agent-model.mjs', 'apps/app/src/product/alpha-product-registration.ts', 'scripts/local-agent-source.mjs',
    'scripts/copy-file-clone.mjs', 'scripts/core-state-preload.mjs', 'scripts/core-state-patch.mjs', 'scripts/build-policy-source.mjs',
    'scripts/combined-agent-source.mjs', manifest, 'upstream.lock.json',
    'vendor/eliza/packages/app/scripts/lib/immutable-workspace-source.mjs',
    'vendor/eliza/packages/app/scripts/lib/committed-source.mjs',
    'vendor/eliza/packages/agent/native-host/private-runtime-launch.mjs',
    'vendor/eliza/packages/agent/native-host/private-runtime-json.mjs',
    ...Object.keys(files).map(name => 'vendor/eliza/'+name),
    'test/fixtures/core-state-root.mjs', probe, fileURLToPath(import.meta.url), ...extraSources,
  ];
}

function runScenario(name, bun) {
  if (bun) assert.ok(isAbsolute(bun), 'Use an explicit absolute Bun path');
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'reviewed-launch-')));
  const home = join(scratch, 'home');
  try {
    mkdirSync(home, {mode: 0o700});
    const env = {PATH: '/usr/bin:/bin', HOME: home, TMPDIR: scratch,
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null'};
    const args = [probe, scratch, name, ...(bun ? [bun] : [])];
    const result = spawnSync(process.execPath, args, {
      cwd: scratch, env, encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024,
    });
    if (result.error) throw result.error;
    assert.equal(result.signal, null, name+' failed: '+result.stderr);
    const trace = JSON.parse(readFileSync(join(scratch, 'report.json'), 'utf8'));
    assert.equal(trace.name, name);
    assert.equal(result.status, trace.steps.at(-1).expect['s.exitCode']);
    return trace;
  } finally {rmSync(scratch, {recursive: true, force: true});}
}

export async function checkReviewedWorkflowLauncher(extraSources = [], bun) {
  const sources = sourceInputs(extraSources);
  const driverHashes = captureInputs(sources);
  const traces = cases.map(name => runScenario(name));
  if (bun) for (const name of ['actual-pinned', 'actual-wrong-pin', 'actual-dirty'])
    traces.push(runScenario(name, bun));
  return checkTraces({model: 'ReviewedWorkflowLauncher', id: bun ? 'ReviewedWorkflowLauncherWithBun' : undefined,
    sources, driverHashes, traces, scope: 'bounded-orchestration', assumptions: [
      'The exact launcher, source and profile helpers run in a disposable synthetic Git workspace and private home. Module hooks observe real filesystem operations and substitute a closed spawn port. All state files and child inputs belong to the fixture.',
      'The opt-in Bun traces execute the actual core preload and a synthetic entry that checks one reviewed transformation. Each checkout is stable from the start of the launcher through child admission. Real workflows and provider behavior are separate.',
      'Fresh and saved profile cases observe identity, text routing, embeddings and the two optional plugin settings. Endpoint readiness remains a separate acceptance check.',
      'Revision read refusal closes the log before spawn. Receipt write refusal retains the supervised child until it closes. The shared supervisor escalation is exercised by the CombinedAgentLauncher fixture.',
    ]});
}
