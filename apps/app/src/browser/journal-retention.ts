import {rendererDeletionClock,deletionWindow,type DeletionDeadline} from '../../../../.eliza/client-features/packages/contracts/src/deletion-window';
/** Shared bounds for the browser Calendar and Reminder journals. Only definite rows retire:
 * an unacknowledged creation or an unresolved deletion stays until it is resolved. */
const KEEP=200,AGE=30*86400000,SETTLED=127;
/** Operation identities are opaque, including names inherited by ordinary JS objects. */
export function journalEntry<T>(rows:Record<string,T>|undefined,id:string):T|undefined{
 return rows&&Object.hasOwn(rows,id)?rows[id]:undefined;
}
export function writeJournalEntry<T>(rows:Record<string,T>,id:string,row:T){
 Object.defineProperty(rows,id,{value:row,enumerable:true,writable:true,configurable:true});
}
/** Retire definite rows beyond the newest 200 or older than 30 days. Rows without a time
 * predate this policy; they count as oldest, in their saved order, and retire by count only. */
export function retireJournal<T extends {at?:number}>(rows:Record<string,T>|undefined,definite:(row:T)=>boolean,now=Date.now()){
 if(!rows)return;
 const done=Object.entries(rows).filter(([,row])=>definite(row)).sort(([,a],[,b])=>(a.at??0)-(b.at??0));
 done.forEach(([id,row],index)=>{if(journalRowRetires(index,done.length,row.at,now))delete rows[id];});
}
/** Whether the definite row at `index` of `doneCount` (oldest first) retires: by count when more
 * than 200 rows are newer or equal, by age when its time is more than 30 days before `now`. */
export function journalRowRetires(index:number,doneCount:number,at:number|undefined,now:number):boolean{
 //@ verify
 //@ ensures at !== undefined ==> (\result <==> index < doneCount - KEEP || now - at > AGE)
 //@ ensures at === undefined ==> (\result <==> index < doneCount - KEEP)
 //@ ensures index < doneCount - KEEP ==> \result
 //@ ensures !\result ==> index >= doneCount - KEEP
 //@ ensures !\result && at !== undefined ==> now - at <= AGE
 if(index<doneCount-KEEP)return true;
 if(at===undefined)return false;
 return now-at>AGE;
}
/** A deletion that reached an outcome. A queued or paused deletion is still undoable and is never trimmed. */
export function deletionSettled(phase:string):boolean{
 //@ verify
 //@ ensures \result <==> phase === 'deleted' || phase === 'undone' || phase === 'conflict'
 //@ ensures phase === 'queued' || phase === 'paused' ==> !\result
 return ['deleted','undone','conflict'].includes(phase);
}
/** How many of `terminal` settled deletions, oldest first, are trimmed so that at most 127 stay. */
export function settledDeletionsToTrim(terminal:number):number{
 //@ verify
 //@ requires terminal >= 0
 //@ ensures 0 <= \result && \result <= terminal
 //@ ensures terminal - \result <= SETTLED
 //@ ensures terminal <= SETTLED ==> \result === 0
 //@ ensures terminal > SETTLED ==> terminal - \result === SETTLED
 return Math.max(0,terminal-SETTLED);
}
type Deletion={id:string;phase:string;deadline:DeletionDeadline};
/** Keep the newest settled deletions, and each agent replay claim only while its deletion is kept. */
export function trimDeletionJournal(data:{deletions?:Record<string,Deletion>;deleteClaims?:Record<string,string>}){
 const terminal=Object.values(data.deletions||{}).filter(e=>deletionSettled(e.phase)).sort((a,b)=>a.deadline.createdElapsed-b.deadline.createdElapsed);
 for(const entry of terminal.slice(0,settledDeletionsToTrim(terminal.length)))delete data.deletions![entry.id];
 for(const id of Object.keys(data.deleteClaims||{}))if(!data.deletions||!Object.hasOwn(data.deletions,id))delete data.deleteClaims![id];
}
/** Undo polling runs every 500ms. Only an expired queued deletion may change the document;
 * any other edit mints a revision and replaces the one held by recovery and editors. */
export async function settleExpiredDeletions<T extends {deletions?:Record<string,Deletion>}>(document:{readRaw():Promise<string|null>;edit<D,R>(initial:()=>D,edit:(data:D)=>R):Promise<R>},initial:()=>T,settle:(data:T)=>void){
 const expired=(data:T)=>{
  const clock=rendererDeletionClock();
  return Object.values(data.deletions||{}).some(entry=>entry.phase==='queued'&&deletionWindow(entry.deadline,clock)==='expired');
 };
 const raw=await document.readRaw();if(raw===null||!expired(JSON.parse(raw)))return;
 const alreadySettled=Symbol('Deletion journal changed before settlement');
 try{
  await document.edit(initial,data=>{
   // The lock may have waited for another poll. Exit before its CAS can mint a no-op revision.
   if(!expired(data))throw alreadySettled;
   settle(data);
  });
 }catch(error){if(error!==alreadySettled)throw error;}
}
