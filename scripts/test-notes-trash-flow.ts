import assert from 'node:assert/strict';
import {NotesStore} from '../apps/app/src/runtime/notes-store';
import {
 NOTES_TRASH_RETENTION_MS,addNotesTrashEntry,emptyNotesTrash,notesTrashDaysLabel,notesTrashDaysShort,notesTrashDaysLeft,notesTrashExpired,
 planNotesTrash,removeNotesTrashEntries,restoreNotesTrashEntry,sortedNotesTrash,validateNotesTrash,type NotesTrashDocument,type NotesTrashEntry,
 NOTES_TRASH_FULL_CODE,NOTES_TRASH_MAX_BYTES,NOTES_TRASH_MAX_ENTRIES,NotesTrashFull,notesTrashOverflows,
} from '../apps/app/src/runtime/notes-trash-policy';
import {createNotesTrashPolicy} from '../.eliza/client-features/plugins/plugin-notes/src/client/notes-trash-policy.ts';

const DAY=24*60*60*1000,R=30,t0=Date.UTC(2026,9,7,12);
assert.equal(NOTES_TRASH_RETENTION_MS,R*DAY);
const memory=()=>{const values=new Map<string,string>();return {getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);}};};
const text={id:'text-1',kind:'text',title:'Groceries',body:'Milk',pinned:false,createdAt:t0-DAY,modifiedAt:t0-DAY,custom:{kept:'verbatim'}};
const list={id:'list-1',kind:'list',title:'Packing',items:[{t:'Passport',done:true}],pinned:true};
const voice={id:'voice-1',kind:'voice',title:'Standup',body:'Transcript',audio:{audioId:'audio-1',noteId:'voice-1'}};
const entry=(note:any,id:string,deletedAt:number,index=0,extra:Partial<NotesTrashEntry>={}):NotesTrashEntry=>({id,note,index,deletedAt,...extra});

// Validation: absent storage is an empty Trash; malformed or ambiguous rows are refused, never guessed.
assert.deepEqual(validateNotesTrash(null),emptyNotesTrash());
for(const bad of [{version:2,entries:[]},{version:1,entries:{}},{version:1,entries:[],extra:true},
 {version:1,entries:[entry(text,'a',t0),entry(text,'b',t0)]},
 {version:1,entries:[entry(text,'a',t0),entry(list,'a',t0)]},
 {version:1,entries:[entry(text,'bad id!',t0)]},
 {version:1,entries:[entry(text,'a',0)]},
 {version:1,entries:[entry(text,'a',t0,-1)]},
 {version:1,entries:[entry(text,'a',t0,0,{audio:{audioId:'audio-1'}})]},
 {version:1,entries:[entry(voice,'a',t0,0,{audio:{audioId:'other'}})]},
 {version:1,entries:[entry(text,'a',t0,0,{target:{sourceId:'s',sourceRevision:'r',noteId:'other',revision:'x'}})]}])
 assert.throws(()=>validateNotesTrash(bad));

// Add: newest first; a fresh deletion of the same note replaces a stale row; an operation id is recorded once.
let doc:NotesTrashDocument=emptyNotesTrash();
doc=addNotesTrashEntry(doc,entry(text,'op-1',t0,0));
doc=addNotesTrashEntry(doc,entry(list,'op-2',t0+1000,1));
doc=addNotesTrashEntry(doc,entry(voice,'op-3',t0+2000,2,{audio:{audioId:'audio-1'}}));
assert.deepEqual(doc.entries.map(e=>e.id),['op-3','op-2','op-1']);
assert.throws(()=>addNotesTrashEntry(doc,entry(text,'op-1',t0)),/already recorded/);
const again=addNotesTrashEntry(doc,entry(text,'op-4',t0+5000,0));
assert.deepEqual(again.entries.map(e=>e.id),['op-4','op-3','op-2']);
assert.deepEqual(sortedNotesTrash(again).map(e=>e.id),['op-4','op-3','op-2']);
assert.deepEqual(removeNotesTrashEntries(doc,['op-2','missing']).entries.map(e=>e.id),['op-3','op-1']);
assert.deepEqual(JSON.parse(JSON.stringify(doc)),doc,'stored as plain JSON');

// Clock injection: the 3-day boundary is exact.
const row=entry(text,'op-1',t0);
assert.equal(notesTrashExpired(row,t0),false);
assert.equal(notesTrashExpired(row,t0+R*DAY-1),false);
assert.equal(notesTrashExpired(row,t0+R*DAY),true);
assert.equal(notesTrashExpired(row,t0+90*DAY),true);
assert.deepEqual([0,1,DAY-1,DAY,DAY+1,2*DAY,2*DAY+1,(R-1)*DAY+1,R*DAY-1,R*DAY,(R+1)*DAY].map(d=>notesTrashDaysLeft(row,t0+d)),[30,30,30,29,29,28,28,1,1,0,0]);
assert.equal(notesTrashDaysLabel(row,t0),'30 days left');
assert.equal(notesTrashDaysShort(row,t0+DAY),'29d');
assert.equal(notesTrashDaysLabel(row,t0+(R-1)*DAY+1),'1 day left');
assert.equal(notesTrashDaysLabel(row,t0+R*DAY),'Deleting permanently');
// A clock moved backwards never shows more than 30 days and never purges early; the purge waits for the wall clock.
assert.equal(notesTrashDaysLeft(row,t0-10*DAY),30);
assert.equal(notesTrashExpired(row,t0-10*DAY),false);
assert.deepEqual(planNotesTrash({version:1,entries:[row]},new Set(),t0-10*DAY).kept.map(e=>e.id),['op-1']);

// Planning: live notes are stale rows (undo, restore, uncommitted deletion); absent notes expire at 30 days.
const live=new Set(['list-1']);
let plan=planNotesTrash(doc,live,t0+R*DAY-1);
assert.deepEqual(plan.stale.map(e=>e.id),['op-2']);
assert.deepEqual(plan.expired.map(e=>e.id),[]);
assert.deepEqual(plan.kept.map(e=>e.id),['op-3','op-1']);
plan=planNotesTrash(doc,live,t0+R*DAY);
assert.deepEqual(plan.expired.map(e=>e.id),['op-1']);
plan=planNotesTrash(doc,live,t0+R*DAY+2000);
assert.deepEqual(plan.expired.map(e=>e.id),['op-3','op-1']);
// Idempotent: applying a plan and planning again leaves nothing to do, however often it runs.
let applied=removeNotesTrashEntries(doc,[...plan.stale,...plan.expired].map(e=>e.id));
for(let run=0;run<3;run++){const next=planNotesTrash(applied,live,t0+R*DAY+2000);assert.equal(next.stale.length+next.expired.length,0);applied=removeNotesTrashEntries(applied,[]);}
assert.deepEqual(applied.entries,[]);
// A failed recording purge is retained (not dropped) and simply planned again on the next run.
const retained=removeNotesTrashEntries(doc,['op-1','op-2']);
assert.deepEqual(planNotesTrash(retained,live,t0+(R+1)*DAY).expired.map(e=>e.id),['op-3']);

// Restore: exact record, original position (clamped), refuses to replace a live note with the same identity.
assert.deepEqual(restoreNotesTrashEntry([list],entry(text,'op',t0,0)),[text,list]);
assert.deepEqual(restoreNotesTrashEntry([list],entry(text,'op',t0,9)),[list,text]);
assert.throws(()=>restoreNotesTrashEntry([text],entry(text,'op',t0)),/already exists/);

// Identity and revision rules with the real shared store: a restored note has the same id and revision.
{
 const storage=memory(),store=new NotesStore(storage,[text,list]);
 const before=await store.target('text-1');
 const trashed=entry(store.list[0],'touch-op',t0,0,{target:before});
 store.replace(store.list.filter(n=>n.id!=='text-1'));
 await assert.rejects(store.target('text-1'));
 store.replace(restoreNotesTrashEntry(store.list,trashed));
 assert.deepEqual(store.list[0],text);
 assert.deepEqual(await store.target('text-1'),before,'restore keeps identity and revision');
 // Any edit after restore follows the normal revision rule.
 store.replace(store.list.map(n=>n.id==='text-1'?{...n,body:'Oat milk'}:n));
 assert.notEqual((await store.target('text-1')).revision,before.revision);
}
{
 // An approved agent deletion leaves a content-free tombstone; Trash holds the content under the same operation id.
 const storage=memory(),store=new NotesStore(storage,[text]);const target=await store.target('text-1');
 const trashDoc=addNotesTrashEntry(emptyNotesTrash(),entry(store.list[0],'agent-op',t0,0,{target}));
 await store.execute({type:'notes_delete',target},'agent-op',new AbortController().signal,()=>{});
 const envelope=JSON.parse(store.raw);
 assert.equal(JSON.stringify(envelope.deleted).includes('Milk'),false,'tombstone stays content-free');
 assert.deepEqual(envelope.deleted,[{id:'text-1',revision:target.revision,operationId:'agent-op'}]);
 assert.deepEqual(planNotesTrash(trashDoc,new Set(store.list.map(n=>n.id)),t0+DAY).kept.map(e=>e.id),['agent-op']);
 store.replace(restoreNotesTrashEntry(store.list,trashDoc.entries[0]));
 assert.deepEqual(await store.target('text-1'),target);
 assert.deepEqual(planNotesTrash(trashDoc,new Set(store.list.map(n=>n.id)),t0+DAY).stale.map(e=>e.id),['agent-op'],'restored note makes its row stale');
}
{
 // Capacity (MVP-15). A definite refusal is typed, computed from the product limits and never
 // confused with a malformed or duplicate entry; the refused document is unchanged.
 const small=(i:number)=>entry({id:`n${i}`,kind:'text',title:`T${i}`},`op-${i}`,t0+i,0);
 const atLimit:NotesTrashDocument={version:1,entries:Array.from({length:NOTES_TRASH_MAX_ENTRIES},(_,i)=>small(i))};
 const before=JSON.stringify(atLimit);
 assert.equal(notesTrashOverflows(atLimit,small(NOTES_TRASH_MAX_ENTRIES)),true);
 assert.throws(()=>addNotesTrashEntry(atLimit,small(NOTES_TRASH_MAX_ENTRIES)),(error:any)=>error instanceof NotesTrashFull&&error.code===NOTES_TRASH_FULL_CODE);
 assert.equal(JSON.stringify(atLimit),before,'a refused addition changes nothing');
 // Replacing the stale row of the same note does not grow Trash, so it is admitted at the limit.
 assert.equal(notesTrashOverflows(atLimit,entry({id:'n0',kind:'text',title:'Again'},'op-new',t0)),false);
 assert.equal(addNotesTrashEntry(atLimit,entry({id:'n0',kind:'text',title:'Again'},'op-new',t0)).entries.length,NOTES_TRASH_MAX_ENTRIES);
 // A duplicate operation or an invalid entry is not a capacity refusal.
 assert.equal(notesTrashOverflows(atLimit,small(1)),false);
 assert.throws(()=>addNotesTrashEntry(atLimit,small(1)),(error:any)=>!(error instanceof NotesTrashFull)&&/already recorded/.test(error.message));
 assert.throws(()=>addNotesTrashEntry(atLimit,entry({id:'x',kind:'unknown',title:''},'op-x',t0)),(error:any)=>!(error instanceof NotesTrashFull));
 // Byte limit: one oversized body is refused with the same typed error.
 const huge=entry({id:'huge',kind:'text',title:'Huge',body:'x'.repeat(NOTES_TRASH_MAX_BYTES)},'op-huge',t0);
 assert.equal(notesTrashOverflows(emptyNotesTrash(),huge),true);
 assert.throws(()=>addNotesTrashEntry(emptyNotesTrash(),huge),NotesTrashFull);

 // A document that already exceeds the product limits (written by a host with larger limits)
 // stays readable, plannable, restorable and reducible through the product functions.
 const over:NotesTrashDocument={version:1,entries:[...atLimit.entries,small(NOTES_TRASH_MAX_ENTRIES),small(NOTES_TRASH_MAX_ENTRIES+1)]};
 assert.equal(validateNotesTrash(over).entries.length,NOTES_TRASH_MAX_ENTRIES+2);
 assert.equal(sortedNotesTrash(over)[0].id,`op-${NOTES_TRASH_MAX_ENTRIES+1}`);
 assert.deepEqual(restoreNotesTrashEntry([],over.entries[0]),[over.entries[0].note]);
 assert.throws(()=>addNotesTrashEntry(over,small(NOTES_TRASH_MAX_ENTRIES+2)),NotesTrashFull);
 const reducedOver=removeNotesTrashEntries(over,['op-0']);
 assert.equal(reducedOver.entries.length,NOTES_TRASH_MAX_ENTRIES+1,'a reduction that is still above the limit is accepted');
 const expiredPlan=planNotesTrash(over,new Set(['n1']),t0+R*DAY+5);
 assert.deepEqual([expiredPlan.stale.map(e=>e.id),expiredPlan.expired.length,expiredPlan.kept.length],[['op-1'],5,NOTES_TRASH_MAX_ENTRIES+2-6],'expiry is planned above the limit');
 const purged=removeNotesTrashEntries(over,[...expiredPlan.stale,...expiredPlan.expired].map(e=>e.id));
 assert.equal(purged.entries.length,NOTES_TRASH_MAX_ENTRIES-4);
 assert.equal(addNotesTrashEntry(purged,small(NOTES_TRASH_MAX_ENTRIES+2)).entries.length,NOTES_TRASH_MAX_ENTRIES-3,'additions resume once below the limit');
}
{
 // The consumed upstream capacity fix (elizaOS PR 34649, in the pin): the same stored bytes,
 // read by a later host whose entry and byte limits are both lower than the stored document.
 const options={retentionMs:NOTES_TRASH_RETENTION_MS,kinds:['text','list','voice','link'],recordingKind:'voice'};
 const larger=createNotesTrashPolicy({...options,maxEntries:100,maxBytes:1024*1024});
 let stored=larger.empty();
 const notes=[text,list,voice,{id:'link-1',kind:'link',title:'Link',url:'https://example.test/a'},{id:'text-2',kind:'text',title:'Long',body:'y'.repeat(4000)}];
 notes.forEach((note,i)=>{stored=larger.add(stored,entry(note,`big-${i}`,t0+i*1000,i,note.id==='voice-1'?{audio:{audioId:'audio-1'}}:{}));});
 const bytes=JSON.stringify(stored);
 const smaller=createNotesTrashPolicy({...options,maxEntries:2,maxBytes:512});
 assert.ok(new TextEncoder().encode(bytes).length>512&&stored.entries.length>2);
 // Readable: every entry, exact content, byte-identical.
 const reread=smaller.validate(JSON.parse(bytes));
 assert.equal(JSON.stringify(reread),bytes);
 assert.deepEqual(smaller.sorted(reread).map(e=>e.id),['big-4','big-3','big-2','big-1','big-0']);
 // Restorable: the exact text record and the voice record with its recording binding.
 assert.deepEqual(smaller.restore([],reread.entries.find(e=>e.id==='big-0')!),[text]);
 assert.deepEqual(smaller.restore([text],reread.entries.find(e=>e.id==='big-2')!),[text,voice]);
 assert.deepEqual(reread.entries.find(e=>e.id==='big-2')!.audio,{audioId:'audio-1'});
 // Only new additions enforce capacity.
 assert.throws(()=>smaller.add(reread,entry({id:'new',kind:'text',title:'New'},'new-op',t0)),/full/);
 // Purgeable one entry at a time while still above both limits, and by expiry.
 let reduced=smaller.remove(reread,['big-4']);
 assert.equal(reduced.entries.length,4);
 assert.ok(new TextEncoder().encode(JSON.stringify(reduced)).length>512,'still above the lowered byte limit after one removal');
 const due=smaller.plan(reduced,new Set(),t0+R*DAY+1000);
 assert.deepEqual(due.expired.map(e=>e.id),['big-1','big-0']);
 reduced=smaller.remove(reduced,due.expired.map(e=>e.id));
 assert.deepEqual(reduced.entries.map(e=>e.id),['big-3','big-2']);
 assert.throws(()=>smaller.add(reduced,entry({id:'new',kind:'text',title:'New'},'new-op',t0)),/full/,'two entries are at the lowered entry limit');
 reduced=smaller.remove(reduced,['big-2','big-3']);
 assert.deepEqual(smaller.add(reduced,entry({id:'new',kind:'text',title:'New'},'new-op',t0)).entries.map(e=>e.id),['new-op']);
}

// MVP-15 startup backstop: the plan for an interrupted permanent voice deletion is the shared
// plugin-notes recording-deletion module; every combination of evidence is enumerated upstream
// (plugins/plugin-notes/test/notes-recording-deletion.test.mjs). Alpha re-exports that plan.
{
 const alpha=await import('../apps/app/src/runtime/permanent-voice-deletion');
 const shared=await import('../.eliza/client-features/plugins/plugin-notes/src/client/notes-recording-deletion.ts');
 assert.equal(alpha.planInterruptedPermanentDeletion,shared.planInterruptedPermanentDeletion);
 assert.equal(alpha.planInterruptedPermanentDeletion({note:'deleted',recording:{ownedByNote:true,inAudioTrash:false},receipt:'unknown',referencedElsewhere:false}),'trash-then-erase');
}
console.log('notes trash flow ok');
