import type {Reminder} from '../daily';
import {rendererDeletionClock,claimDeletion,deletionDeadline,deletionWindow,type PendingDeletion} from '../../../../.eliza/client-features/packages/contracts/src/deletion-window';
import {revision} from './revision';
export type DeletableReminder=Reminder&{revision:string;pendingDeletion?:string};
export type ReminderDeletion=PendingDeletion<{sourceRevision:string;row:DeletableReminder}>&{blocked?:string;binding?:string;journalBinding?:{scope:string;proposalId:string;operationHash:string}};
export type ReminderDeletionState={sourceRevision:string;reminders:DeletableReminder[];deletions?:Record<string,ReminderDeletion>};
export function stageReminderDeletion(data:ReminderDeletionState,row:DeletableReminder,owner:string,id:string=crypto.randomUUID(),binding?:string){
 if(row.pendingDeletion||row.status==='cancelled'||data.deletions?.[id])throw Error('Reminder deletion already pending or settled.');
 const terminal=Object.values(data.deletions||{}).filter(e=>['deleted','undone','conflict'].includes(e.phase)).sort((a,b)=>a.deadline.createdElapsed-b.deadline.createdElapsed);
 for(const entry of terminal.slice(0,Math.max(0,terminal.length-127)))delete data.deletions![entry.id];
 if(Object.keys(data.deletions||{}).length>=500)throw Error('Pending reminder deletions require review.');
 const entry:ReminderDeletion={version:1,id,owner,target:{sourceRevision:data.sourceRevision,row:structuredClone(row)},deadline:deletionDeadline(rendererDeletionClock()),phase:'queued',...(binding?{binding}:{})};
 (data.deletions??={})[id]=entry;row.pendingDeletion=id;return structuredClone(entry);
}
export function settleReminderDeletions(data:ReminderDeletionState,ownerCurrent:(owner:string)=>boolean){
 const clock=rendererDeletionClock();
 for(const entry of Object.values(data.deletions||{})){
  if(entry.phase!=='queued'||deletionWindow(entry.deadline,clock)!=='expired')continue;
  if(!ownerCurrent(entry.owner)){entry.phase='paused';entry.blocked='owner-changed';continue;}
  const row=data.reminders.find(r=>r.id===entry.target.row.id),copy=row?{...row}:undefined;if(copy)delete copy.pendingDeletion;
  if(data.sourceRevision!==entry.target.sourceRevision||row?.pendingDeletion!==entry.id||JSON.stringify(copy)!==JSON.stringify(entry.target.row)){entry.phase='conflict';continue;}
  if(!claimDeletion(entry,entry.owner,clock,'dispatch'))continue;
  delete row.pendingDeletion;row.status='cancelled';row.cancelledAt=Date.now();row.revision=revision();entry.phase='deleted';
 }
}
export function undoReminderDeletion(data:ReminderDeletionState,id:string,ownerCurrent:(owner:string)=>boolean){
 const entry=data.deletions?.[id];if(!entry||!ownerCurrent(entry.owner))throw Error('Deletion owner changed.');
 const row=data.reminders.find(r=>r.id===entry.target.row.id),copy=row?{...row}:undefined;if(copy)delete copy.pendingDeletion;
 if(data.sourceRevision!==entry.target.sourceRevision||row?.pendingDeletion!==id||JSON.stringify(copy)!==JSON.stringify(entry.target.row))throw Error('Reminder changed. Review it again.');
 if(!claimDeletion(entry,entry.owner,rendererDeletionClock(),'undo'))throw Error('Undo window ended or deletion already settled.');
 // Removing only suspension preserves occurrence identity, original due time and revision.
 // Normal due reconciliation then applies its existing missed-occurrence policy.
 delete row.pendingDeletion;return structuredClone(entry);
}
export function guardPendingReminderChanges(before:ReminderDeletionState,after:ReminderDeletionState){
 for(const entry of Object.values(before.deletions||{})){
  if(!['queued','paused'].includes(entry.phase)||after.deletions?.[entry.id]?.phase!==entry.phase)continue;
  const prior=before.reminders.find(r=>r.id===entry.target.row.id),current=after.reminders.find(r=>r.id===entry.target.row.id);
  if(after.sourceRevision!==before.sourceRevision||JSON.stringify(prior)!==JSON.stringify(current))throw Error('Undo or finish the pending deletion before changing this reminder.');
 }
}
