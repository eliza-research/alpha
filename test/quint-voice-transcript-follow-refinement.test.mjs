import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkVoiceTranscriptFollow} from '../specs/quint/refinement/application/voice-transcript-follow.mjs';
test('actual shell voice intent follows only the accepted matching new row once',{timeout:60000},async()=>{
 const receipt=await checkVoiceTranscriptFollow([fileURLToPath(import.meta.url)]);
 assert.equal(receipt.passed,true);assert.equal(receipt.driverInputsBound,true);assert.equal(receipt.inputsUnchanged,true);
 assert.equal(receipt.traces,10);
});
