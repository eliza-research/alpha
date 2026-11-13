import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {verifyRefinementReceiptInputs, captureInputs, checkTraces} from '../specs/quint/refinement/check-traces.mjs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {buildSync} from 'esbuild';

const root = resolve(fileURLToPath(new URL('../specs/quint/refinement/services', import.meta.url)), '../../../..');
const probe = fileURLToPath(new URL('../specs/quint/refinement/services/development-digest-pending-probe.mjs', import.meta.url));

async function checkDevelopmentDigestPending(extraSources = []) {
  const graph = buildSync({absWorkingDir: root, entryPoints: [probe, 'scripts/local-agent-dev-storage.ts'],
    bundle: true, packages: 'external', platform: 'node', format: 'esm', outdir: 'out', write: false, metafile: true}).metafile.inputs;
  const sources = [...new Set([...Object.keys(graph), probe, fileURLToPath(import.meta.url),
    'apps/app/src/runtime/hosted-digest-ui.tsx', 'apps/app/src/runtime/hosted-digests.ts',
    'package.json', 'bun.lock', 'tsconfig.json', ...extraSources])];
  const driverHashes = captureInputs(sources);
  const run = spawnSync(process.execPath, [probe, 'current'], {
    cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 2*1024*1024,
    env: {PATH: '/usr/bin:/bin', TSX_DISABLE_CACHE: '1'},
  });
  if (run.error) throw run.error;
  assert.equal(run.status, 0, run.stderr);
  return checkTraces({model: 'DevelopmentDigestPending', scope: 'bounded-orchestration', sources, driverHashes,
    traces: JSON.parse(run.stdout),
    assumptions: [
      'Actual developmentDigestStore and localAgentStorage execute with one in-memory filesystem port and direct asynchronous requests. Only the synthetic pending digest slot is addressed. No real file, provider, credential or socket is used.',
      'The in-memory host observes real serialized bytes, the exact expected string, and actual write/rename operations. The renderer cache is private and checked through the next CAS and stale conflicts.',
      'Two sequentially interleaved renderer stores, one raw host re-encoding and selected transport errors. Real process crash, durability, same-tab concurrent calls and downstream provider mutations are outside this scope.',
    ]});
}

test('development digest phase changes retain exact reviewed payload and raw CAS', {timeout: 30000}, async () => {
  const receipt = await checkDevelopmentDigestPending([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.traces, 7);
  assert.equal(receipt.checkpoints, 52);
  assert.ok(receipt.passed && receipt.driverInputsBound && verifyRefinementReceiptInputs(receipt));
  const trace = name => receipt.traceInputs.find(row => row.name === name);
  const legacy = trace('legacy retry retains original expected bytes').steps[1].expect;
  assert.equal(legacy['s.expected'].pretty, true);
  assert.equal(legacy['s.result'], 'saved');
  const lost = trace('lost acknowledgement preserves host commit and stale renderer view').steps;
  assert.equal(lost[2].expect['s.stored'].phase, 'dispatched');
  assert.equal(lost[2].expect['s.result'], 'lost');
  assert.equal(lost[3].expect['s.result'], 'conflict');
});
