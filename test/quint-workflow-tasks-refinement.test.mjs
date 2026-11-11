import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('workflow task registration and cleanup refine actual source operations', {timeout: 300000}, () => {
  const result = spawnSync(process.execPath, ['-e', `
    import assert from 'node:assert/strict';
    import {runWorkflowTaskRefinement} from './specs/quint/refinement/services/workflow-scheduler/registration.mjs';
    const result = await runWorkflowTaskRefinement(['test/quint-workflow-tasks-refinement.test.mjs']);
    const [receipt] = result.receipts;
    assert.equal(receipt.passed, true);
    assert.equal(receipt.driverInputsBound, true);
    assert.equal(receipt.inputsUnchanged, true);
    assert.equal(receipt.traces, 14);
    assert.equal(receipt.checkpoints, 63);
    assert.ok(receipt.actions.retireCreated);
    assert.ok(receipt.actions.restore);
    assert.ok(receipt.actions.creationFailed);
    assert.ok(result.obligations.length);
    console.log(JSON.stringify({traces: receipt.traces, checkpoints: receipt.checkpoints}));
  `], {cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 280000, maxBuffer: 16 * 1024 * 1024});
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
