import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, existsSync, realpathSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {isAbsolute, join, resolve} from 'node:path';
import {captureInputs, checkTraces} from '../specs/quint/refinement/check-traces.mjs';
import {parseBuildPolicy} from '../scripts/build-policy-source.ts';

const root = resolve(fileURLToPath(new URL('../specs/quint/refinement/services', import.meta.url)), '../../../..');
const probe = join(fileURLToPath(new URL('../specs/quint/refinement/services', import.meta.url)), 'reviewed-workflow-launcher-probe.mjs');
const manifest = 'scripts/upstream-core-sources.ts';
const cases = [
  'relative-default', 'missing-deps', 'invalid-port', 'input-mode', 'unreviewed-profile', 'missing-entry',
  'routing', 'embedding-path', 'default-source', 'existing-profile', 'spawn-error', 'signal-int', 'signal-term',
  'exit-seven', 'git-metadata', 'write-metadata',
];

function sourceInputs(extraSources) {
  const {files} = parseBuildPolicy(readFileSync(join(root, manifest)));
  return [
    'scripts/launcher-child.ts', 'scripts/private-runtime-launch.ts', 'scripts/start-reviewed-workflow-agent.ts', 'scripts/agent-embeddings.ts', 'scripts/agent-identity.ts',
    'scripts/agent-model.ts', 'apps/app/src/product/alpha-product-registration.ts', 'scripts/local-agent-source.ts',
    'scripts/copy-file-clone.ts', 'scripts/core-state-preload.ts', 'scripts/core-state-patch.ts', 'scripts/build-policy-source.ts',
    'scripts/combined-agent-source.ts', manifest, 'upstream.lock.json',
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
    const report = join(scratch, 'report.json');
    assert.ok(existsSync(report), `${name}: launcher probe exited ${result.status} without a report\n${result.stdout}${result.stderr}`);
    const trace = JSON.parse(readFileSync(report, 'utf8'));
    assert.equal(trace.name, name);
    assert.equal(result.status, trace.steps.at(-1).expect['s.exitCode']);
    return trace;
  } finally {rmSync(scratch, {recursive: true, force: true});}
}

async function checkReviewedWorkflowLauncher(extraSources = [], bun) {
  const sources = sourceInputs(extraSources);
  const driverHashes = captureInputs(sources);
  const traces = cases.map(name => runScenario(name));
  if (bun) for (const name of ['actual-pinned', 'actual-wrong-pin', 'actual-dirty'])
    traces.push(runScenario(name, bun));
  return checkTraces({model: 'ReviewedWorkflowLauncher', id: bun ? 'ReviewedWorkflowLauncherWithBun' : undefined,
    sources, driverHashes, traces, scope: 'bounded-orchestration', assumptions: [
      'The exact launcher, source and profile helpers run in a disposable synthetic Git workspace and private home. Module hooks observe real filesystem operations and substitute a closed spawn port. All state files and child inputs belong to the fixture.',
      'The opt-in Bun traces execute the actual core preload and a synthetic entry that checks the unchanged reviewed source bytes. Each checkout is stable from the start of the launcher through child admission. Real workflows and provider behavior are separate.',
      'Fresh and saved profile cases observe identity, text routing, embeddings and the two optional plugin settings. Endpoint readiness remains a separate acceptance check.',
      'Revision read refusal closes the log before spawn. Receipt write refusal retains the supervised child until it closes. The shared supervisor escalation is exercised by the CombinedAgentLauncher fixture.',
    ]});
}

test('reviewed workflow launcher compares private admission and child handoff', {timeout: 150000}, async () => {
  const bun = process.env.ALPHA_QUINT_BUN;
  const receipt = await checkReviewedWorkflowLauncher([fileURLToPath(import.meta.url)], bun);
  assert.equal(receipt.model, 'ReviewedWorkflowLauncher');
  assert.equal(receipt.traces, bun ? 19 : 16);
  assert.ok(receipt.passed && receipt.driverInputsBound && receipt.inputsUnchanged);
  const last = name => receipt.traceInputs.find(trace => trace.name === name).steps.at(-1).expect;
  assert.equal(last('default-source')['s.features'], 'disabled');
  assert.equal(last('existing-profile')['s.features'], 'enabled');
  assert.equal(last('existing-profile')['s.embeddings'], false);
  assert.equal(last('missing-entry')['s.token'], true);
  assert.equal(last('routing')['s.identity'], true);
  const revision = last('git-metadata');
  assert.equal(revision['s.child'], false);
  assert.equal(revision['s.logOpen'], false);
  const write = last('write-metadata');
  assert.equal(write['s.metadata'], false);
  assert.equal(write['s.childClosed'], true);
  assert.equal(write['s.logOpen'], false);
  assert.equal(write['s.cleanupSignal'], 'SIGTERM');
  assert.equal(write.ChildCustodyAfterReceiptFailure, true);
  assert.equal(last('spawn-error')['s.pid'], false);
  assert.equal(last('spawn-error')['s.exitCode'], 1);
  assert.equal(last('signal-int')['s.forwarded'], 'SIGINT');
  assert.equal(last('signal-term')['s.forwarded'], 'SIGTERM');
  assert.equal(last('exit-seven')['s.exitCode'], 7);
  if (bun) {
    assert.equal(last('actual-pinned')['s.preloadEntry'], true);
    assert.equal(last('actual-wrong-pin')['s.revision'], 'other');
    assert.equal(last('actual-wrong-pin')['s.preloadEntry'], false);
    assert.equal(last('actual-dirty')['s.revision'], 'pinned');
    assert.equal(last('actual-dirty')['s.preloadEntry'], false);
  }
});
