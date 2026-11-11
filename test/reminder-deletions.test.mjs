import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
const bundled=buildSync({entryPoints:['apps/app/src/browser/reminder-deletions.ts'],bundle:true,write:false,platform:'node',format:'esm'}).outputFiles[0].text;
const {stageReminderDeletion,settleReminderDeletions,undoReminderDeletion,guardPendingReminderChanges}=await import('data:text/javascript;base64,'+Buffer.from(bundled).toString('base64'));
const state=()=>({sourceRevision:'source',reminders:[{id:'r',revision:'r1',title:'Keep original occurrence',body:'Exact body',at:1500,dueAt:1500,occurrenceId:'original',status:'scheduled',mode:'inexact',createdAt:1}]});
test('suspension and intent persist together; Undo keeps exact original occurrence after due time',t=>{
 let now=100;t.mock.method(performance,'now',()=>now);const data=state(),original=structuredClone(data.reminders[0]);
 stageReminderDeletion(data,data.reminders[0],'owner','delete');const restored=JSON.parse(JSON.stringify(data));
 assert.equal(restored.reminders[0].pendingDeletion,'delete');assert.deepEqual(restored.deletions.delete.target.row,original);
 now=5000;undoReminderDeletion(restored,'delete',()=>true);assert.deepEqual(restored.reminders[0],original);
 now=20000;settleReminderDeletions(restored,()=>true);assert.deepEqual(restored.reminders[0],original);
});
test('expiry cancels one exact reminder, no duplicate effects or Undo after commit',t=>{
 let now=100;t.mock.method(performance,'now',()=>now);const data=state();stageReminderDeletion(data,data.reminders[0],'owner','delete');
 now=10099;settleReminderDeletions(data,()=>true);assert.equal(data.reminders[0].status,'scheduled');
 now=10100;settleReminderDeletions(data,()=>true);assert.equal(data.reminders[0].status,'cancelled');assert.equal(data.reminders[0].pendingDeletion,undefined);
 const completed=structuredClone(data);settleReminderDeletions(data,()=>true);assert.deepEqual(data,completed);assert.throws(()=>undoReminderDeletion(data,'delete',()=>true));
});
test('owner recovery cannot dispatch a paused intent; pending row cannot be edited or delivered',t=>{
 let now=100;t.mock.method(performance,'now',()=>now);const data=state();stageReminderDeletion(data,data.reminders[0],'owner','delete');
 const delivered=structuredClone(data);delivered.reminders[0].status='posted';assert.throws(()=>guardPendingReminderChanges(data,delivered));
 const edited=structuredClone(data);edited.reminders[0].body='Changed';assert.throws(()=>guardPendingReminderChanges(data,edited));
 now=10100;settleReminderDeletions(data,()=>false);assert.equal(data.deletions.delete.phase,'paused');
 now=999999;settleReminderDeletions(data,()=>true);assert.equal(data.reminders[0].status,'scheduled');undoReminderDeletion(data,'delete',()=>true);assert.equal(data.reminders[0].occurrenceId,'original');
});
test('new renderer clock never dispatches persisted intent and exact revision drift refuses Undo',t=>{
 let now=100;t.mock.method(performance,'now',()=>now);const data=state();stageReminderDeletion(data,data.reminders[0],'owner','delete');
 data.deletions.delete.deadline.continuity='old-renderer';now=999999;settleReminderDeletions(data,()=>true);assert.equal(data.reminders[0].status,'scheduled');
 const drift=structuredClone(data);drift.reminders[0].revision='changed';assert.throws(()=>undoReminderDeletion(drift,'delete',()=>true));
 undoReminderDeletion(data,'delete',()=>true);assert.equal(data.reminders[0].pendingDeletion,undefined);
});
test('a second Undo of an undone deletion returns the same receipt and leaves the reminder as it was',t=>{
 let now=100;t.mock.method(performance,'now',()=>now);const data=state(),original=structuredClone(data.reminders[0]);
 stageReminderDeletion(data,data.reminders[0],'owner','delete');
 const first=undoReminderDeletion(data,'delete',()=>true);now=999999;const again=undoReminderDeletion(data,'delete',()=>true);
 assert.equal(first.phase,'undone');assert.deepEqual(again,first);assert.deepEqual(data.reminders[0],original);
 assert.throws(()=>undoReminderDeletion(data,'delete',()=>false),/owner changed/);
 settleReminderDeletions(data,()=>true);assert.deepEqual(data.reminders[0],original);
});
