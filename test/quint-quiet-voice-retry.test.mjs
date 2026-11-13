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
import {runQuietVoiceRetryReplay} from '../specs/quint/refinement/application/quiet-voice-retry.mjs';

// QuietVoiceRetry model traces (scenarios, witnesses and random walks from the pinned Quint CLI)
// replayed step by step against the voice surface's quietVoiceRetry, with its wait timer, the
// chat's currency and the refusal's limit facts replaced by ports.
test("partial source contract: quiet voice recovery follows every QuietVoiceRetry model trace", {timeout: 240000}, async () => {
  const receipt = await runQuietVoiceRetryReplay();
  assert.equal(receipt.traces, 93);
  assert.ok(receipt.checkpoints > 2500, `checkpoints ${receipt.checkpoints}`);
  for (const action of ['chooseProvider', 'open', 'listening', 'speaking', 'failure', 'waitElapsed', 'currencyLost', 'currencyBack', 'recover', 'close'])
    assert.ok(receipt.actions[action] > 0, `${action} was replayed`);
});
