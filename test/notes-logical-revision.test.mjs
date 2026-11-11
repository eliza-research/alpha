import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadNotesSource} from '../specs/quint/refinement/services/notes-store/module.mjs';
import {notesFixture} from '../specs/quint/refinement/services/notes-store/fixture.mjs';
const loaded=loadNotesSource([fileURLToPath(import.meta.url),fileURLToPath(new URL('../specs/quint/refinement/services/notes-store/fixture.mjs',import.meta.url))]);
const publicKeys=['createdAt','updatedAt','id','title','body','color'].sort();
function decoder(m,result){return m.createNotesClient({async fetch(){return {requestId:'notes-logical-revision',success:true,result};}});}

for(const [name,clock] of [['tied',[0]],['backward',[10,9,8,7,6,5,4,3,2,1,0]]]){
 test(`logical revision keeps edited identity visible with ${name} wall time`,async()=>{
  const m=await loaded,f=await notesFixture(m,{mode:'encrypted',clock});
  try{
   const service=await f.open();
   const a=await f.interact('create-note',{content:'Alpha'}),b=await f.interact('create-note',{content:'Beta'});
   const id=a.data.note.id;
   const result=await f.interact('update-note',{id,content:'Beta',expectedRevision:b.state.revision});
   const decoded=await decoder(m,result).interact('update-note',{id});
   assert.equal(decoded.note.id,id);assert.equal(service.snapshot().notes[0].id,id);
   assert.deepEqual(Object.keys(decoded.note).sort(),publicKeys);
   assert.deepEqual(Object.keys(result.state).sort(),['notes','revision','trash']);
   const raw=await f.raw();assert.equal(raw.noteRevisions[id],raw.revision);
   if(name==='tied')assert.equal(result.data.note.updatedAt,a.data.note.updatedAt);
   else assert.ok(result.data.note.updatedAt<a.data.note.updatedAt);
   const noChange=await f.interact('update-note',{id,content:'Beta',expectedRevision:raw.revision});
   assert.equal(noChange.state.revision,raw.revision+1);
   const after=await f.raw();const replay=await f.interact('create-note',{content:'Beta'});
   assert.equal(replay.data.note.id,id);assert.equal(replay.state.revision,after.revision);
   assert.deepEqual(await f.raw(),after);
   await service.stop();const restarted=await f.open();assert.equal(restarted.snapshot().notes[0].id,id);
  }finally{await f.close();}
 });
}

for(const version of [1,2,3])test(`legacy schema ${version} keeps timestamp fallback and gains order only on edit`,async()=>{
 const m=await loaded,f=await notesFixture(m,{clock:[0]});
 try{
  const service=await f.open({initialize:false});
  const note=(id,updatedAt)=>({id,title:'Same',body:version===1?'Body':'\nBody',color:'yellow',createdAt:'2025-01-01T00:00:00.000Z',updatedAt});
  const original={schemaVersion:version,revision:7,persistedAt:'2025-01-01T00:00:00.000Z',notes:[note('note-older','2025-01-01T00:00:00.000Z'),note('note-newer','2025-02-01T00:00:00.000Z')]};
  await fs.mkdir(path.dirname(service.store.filePath),{recursive:true});
  const bytes=JSON.stringify(original);await fs.writeFile(service.store.filePath,bytes);
  await service.initialize();assert.equal(service.snapshot().notes[0].id,'note-newer');
  assert.equal(await fs.readFile(service.store.filePath,'utf8'),bytes);
  const result=await f.interact('update-note',{id:'note-older',content:'Same\nBody',expectedRevision:7});
  await decoder(m,result).interact('update-note',{id:'note-older'});
  const raw=await f.raw();assert.equal(raw.schemaVersion,3);assert.deepEqual(raw.noteRevisions,{'note-older':8});
  assert.equal(service.snapshot().notes[0].id,'note-older');
  await service.stop();const restarted=await f.open();assert.equal(restarted.snapshot().notes[0].id,'note-older');
  assert.equal(restarted.snapshot().notes[0].body,'\nBody');
 }finally{await f.close();}
});

test('projection and metadata validation failures leave durable and cached notes unchanged',async()=>{
 const m=await loaded,f=await notesFixture(m,{mode:'encrypted'});
 try{
  const service=await f.open();const created=await f.interact('create-note',{content:'Original'});
  const before=await f.raw(),snapshot=service.snapshot();
  await assert.rejects(service.store.transact(draft=>{draft.notes[0].title='Uncommitted';},()=>{throw Error('controlled projection failure');}),/projection failure/);
  assert.deepEqual(await f.raw(),before);assert.deepEqual(service.snapshot(),snapshot);
  await assert.rejects(service.store.transact(draft=>{draft.noteRevisions['note-not-present']=0;}),error=>error.code==='NOTES_VALIDATION_FAILED');
  assert.deepEqual(await f.raw(),before);assert.deepEqual(service.snapshot(),snapshot);
  const projected=service.store.snapshot(document=>{document.notes[0].title='Detached';return document;});
  projected.notes[0].body='Also detached';assert.deepEqual(service.snapshot(),snapshot);assert.deepEqual(await f.raw(),before);
  await service.store.transact(draft=>{draft.notes=[];draft.trash=[];});
  assert.deepEqual((await f.raw()).noteRevisions,{});
  assert.equal(created.state.notes[0].title,'Original');
 }finally{await f.close();}
});

test('logical order survives raw document copy and stale encrypted views cannot overwrite it',async()=>{
 const m=await loaded,f=await notesFixture(m,{mode:'encrypted',clock:[0]});
 try{
  const first=await f.open();const a=await f.interact('create-note',{content:'A'},first);const b=await f.interact('create-note',{content:'B'},first);
  const stale=await f.open({freshPort:true});
  await f.interact('update-note',{id:a.data.note.id,content:'B',expectedRevision:b.state.revision},first);
  const failed=await f.interact('update-note',{id:b.data.note.id,content:'A',expectedRevision:b.state.revision},stale);
  assert.equal(failed.success,false);assert.equal(failed.error.code,'NOTES_EDIT_CONFLICT');
  const raw=await f.raw();assert.equal(raw.noteRevisions[a.data.note.id],3);
  const copy=await notesFixture(m);
  try{
   const copied=await copy.open({initialize:false});await fs.mkdir(path.dirname(copied.store.filePath),{recursive:true});
   await fs.writeFile(copied.store.filePath,JSON.stringify(raw));await copied.initialize();
   assert.deepEqual(copied.snapshot(),first.snapshot());assert.equal(copied.snapshot().notes[0].id,a.data.note.id);
  }finally{await copy.close();}
 }finally{await f.close();}
});

test('invalid persisted note revision metadata fails closed',async()=>{
 const m=await loaded;
 for(const revisions of [{'note-a':-1},{'note-a':1.5},{'note-a':2},{'note-missing':0}]){
  const f=await notesFixture(m,{mode:'encrypted'});
  try{
   const raw={schemaVersion:3,revision:1,persistedAt:'2026-01-01T00:00:00.000Z',notes:[{id:'note-a',title:'A',body:'',color:'yellow',createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z'}],trash:[],noteRevisions:revisions};
   const bytes=JSON.stringify(raw);f.backend.replace(bytes);const reader=await f.open({initialize:false});
   await assert.rejects(reader.initialize(),error=>error.code==='NOTES_VALIDATION_FAILED');
   assert.equal(reader.status().phase,'error');assert.equal(f.backend.raw,bytes);
  }finally{await f.close();}
 }
});
