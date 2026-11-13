// Partial source contract regression evidence. Original schedules, actions and assertions are retained.
// Only the selected source members/components and controlled ports execute; this is not whole-file refinement.
import {after as afterPartialContract} from 'node:test';
import partialContractAssert from 'node:assert/strict';
import {fileURLToPath as partialContractFile} from 'node:url';
import {captureReplayClosure as capturePartialClosure} from '../specs/quint/refinement/observed-replay.mjs';
import {captureInputs as capturePartialInputs} from '../specs/quint/refinement/check-traces.mjs';
const partialContractInputs = capturePartialClosure([partialContractFile(import.meta.url)]);
afterPartialContract(() => partialContractAssert.deepEqual(capturePartialInputs(Object.keys(partialContractInputs)), partialContractInputs));

import test from 'node:test';
import assert from 'node:assert/strict';
import {checkFindInPage} from '../specs/quint/refinement/application/find-in-page.mjs';

test("partial source contract: the browser adapter find bar follows every FindInPage trace", {timeout: 240000}, async () => {
  const receipt = await checkFindInPage();
  assert.equal(receipt.traces, 49);
  assert.ok(receipt.checkpoints > 1000, `checkpoints ${receipt.checkpoints}`);
  for (const action of ['openFind', 'closeFind', 'typeQuery', 'timerFires', 'nativeResult', 'deliver', 'pick', 'present', 'navigate', 'closeTab'])
    assert.ok(receipt.actions[action] > 0, `${action} is replayed`);
});
