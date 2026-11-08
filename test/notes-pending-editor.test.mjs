import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from './fixtures/ts-source.mjs';
import {fileURLToPath} from 'node:url';
const sdk=process.env.ALPHA_NOTES_TEST_SDK??fileURLToPath(new URL('../.eliza/client-features/plugins/plugin-notes/src/client',import.meta.url));
// Use Node's normal test entry without a TS loader; transform the exact prepared modules.
const moduleUrl=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const contract=moduleUrl(stripTypeScriptTypes(readFileSync(sdk+'/notes-contract.ts','utf8'),{mode:'strip'}));
const store=moduleUrl(stripTypeScriptTypes(readFileSync(sdk+'/notes-store.ts','utf8'),{mode:'strip'}).replaceAll('./notes-contract.ts',contract));
const documentStore=moduleUrl(stripTypeScriptTypes(readFileSync(sdk+'/notes-document-store.ts','utf8'),{mode:'strip'}).replaceAll('./notes-store.ts',store).replaceAll('./notes-contract.ts',contract));
const {DocumentNotesStore,NotesDocumentConflict}=await import(documentStore);
const {NotesCommitUncertain}=await import(store);
const source=readFileSync(new URL('../apps/app/src/prototype/agent-adapter.ts',import.meta.url),'utf8');
const start=source.indexOf('  p.vset = function (key: string'),end=source.indexOf('  p.api = function',start);
assert.ok(start>=0&&end>start);
const assignment=stripTypeScriptTypes(source.slice(start,end),{mode:'strip'});
const makeEditor=new Function('originalSet','stampNoteChanges','context','failedNotesStatus','keepNotesDraft','NotesCommitUncertain','NotesStorageFull','isStorageFull',`const p={};${assignment};return p.vset;`);
const {createNotesDraftSlot}=await import(moduleUrl(stripTypeScriptTypes(readFileSync(sdk+'/notes-draft.ts','utf8'),{mode:'strip'})));
const slice=(from,to,wrap=code=>code)=>{const a=source.indexOf(from),b=source.indexOf(to,a);assert.ok(a>=0&&b>a,from);return stripTypeScriptTypes(wrap(source.slice(a,b)),{mode:'strip'});};
// The real draft keeper, failure status and agent-write fallback, and the real approved agent Notes write.
const helpers=slice('  /** Status for a Notes save','  /** Android Notes recovery');
const makeHelpers=new Function('isAndroid','SecureNotesStore','secureConnectionStore','notesDataset','originalSet','setTimeout','clearTimeout',`${helpers};return {failedNotesStatus,keepNotesDraft,armNotesAgentFallback};`);
const agentWrite=slice('      if(isNotesOperation(operation)){',"      if(operation.type==='read_calendar_range'&&agendaSource){",code=>`async function notesWrite(operation,operationId,signal,expectedContext){${code}throw Error('not a Notes write');}`);
const makeAgent=new Function('isNotesOperation','context','alphaClient','document','window','withNotesDeletionLock','editNotesTrash','addNotesTrashEntry','isNotesTrashFull','presentDeviceRecordOperation','armNotesAgentFallback','NotesCommitUncertain','NotesStorageFull','failedNotesStatus','originalSet',`${agentWrite};return notesWrite;`);
const DRAFT_SLOT='notes-draft:test';
const SecureNotesStore={saveDraft:(vault,input)=>createNotesDraftSlot(vault,DRAFT_SLOT).save(input),readDraft:vault=>createNotesDraftSlot(vault,DRAFT_SLOT).read()};
async function fixture(initial=[{id:'fixture-note',kind:'text',title:'Initial',body:'Saved body'}]){
 let saved,revision=0,blocked=false,refuse=0,operations=0,trash=[];
 const started=Promise.withResolvers(),gate=Promise.withResolvers();
 const port={initialize:async create=>saved??(saved={revision:String(++revision),raw:create(null,null)}),read:async()=>({...saved}),compareExchange:async(expected,raw)=>{
  if(blocked){started.resolve();await gate.promise;}
  if(refuse&&--refuse===0)throw new NotesDocumentConflict('Refused');
  if(saved.revision!==expected.revision||saved.raw!==expected.raw)throw new NotesDocumentConflict('Foreign revision');
  return saved={revision:String(++revision),raw};
 }};
 const slots=new Map(),vault={read:async key=>slots.has(key)?structuredClone(slots.get(key)):null,compareExchange:async(key,expected,value)=>{
  if(JSON.stringify(slots.get(key)??null)!==JSON.stringify(expected))return {status:'conflict'};
  if(value===null)slots.delete(key);else slots.set(key,structuredClone(value));return {status:'saved'};
 }};
 const store=await DocumentNotesStore.open(port,initial);
 const state={list:store.list,storageStatus:''},toasts=[],timers=[];
 const shell={notesSourceMode:'legacy',notesStore:store,notesRaw:store.raw,notesPending:0,notesStorageFailed:false,live:true,vget:()=>state,toast:text=>toasts.push(text),api:()=>({})};
 const originalSet=function(_key,patch){Object.assign(state,patch);};
 const helper=makeHelpers(true,SecureNotesStore,vault,()=>{},originalSet,fn=>timers.push(fn),()=>{});
 const editor=makeEditor(originalSet,(_old,next)=>next,()=>{},helper.failedNotesStatus,helper.keepNotesDraft,NotesCommitUncertain,class NotesStorageFull extends Error{},()=>false);
 const context={view:'notes',sensitive:false};
 const agent=makeAgent(()=>true,()=>{},{getState:()=>({context})},{hidden:false},{dispatchEvent(){}},fn=>fn(),edit=>{trash=edit(trash);},(doc,entry)=>[...doc,entry],()=>false,()=>({appliedSummary:'Done'}),helper.armNotesAgentFallback,NotesCommitUncertain,class NotesStorageFull extends Error{},helper.failedNotesStatus,originalSet);
 const editNote=(id,patch)=>editor.call(shell,'notes',{list:shell.notesStore.list.map(n=>n.id===id?{...n,...patch}:n)});
 return {store,shell,state,toasts,timers,
  edit:patch=>editor.call(shell,'notes',{list:shell.notesStore.list.map(n=>({...n,...patch}))}),editNote,
  agent:operation=>agent.call(shell,operation,'op-'+ ++operations,new AbortController().signal,context),
  draft:async()=>{await shell.notesDraftTask;return SecureNotesStore.readDraft(vault);},trash:()=>trash,
  // Reopening Previous notes adopts the saved collection and keeps an earlier draft unapplied (selectNotesSource).
  reopen:async()=>{await shell.notesDraftTask;const next=await DocumentNotesStore.open(port);Object.assign(shell,{notesStore:next,notesRaw:next.raw,notesStorageFailed:false,notesCommitUncertain:false,notesDraftSaved:null,notesDraftKept:await SecureNotesStore.readDraft(vault)});state.list=next.list;},
  // The committed refresh after an agent write adopts the store (notesCommittedHandler).
  adopt:()=>{shell.notesRaw=shell.notesStore.raw;shell.notesAgentRaw=null;state.list=shell.notesStore.list;},
  hold:()=>{blocked=true;},refuseCommit:n=>{refuse=n;},started:started.promise,release:()=>gate.resolve(),saved:()=>JSON.parse(saved.raw),foreign:body=>{const value=JSON.parse(saved.raw);value.records[0].body=body;saved={revision:String(++revision),raw:JSON.stringify(value)};}};
}
test('consecutive editor inputs settle both own CAS writes without false recovery',async()=>{
 const f=await fixture();f.hold();const first=f.edit({title:'Pending title'});await f.started;
 const second=f.edit({body:'Body typed while title saves'});f.release();
 assert.equal(await first,true);assert.equal(await second,true);
 assert.equal(f.saved().records[0].title,'Pending title');assert.equal(f.saved().records[0].body,'Body typed while title saves');
 assert.equal(f.shell.notesPending,0);assert.equal(f.shell.notesStorageFailed,false);assert.equal(await f.draft(),null);
});
test('foreign durable CAS still refuses queued local edits and keeps the latest editor draft',async()=>{
 const f=await fixture();f.hold();const first=f.edit({body:'First local edit'});await f.started;
 const second=f.edit({body:'Latest local draft'});f.foreign('Foreign committed body');f.release();
 assert.equal(await first,false);assert.equal(await second,false);
 assert.equal(f.saved().records[0].body,'Foreign committed body');assert.equal(f.state.list[0].body,'Latest local draft');
 assert.equal(f.shell.notesStorageFailed,true);assert.equal(f.store.needsRecovery,true);assert.equal((await f.draft()).records[0].body,'Latest local draft');
 assert.equal(f.shell.notesPending,0);
});

test('an edit while an approved agent Notes write lands is refused without a storage failure',async()=>{
 const f=await fixture(),before=structuredClone(f.state.list);
 f.shell.notesAgentBusy=true;
 assert.equal(await f.edit({body:'Typed during the agent write'}),false);
 f.shell.notesAgentBusy=false;
 // The agent's write committed; the editor has not adopted it yet.
 await f.store.replace(f.store.list.map(n=>({...n,body:'Agent body'})));f.shell.notesAgentRaw=f.store.raw;
 assert.equal(await f.edit({body:'Typed before the refresh'}),false);
 assert.deepEqual(f.toasts,['Your agent is updating Notes. Try again in a moment.','Your agent is updating Notes. Try again in a moment.']);
 assert.deepEqual(f.state.list,before,'the view stays clean against the last adopted collection');
 assert.equal(f.shell.notesStorageFailed,false);assert.equal(f.store.needsRecovery,false);assert.equal(await f.draft(),null);
 assert.equal(f.saved().records[0].body,'Agent body');
 // After the committed refresh adopts the store, editing works again.
 f.shell.notesRaw=f.store.raw;f.shell.notesAgentRaw=null;f.state.list=f.store.list;
 assert.equal(await f.edit({body:'Edited after the refresh'}),true);assert.equal(f.saved().records[0].body,'Edited after the refresh');
});
test('overlapping commits with only the second refused keep the first commit as the saved baseline',async()=>{
 const f=await fixture();f.hold();f.refuseCommit(2);
 const first=f.edit({title:'First commit'});await f.started;
 const second=f.edit({body:'Second commit, refused'});f.release();
 assert.equal(await first,true);assert.equal(await second,false);
 assert.equal(f.saved().records[0].title,'First commit');
 assert.equal(f.shell.notesRaw,JSON.stringify(f.saved()),'notesRaw records exactly the bytes that landed');
 assert.equal(JSON.parse(f.shell.notesRaw).records[0].body,'Saved body');
 assert.equal((await f.draft()).records[0].body,'Second commit, refused','the draft holds the edit made after the first commit');
});
test('an agent create keeps the open note selection, so its own run context does not change',async()=>{
 const f=await fixture(),selection={kind:'note',id:'fixture-note',revision:'r1'};
 const create=keepSelection=>{f.shell.notesSelection=selection;f.shell.notesSelectionKey='key';return makeEditor(function(_key,patch){Object.assign(f.state,patch);},(_old,next)=>next,()=>{},()=>'',()=>{},NotesCommitUncertain,class extends Error{},()=>false).call(f.shell,'notes',{list:[{id:'created-'+keepSelection,kind:'text',title:'Milk',body:''},...f.store.list]},{keepSelection});};
 assert.equal(await create(true),true);assert.equal(f.shell.notesSelection,selection);assert.equal(f.shell.notesSelectionKey,'key');
 assert.equal(await create(false),true);assert.equal(f.shell.notesSelection,null,'an owner edit still republishes the selection');
});

const twoNotes=()=>[{id:'first-note',kind:'text',title:'First',body:'First body'},{id:'second-note',kind:'text',title:'Second',body:'Second body'}];
test('an approved agent update queued behind an in-flight editor save is refused and the editor write lands',async()=>{
 const f=await fixture(),target=await f.shell.notesStore.target('fixture-note');
 f.hold();const save=f.edit({body:'Owner body'});await f.started;
 const agent=f.agent({type:'notes_update',target,fields:{title:'Initial',body:'Agent body'}});
 assert.equal(f.shell.notesAgentBusy,true);
 assert.equal(await f.edit({body:'Typed during the agent write'}),false);
 f.release();
 assert.equal(await save,true);
 assert.deepEqual(await agent,{status:'failed',summary:'Selected note revision changed'});
 assert.equal(f.saved().records[0].body,'Owner body');assert.equal(f.shell.notesRaw,JSON.stringify(f.saved()));
 assert.equal(f.shell.notesAgentBusy,false);assert.equal(f.shell.notesAgentRaw,undefined);
 assert.equal(f.shell.notesStorageFailed,false);assert.equal(f.store.needsRecovery,false);assert.equal(await f.draft(),null);
 assert.deepEqual(f.toasts,['Your agent is updating Notes. Try again in a moment.']);
});
test('an agent update approved against an in-flight editor save commits on top of it, and edits wait for the refresh',async()=>{
 const f=await fixture();f.hold();const save=f.edit({title:'Owner title'});await f.started;
 const reading=f.shell.notesStore.target('fixture-note');f.release();
 assert.equal(await save,true);const target=await reading;
 const result=await f.agent({type:'notes_update',target,fields:{title:'Owner title',body:'Agent body'}});
 assert.equal(result.status,'succeeded');
 assert.equal(f.saved().records[0].title,'Owner title');assert.equal(f.saved().records[0].body,'Agent body');
 assert.equal(f.shell.notesAgentRaw,f.store.raw);assert.equal(f.timers.length,1,'the refresh fallback is armed');
 assert.equal(await f.edit({body:'Typed before the refresh'}),false);
 assert.deepEqual(f.toasts,['Your agent is updating Notes. Try again in a moment.']);assert.equal(f.saved().records[0].body,'Agent body');
 f.adopt();assert.equal(await f.edit({body:'Edited after the refresh'}),true);
 assert.equal(f.saved().records[0].title,'Owner title');assert.equal(f.saved().records[0].body,'Edited after the refresh');
 assert.equal(f.shell.notesStorageFailed,false);assert.equal(await f.draft(),null);
});
test('a draft kept after a foreign write survives reopening and merges with the next failed save',async()=>{
 const f=await fixture(twoNotes());f.foreign('Foreign body');
 assert.equal(await f.editNote('second-note',{body:'Kept second body'}),false);
 const kept=await f.draft();
 assert.deepEqual(kept.records.map(n=>[n.id,n.body]),[['second-note','Kept second body']]);assert.equal(kept.reason,'failed');
 assert.equal(f.state.storageStatus,'Not saved. Your changes are kept in an encrypted draft on this phone.');
 assert.deepEqual(f.toasts,['Can\'t save. Your text is still here.']);
 await f.reopen();
 assert.deepEqual(f.shell.notesDraftKept,kept);
 assert.deepEqual(f.saved().records.map(n=>n.body),['Foreign body','Second body'],'the draft is never applied on reopen');
 // A save after reopening lands without touching the kept draft.
 assert.equal(await f.editNote('first-note',{title:'Saved after reopening'}),true);assert.deepEqual(await f.draft(),kept);
 f.foreign('Second foreign body');
 assert.equal(await f.editNote('first-note',{body:'Lost to a second foreign write'}),false);
 const merged=await f.draft();
 assert.deepEqual(merged.records.map(n=>[n.id,n.body]).sort(),[['first-note','Lost to a second foreign write'],['second-note','Kept second body']]);
 assert.equal(f.saved().records[0].body,'Second foreign body');assert.equal(f.saved().records[0].title,'Saved after reopening');
});
test('an agent delete of a note with a kept draft edit moves it to Trash and the draft keeps the edit',async()=>{
 const f=await fixture(twoNotes());f.foreign('Foreign body');
 assert.equal(await f.editNote('second-note',{body:'Kept second body'}),false);
 await f.reopen();
 const target=await f.shell.notesStore.target('second-note');
 assert.equal((await f.agent({type:'notes_delete',target})).status,'succeeded');
 assert.deepEqual(f.saved().records.map(n=>n.id),['first-note']);
 assert.deepEqual(f.trash().map(entry=>[entry.id,entry.note.id,entry.note.body]),[['op-1','second-note','Second body']]);
 assert.deepEqual((await f.draft()).records.map(n=>[n.id,n.body]),[['second-note','Kept second body']],'the agent write leaves the draft slot alone');
 f.adopt();f.foreign('Second foreign body');
 assert.equal(await f.editNote('first-note',{body:'First edit refused'}),false);
 assert.deepEqual((await f.draft()).records.map(n=>[n.id,n.body]).sort(),[['first-note','First edit refused'],['second-note','Kept second body']]);
 assert.equal(f.state.storageStatus,'Not saved. Your changes are kept in an encrypted draft on this phone.');
 assert.deepEqual(f.saved().records.map(n=>n.id),['first-note'],'the deleted note is not revived');
});
