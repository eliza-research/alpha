import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkKeyboardDictationCloud} from '../specs/quint/refinement/native/keyboard-dictation-cloud.mjs';

test('native dictation routes, stale replies and audio cleanup refine the selected-route model', {timeout:180000}, async()=>{
  const receipt=await checkKeyboardDictationCloud([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed,true);
  assert.equal(receipt.traces,31);
  assert.equal(receipt.observedFields.length,14);
});
