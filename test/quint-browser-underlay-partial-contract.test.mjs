import test from 'node:test';
import assert from 'node:assert/strict';
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import {checkBrowserUnderlay} from '../specs/quint/refinement/native/browser-underlay.mjs';

test('partial source contract: Browser underlay keeps actual touch and layout custody', {timeout:scaledTimeout(600000)}, async () => {
  const result=await checkBrowserUnderlay(['test/quint-browser-underlay-partial-contract.test.mjs']);
  const receipt=result.receipt??result;
  assert.equal(receipt.passed,true);
  assert.equal(receipt.inputsUnchanged,true);
  assert.equal(receipt.driverInputsBound,true);
  assert.equal(receipt.scope,'partial-source-contract');
  assert.equal(receipt.traces,8);
  assert.equal(receipt.checkpoints,39);
});
