import test from 'node:test';
import assert from 'node:assert/strict';
import {checkAsrPipe,asrPipeScenarios} from '../specs/quint/refinement/native/asr-pipe.mjs';

test('actual ASR pipe preserves cutoff, owner retirement and terminal futures', {timeout:360000}, async()=>{
  const receipt=await checkAsrPipe(['test/quint-asr-pipe.test.mjs']);
  assert.equal(receipt.passed,true);
  assert.equal(receipt.traces,asrPipeScenarios.length);
  assert.equal(receipt.driverInputsBound,true);
  assert.equal(receipt.inputsUnchanged,true);
  assert.ok(receipt.actions.warmReply>0);
  assert.ok(receipt.actions.closeReply>0);
  assert.ok(receipt.actions.ownership>0);
});
