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
 done.forEach(([id,row],index)=>{if(index<done.length-KEEP||row.at!==undefined&&now-row.at>AGE)delete rows[id];});
}
type Deletion={id:string;phase:string;deadline:DeletionDeadline};
/** Keep the newest settled deletions, and each agent replay claim only while its deletion is kept. */
export function trimDeletionJournal(data:{deletions?:Record<string,Deletion>;deleteClaims?:Record<string,string>}){
 const terminal=Object.values(data.deletions||{}).filter(e=>['deleted','undone','conflict'].includes(e.phase)).sort((a,b)=>a.deadline.createdElapsed-b.deadline.createdElapsed);
 for(const entry of terminal.slice(0,Math.max(0,terminal.length-SETTLED)))delete data.deletions![entry.id];
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
