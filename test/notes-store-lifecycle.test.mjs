import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadNotesSource} from '../specs/quint/refinement/services/notes-store/module.mjs';
import {notesFixture,deferred} from '../specs/quint/refinement/services/notes-store/fixture.mjs';
const loaded=loadNotesSource([fileURLToPath(import.meta.url),fileURLToPath(new URL('../specs/quint/refinement/services/notes-store/fixture.mjs',import.meta.url))]);

for(const mode of ['file','encrypted'])test(`Notes ${mode} stores share serialized writes and retire independently`,async()=>{
 const m=await loaded,f=await notesFixture(m,{mode});
 try{
  const first=await f.open(),second=await f.open();
  await Promise.all([f.interact('create-note',{content:'First'},first),f.interact('create-note',{content:'Second'},second)]);
  assert.equal(first.snapshot().revision,2);assert.deepEqual(first.snapshot(),second.snapshot());
  await first.stop();assert.equal(first.status().phase,'stopped');assert.equal(second.snapshot().notes.length,2);
  await second.stop();const restarted=await f.open();assert.equal(restarted.snapshot().revision,2);assert.equal(restarted.snapshot().notes.length,2);
 }finally{await f.close();}
});

test('encrypted successful CAS with failed readback has durable data but no success reply',async()=>{
 const m=await loaded,f=await notesFixture(m,{mode:'encrypted'});
 try{
  const service=await f.open();f.backend.nextRead='fail';
  await assert.rejects(f.interact('create-note',{content:'Durable unknown'}),error=>{
   assert.equal(error.code,'NOTES_STORE_WRITE_FAILED');assert.equal(error.cause?.message,'controlled encrypted read failure');return true;
  });
  assert.equal((await f.raw()).revision,1);assert.equal(service.status().phase,'error');
  assert.throws(()=>service.snapshot(),{code:'NOTES_STORE_WRITE_FAILED'});
  assert.equal(f.events.length,0);
  await assert.rejects(f.interact('create-note',{content:'Must not overwrite'}),{code:'NOTES_STORE_WRITE_FAILED'});
  assert.equal(f.events.length,0);
  assert.equal((await f.raw()).notes[0].title,'Durable unknown');
  await service.stop();const restarted=await f.open();assert.equal(restarted.snapshot().notes[0].title,'Durable unknown');
 }finally{await f.close();}
});

test('separate encrypted port views reject stale writes and readback does not silently refresh their cache',async()=>{
 const m=await loaded,f=await notesFixture(m,{mode:'encrypted'});
 try{
  const first=await f.open(),other=await f.open({freshPort:true});
  await f.interact('create-note',{content:'Winner'},first);
  const rejected=await f.interact('create-note',{content:'Stale'},other);
  assert.equal(rejected.success,false);assert.equal(rejected.error.code,'NOTES_EDIT_CONFLICT');
  assert.equal(other.snapshot().revision,0);assert.equal((await other.store.persistedSnapshot()).revision,1);
  assert.equal(other.snapshot().revision,0);
  await other.stop();const refreshed=await f.open({freshPort:true});assert.equal(refreshed.snapshot().revision,1);
 }finally{await f.close();}
});

test('stop drains an admitted write and rejects a later queued write on the retired store',async()=>{
 const m=await loaded,f=await notesFixture(m,{mode:'encrypted'});
 try{
  const service=await f.open(),held=deferred();f.backend.nextWrite=held;
  const first=f.interact('create-note',{content:'Admitted'});
  while(!f.backend.calls.some(call=>call.kind==='write'&&call.next.includes('Admitted')))await new Promise(resolve=>setImmediate(resolve));
  const stop=service.stop();const queued=f.interact('create-note',{content:'After stop'}).then(value=>({value}),error=>({error}));
  held.resolve();await first;await stop;const result=await queued;
  assert.equal(result.value?.success,false);assert.equal(result.value?.error.code,'NOTES_STORE_UNAVAILABLE');
  assert.equal((await f.raw()).notes.length,1);assert.equal(service.status().phase,'stopped');
 }finally{await f.close();}
});
