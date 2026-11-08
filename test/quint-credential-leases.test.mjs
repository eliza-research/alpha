import test from 'node:test';
import assert from 'node:assert/strict';
import {checkCredentialLeasePolicies} from '../specs/quint/refinement/native/credential-leases.mjs';

test('native request and shutdown leases preserve exact ownership', {timeout:120000}, async () => {
 const receipt=await checkCredentialLeasePolicies(['test/quint-credential-leases.test.mjs']);
 assert.equal(receipt.passed,true);
 assert.equal(receipt.traces,13);
 assert.equal(receipt.driverInputsBound,true);
 assert.equal(receipt.inputsUnchanged,true);
});
