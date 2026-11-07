import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
const source=stripTypeScriptTypes(fs.readFileSync('apps/app/src/prototype/files-tree-adapter.ts','utf8').replace(/^import .*;\n/gm,'').replace('export function','function'),{mode:'transform'});
function harness({native=false,category='Documents'}={}){
 let resolve,active=true;const doc={hidden:false},toasts=[];let failForget=false;const result=new Promise(done=>{resolve=done;}),accepted=[],forgotten=[],calls=[],state={};
 const api={ic:{folder:'fixture-folder'},get:()=>state,set:patch=>Object.assign(state,patch),isActive:()=>active,toast(message){toasts.push(message);}};
 const view={render:()=>({locs:[{name:category}]}),onLeave(){}};
 const ctx=vm.createContext({Date,Set,Map,window:{dispatchEvent(){}},CustomEvent:class{},document:doc,Capacitor:{isNativePlatform:()=>native},registerPlugin:()=>({}),DailyApps:{perform:input=>{calls.push(input);return result;},async forgetSelected(input){forgotten.push(input.selectionId);if(failForget)throw new Error('release failed');}},filesIndex:{list:()=>[],revokeTree(){}},createInlineModal:()=>({}),FOLDER_CONTEXT_EVENT:'owned-folder-context',createFolderRevisions:()=>()=>null,folderScope:()=>null});
 vm.runInContext(source+';globalThis.install=installFilesTreeAdapter',ctx);
 ctx.install({files:view},async(_module,value)=>accepted.push(value.selectionId),()=>{});
 const pick=view.render(state,api).locs.find(row=>row.name===category).go;
 return {accepted,forgotten,calls,toasts,doc,failRelease(){failForget=true;},pick,release:value=>resolve(value),leave(){active=false;view.onLeave(api);},return(){active=true;view.render(state,api);},async settle(){for(let i=0;i<10;i++)await Promise.resolve();}};
}
const selected={status:'selected',action:'files',selectionId:'owned-selected-fixture',name:'Owned fixture.txt',mimeType:'text/plain'};
test('an active Files picker accepts its selected result once',async()=>{
 const h=harness();h.pick();h.release(selected);await h.settle();assert.deepEqual(h.accepted,[selected.selectionId]);assert.deepEqual(h.forgotten,[]);
});
test('leaving Files while its picker is pending rejects the late result and releases only its grant',async()=>{
 const h=harness();h.pick();h.leave();h.release(selected);await h.settle();assert.deepEqual(h.accepted,[]);assert.deepEqual(h.forgotten,[selected.selectionId]);
});
test('returning to Files does not revive an earlier picker completion',async()=>{
 const h=harness();h.pick();h.leave();h.return();h.release(selected);await h.settle();assert.deepEqual(h.accepted,[]);assert.deepEqual(h.forgotten,[selected.selectionId]);
});
test('picker cancellation neither opens a preview nor releases an unrelated grant',async()=>{
 const h=harness();h.pick();h.leave();h.release({status:'cancelled'});await h.settle();assert.deepEqual(h.accepted,[]);assert.deepEqual(h.forgotten,[]);
});
test('a result delivered while the native picker still hides the page is accepted',async()=>{
 const h=harness();h.pick();h.doc.hidden=true;h.release(selected);await h.settle();assert.deepEqual(h.accepted,[selected.selectionId]);assert.deepEqual(h.forgotten,[]);
});
test('a failed release of a late result does not toast the owner who left',async()=>{
 const h=harness();h.pick();h.leave();h.failRelease();h.release(selected);await h.settle();assert.deepEqual(h.accepted,[]);assert.deepEqual(h.forgotten,[selected.selectionId]);assert.deepEqual(h.toasts,[]);
});

test('Downloads requests the native Downloads location without changing the browser picker',async()=>{
 for(const native of [true,false]){
  const h=harness({native,category:'Downloads'});h.pick();
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].action,'files');
  assert.equal(h.calls[0].initialLocation,native?'downloads':undefined);
  assert.equal(h.calls[0].mime,undefined);
  h.release(selected);await h.settle();assert.deepEqual(h.accepted,[selected.selectionId]);
 }
});
test('typed categories refuse a known mismatched result and release its selected capability',async()=>{
 for(const category of ['Documents','Recordings']){
  const h=harness({category});h.pick();
  h.release({...selected,mimeType:'image/jpeg'});await h.settle();
  assert.deepEqual(h.accepted,[]);assert.deepEqual(h.forgotten,[selected.selectionId]);
  assert.deepEqual(h.toasts,['Choose a file that matches this category.']);
 }
});
test('Recordings accepts audio and keeps unknown provider MIME usable',async()=>{
 for(const mimeType of ['audio/mpeg','application/octet-stream']){
  const h=harness({category:'Recordings'});h.pick();
  assert.deepEqual(Array.from(h.calls[0].mime),['audio/*']);
  h.release({...selected,mimeType});await h.settle();
  assert.deepEqual(h.accepted,[selected.selectionId]);assert.deepEqual(h.forgotten,[]);
 }
});
