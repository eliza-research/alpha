import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
// AP-11 selected-reminders Read step: the phone shares only today's open and completed reminders, within the
// reviewed bound, through the shared @elizaos/contracts window and revision checks. Synthetic reminder rows.
const root=resolve(import.meta.dirname,'..');
const script=`
const R=await import(${JSON.stringify(resolve(root,'apps/app/src/runtime/workflow-reminder-read.ts'))});
const op={type:'read_selected_reminders',window:'open_and_completed_today',day:'2026-10-08',timeZone:'America/Los_Angeles',maximumItems:4};
const at=iso=>Date.parse(iso);
const reminders=[
 {id:'overdue',title:'Overdue',body:'private note',at:at('2026-10-07T16:00:00.000Z'),status:'posted',mode:'inexact',createdAt:0},
 {id:'tonight',title:'Tonight',body:'',at:at('2026-10-09T06:30:00.000Z'),status:'scheduled',mode:'inexact',createdAt:0},
 {id:'tomorrow',title:'Tomorrow',body:'',at:at('2026-10-09T07:00:00.000Z'),status:'scheduled',mode:'inexact',createdAt:0},
 {id:'done',title:'Done today',body:'',at:at('2026-10-08T15:00:00.000Z'),status:'completed',completedAt:at('2026-10-08T20:00:00.000Z'),mode:'inexact',createdAt:0},
 {id:'doneYesterday',title:'Done yesterday',body:'',at:at('2026-10-07T15:00:00.000Z'),status:'completed',completedAt:at('2026-10-08T06:59:59.000Z'),mode:'inexact',createdAt:0},
 {id:'cancelled',title:'Cancelled',body:'',at:at('2026-10-08T15:00:00.000Z'),status:'cancelled',mode:'inexact',createdAt:0},
 {id:'alarm_1',title:'Alarm',body:'',at:at('2026-10-08T14:00:00.000Z'),status:'scheduled',mode:'inexact',createdAt:0},
 {id:'daily',title:'Daily',body:'',at:at('2026-10-09T16:00:00.000Z'),dueAt:at('2026-10-09T16:00:00.000Z'),status:'scheduled',mode:'inexact',createdAt:0,history:[{occurrenceId:'o1',dueAt:at('2026-10-08T16:00:00.000Z'),completedAt:at('2026-10-08T16:05:00.000Z'),skippedDates:0}]},
];
const out={};
const result=await R.workflowReminderRows(op,reminders);
out.rows=result.reminders.map(r=>[r.id,r.status]);
out.noBodies=result.reminders.every(r=>!('body' in r));
try{await R.workflowReminderRows({...op,maximumItems:3},reminders);out.overflow=false;}catch(error){out.overflow=error instanceof R.WorkflowReminderOverflow;}
console.log(JSON.stringify(out));`;
test('a selected-reminders read shares only today’s open and completed reminders within the reviewed bound',()=>{
 const out=JSON.parse(execFileSync(process.execPath,['--import=tsx','--input-type=module','-e',script],{cwd:root,encoding:'utf8',timeout:60000}));
 assert.deepEqual(out,{rows:[['overdue','open'],['done','completed'],['daily','completed'],['tonight','open']],noBodies:true,overflow:true});
});
