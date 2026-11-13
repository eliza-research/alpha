import test from 'node:test';import assert from 'node:assert/strict';import {nativeSource,fixture,runJvm,jsonJarSkip} from './fixtures/jvm-tools.mjs';
test('native interrupted-write receipts recover only from the exact observed owner/event/postcondition',{skip:jsonJarSkip},()=>{
 assert.equal(runJvm([nativeSource('CalendarSyncReceiptRecovery.java'),fixture('CalendarSyncReceiptRecoveryTest.java')],'ai.alphacompute.alphaphone.CalendarSyncReceiptRecoveryTest',{json:true}).trim(),'PASS native Calendar readback-only receipt recovery and owner isolation');
});
