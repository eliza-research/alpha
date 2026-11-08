import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('workflow wakeups and restart refine actual source callbacks and persisted state', {timeout: 300000}, () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import {runWorkflowWakeupRefinement} from './specs/quint/refinement/services/workflow-scheduler/index.mjs';
    const result = await runWorkflowWakeupRefinement(['test/quint-workflow-wakeups-refinement.test.mjs']);
    const [receipt] = result.receipts;
    assert.equal(receipt.passed, true);
    assert.equal(receipt.driverInputsBound, true);
    assert.equal(receipt.inputsUnchanged, true);
    assert.equal(receipt.traces, 14);
    assert.equal(receipt.checkpoints, 72);
    assert.ok(receipt.actions.fire);
    assert.ok(receipt.actions.missedQueued);
    assert.ok(receipt.actions.staleCallback);
    assert.ok(result.obligations.length);
    console.log(JSON.stringify({traces: receipt.traces, checkpoints: receipt.checkpoints}));
  `], {cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 280000, maxBuffer: 16 * 1024 * 1024});
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
