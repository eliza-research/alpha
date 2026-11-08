import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {nativeSource,fixture,runJvm,jsonJarSkip} from './fixtures/jvm-tools.mjs';
test('native interrupted-write receipts recover only from the exact observed owner/event/postcondition',{skip:jsonJarSkip},()=>{
 assert.equal(runJvm([nativeSource('CalendarSyncReceiptRecovery.java'),fixture('CalendarSyncReceiptRecoveryTest.java')],'ai.elizaresearch.alphaphone.CalendarSyncReceiptRecoveryTest',{json:true}).trim(),'PASS native Calendar readback-only receipt recovery and owner isolation');
});
test('a full unconfirmed receipt journal refuses a new write before recording or dispatching it',()=>{
 const source=readFileSync(nativeSource('CalendarSyncBridge.java'),'utf8');
 const prune=source.indexOf('if(operations.length()>=128)CalendarSyncReceiptRecovery.prune(');
 const capacity=source.indexOf('if(operations.length()>=128)throw new IllegalStateException("Calendar sync receipt history needs review")',prune);
 const record=source.indexOf('operations.put(operationId,',prune);
 const dispatch=source.indexOf('applyBatch(CalendarContract.AUTHORITY,changes)',prune);
 assert.ok(prune>=0&&capacity>prune&&record>capacity&&dispatch>record);
});

test('pruning an unacknowledged deletion retains the same owner fence as acknowledgment',()=>{
 const source=readFileSync(nativeSource('CalendarSyncBridge.java'),'utf8');
 const start=source.indexOf('CalendarSyncReceiptRecovery.prune('),end=source.indexOf('if(operations.length()>=128)throw',start);
 const prune=source.slice(start,end);
 assert.match(prune,/scope\(context\)\.equals\(row\.optString\("scope"\)\)/);
 assert.match(prune,/same\(receipt\.opt\("owner"\),context\.owner\)/);
 assert.match(prune,/Set\.of\("deleted","undone","conflict"\)\.contains\(receipt\.optString\("phase"\)\)/);
});
