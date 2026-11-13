import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('Inbox cleanup checks each durable write, lost reply, stale binding and peer save', {timeout: scaledTimeout(180000)}, () => {
  const result = spawnSync(process.execPath, ['-e', `
    import assert from 'node:assert/strict';
    import {runInboxCleanupRefinement} from './specs/quint/refinement/services/inbox-cleanup.mjs';
    const {receipts} = await runInboxCleanupRefinement();
    assert.equal(receipts.length, 1);
    const receipt = receipts[0];
    assert.equal(receipt.passed, true);
    assert.equal(receipt.traces, 9);
    assert.equal(receipt.driverInputsBound, true);
    assert.equal(receipt.inputsUnchanged, true);
    assert.ok(receipt.actions.publishRetainedClear);
    assert.ok(receipt.actions.restoreRetained);
    assert.ok(receipt.actions.peerSave);
    console.log(JSON.stringify({traces: receipt.traces, checkpoints: receipt.checkpoints}));
  `], {cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: scaledTimeout(170000), maxBuffer: 8 * 1024 * 1024});
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /"traces":9/);
});
