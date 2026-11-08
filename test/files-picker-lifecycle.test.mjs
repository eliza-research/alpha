import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
const source=stripTypeScriptTypes(fs.readFileSync('apps/app/src/prototype/files-browser-adapter.ts','utf8').replace(/^import[\s\S]*?;\n/gm,'').replace(/^export /gm,''),{mode:'transform'});
const rules=stripTypeScriptTypes(fs.readFileSync('apps/app/src/runtime/files-storage.ts','utf8').replace(/^export /gm,''),{mode:'transform'});
async function harness(){
 let resolve,active=true,agent;const doc=Object.assign(new EventTarget(),{hidden:false}),toasts=[];let failForget=false;
 const result=new Promise(done=>{resolve=done;}),accepted=[],forgotten=[],calls=[],state={};
 const entry={path:'Documents/fixture.txt',name:'fixture.txt',mimeType:'text/plain',directory:false,size:7,modified:1};
 const api={ic:{},get:()=>state,set:patch=>Object.assign(state,patch),isActive:()=>active,toast:message=>toasts.push(message)};
 const storage={storageSelect:input=>{calls.push(input);return result;},storageState:async()=>({status:'ready',access:'granted',volumes:[]}),storageCategory:async()=>({status:'ready',entries:[entry]}),storageTrashList:async()=>({status:'ready',items:[]}),storageWatch:async()=>({status:'ready'}),storageUnwatch:async()=>({status:'ready'}),addListener:async()=>({remove:async()=>{}})};
 const view={render:()=>({}),onLeave(){}};
 const ctx=vm.createContext({setTimeout,clearTimeout,queueMicrotask,window:new EventTarget(),CustomEvent:class{},HTMLElement:class{},document:doc,registerPlugin:()=>storage,DailyApps:{async forgetSelected(input){forgotten.push(input.selectionId);if(failForget)throw Error('release failed');}},createInlineModal:()=>({}),registerFilesAgent:handler=>{agent=handler;}});
 vm.runInContext(rules+';'+source+';globalThis.install=installFilesBrowserAdapter',ctx);
 ctx.install({files:view},async(_module,value)=>accepted.push(value.selectionId),()=>{});
 const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
 view.render(state,api);await settle();view.render(state,api).browse.cats.find(row=>row.name==='Documents').go();await settle();
 return {accepted,forgotten,calls,toasts,doc,failRelease(){failForget=true;},pick(){view.render(state,api).fd.items[0].tap();},agentOpen(){return agent.run({type:'files_open',path:entry.path});},release:value=>resolve(value),leave(){active=false;view.onLeave(api);},return(){active=true;view.render(state,api);},settle};
}
const selected={status:'selected',action:'files',selectionId:'owned-selected-fixture',name:'fixture.txt',mimeType:'text/plain'};
test('an active storage selection accepts its result once',async()=>{
 const h=await harness();h.pick();h.release(selected);await h.settle();assert.deepEqual(h.accepted,[selected.selectionId]);assert.deepEqual(h.forgotten,[]);
});
test('leaving Files while a storage selection is pending rejects the late result and releases only its grant',async()=>{
 const h=await harness();h.pick();h.leave();h.release(selected);await h.settle();assert.deepEqual(h.accepted,[]);assert.deepEqual(h.forgotten,[selected.selectionId]);
});
test('returning to Files does not revive an earlier storage selection',async()=>{
 const h=await harness();h.pick();h.leave();h.return();h.release(selected);await h.settle();assert.deepEqual(h.accepted,[]);assert.deepEqual(h.forgotten,[selected.selectionId]);
});
test('a cancelled selection neither opens a preview nor releases an unrelated grant',async()=>{
 const h=await harness();h.pick();h.leave();h.release({status:'cancelled'});await h.settle();assert.deepEqual(h.accepted,[]);assert.deepEqual(h.forgotten,[]);
});
test('a hidden document alone does not invalidate the active native selection',async()=>{
 const h=await harness();h.pick();h.doc.hidden=true;h.release(selected);await h.settle();assert.deepEqual(h.accepted,[selected.selectionId]);assert.deepEqual(h.forgotten,[]);
});
test('a failed release of a late selection does not toast the owner who left',async()=>{
 const h=await harness();h.pick();h.leave();h.failRelease();h.release(selected);await h.settle();assert.deepEqual(h.accepted,[]);assert.deepEqual(h.forgotten,[selected.selectionId]);assert.deepEqual(h.toasts,[]);
});
test('an agent file-open cannot revive a selection after leaving and returning',async()=>{
 const h=await harness();const pending=h.agentOpen();await h.settle();h.leave();h.return();h.release(selected);const outcome=await pending;await h.settle();assert.equal(outcome.status,'failed');assert.deepEqual(h.accepted,[]);assert.deepEqual(h.forgotten,[selected.selectionId]);
});
