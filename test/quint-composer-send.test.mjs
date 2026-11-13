// Partial source contract regression evidence. Original schedules, actions and assertions are retained.
// Only the selected source members/components and controlled ports execute; this is not whole-file refinement.
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import {after as afterPartialContract} from 'node:test';
import partialContractAssert from 'node:assert/strict';
import {fileURLToPath as partialContractFile} from 'node:url';
import {captureReplayClosure as capturePartialClosure} from '../specs/quint/refinement/observed-replay.mjs';
import {captureInputs as capturePartialInputs} from '../specs/quint/refinement/check-traces.mjs';
const partialContractInputs = capturePartialClosure([partialContractFile(import.meta.url)]);
afterPartialContract(() => partialContractAssert.deepEqual(capturePartialInputs(Object.keys(partialContractInputs)), partialContractInputs));

import test from 'node:test';
import assert from 'node:assert/strict';
import {runComposerSendReplay} from '../specs/quint/refinement/application/composer-send.mjs';

// ComposerSend model traces (scenarios, witnesses and random walks from the pinned Quint CLI)
// replayed step by step against the shell's send, the real AlphaClient and the shared draft
// controller, with the connection, transport and draft store replaced by ports.
test("partial source contract: the chat shell send follows every ComposerSend model trace", {timeout: scaledTimeout(240000)}, async () => {
  const receipt = await runComposerSendReplay();
  assert.equal(receipt.traces, 73);
  assert.ok(receipt.checkpoints > 1500, `checkpoints ${receipt.checkpoints}`);
  for (const action of ['typeText', 'send', 'refusedBeforeTransport', 'transportCall', 'serverReceives', 'transportRefuses', 'transportFails',
    'streamChunk', 'reply', 'cancel', 'settleTimeout', 'sessionSwitch']) assert.ok(receipt.actions[action] > 0, `${action} was replayed`);
});
