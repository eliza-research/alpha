import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import {NoteRecorderSession} from '../apps/app/src/prototype/note-recorder.ts';
import {createNoteRecordingJournal} from '../apps/app/src/browser/note-recording-journal.ts';

// Real BrowserVoice and recorder session against one persistent recording port.
// The shared store's IndexedDB transitions are covered by its own storage suite.
const code=stripTypeScriptTypes(readFileSync('apps/app/src/browser/voice.ts','utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'').replaceAll('import.meta.env.DEV','false'),{mode:'strip'})+';return BrowserVoice;';
const binding={ownerDigest:'a'.repeat(64),folderId:null},id='pending-recording';
function fixture({segments=[],durationMs=11000}={}){
 let row=null,failStage=false,claims=0,commits=0,discards=0,captures=0;
 const events=[],clip={blob:new Blob(['exact recording bytes'],{type:'audio/webm'}),durationMs},documents=new Map();let revision=0;
 const browserDocuments={read:async key=>documents.get(key),readOrCreate:async(key,raw)=>{if(!documents.has(key))documents.set(key,{revision:String(++revision),raw});return documents.get(key);},edit:async(key,edit)=>{const value=await edit(documents.get(key));documents.set(key,{revision:String(++revision),raw:value.raw});return value.result;}};
 const ports={
  pendingAudio:async()=>row&&row.recordingSave.phase!=='committed'?[structuredClone(row)]:[],
  retainPendingAudio:async(audioId,owner,saved,transcript)=>{events.push('stage');if(failStage)throw Error('Storage unavailable');row??={audioId,noteId:audioId,...saved,transcript,recordingSave:{...owner,phase:'stopped'}};},
  claimPendingAudio:async()=>{claims++;events.push('claim');if(row.recordingSave.phase!=='stopped')return false;row.recordingSave.phase='claimed';return true;},
  commitPendingAudio:async(audioId,ownerDigest,noteId,transcript)=>{commits++;events.push('commit');assert.equal(ownerDigest,binding.ownerDigest);assert.equal(row.audioId,audioId);if(row.recordingSave.phase==='committed')assert.equal(row.noteId,noteId);row.noteId=noteId;row.transcript=transcript;row.recordingSave.phase='committed';return {...row};},
  discardPendingAudio:async()=>{discards++;events.push('discard');if(row?.recordingSave.phase==='claimed')throw Error('Check Notes');if(row?.recordingSave.phase==='stopped')row=null;},
 };
 class Capture{async start(input){captures++;this.onSegment=input.onSegment;return{recordingId:id};}get(recordingId){return recordingId===id?clip:undefined;}elapsed(){return clip.durationMs;}metrics(){return{peak:0};}async stop(){for(const [index,segment] of segments.entries())this.onSegment?.({index,...segment});return{recordingId:id,durationMs:clip.durationMs};}cancel(){}}
 const connection={getSnapshot:()=>({}),getCloudEnvironment:()=>null,getCloudClient:()=>null,subscribe:()=>()=>{}};
 const dependencies={...ports,browserDocuments,createNoteRecordingJournal,connectionController:connection,WebPlugin:class{notifyListeners(){return Promise.resolve();}},BrowserAudioCapture:Capture,window:{addEventListener(){}},document:{addEventListener(){}},migrateAudio:async()=>{},BroadcastChannel:undefined,decodeRecordingPcm:async()=>new Float32Array(durationMs*16),encodePcm16Wav:pcm=>new Uint8Array(pcm.length*2+44)};
 const BrowserVoice=new Function(...Object.keys(dependencies),code)(...Object.values(dependencies));
 const make=()=>new BrowserVoice();
 const driver=voice=>({start:()=>voice.startNoteRecording(binding),status:()=>voice.noteRecordingStatus(),stop:recordingId=>voice.stopNoteRecording({recordingId}),claimCanonicalSave:async recordingId=>(await voice.claimCanonicalNoteSave({recordingId})).claimed,save:input=>voice.saveNoteRecording(input),setText:(recordingId,segmentId,text)=>voice.setNoteSegmentText({recordingId,segmentId,text}),discard:recordingId=>voice.discardNoteRecording({recordingId}),listen:async()=>({remove(){}})});
 return{make,driver,events,documents,get row(){return row;},get claims(){return claims;},get commits(){return commits;},get discards(){return discards;},get captures(){return captures;},set failStage(value){failStage=value;}};
}

test('browser Stop persists bytes before a canonical create can be claimed',async()=>{
 const f=fixture(),voice=f.make();await voice.startNoteRecording(binding);f.failStage=true;
 await assert.rejects(voice.stopNoteRecording({recordingId:id}),/Storage unavailable/);
 await assert.rejects(voice.claimCanonicalNoteSave({recordingId:id}),/Storage unavailable/);
 assert.equal(f.claims,0);assert.equal(f.row,null);
 f.failStage=false;await voice.stopNoteRecording({recordingId:id});
 assert.equal(f.row.blob.size,21);assert.equal(f.row.recordingSave.phase,'stopped');
 assert.equal((await voice.claimCanonicalNoteSave({recordingId:id})).claimed,true);
 assert.equal(f.row.recordingSave.phase,'claimed');assert.equal(f.events.at(-1),'claim');
});

test('browser reload recovers a claimed recording and settles the existing canonical note once',async()=>{
 const f=fixture(),voice=f.make(),session=new NoteRecorderSession(f.driver(voice),async()=>null,()=>{},{pollMs:60000});
 await session.begin();let creates=0;
 assert.equal(await session.finishAudio(async(_audio,_text,intent)=>{assert.equal(await intent.claim(),true);creates++;throw Error('Lost response after canonical commit');},true),false);
 assert.equal(creates,1);assert.equal(f.row.recordingSave.phase,'claimed');assert.equal(f.discards,0);session.close();
 const reloadedVoice=f.make(),recovered=await reloadedVoice.noteRecordingStatus();
 assert.equal(recovered.recovered,true);assert.equal(recovered.canonicalSavePending,true);assert.deepEqual(recovered.binding,binding);assert.equal(recovered.durationMs,11000);
 const next=new NoteRecorderSession(f.driver(reloadedVoice),async()=>null,()=>{},{pollMs:60000});
 await next.adopt();
 assert.equal(await next.finishAudio(async(_audio,_text,intent)=>{assert.equal(intent.pending,true);const saved=await intent.retainAudio('existing-canonical-note');return saved.noteId==='existing-canonical-note';},true),true);
 assert.equal(creates,1);assert.equal(f.claims,1);assert.equal(f.commits,1);assert.equal(f.row.noteId,'existing-canonical-note');assert.equal(f.row.recordingSave.phase,'committed');assert.equal(f.row.blob.size,21);assert.equal(f.captures,1);next.close();
});

test('recovered ambiguous creation never starts a second create or discards its bytes',async()=>{
 const f=fixture(),voice=f.make();await voice.startNoteRecording(binding);await voice.stopNoteRecording({recordingId:id});await voice.claimCanonicalNoteSave({recordingId:id});
 const recoveredVoice=f.make(),session=new NoteRecorderSession(f.driver(recoveredVoice),async()=>null,()=>{},{pollMs:60000});await session.adopt();
 assert.equal(await session.finishAudio(async(_audio,_text,intent)=>{assert.equal(intent.pending,true);assert.equal(await intent.claim(),false);return false;},true),false);
 assert.equal(f.claims,1);assert.equal(f.commits,0);assert.equal(f.row.blob.size,21);assert.equal(session.phase,'stopped');
 await assert.rejects(recoveredVoice.discardNoteRecording({recordingId:id}),/Check Notes/);session.close();
});

test('reload keeps exact segment boundaries, late text, and the unfinished final segment',async()=>{
 const blobs=[new Blob(['first standalone segment']),new Blob(['second standalone segment'])],f=fixture({segments:blobs.map((blob,index)=>({blob,durationMs:index?5000:25000})),durationMs:30000}),voice=f.make();
 await voice.startNoteRecording(binding);await voice.stopNoteRecording({recordingId:id});
 await voice.setNoteSegmentText({recordingId:id,segmentId:id+'-s0',text:'Finished after Stop.'});
 const recovered=f.make(),status=await recovered.noteRecordingStatus();
 assert.deepEqual(status.segments,[{segmentId:id+'-s0',durationMs:25000,text:'Finished after Stop.'},{segmentId:id+'-s1',durationMs:5000}]);
 const audio=await recovered.transcriptionAudio({recordingId:id+'-s1'},new AbortController().signal);
 assert.equal(await audio.blob.text(),'second standalone segment');
 let transcribed=[];const session=new NoteRecorderSession(f.driver(recovered),async()=>async segment=>{transcribed.push(segment);return 'The remaining words.';},()=>{},{pollMs:60000});
 await session.adopt();await session.pump(true);
 assert.deepEqual(transcribed,[id+'-s1']);assert.equal(session.transcript(),'Finished after Stop. The remaining words.');session.close();
 assert.deepEqual((await f.make().noteRecordingStatus()).segments.map(segment=>segment.text),['Finished after Stop.','The remaining words.']);
});

test('old pending rows preserve audio and retry unknown completion in bounded windows',async()=>{
 const f=fixture({durationMs:61000}),voice=f.make();
 // Seed an older-version pending row without a segment journal.
 await voice.startNoteRecording(binding);f.failStage=false;
 voice.note.segments=[{segmentId:id,durationMs:61000,text:'Earlier partial text'}];
 // The audio store existed before the segment-journal write. Simulate that crash boundary.
 await assert.rejects(voice.stopNoteRecording({recordingId:id}),/recovery needs review/);
 assert.equal(f.row.transcript,'Earlier partial text');
 const recovered=f.make(),status=await recovered.noteRecordingStatus();
 assert.deepEqual(status.segments.map(segment=>segment.durationMs),[25000,25000,11000]);
 assert(status.segments.every(segment=>!Object.hasOwn(segment,'text')));
 const audio=await recovered.transcriptionAudio({recordingId:status.segments[2].segmentId},new AbortController().signal);
 assert.equal(audio.pcm.length,11000*16*2+44);assert.equal(f.row.blob.size,21);assert.equal(f.row.transcript,'Earlier partial text');
 await recovered.setNoteSegmentText({recordingId:id,segmentId:status.segments[0].segmentId,text:'Recovered first part'});
 assert.equal((await f.make().noteRecordingStatus()).segments[0].text,'Recovered first part');
});

test('successful discard and commit retire pending segment bytes',async()=>{
 for(const commit of [false,true]){
  const f=fixture(),voice=f.make();await voice.startNoteRecording(binding);await voice.stopNoteRecording({recordingId:id});
  assert([...f.documents.values()].some(row=>row.raw?.includes('base64')));
  if(commit)await voice.saveNoteRecording({recordingId:id,noteId:'saved-note',transcript:'Saved words'});else await voice.discardNoteRecording({recordingId:id});
  assert([...f.documents.values()].every(row=>row.raw===null));
  assert.equal((await f.make().noteRecordingStatus()).state,'idle');
 }
});

test('pending recording recovery compares binding fields independently of property order',async()=>{
 const f=fixture(),voice=f.make();
 await voice.startNoteRecording({folderId:null,ownerDigest:binding.ownerDigest});
 await voice.stopNoteRecording({recordingId:id});
 await voice.setNoteSegmentText({recordingId:id,segmentId:id,text:'Words retained across reload'});
 const recovered=f.make(),status=await recovered.noteRecordingStatus();
 assert.deepEqual(status.binding,binding);
 assert.equal(status.segments[0].text,'Words retained across reload');
 await recovered.discardNoteRecording({recordingId:id});
 assert([...f.documents.values()].every(row=>row.raw===null));
});
