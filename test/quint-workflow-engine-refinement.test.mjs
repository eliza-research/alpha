import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('workflow engine SQL admission and source coordinator refine bounded Quint traces', {timeout: 360000}, () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import {runWorkflowEngineRefinement} from './specs/quint/refinement/services/workflow-engine/index.mjs';
    const result = await runWorkflowEngineRefinement(['test/quint-workflow-engine-refinement.test.mjs']);
    const [receipt] = result.receipts;
    assert.equal(receipt.passed, true);
    assert.equal(receipt.inputsUnchanged, true);
    assert.equal(receipt.driverInputsBound, true);
    assert.equal(receipt.traces, 24);
    assert.equal(receipt.checkpoints, 118);
    assert.ok(receipt.actions.cancelReceipt);
    assert.ok(receipt.actions.decisionUnconfirmed);
    assert.ok(receipt.actions.replayScheduled);
    assert.ok(result.obligations.length >= 4);
    console.log(JSON.stringify({traces: receipt.traces, checkpoints: receipt.checkpoints}));
  `], {cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 340000, maxBuffer: 16 * 1024 * 1024});
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
