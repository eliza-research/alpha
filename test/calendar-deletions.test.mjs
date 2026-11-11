import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
const bundled=buildSync({entryPoints:['apps/app/src/browser/calendar-deletions.ts'],bundle:true,write:false,platform:'node',format:'esm',loader:{'.css':'empty'},define:{'import.meta.env':'{}'}}).outputFiles[0].text;
const {stageCalendarDeletion,settleCalendarDeletions,undoCalendarDeletion,calendarDeletionPending,guardPendingCalendarChanges}=await import('data:text/javascript;base64,'+Buffer.from(bundled).toString('base64'));
const event=()=>({id:'event',calendarId:'local',title:'Exact event',body:'Keep this text',location:'Here',begin:Date.UTC(2026,0,1,9),end:Date.UTC(2026,0,1,10),revision:'r1',timeZone:'UTC'});
const state=()=>({sourceRevision:'source1',events:[event()]});
test('Calendar row stays intact during Undo; one transaction settles exact expiry and never repeats',t=>{
 let now=100;t.mock.method(performance,'now',()=>now);const data=state(),original=structuredClone(data.events);
 const entry=stageCalendarDeletion(data,data.events[0],'event','owner','delete');
 now=10099;settleCalendarDeletions(data,()=>true);assert.deepEqual(data.events,original);assert.equal(entry.phase,'queued');
 now=10100;settleCalendarDeletions(data,()=>true);assert.deepEqual(data.events,[]);assert.equal(data.deletions.delete.phase,'deleted');
 settleCalendarDeletions(data,()=>true);assert.deepEqual(data.events,[]);assert.throws(()=>undoCalendarDeletion(data,'delete',()=>true));
});
test('Undo restores no invented event and uncertain clock permits cancellation without dispatch',t=>{
 let now=100;t.mock.method(performance,'now',()=>now);const data=state(),original=structuredClone(data.events);
 stageCalendarDeletion(data,data.events[0],'event','owner','delete');data.deletions.delete.deadline.continuity='previous-renderer';
 now=999999;settleCalendarDeletions(data,()=>true);assert.deepEqual(data.events,original);
 undoCalendarDeletion(data,'delete',()=>true);assert.deepEqual(data.events,original);assert.equal(data.deletions.delete.phase,'undone');
});
test('owner refusal pauses permanently until explicit Undo; provider revision drift cannot delete',t=>{
 let now=100;t.mock.method(performance,'now',()=>now);const data=state();stageCalendarDeletion(data,data.events[0],'event','owner','delete');
 now=10100;settleCalendarDeletions(data,()=>false);assert.equal(data.deletions.delete.phase,'paused');
 now=20000;settleCalendarDeletions(data,()=>true);assert.equal(data.events.length,1);undoCalendarDeletion(data,'delete',()=>true);
 stageCalendarDeletion(data,data.events[0],'event','owner','second');data.events[0].revision='provider-change';now=30000;
 settleCalendarDeletions(data,()=>true);assert.equal(data.deletions.second.phase,'conflict');assert.equal(data.events.length,1);
});
test('pending recurrence occurrence blocks parent series deletion and mutations of its exact source',t=>{
 t.mock.method(performance,'now',()=>100);const data=state();data.events[0].repeat='daily';
 const series=data.events[0],occurrence={...series,id:'event:occ:'+series.begin,seriesId:'event',occurrenceBegin:series.begin};
 stageCalendarDeletion(data,occurrence,'event','owner','occurrence');assert.equal(calendarDeletionPending(data,series.id),true);
 assert.throws(()=>stageCalendarDeletion(data,series,'series','owner','series'));
 const changed=structuredClone(data);changed.events[0].title='Changed';assert.throws(()=>guardPendingCalendarChanges(data,changed));
 undoCalendarDeletion(data,'occurrence',()=>true);stageCalendarDeletion(data,series,'series','owner','series');
 assert.equal(calendarDeletionPending(data,occurrence.id),true);
});
test('a second Undo of an undone deletion returns the same receipt; a settled deletion and a changed owner are still refused',t=>{
 let now=100;t.mock.method(performance,'now',()=>now);const data=state(),original=structuredClone(data.events);
 stageCalendarDeletion(data,data.events[0],'event','owner','delete');
 const first=undoCalendarDeletion(data,'delete',()=>true);now=999999;const again=undoCalendarDeletion(data,'delete',()=>true);
 assert.equal(first.phase,'undone');assert.deepEqual(again,first);assert.deepEqual(data.events,original);
 assert.throws(()=>undoCalendarDeletion(data,'delete',()=>false),/owner changed/);
 settleCalendarDeletions(data,()=>true);assert.deepEqual(data.events,original);assert.equal(data.deletions.delete.phase,'undone');
});
