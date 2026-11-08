import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import vm from 'node:vm';
const source=readFileSync(new URL('../apps/app/src/prototype/canonical-notes-ui.ts',import.meta.url),'utf8');
const helper=source.slice(source.indexOf('function voiceAudio('),source.indexOf('function domainOf('));
const method=source.slice(source.indexOf(' async saveVoice('),source.indexOf(' async saveCard('));
assert.ok(helper.startsWith('function voiceAudio(')&&method.startsWith(' async saveVoice('));
const formatSource=readFileSync(new URL('../.eliza/client-features/plugins/plugin-notes/src/note-format.ts',import.meta.url),'utf8');
const typesSource=readFileSync(new URL('../.eliza/client-features/plugins/plugin-notes/src/types.ts',import.meta.url),'utf8');
const reconstruct=typesSource.slice(typesSource.indexOf('export function reconstructNoteContent('),typesSource.indexOf('/** Lossless model parts:'));
const box={structuredClone};vm.createContext(box);
vm.runInContext(stripTypeScriptTypes((formatSource+'\n'+reconstruct).replace(/^export /gm,''),{mode:'transform'}),box);
const save=vm.runInContext(stripTypeScriptTypes(helper+'\n({'+method+'}).saveVoice',{mode:'transform'}),box);
function fixture(dirty=false){
 const notes=[],created=[],opened=[],retained=[];let claimed=false,claims=0,failAudio=false,reviews=0;
 const ui={pending:false,dirty,editor:{open:id=>opened.push(id)},hooks:{committed(){}},needsReview(){reviews++;},controller:{current:true,snapshot:{notes,trash:[]},refresh:async()=>{},interact:async(_action,input)=>{created.push(input);const boundary=input.content.indexOf('\n'),title=boundary<0?input.content:input.content.slice(0,boundary);const note={id:'canonical-'+(notes.length+1),content:input.content,title,body:input.content.slice(title.length),format:input.format};notes.push(note);return {note,target:{id:note.id}};}}};
 const intent=()=>({pending:claimed,claim:async()=>{claims++;if(claimed)return false;claimed=true;return true;},retainAudio:async noteId=>{retained.push(noteId);if(failAudio)throw Error('Audio save interrupted');return {audioId:'recording-1',noteId,durationMs:2500,transcript:''};}});
 return {ui,notes,created,opened,retained,intent,get reviews(){return reviews;},get claims(){return claims;},set failAudio(value){failAudio=value;}};
}
test('audio-only canonical recording creates a distinct voice note and retains it under its actual id',async()=>{
 const f=fixture(true),textDraft={body:'Keep my existing draft'};f.ui.editor.draft=textDraft;
 assert.equal(await save.call(f.ui,'recording-1','',2500,'f-original',()=>true,f.intent()),true);
 assert.equal(f.created.length,1);assert.equal(f.notes[0].format.kind,'voice');assert.deepEqual(JSON.parse(JSON.stringify(f.notes[0].format.data.audio)),{audioId:'recording-1',durationMs:2500});
 assert.deepEqual(f.retained,['canonical-1']);assert.equal(f.ui.editor.draft,textDraft);assert.equal(textDraft.body,'Keep my existing draft');assert.deepEqual(f.opened,[],'do not replace a dirty editor with the new recording');
});
test('interrupted canonical audio retention reads the existing saved note and never repeats create',async()=>{
 const f=fixture();f.failAudio=true;
 assert.equal(await save.call(f.ui,'recording-1','',2500,null,()=>true,f.intent()),false);assert.equal(f.created.length,1);assert.equal(f.reviews,0,'local audio retry must not invent an unknown canonical mutation');
 f.failAudio=false;assert.equal(await save.call(f.ui,'recording-1','',2500,null,()=>true,f.intent()),true);
 assert.equal(f.created.length,1);assert.equal(f.claims,1);assert.deepEqual(f.retained,['canonical-1','canonical-1']);assert.deepEqual(f.opened,['canonical-1']);
});
test('foreign or malformed attachment metadata cannot stand in for the recorded clip',async()=>{
 const f=fixture();f.notes.push({id:'foreign',content:'Voice note',format:{kind:'voice',data:{recordingId:'recording-1',dur:2.5,audio:{audioId:'different-audio',durationMs:2500}}}});
 assert.equal(await save.call(f.ui,'recording-1','',2500,null,()=>true,f.intent()),false);assert.equal(f.created.length,0);assert.equal(f.retained.length,0);assert.equal(f.claims,0);
});

test('a delayed Stop does not recreate or attach audio to a voice note already in Trash',async()=>{
 const f=fixture();f.ui.controller.snapshot.trash.push({note:{id:'trashed-target',title:'Voice note',body:'',format:{kind:'voice',data:{recordingId:'recording-1',dur:2.5,audio:{audioId:'recording-1',durationMs:2500}}}}});
 assert.equal(await save.call(f.ui,'recording-1','',2500,null,()=>true,f.intent()),false);
 assert.equal(f.created.length,0);assert.equal(f.claims,0);assert.equal(f.retained.length,0);assert.deepEqual(f.opened,[]);
});
