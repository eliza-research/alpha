import {emptyDraft,type DraftState} from './message-draft.ts';
import type {DurableDraft,DurableDraftStore} from '../../../../.eliza/client-features/packages/ui/src/state/durable-draft.ts';

/**
 * The SMS draft slot of one thread, kept on this phone only (AC-10, AC-30, AC-31): the Android secure
 * slot `sms-draft:v1:` + SHA-256 of the thread id, or the browser key `alpha.browser.sms-draft:v1:…`.
 * There is no recovery prompt: a slot that no longer reads as a draft is reset to empty.
 */
export async function smsDraftStore(threadId:string):Promise<DurableDraftStore>{
 /* Loaded on first use: Messages renders before any thread's slot is read. */
 return (await import('./assistant-draft-store.ts')).durableDraftSlotStore('sms-draft:v1:',threadId,null);
}

const SMS_TEXT_LIMIT=1600;
type SlotDraft='none'|'owner'|'asked';
const SLOT_DRAFTS:readonly string[]=['none','owner','asked'];
const UNDO_DRAFTS:readonly string[]=['owner','agent','asked'];
const exactKeys=(value:Record<string,unknown>,keys:string)=>Object.keys(value).sort().join(',')===keys;
const isRecord=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);

/** The saved text of a slot. An automatic suggestion is for the visit only and is never saved. */
export function smsDraftText(state:Pick<DraftState,'draft'|'text'|'undo'>):string{
 const draft:SlotDraft=state.draft==='agent'?'none':state.draft;
 return JSON.stringify({v:1,draft,text:draft==='none'?'':state.text,undo:state.undo});
}
/** Reads only the exact saved shape `{v:1, draft, text, undo}`; anything else is an empty slot. */
export function readSmsDraftText(raw:string):DraftState{
 let value:unknown;
 try{value=JSON.parse(raw);}catch{return emptyDraft();}
 if(!isRecord(value)||!exactKeys(value,'draft,text,undo,v')||value.v!==1)return emptyDraft();
 const {draft,text,undo}=value;
 if(typeof draft!=='string'||!SLOT_DRAFTS.includes(draft)||typeof text!=='string'||text.length>SMS_TEXT_LIMIT||(draft==='none')!==(text===''))return emptyDraft();
 if(undo!==null&&!(isRecord(undo)&&exactKeys(undo,'draft,text')&&typeof undo.draft==='string'&&UNDO_DRAFTS.includes(undo.draft)&&typeof undo.text==='string'&&undo.text!==''&&undo.text.length<=SMS_TEXT_LIMIT))return emptyDraft();
 return {...emptyDraft(),draft:draft as SlotDraft,text,undo:undo as DraftState['undo']};
}

type Slot={store:Promise<DurableDraftStore>;row:DurableDraft|null;read:boolean;queue:Promise<unknown>};
/**
 * The saved slots of the threads opened this visit. Reads and writes of one thread run in order;
 * a write that meets another writer's row reads it again and writes once more.
 */
export function smsDraftSlots(open:(threadId:string)=>Promise<DurableDraftStore>=smsDraftStore){
 const slots=new Map<string,Slot>();
 const slot=(threadId:string)=>{let found=slots.get(threadId);if(!found){found={store:open(threadId),row:null,read:false,queue:Promise.resolve()};slots.set(threadId,found);}return found;};
 const run=<T>(threadId:string,task:(found:Slot,store:DurableDraftStore)=>Promise<T>):Promise<T>=>{
  const found=slot(threadId),next=found.queue.then(async()=>task(found,await found.store));
  found.queue=next.catch(()=>{});return next;
 };
 const reread=async(found:Slot,store:DurableDraftStore)=>{found.row=await store.read();found.read=true;};
 return {
  load:(threadId:string):Promise<DraftState>=>run(threadId,async(found,store)=>{await reread(found,store);return readSmsDraftText(found.row?.text??'');}),
  save:(threadId:string,state:Pick<DraftState,'draft'|'text'|'undo'>):Promise<void>=>run(threadId,async(found,store)=>{
   const text=smsDraftText(state);
   if(!found.read)await reread(found,store);
   if((found.row?.text??smsDraftText(emptyDraft()))===text)return;
   try{found.row=await store.save(found.row,text);}
   catch{await reread(found,store);found.row=await store.save(found.row,text);}
  }),
  clear:()=>slots.clear(),
 };
}
