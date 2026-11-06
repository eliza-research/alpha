import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
const source=stripTypeScriptTypes(fs.readFileSync('apps/app/src/prototype/workflow-authoring.ts','utf8').replace(/^import .*;\n/gm,'').replace('export function','function'),{mode:'transform'});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function harness(){
 const records=new Map(),gate=deferred(),entered=deferred();let held=false,fail=false;
 let session={origin:'owned-origin',ownerId:'owner-a',agentId:'agent-a'},binding={sessionId:'session-a',client:{async phoneCatalog(){return {palette:[],triggers:[]};}}};
 const storage={async secureRead({slot}){return {value:records.get(slot)??null};},async secureCompareExchange(input){if(held){entered.resolve();await gate.promise;}if(fail)throw Error('Synthetic write unavailable');if((records.get(input.slot)??null)!==input.expectedValue)return {status:'conflict'};records.set(input.slot,input.value);return {status:'saved'};}};
 const ctx=vm.createContext({AbortController,TextEncoder,document:{hidden:false},browserLocalAgentEnabled:true,browserDevProfile:false,developmentWorkflowDraftStore:storage,registerPlugin:()=>({}),workflowSha:async values=>JSON.stringify(values),normalizePhoneSpec:spec=>JSON.parse(JSON.stringify(spec)),assertPhoneCapabilities:()=>{},connectionController:{getWorkflowClient:()=>binding,getSnapshot:()=>({session,open:false})},WORKFLOW_OPERATION_LABELS:{supplied_text:'Read supplied text'}});
 vm.runInContext(source+';globalThis.create=createWorkflowAuthoring',ctx);
 const authoring=ctx.create(()=>({toast(){}}),()=>{},async()=>{}),api={ic:{},get:()=>({})};
 await authoring.open();for(let i=0;i<5;i++)await Promise.resolve();
 return {authoring,render:()=>authoring.render(api),records,
  async editHeld(name){held=true;authoring.render(api).onName({target:{value:name}});await entered.promise;},
  release(){held=false;gate.resolve();},failWrite(){fail=true;},restoreWrite(){fail=false;},
  async edit(name){authoring.render(api).onName({target:{value:name}});for(let i=0;i<10;i++)await Promise.resolve();},
  async reopen(workflow){authoring.close();await authoring.open(workflow);for(let i=0;i<10;i++)await Promise.resolve();},
  writeElsewhere(name){const [slot,raw]=[...records][0];records.set(slot,JSON.stringify({...JSON.parse(raw),spec:{...JSON.parse(raw).spec,name}}));},
  stored:()=>JSON.parse([...records.values()][0]).spec.name,
  changeOwner(){session={origin:'other-origin',ownerId:'owner-b',agentId:'agent-b'};binding={...binding,sessionId:'session-b'};},
 };
}
test('closing and reopening waits for the prior draft commit and restores the latest unsent name',async()=>{
 const h=await harness();await h.editHeld('Latest owned unsent name');h.authoring.close();
 const reopening=h.authoring.open();for(let i=0;i<5;i++)await Promise.resolve();h.release();await reopening;
 assert.equal(h.render().name,'Latest owned unsent name');
 assert.equal(h.records.size,1,'only the original private draft slot was used');h.authoring.close();
});
test('cancelling a reopen while the prior save is held cannot reopen or publish the draft later',async()=>{
 const h=await harness();await h.editHeld('Owned retained name');h.authoring.close();
 const reopening=h.authoring.open();for(let i=0;i<5;i++)await Promise.resolve();h.authoring.close();h.release();await reopening;
 assert.equal(h.authoring.active,false);await h.authoring.open();assert.equal(h.render().name,'Owned retained name');h.authoring.close();
});
test('reopening under another owner never carries the earlier owner’s pending draft',async()=>{
 const h=await harness();await h.editHeld('Owner A private draft');h.authoring.close();h.changeOwner();
 const reopening=h.authoring.open();for(let i=0;i<5;i++)await Promise.resolve();h.release();await reopening;
 assert.equal(h.render().name,'New workflow');for(let i=0;i<5;i++)await Promise.resolve();
 assert.equal(h.records.size,1,'the next owner\'s untouched draft is not stored');assert.equal(JSON.parse([...h.records.values()][0]).spec.name,'Owner A private draft');h.authoring.close();
});

test('a second reopen after cancellation still waits for the original held commit',async()=>{const h=await harness();await h.editHeld('Newest held name');h.authoring.close();const first=h.authoring.open();for(let i=0;i<5;i++)await Promise.resolve();h.authoring.close();const second=h.authoring.open();for(let i=0;i<5;i++)await Promise.resolve();h.release();await Promise.all([first,second]);assert.equal(h.render().name,'Newest held name');h.authoring.close();});

test('failed pending persistence preserves latest unsent draft instead of restoring older bytes',async()=>{const h=await harness();await h.editHeld('Latest unsaved name');h.authoring.close();const opening=h.authoring.open();h.failWrite();h.release();await opening;assert.equal(h.render().name,'Latest unsaved name');assert.match(h.render().typedStatus,/failed|retained|unavailable/);h.authoring.close();});

test('closing and reopening after a conflicting save loads the newer stored draft instead of the retained failed one',async()=>{
 const h=await harness();await h.edit('Stored first');h.writeElsewhere('Window A newer name');await h.edit('Window B conflicting name');
 assert.match(h.render().typedStatus,/another window/i);
 await h.reopen();assert.equal(h.render().name,'Window A newer name');assert.match(h.render().typedStatus,/Another window changed this draft/);
 await h.edit('Edited after recovery');assert.equal(h.stored(),'Edited after recovery','storage is writable again after the reopen');h.authoring.close();
});
test('a transient write error is retried with the retained edits on reopen and never sticks',async()=>{
 const h=await harness();h.failWrite();await h.edit('Unsaved after write error');assert.equal(h.records.size,0);
 await h.reopen();assert.equal(h.render().name,'Unsaved after write error','still failing: retained edits stay visible');
 h.restoreWrite();await h.reopen();assert.equal(h.render().name,'Unsaved after write error');assert.equal(h.stored(),'Unsaved after write error');
 h.writeElsewhere('Later stored name');await h.reopen();assert.equal(h.render().name,'Later stored name','the retained failed state is not reused after recovery');h.authoring.close();
});
test('discard is still possible after a failed local save',async()=>{
 const h=await harness();h.failWrite();await h.edit('Draft to discard');h.restoreWrite();
 await h.render().discard();await h.render().discard();for(let i=0;i<10;i++)await Promise.resolve();
 assert.equal(h.records.size,1);assert.equal([...h.records.values()][0],null);assert.equal(h.authoring.active,false);
});

const flow=(id,name)=>({id,name,versionId:id+'-v1',phoneSpec:{version:1,name,description:'',trigger:{kind:'manual'},steps:[{id:'s1',kind:'Read',operation:'supplied_text',text:'input'}]}});
test('opening and leaving without an edit stores nothing',async()=>{
 const h=await harness();h.authoring.close();await h.reopen(flow('x','Workflow X'));h.authoring.close();for(let i=0;i<10;i++)await Promise.resolve();
 assert.equal(h.records.size,0);
});
test('a retained draft for another workflow is named, and Discard opens the workflow the owner chose',async()=>{
 const h=await harness();await h.reopen(flow('x','Workflow X'));await h.edit('Workflow X edited');
 await h.reopen(flow('y','Workflow Y'));
 assert.equal(h.render().name,'Workflow X edited','the retained draft is shown, never replaced silently');
 assert.equal(h.render().typedStatus,'You have an unsaved draft for Workflow X edited. Finish it, or discard it to open Workflow Y.');
 await h.render().discard();await h.render().discard();for(let i=0;i<20;i++)await Promise.resolve();
 assert.equal(h.authoring.active,true);assert.equal(h.render().name,'Workflow Y');assert.equal([...h.records.values()][0],null);h.authoring.close();
});
test('the save review names where the draft saves and keeps the full specification under Technical details',async()=>{
 const h=await harness();await h.reopen(flow('x','Workflow X'));await h.edit('Workflow X edited');await h.render().save();
 assert.equal(h.render().typedReview,'Replaces Workflow X. It will be paused and its schedule turned off.\nRuns only when you tap Run now.\n1. Read supplied text');
 assert.equal(JSON.parse(h.render().typedSpecification).name,'Workflow X edited');
 assert.match(h.render().typedStatus,/^Review the steps, then tap Save again\./);
 await h.render().discard();await h.render().discard();for(let i=0;i<20;i++)await Promise.resolve();
 await h.reopen();await h.edit('Brand new');h.render().onDescription({target:{value:''}});await h.render().save();
 assert.match(h.render().typedReview,/^Creates a new workflow\. It saves paused\./);h.authoring.close();
});
test('Describe stays available while the draft has steps',async()=>{
 const h=await harness();await h.reopen(flow('x','Workflow X'));assert.equal(h.render().empty,true);h.authoring.close();
});
