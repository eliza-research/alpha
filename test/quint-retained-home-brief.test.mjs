import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkRetainedHomeBrief} from '../specs/quint/refinement/application/retained-home-brief.mjs';

test('the retained Home brief refines scope, selection and exact publication', {timeout: 120000}, async () => {
  const receipt = await checkRetainedHomeBrief([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.traces, 6);
  assert.equal(receipt.observedFields.length, 6);
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
});
