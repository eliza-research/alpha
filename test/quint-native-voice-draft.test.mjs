import test from 'node:test';
import assert from 'node:assert/strict';
import {checkVoiceDraft,voiceDraftScenarios} from '../specs/quint/refinement/native/voice-draft.mjs';

test('shared native voice draft refines callbacks, selection and failed start cleanup', {timeout:300000}, async()=>{
 const receipt=await checkVoiceDraft(['test/quint-native-voice-draft.test.mjs']);
 assert.equal(receipt.passed,true);
 assert.equal(receipt.traces,voiceDraftScenarios.length);
 assert.equal(receipt.driverInputsBound,true);
 assert.equal(receipt.inputsUnchanged,true);
});
