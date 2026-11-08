import test from 'node:test';
import assert from 'node:assert/strict';
import {addSavedNoteTranscript} from '../apps/app/src/prototype/note-recorder.ts';
function fixture(durationMs=60000){
 const audio={audioId:'recording',noteId:'note',durationMs},abort=new AbortController(),calls={transcribe:[],save:[]};
 let current=true,metadata={...audio,transcript:''};
 const port={current:()=>current,describe:async()=>metadata,transcribe:async offset=>{calls.transcribe.push(offset);return `Part ${offset}`;},save:async text=>{calls.save.push(text);return true;}};
 return {audio,abort,calls,port,retire(){current=false;},metadata(value){metadata=value;}};
}
test('an explicit saved transcript covers the whole recording in order and saves once',async()=>{
 const f=fixture();assert.equal(await addSavedNoteTranscript(f.audio,f.port,f.abort.signal),true);
 assert.deepEqual(f.calls.transcribe,[0,25000,50000]);assert.deepEqual(f.calls.save,['Part 0\nPart 25000\nPart 50000']);
});
test('foreign, deleted or changed-duration audio never reaches a provider',async()=>{
 for(const patch of [{noteId:'other'},{audioId:'other'},{deletedAt:1},{durationMs:1}]){
  const f=fixture();f.metadata({...f.audio,transcript:'',...patch});await assert.rejects(addSavedNoteTranscript(f.audio,f.port,f.abort.signal));assert.deepEqual(f.calls.transcribe,[]);assert.deepEqual(f.calls.save,[]);
 }
});
test('a late response after changing the selected note cannot save or upload another window',async()=>{
 const f=fixture();f.port.transcribe=async offset=>{f.calls.transcribe.push(offset);f.retire();return 'Late';};
 await assert.rejects(addSavedNoteTranscript(f.audio,f.port,f.abort.signal),{name:'AbortError'});assert.deepEqual(f.calls.transcribe,[0]);assert.deepEqual(f.calls.save,[]);
});
test('cancel keeps the audio and never begins another window or save',async()=>{
 const f=fixture();f.port.transcribe=async offset=>{f.calls.transcribe.push(offset);f.abort.abort();return 'Late';};
 await assert.rejects(addSavedNoteTranscript(f.audio,f.port,f.abort.signal),{name:'AbortError'});assert.deepEqual(f.calls.transcribe,[0]);assert.deepEqual(f.calls.save,[]);
});
test('an unconfirmed save is returned without a second write or provider retry',async()=>{
 const f=fixture(1000);f.port.save=async text=>{f.calls.save.push(text);return false;};assert.equal(await addSavedNoteTranscript(f.audio,f.port,f.abort.signal),false);assert.deepEqual(f.calls.transcribe,[0]);assert.deepEqual(f.calls.save,['Part 0']);
});
test('silence in one window does not discard the rest; a fully silent note is not written',async()=>{
 const f=fixture(30000);f.port.transcribe=async offset=>offset?'Second window':'';assert.equal(await addSavedNoteTranscript(f.audio,f.port,f.abort.signal),true);assert.deepEqual(f.calls.save,['Second window']);
 const silent=fixture(1000);silent.port.transcribe=async()=>'';await assert.rejects(addSavedNoteTranscript(silent.audio,silent.port,silent.abort.signal),{code:'no-speech'});assert.deepEqual(silent.calls.save,[]);
});
test('provider failure is never retried and the saved note remains unchanged',async()=>{
 const f=fixture();f.port.transcribe=async offset=>{f.calls.transcribe.push(offset);throw Error('Provider unavailable');};await assert.rejects(addSavedNoteTranscript(f.audio,f.port,f.abort.signal),/Provider unavailable/);assert.deepEqual(f.calls.transcribe,[0]);assert.deepEqual(f.calls.save,[]);
});
