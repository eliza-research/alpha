import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkCopyReceipt,checkCopyReceiptCanary} from '../specs/quint/refinement/native/copy-receipt.mjs';

test('CopyReceipt compares real browser transactions, recovery and every model state field',{timeout:240000},async()=>{
 const {receipt}=await checkCopyReceipt([fileURLToPath(import.meta.url)]);
 assert.equal(receipt.passed,true);assert.equal(receipt.inputsUnchanged,true);assert.equal(receipt.driverInputsBound,true);
 assert.equal(receipt.traces,12);assert.equal(receipt.observedFields.length,15);
 for(const name of ['begin','save','commit','renderFails','readResult','cancelEditor','sessionExpires','externalEdit','trashSource'])assert(receipt.actions[name]>0,name);
});
test('CopyReceipt rejects source that lets a read-retired suspended save commit',{timeout:180000},async()=>{
 await assert.rejects(()=>checkCopyReceiptCanary('retired'),/A read-retired save must not commit afterwards/);
});
test('CopyReceipt rejects source that turns an explicit copy request into replace',{timeout:180000},async()=>{
 await assert.rejects(()=>checkCopyReceiptCanary('replace'),/A copy request must never overwrite the original/);
});
