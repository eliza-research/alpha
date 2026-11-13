import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import {checkAccountSheet} from '../specs/quint/refinement/application/account-sheet.mjs';
test('mounted Account navigation and retained confirmation preserve owned credentials and data',{timeout:scaledTimeout(300000)},async()=>{
 const receipt=await checkAccountSheet([fileURLToPath(import.meta.url)]);
 assert.equal(receipt.passed,true);assert.equal(receipt.driverInputsBound,true);assert.equal(receipt.inputsUnchanged,true);
 assert.equal(receipt.traces,5);
});
