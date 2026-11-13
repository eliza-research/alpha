import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('Inbox source coordination refines grant, confirmation, attachment and recovery transitions', {timeout: scaledTimeout(180000)}, () => {
  const result = spawnSync(process.execPath, ['-e', `
    import assert from 'node:assert/strict';
    import {runInboxCoordinatorRefinement} from './specs/quint/refinement/services/inbox-coordinator.mjs';
    const {receipts, obligations} = await runInboxCoordinatorRefinement();
    assert.equal(receipts.length, 1);
    const receipt = receipts[0];
    assert.equal(receipt.model, 'InboxCoordinator');
    assert.equal(receipt.traces, 18);
    assert.equal(receipt.passed, true);
    assert.equal(receipt.driverInputsBound, true);
    assert.equal(receipt.inputsUnchanged, true);
    assert.equal(receipt.scope, 'bounded-orchestration');
    assert.ok(receipt.observedFields.includes('copy.retained'));
    assert.ok(receipt.actions.storageRefused);
    assert.ok(receipt.actions.applyWithdrawal);
    assert.ok(obligations.length);
    console.log(JSON.stringify({traces: receipt.traces, checkpoints: receipt.checkpoints}));
  `], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    timeout: scaledTimeout(170000),
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /"traces":18/);
});
