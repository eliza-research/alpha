import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkProtectedAppUpdatePromotion} from '../specs/quint/refinement/services/protected-app-update-promotion.mjs';

// Partial source contract: scratch admission, actual Python restoration and publication helpers under closed ports.
// Synthetic signed bytes do not establish signing custody, hosted publication or release acceptance.
test('partial source contract: protected update admission and raw publication bytes retain every original failure schedule',{timeout:240000},async()=>{
 const receipt=await checkProtectedAppUpdatePromotion([fileURLToPath(import.meta.url)]);
 assert.equal(receipt.model,'ProtectedAppUpdatePromotion');
 assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
});
