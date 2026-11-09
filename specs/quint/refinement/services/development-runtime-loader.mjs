import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {isAbsolute, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInputs, checkTraces} from '../check-traces.mjs';

const root = resolve(import.meta.dirname, '../../../..');
const probe = resolve(import.meta.dirname, 'development-runtime-loader-probe.mjs');
const manifest = 'config/upstream-core-sources.json';
const model = 'DevelopmentRuntimeLoader';

function sourceInputs(extraSources) {
  const {files} = JSON.parse(readFileSync(join(root, manifest), 'utf8'));
  return [
    'backend/loader.ts', 'scripts/pinned-upstream-source.mjs', 'scripts/core-state-patch.mjs',
    'scripts/core-state-preload.mjs', 'scripts/combined-agent-source.mjs',
    'scripts/local-agent-source.mjs', 'scripts/copy-file-clone.mjs', manifest,
    'upstream.lock.json', 'test/fixtures/core-state-root.mjs',
    ...['consumer-source-resolver.mjs', 'immutable-workspace-source.mjs', 'committed-source.mjs']
      .map(name => 'vendor/eliza/packages/app/scripts/lib/'+name),
    ...Object.keys(files).map(name => 'vendor/eliza/'+name),
    probe, fileURLToPath(import.meta.url), ...extraSources,
  ];
}

function runProbe(binary, real) {
  assert.ok(isAbsolute(binary), 'The selected executable must be an absolute path');
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'quint-development-loader-')));
  const home = join(scratch, 'home');
  try {
    mkdirSync(home, {mode: 0o700});
    const environment = {PATH: '/usr/bin:/bin', HOME: home, TMPDIR: scratch,
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null'};
    const args = [probe, scratch, ...(real ? ['real'] : [])];
    const result = spawnSync(binary, args, {
      cwd: scratch, env: environment, encoding: 'utf8', timeout: 90000, maxBuffer: 4 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, 'Closed loader subprocess failed: '+result.stderr);
    return JSON.parse(result.stdout);
  } finally {rmSync(scratch, {recursive: true, force: true});}
}

export async function checkDevelopmentRuntimeLoader(extraSources = [], bunExecutable) {
  const sources = sourceInputs(extraSources);
  const driverHashes = captureInputs(sources);
  const traces = runProbe(process.execPath, false);
  if (bunExecutable) traces.push(...runProbe(bunExecutable, true));
  return checkTraces({model, id: bunExecutable ? 'DevelopmentRuntimeLoaderWithBun' : undefined,
    sources, driverHashes, traces, scope: 'bounded-orchestration',
    assumptions: [
      'Each schedule copies exact loader, pin verifier, resolver and core-state hooks into private scratch. It authenticates a tiny synthetic Git commit and uses a closed build port, actual filesystem writes and actual imports of synthetic ESM.',
      'The optional Bun schedule uses its real compiler on synthetic fixture entrypoints. No dev-agent, provider, existing state directory, real runtime backend or installed credential file participates.',
      'Build versions are labels for two fixture source exports. A failed build retains preexisting artifacts. Artifact and receipt labels can diverge, and the fixed URL can reuse a previous successful or rejected module evaluation.',
      'The fixture exercises two serial attempts in one process. Concurrent compiler writers, process crashes and power loss, system-wide filesystem behavior and Bun dependency graph coverage are outside the comparison.',
    ]});
}
