import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {fileURLToPath} from 'node:url';
const sdk=process.env.ALPHA_NOTES_TEST_SDK??fileURLToPath(new URL('../.eliza/client-features/plugins/plugin-notes/src/client',import.meta.url));
// Use Node's normal test entry without a TS loader; transform the exact prepared modules.
const moduleUrl=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const contract=moduleUrl(stripTypeScriptTypes(readFileSync(sdk+'/notes-contract.ts','utf8'),{mode:'transform'}));
const store=moduleUrl(stripTypeScriptTypes(readFileSync(sdk+'/notes-store.ts','utf8'),{mode:'transform'}).replaceAll('./notes-contract.ts',contract));
const documentStore=moduleUrl(stripTypeScriptTypes(readFileSync(sdk+'/notes-document-store.ts','utf8'),{mode:'transform'}).replaceAll('./notes-store.ts',store).replaceAll('./notes-contract.ts',contract));
const {DocumentNotesStore,NotesDocumentConflict}=await import(documentStore);
const {NotesCommitUncertain}=await import(store);
const source=readFileSync(new URL('../apps/app/src/prototype/agent-adapter.ts',import.meta.url),'utf8');
const start=source.indexOf('  p.vset = function (key: string'),end=source.indexOf('  p.api = function',start);
assert.ok(start>=0&&end>start);
const assignment=stripTypeScriptTypes(source.slice(start,end),{mode:'transform'});
const makeEditor=new Function('originalSet','stampNoteChanges','context','failedNotesStatus','keepNotesDraft','NotesCommitUncertain','NotesStorageFull','isStorageFull',`const p={};${assignment};return p.vset;`);
async function fixture(){
 let saved,revision=0,blocked=false,refuse=0;
 const started=Promise.withResolvers(),gate=Promise.withResolvers();
 const port={initialize:async create=>saved??(saved={revision:String(++revision),raw:create(null,null)}),read:async()=>({...saved}),compareExchange:async(expected,raw)=>{
  if(blocked){started.resolve();await gate.promise;}
  if(refuse&&--refuse===0)throw new NotesDocumentConflict('Refused');
  if(saved.revision!==expected.revision||saved.raw!==expected.raw)throw new NotesDocumentConflict('Foreign revision');
  return saved={revision:String(++revision),raw};
 }};
 const store=await DocumentNotesStore.open(port,[{id:'fixture-note',kind:'text',title:'Initial',body:'Saved body'}]);
 const state={list:store.list,storageStatus:''},drafts=[],toasts=[];
 const shell={notesSourceMode:'legacy',notesStore:store,notesRaw:store.raw,notesPending:0,notesStorageFailed:false,live:true,vget:()=>state,toast:text=>toasts.push(text)};
 const editor=makeEditor(function(_key,patch){Object.assign(state,patch);},(_old,next)=>next,()=>{},()=> 'Save unconfirmed',(_shell,list)=>drafts.push(structuredClone(list)),NotesCommitUncertain,class NotesStorageFull extends Error{},()=>false);
 return {store,shell,state,drafts,toasts,edit:patch=>editor.call(shell,'notes',{list:store.list.map(n=>({...n,...patch}))}),hold:()=>{blocked=true;},refuseCommit:n=>{refuse=n;},started:started.promise,release:()=>gate.resolve(),saved:()=>JSON.parse(saved.raw),foreign:body=>{const value=JSON.parse(saved.raw);value.records[0].body=body;saved={revision:String(++revision),raw:JSON.stringify(value)};}};
}
test('consecutive editor inputs settle both own CAS writes without false recovery',async()=>{
 const f=await fixture();f.hold();const first=f.edit({title:'Pending title'});await f.started;
 const second=f.edit({body:'Body typed while title saves'});f.release();
 assert.equal(await first,true);assert.equal(await second,true);
 assert.equal(f.saved().records[0].title,'Pending title');assert.equal(f.saved().records[0].body,'Body typed while title saves');
 assert.equal(f.shell.notesPending,0);assert.equal(f.shell.notesStorageFailed,false);assert.equal(f.drafts.length,0);
});
test('foreign durable CAS still refuses queued local edits and keeps the latest editor draft',async()=>{
 const f=await fixture();f.hold();const first=f.edit({body:'First local edit'});await f.started;
 const second=f.edit({body:'Latest local draft'});f.foreign('Foreign committed body');f.release();
 assert.equal(await first,false);assert.equal(await second,false);
 assert.equal(f.saved().records[0].body,'Foreign committed body');assert.equal(f.state.list[0].body,'Latest local draft');
 assert.equal(f.shell.notesStorageFailed,true);assert.equal(f.store.needsRecovery,true);assert.equal(f.drafts.at(-1)[0].body,'Latest local draft');
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
 assert.equal(f.shell.notesStorageFailed,false);assert.equal(f.store.needsRecovery,false);assert.equal(f.drafts.length,0);
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
 assert.equal(f.drafts.at(-1)[0].body,'Second commit, refused','the draft holds the edit made after the first commit');
});
test('an agent create keeps the open note selection, so its own run context does not change',async()=>{
 const f=await fixture(),selection={kind:'note',id:'fixture-note',revision:'r1'};
 const create=keepSelection=>{f.shell.notesSelection=selection;f.shell.notesSelectionKey='key';return makeEditor(function(_key,patch){Object.assign(f.state,patch);},(_old,next)=>next,()=>{},()=>'',()=>{},NotesCommitUncertain,class extends Error{},()=>false).call(f.shell,'notes',{list:[{id:'created-'+keepSelection,kind:'text',title:'Milk',body:''},...f.store.list]},{keepSelection});};
 assert.equal(await create(true),true);assert.equal(f.shell.notesSelection,selection);assert.equal(f.shell.notesSelectionKey,'key');
 assert.equal(await create(false),true);assert.equal(f.shell.notesSelection,null,'an owner edit still republishes the selection');
});
