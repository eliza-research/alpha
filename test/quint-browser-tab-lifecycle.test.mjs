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
import {checkBrowserTabLifecycle} from '../specs/quint/refinement/application/browser-tab-lifecycle.mjs';

test("partial source contract: the browser adapter tab code follows every BrowserTabLifecycle trace", {timeout: 240000}, async () => {
  const receipt = await checkBrowserTabLifecycle();
  assert.equal(receipt.traces, 71);
  assert.ok(receipt.checkpoints > 1000, `checkpoints ${receipt.checkpoints}`);
  for (const action of ['hydrate', 'openTab', 'setEditing', 'pick', 'navigateStart', 'restoredShown', 'createSettles', 'navigateSettles', 'closeTab', 'nativeTabOpened', 'nativeTabClosed'])
    assert.ok(receipt.actions[action] > 0, `${action} is replayed`);
});
