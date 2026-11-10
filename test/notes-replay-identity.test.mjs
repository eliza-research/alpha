import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadNotesSource} from '../specs/quint/refinement/services/notes-store/module.mjs';
import {encryptedBackend} from '../specs/quint/refinement/services/notes-store/fixture.mjs';
const support=fileURLToPath(new URL('../specs/quint/refinement/services/notes-store/fixture.mjs',import.meta.url));

async function fixture(loaded, callback) {
  const stateDir=await fs.mkdtemp(path.join(os.tmpdir(),'quint-notes-identity-'));
  let next=0,tick=0;
  const store=new loaded.NotesStore({encryptedPort:encryptedBackend().port(),agentId:'notes-fixture'});
  const service=new loaded.NotesService(undefined,{store,createId:()=>`note-test-${++next}`,now:()=>new Date(1700000000000+tick++*1000)});
  try {
    await service.initialize();
    const send=(kind,params)=>loaded.interact(kind,params,service);
    const decode=(kind,params,result)=>loaded.createNotesClient({async fetch(){return {requestId:'notes-fixture-request',success:true,result};}}).interact(kind,params);
    await callback({service,store,send,decode,stateDir});
  } finally {await service.stop();await fs.rm(stateDir,{recursive:true,force:true});}
}

test('create replay returns the visible canonical identity without another write',async()=>{
  const loaded=await loadNotesSource([fileURLToPath(import.meta.url),support]);
  await fixture(loaded,async({service,store,send,decode})=>{
    const a=await send('create-note',{content:'Alpha'});
    const b=await send('create-note',{content:'Beta'});
    await send('update-note',{id:a.data.note.id,content:'Beta',expectedRevision:b.state.revision});
    const before=await store.persistedSnapshot();
    const replay=await send('create-note',{content:'Beta'});
    assert.equal(replay.data.replayed,true);
    assert.equal(replay.effectReceipts[0].outcome,'noop');
    assert.deepEqual(await store.persistedSnapshot(),before);
    assert.equal(before.notes.length,2);
    assert.equal(service.snapshot().notes.length,1);
    const reply=await decode('create-note',{content:'Beta'},replay);
    assert.equal(reply.note.id,a.data.note.id);
    assert.equal(reply.target.revision,before.revision);
  });
});

test('both restore orders preserve raw duplicates, exact identities and client-decodable replies',async()=>{
  const loaded=await loadNotesSource([fileURLToPath(import.meta.url),support]);
  for(const order of [[0,1],[1,0]])await fixture(loaded,async({service,store,send,decode})=>{
    const creates=[];
    for(let index=0;index<2;index++)creates.push(await send('create-note',{content:'Same title\nSame body',forceNew:true}));
    const original=creates.map(result=>result.data.note);
    const removed=await send('delete-note',{id:original[0].id});
    assert.deepEqual(new Set(removed.data.removedIds),new Set(original.map(note=>note.id)));
    let revision=removed.state.revision;
    for(const index of order){
      const params={id:original[index].id,expectedRevision:revision};
      const restored=await send('restore-note',params);revision=restored.state.revision;
      const decoded=await decode('restore-note',params,restored);
      assert.deepEqual(decoded.note,original[index]);
    }
    const raw=await store.persistedSnapshot(), visible=service.snapshot();
    assert.equal(raw.notes.length,2);assert.equal(visible.notes.length,1);
    assert.equal(visible.notes[0].id,original[1].id);
    assert.equal(raw.revision,visible.revision);
    assert.equal(raw.trash.length,0);
  });
});
