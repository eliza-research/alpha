import type {Reminder} from '../daily';
import {phoneWorkflowLocalDayBounds} from '../../../../.eliza/client-features/packages/contracts/src/phone-workflow.ts';
import {validateWorkflowReadResult,workflowReminderRevisionInput,workflowSha,type WorkflowReminderReadOperation,type WorkflowReminderRow} from '../../../../.eliza/client-features/packages/contracts/src/workflow-device.ts';
/** Thrown when the owner day holds more reminders than the reviewed bound: overflow is never presented as complete. */
export class WorkflowReminderOverflow extends Error {constructor(readonly maximumItems:number,readonly overdue:number){super(overdue>0?`More than ${maximumItems} reminders match today, ${overdue} of them overdue, so none were shared. Delete old reminders to include the rest.`:`More than ${maximumItems} reminders match today, so none were shared.`);}}
const OPEN=new Set(['pending','scheduled','posted','permission-denied','scheduling-failed']);
const iso=(ms:number)=>new Date(ms).toISOString();
/**
 * The phone's reminders inside the reviewed owner-day window: open reminders due by the end of the day
 * (overdue included) and reminders, or recurring occurrences, completed during it. Undated to-dos have no
 * due time and are not part of the read. Only id, title, due
 * time, status and completion time leave the phone; bodies, alarms and cancelled reminders never do.
 */
export async function workflowReminderRows(operation:WorkflowReminderReadOperation,reminders:readonly Reminder[]):Promise<{kind:'reminders';reminders:WorkflowReminderRow[]}>{
 const {start,end}=phoneWorkflowLocalDayBounds(operation.day,operation.timeZone);
 const rows:Array<Omit<WorkflowReminderRow,'revision'>>=[];
 for(const reminder of reminders){
  if(reminder.id.startsWith('alarm_'))continue;
  const dueAt=reminder.dueAt??reminder.at;
  if(OPEN.has(reminder.status)&&Number.isFinite(dueAt)&&dueAt<end)rows.push({id:reminder.id,title:reminder.title,dueAt:iso(dueAt),status:'open'});
  if(reminder.status==='completed'&&Number.isFinite(dueAt)&&typeof reminder.completedAt==='number'&&reminder.completedAt>=start&&reminder.completedAt<end)rows.push({id:reminder.id,title:reminder.title,dueAt:iso(dueAt),status:'completed',completedAt:iso(reminder.completedAt)});
  for(const done of reminder.history??[])if(Number.isFinite(done.dueAt)&&done.completedAt>=start&&done.completedAt<end)rows.push({id:reminder.id,title:reminder.title,dueAt:iso(done.dueAt),status:'completed',completedAt:iso(done.completedAt)});
 }
 const unique=[...new Map(rows.map(row=>[JSON.stringify([row.id,row.dueAt,row.status]),row])).values()].sort((a,b)=>a.dueAt.localeCompare(b.dueAt)||a.id.localeCompare(b.id));
 if(unique.length>operation.maximumItems)throw new WorkflowReminderOverflow(operation.maximumItems,unique.filter(row=>row.status==='open'&&Date.parse(row.dueAt)<start).length);
 const result={kind:'reminders' as const,reminders:await Promise.all(unique.map(async row=>({...row,revision:await workflowSha(workflowReminderRevisionInput(row))})))};
 const checked=await validateWorkflowReadResult(operation,result);
 if(checked.kind!=='reminders')throw new Error('Workflow phone scope could not be verified');
 return checked;
}
