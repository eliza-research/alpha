import type {JournalEntry} from '../runtime/device-actions';
import type {CalendarDeletion} from './calendar-deletions';
import type {ReminderDeletion,DeletableReminder} from './reminder-deletions';
export function browserDeletionRecovery(entry:JournalEntry,saved:CalendarDeletion|ReminderDeletion|null,row?:DeletableReminder){
 if(!saved||saved.id!==entry.operationId||!entry.attemptId||entry.phase!=='applying'&&entry.status!=='unknown')return null;
 const binding=saved.journalBinding;if(!binding||binding.scope!==entry.scope||binding.proposalId!==entry.proposalId||binding.operationHash!==entry.operationHash)return null;
 const r=entry.record,owner='agent:'+JSON.stringify([r.origin,r.ownerId,r.agentId,r.sessionId,r.installationId,r.enrollmentId]);if(saved.owner!==owner)return null;
 const operation=r.operation as {type:string;target:Record<string,unknown>},target=operation.target,original=saved.target.row;
 if(saved.target.sourceRevision!==target.sourceRevision||original.revision!==target.revision)return null;
 if(operation.type==='calendar_delete'&&(target.sourceId!=='local'||original.id!==target.eventId))return null;
 if(operation.type==='reminder_cancel'&&(target.sourceId!=='browser-reminders'||original.id!==target.reminderId||!('occurrenceId' in original)||original.occurrenceId!==target.occurrenceId))return null;
 if(!['calendar_delete','reminder_cancel'].includes(operation.type)||!['deleted','undone','conflict'].includes(saved.phase))return null;
 const result:Record<string,unknown>={operationId:entry.operationId};
 if(saved.phase==='deleted'){
  if(operation.type==='calendar_delete')result.calendarResult={version:1,kind:operation.type,sourceId:'local',eventId:original.id,revision:original.revision};
  else{
   if(!row||row.status!=='cancelled'||row.id!==original.id||!('occurrenceId' in original)||row.occurrenceId!==original.occurrenceId)return null;
   result.reminderResult={version:1,kind:operation.type,sourceId:'browser-reminders',reminderId:row.id,occurrenceId:row.occurrenceId,revision:row.revision,status:row.status,at:row.at,...(row.alertMinutes!==undefined?{dueAt:row.dueAt,alertMinutes:row.alertMinutes}:{})};
  }
 }
 return {status:saved.phase==='deleted'?'succeeded' as const:'failed' as const,summary:saved.phase==='deleted'?'Recovered':saved.phase==='undone'?'Undone':'Item changed',result};
}
