import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
const source=stripTypeScriptTypes(fs.readFileSync('apps/app/src/prototype/files-tree-adapter.ts','utf8').replace(/^import .*;\n/gm,'').replace('export function','function'),{mode:'strip'});
function harness(){
 let resolve,active=true;const doc={hidden:false},toasts=[];let failForget=false;const result=new Promise(done=>{resolve=done;}),accepted=[],forgotten=[],state={};
 const api={ic:{folder:'fixture-folder'},get:()=>state,set:patch=>Object.assign(state,patch),isActive:()=>active,toast(message){toasts.push(message);}};
 const view={render:()=>({locs:[{name:'Documents'}]}),onLeave(){}};
 const ctx=vm.createContext({Date,Set,Map,window:{dispatchEvent(){}},CustomEvent:class{},document:doc,Capacitor:{isNativePlatform:()=>false},registerPlugin:()=>({}),DailyApps:{perform:()=>result,async forgetSelected(input){forgotten.push(input.selectionId);if(failForget)throw new Error('release failed');}},filesIndex:{list:()=>[],revokeTree(){}},createInlineModal:()=>({}),FOLDER_CONTEXT_EVENT:'owned-folder-context',createFolderRevisions:()=>()=>null,folderScope:()=>null});
 vm.runInContext(source+';globalThis.install=installFilesTreeAdapter',ctx);
 ctx.install({files:view},async(_module,value)=>accepted.push(value.selectionId),()=>{});
 const pick=view.render(state,api).locs.find(row=>row.name==='Documents').go;
 return {accepted,forgotten,toasts,doc,failRelease(){failForget=true;},pick,release:value=>resolve(value),leave(){active=false;view.onLeave(api);},return(){active=true;view.render(state,api);},async settle(){for(let i=0;i<10;i++)await Promise.resolve();}};
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
