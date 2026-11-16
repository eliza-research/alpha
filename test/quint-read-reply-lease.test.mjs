import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {verifyRefinementReceiptInputs} from '../specs/quint/refinement/check-traces.mjs';
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import {checkReadReplyLease} from '../specs/quint/refinement/application/read-reply-lease.mjs';

const source = fileURLToPath(import.meta.url);

test('the real Notes read-reply lease follows approval, completion and retirement', {timeout:scaledTimeout(120000)}, async () => {
  const receipt = await checkReadReplyLease([source]);
  assert.equal(receipt.traces, 9);
  assert.equal(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound, true);
  assert.equal(verifyRefinementReceiptInputs(receipt), true);
  assert.equal(receipt.actions.retireStaleLease, 3);
  assert.equal(receipt.actions.completionSettles, 5);
});

test('the read-reply replay catches stale answer insertion at the renderer commit', {timeout:scaledTimeout(120000)}, async () => {
  await assert.rejects(checkReadReplyLease([source], {
    only:'retirement before a queued answer commit',
    rewrite(code) {
      const guard = 'try{current();}catch{return null;}';
      assert.ok(code.includes(guard));
      return code.replace(guard, '');
    },
  }), /retired binding must not publish the queued answer/);
});
