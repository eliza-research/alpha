import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkBrowserGoogleReturn} from '../specs/quint/refinement/services/browser-google-return.mjs';

// Partial source contract: the exact loopback callback branch, with controlled request/credential ports.
// Provider authorization and whole-server behavior remain separate.
test('partial source contract: browser Google return keeps exact host, owner, expiry and replay fences',{timeout:120000},async()=>{
 const receipt=await checkBrowserGoogleReturn([fileURLToPath(import.meta.url)]);
 assert.equal(receipt.traces,4);
 assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
});
