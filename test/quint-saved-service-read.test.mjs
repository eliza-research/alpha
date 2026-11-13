import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {checkSavedServiceRead} from '../specs/quint/refinement/application/saved-service-read.mjs';
import {verifyRefinementReceiptInputs} from '../specs/quint/refinement/check-traces.mjs';

test('actual Calendar and Inbox reads refine saved visibility and current authority', {timeout: 60_000}, async () => {
  const receipt = await checkSavedServiceRead([fileURLToPath(import.meta.url)]);
  assert.ok(receipt.passed && receipt.driverInputsBound && receipt.inputsUnchanged);
  assert.equal(receipt.traces, 12);
  assert.ok(receipt.observedFields.includes('canMutate'));
  assert.ok(receipt.observedFields.includes('canUseDetail'));
  assert.equal(Object.keys(receipt.generatedSourceSnapshots).length, 2);
  assert.ok(verifyRefinementReceiptInputs(receipt), 'Generated input remains independently revalidatable after cleanup');
  for (const action of ['start', 'restore', 'fresh', 'refuse', 'otherOwner', 'otherCredential', 'otherQuery',
    'tick', 'openSavedDetail', 'backFromDetail', 'checkFailed', 'recheck', 'acceptGrant', 'leave'])
    assert.ok(receipt.actions[action] > 0, action);
});
