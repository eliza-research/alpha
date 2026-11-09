import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const probe = fileURLToPath(new URL('../specs/quint/refinement/services/browser-cloud-request-custody-probe.mjs', import.meta.url));

test('as-built browser Cloud duplicate request loses the incumbent cancellation slot', () => {
  const run = spawnSync(process.execPath, ['--import=tsx', probe, 'baseline'],
    {encoding: 'utf8', timeout: 10000});
  if (run.error) throw run.error;
  assert.equal(run.status, 0, run.stderr);
  const steps = JSON.parse(run.stdout);
  assert.deepEqual(steps[1].state, {dispatched: [1], pending: [1], aborted: [], closed: [], status: [[1, 0], [2, 400]]});
  assert.deepEqual(steps[2].state.aborted, [], 'Acknowledged cancel misses the held incumbent');
  assert.deepEqual(steps[3].state.pending, [1, 3], 'The same ID admits a new live owner before the incumbent settles');
  assert.deepEqual(steps[5].state.aborted, [], 'Incumbent cleanup removes the replacement cancellation slot');
  assert.deepEqual(steps.at(-1).state.status, [[1, 200], [2, 400], [3, 200]]);
});
