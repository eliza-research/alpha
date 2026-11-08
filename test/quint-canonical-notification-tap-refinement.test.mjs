import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkCanonicalNotificationTap} from '../specs/quint/refinement/native/canonical-notification-tap.mjs';

test('the actual native canonical tap slots and bridge refine custody and acknowledgement', async () => {
  const {receipt} = await checkCanonicalNotificationTap([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 9);
  assert.equal(receipt.checkpoints, 173);
  assert.ok(receipt.observedFields.includes('s.posted'));
});
