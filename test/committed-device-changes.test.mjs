// The approval-receipt path in agent-adapter hands each delivered receipt to
// publishCommittedDeviceChanges, which announces `alpha:<view>-committed` so an open Notes list
// reloads. Real device-actions source with a synthetic client and a window event target.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadBrowserModule} from './fixtures/browser-source.mjs';

const {publishCommittedDeviceChanges}=await loadBrowserModule('apps/app/src/runtime/device-actions.ts');
const session={ownerId:'synthetic-owner',agentId:'synthetic-agent',sessionId:'synthetic-session',origin:'https://agent.example.invalid'};

function client(state){
 const listeners=new Set();
 return {state,getState:()=>state,subscribe:listener=>{listeners.add(listener);return ()=>listeners.delete(listener);},set(next){Object.assign(state,next);for(const listener of [...listeners])listener();}};
}
function events(){
 const target=new EventTarget(),seen=[];
 for(const name of ['alpha:notes-committed','alpha:calendar-committed','alpha:reminders-committed'])target.addEventListener(name,()=>seen.push(name));
 globalThis.window=target;
 return seen;
}
const receipt=(proposalId,committedChanges)=>({proposalId,status:'succeeded',summary:'Note moved to Trash.',committedChanges});

test('a notes receipt in an idle same session announces alpha:notes-committed once',()=>{
 const seen=events();
 const done=receipt('note-trash-1',['notes']);
 publishCommittedDeviceChanges(done,client({connection:'ready',pending:false,session:{...session}}),session);
 assert.deepEqual(seen,['alpha:notes-committed']);
 // The same receipt is never announced twice.
 publishCommittedDeviceChanges(done,client({connection:'ready',pending:false,session:{...session}}),session);
 assert.deepEqual(seen,['alpha:notes-committed']);
});

test('a busy session waits until idle, and another session hears nothing',()=>{
 const seen=events();
 const busy=client({connection:'ready',pending:true,session:{...session}});
 publishCommittedDeviceChanges(receipt('note-trash-2',['notes']),busy,session);
 assert.deepEqual(seen,[]);
 busy.set({pending:false});
 assert.deepEqual(seen,['alpha:notes-committed']);

 const other=client({connection:'ready',pending:false,session:{...session,sessionId:'other-session'}});
 publishCommittedDeviceChanges(receipt('note-trash-3',['notes']),other,session);
 assert.deepEqual(seen,['alpha:notes-committed']);
});
