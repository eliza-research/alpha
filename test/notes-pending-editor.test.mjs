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
const makeEditor=new Function('originalSet','stampNoteChanges','context','failedNotesStatus','keepNotesDraft','resumeNotesDraft','NotesCommitUncertain','NotesStorageFull','isStorageFull',`const p={};${assignment};return p.vset;`);
async function fixture(){
 let saved,revision=0,blocked=false;
 const started=Promise.withResolvers(),gate=Promise.withResolvers();
 const port={initialize:async create=>saved??(saved={revision:String(++revision),raw:create(null,null)}),read:async()=>({...saved}),compareExchange:async(expected,raw)=>{
  if(blocked){started.resolve();await gate.promise;}
  if(saved.revision!==expected.revision||saved.raw!==expected.raw)throw new NotesDocumentConflict('Foreign revision');
  return saved={revision:String(++revision),raw};
 }};
 const store=await DocumentNotesStore.open(port,[{id:'fixture-note',kind:'text',title:'Initial',body:'Saved body'}]);
 const state={list:store.list,storageStatus:''},drafts=[],toasts=[];
 const shell={notesSourceMode:'legacy',notesStore:store,notesRaw:store.raw,notesPending:0,notesStorageFailed:false,live:true,vget:()=>state,toast:text=>toasts.push(text)};
 const editor=makeEditor(function(_key,patch){Object.assign(state,patch);},(_old,next)=>next,()=>{},()=> 'Save unconfirmed',(_shell,list)=>drafts.push(structuredClone(list)),()=>{},NotesCommitUncertain,class NotesStorageFull extends Error{},()=>false);
 return {store,shell,state,drafts,toasts,edit:patch=>editor.call(shell,'notes',{list:store.list.map(n=>({...n,...patch}))}),hold:()=>{blocked=true;},started:started.promise,release:()=>gate.resolve(),saved:()=>JSON.parse(saved.raw),foreign:body=>{const value=JSON.parse(saved.raw);value.records[0].body=body;saved={revision:String(++revision),raw:JSON.stringify(value)};}};
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
