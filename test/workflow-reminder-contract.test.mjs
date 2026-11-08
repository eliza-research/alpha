import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
// The renderer contract is TypeScript; evaluate it with the repository's tsx loader.
const root=resolve(import.meta.dirname,'..');
const script=`
const c=await import(${JSON.stringify(resolve(root,'apps/app/src/runtime/workflow-device-contract.ts'))});
const out={};const rejects=async f=>{try{await f();return false;}catch{return true;}};
const op=c.parseWorkflowReminderRead({type:'read_selected_reminders',window:'open_and_completed_today',day:'2026-10-08',timeZone:'America/Los_Angeles',maximumItems:3});
out.op=op;
out.badWindow=await rejects(()=>c.parseWorkflowReminderRead({...op,window:'all_reminders'}));
out.badDay=await rejects(()=>c.parseWorkflowReminderRead({...op,day:'2026-02-30'}));
out.extra=await rejects(()=>c.parseWorkflowReminderRead({...op,body:true}));
const row=async(id,title,dueAt,status,completedAt)=>({id,revision:await c.workflowSha([id,title,dueAt,status,completedAt??null]),title,dueAt,status,...(completedAt?{completedAt}:{})});
// Owner day in Los Angeles: 2026-10-08T07:00Z to 2026-10-09T07:00Z.
const open=await row('open','Overdue','2026-10-07T16:00:00.000Z','open'),done=await row('done','Done today','2026-10-08T15:00:00.000Z','completed','2026-10-08T20:00:00.000Z');
out.valid=(await c.validateWorkflowReminderResult(op,{kind:'reminders',reminders:[open,done]})).reminders.map(r=>r.id);
out.future=await rejects(async()=>c.validateWorkflowReminderResult(op,{kind:'reminders',reminders:[await row('later','Tomorrow','2026-10-09T08:00:00.000Z','open')]}));
out.oldCompletion=await rejects(async()=>c.validateWorkflowReminderResult(op,{kind:'reminders',reminders:[await row('old','Yesterday','2026-10-07T15:00:00.000Z','completed','2026-10-08T06:59:59.000Z')]}));
out.tampered=await rejects(()=>c.validateWorkflowReminderResult(op,{kind:'reminders',reminders:[{...open,title:'Changed'}]}));
out.privateBody=await rejects(()=>c.validateWorkflowReminderResult(op,{kind:'reminders',reminders:[{...open,body:'secret'}]}));
out.overflow=await rejects(()=>c.validateWorkflowReminderResult(op,{kind:'reminders',reminders:[open,done,open,done]}));
const review={runId:'r',workflowId:'w',versionId:'v',specDigest:'a'.repeat(64),finished:false,cancellationRequestedAt:null,status:'running',spec:{device:{installationId:'i',enrollmentId:'e'},steps:[{id:'reminders',kind:'Read',operation:'selected_reminders',scope:{window:op.window,timeZone:op.timeZone,maximumItems:3}}]}};
const binding={workflowId:'w',versionId:'v',runId:'r',stepId:'reminders',specDigest:'a'.repeat(64)},target={installationId:'i',enrollmentId:'e'};
const now=Date.UTC(2026,9,8,18);c.assertWorkflowOperation(review,binding,target,op,now);out.bound=true;
out.otherDay=await rejects(()=>c.assertWorkflowOperation(review,binding,target,{...op,day:'2026-10-07'},now));
out.widened=await rejects(()=>c.assertWorkflowOperation(review,binding,target,{...op,maximumItems:200},now));
console.log(JSON.stringify(out));`;
test('selected reminder reads stay inside the reviewed owner-day window',()=>{
 const out=JSON.parse(execFileSync(process.execPath,['--import=tsx','--input-type=module','-e',script],{cwd:root,encoding:'utf8',timeout:60000}));
 assert.deepEqual(out,{op:{type:'read_selected_reminders',window:'open_and_completed_today',day:'2026-10-08',timeZone:'America/Los_Angeles',maximumItems:3},badWindow:true,badDay:true,extra:true,valid:['open','done'],future:true,oldCompletion:true,tampered:true,privateBody:true,overflow:true,bound:true,otherDay:true,widened:true});
});
