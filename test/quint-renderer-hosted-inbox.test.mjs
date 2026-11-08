import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkRendererHostedInbox} from '../specs/quint/refinement/application/renderer-hosted-inbox.mjs';

test('renderer hosted inbox refines exact retention, notice retry and provider acknowledgement', {timeout: 120000}, async () => {
  const receipt = await checkRendererHostedInbox([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.traces, 14);
  assert.equal(receipt.observedFields.length, 16);
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
});
