import {rendererDeletionClock,claimDeletion,deletionDeadline,deletionWindow,type PendingDeletion} from '../../../../.eliza/client-features/packages/contracts/src/deletion-window';
import {calendarRecord,deleteCalendarRecord,type CalendarRecord} from './calendar-records';
import {revision} from './revision';
import {trimDeletionJournal} from './journal-retention';
export type CalendarDeletionTarget={sourceRevision:string;row:CalendarRecord;scope:'event'|'series'};
export type CalendarDeletion=PendingDeletion<CalendarDeletionTarget>&{blocked?:string;journalBinding?:{scope:string;proposalId:string;operationHash:string}};
export type CalendarDeletionState={sourceRevision:string;events:CalendarRecord[];deletions?:Record<string,CalendarDeletion>;deleteClaims?:Record<string,string>};
const unresolved=(entry:CalendarDeletion)=>entry.phase==='queued'||entry.phase==='paused';
/** A computed occurrence copies its series' revision and excluded dates, which change when a
 * sibling date is deleted or edited. Compare its own fields; a stored row compares exactly. */
function sameRow(rows:CalendarRecord[],current:CalendarRecord|undefined,expected:CalendarRecord|undefined){
 if(!current||!expected||!current.seriesId||rows.some(row=>row.id===current.id))return JSON.stringify(current)===JSON.stringify(expected);
 const own=({revision:_revision,excluded:_excluded,...row}:CalendarRecord)=>JSON.stringify(row);
 return own(current)===own(expected);
}
export function calendarDeletionPending(data:CalendarDeletionState,id:string):boolean{
 const row=calendarRecord(data.events,id);
 return Object.values(data.deletions||{}).some(entry=>unresolved(entry)&&(entry.target.row.id===id||entry.target.row.seriesId===id||entry.target.scope==='series'&&entry.target.row.id===row?.seriesId));
}
export function stageCalendarDeletion(data:CalendarDeletionState,row:CalendarRecord,scope:'event'|'series',owner:string,id:string=crypto.randomUUID()):CalendarDeletion{
 if(calendarDeletionPending(data,row.id))throw Error('This event already has a pending deletion.');
 const previous=data.deletions?.[id];if(previous)throw Error('Deletion identity already used.');
 trimDeletionJournal(data);
 if(Object.keys(data.deletions||{}).length>=500)throw Error('Pending deletion history requires review.');
 const entry:CalendarDeletion={version:1,id,owner,target:{sourceRevision:data.sourceRevision,row:structuredClone(row),scope},deadline:deletionDeadline(rendererDeletionClock()),phase:'queued'};
 (data.deletions??={})[id]=entry;return structuredClone(entry);
}
export function settleCalendarDeletions(data:CalendarDeletionState,ownerCurrent:(owner:string)=>boolean){
 const clock=rendererDeletionClock();
 for(const entry of Object.values(data.deletions||{})){
  if(entry.phase!=='queued'||deletionWindow(entry.deadline,clock)!=='expired')continue;
  if(!ownerCurrent(entry.owner)){entry.phase='paused';entry.blocked='owner-changed';continue;}
  // Each settled sibling changes the series, so every entry reads the current rows again.
  const current=calendarRecord(data.events,entry.target.row.id);
  if(data.sourceRevision!==entry.target.sourceRevision||!current||!sameRow(data.events,current,entry.target.row)){entry.phase='conflict';continue;}
  if(!claimDeletion(entry,entry.owner,clock,'dispatch'))continue;
  // The document CAS commits this exact row mutation and result together. A CAS
  // error is never retried by this function; the document owner reports uncertainty.
  data.events=deleteCalendarRecord(data.events,current,revision());entry.phase='deleted';
 }
}
export function undoCalendarDeletion(data:CalendarDeletionState,id:string,ownerCurrent:(owner:string)=>boolean){
 const entry=data.deletions?.[id];if(!entry||!ownerCurrent(entry.owner))throw Error('Deletion owner changed.');
 if(!claimDeletion(entry,entry.owner,rendererDeletionClock(),'undo'))throw Error('Undo window ended or deletion already settled.');return structuredClone(entry);
}
/** All document writers share this check, including editor and recurrence operations. */
export function guardPendingCalendarChanges(before:CalendarDeletionState,after:CalendarDeletionState){
 for(const entry of Object.values(before.deletions||{})){
  if(!unresolved(entry)||after.deletions?.[entry.id]?.phase!==entry.phase)continue;
  const current=calendarRecord(after.events,entry.target.row.id),prior=calendarRecord(before.events,entry.target.row.id);
  if(after.sourceRevision!==before.sourceRevision||!sameRow(after.events,current,prior))throw Error('Undo or finish the pending deletion before changing this event.');
 }
}
