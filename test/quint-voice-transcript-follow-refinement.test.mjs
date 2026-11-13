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
import {fileURLToPath} from 'node:url';
import {checkVoiceTranscriptFollow} from '../specs/quint/refinement/application/voice-transcript-follow.mjs';
test("partial source contract: actual shell voice intent follows only the accepted matching new row once",{timeout:scaledTimeout(60000)},async()=>{
 const receipt=await checkVoiceTranscriptFollow([fileURLToPath(import.meta.url)]);
 assert.equal(receipt.passed,true);assert.equal(receipt.driverInputsBound,true);assert.equal(receipt.inputsUnchanged,true);
 assert.equal(receipt.traces,10);
});
