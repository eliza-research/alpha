import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import {findStoppedUserTurn} from '../.eliza/client-features/packages/ui/src/api/conversation-turn-controller.ts';

const source=readFileSync('apps/app/src/runtime/connection-ui.tsx','utf8');
const start=source.indexOf('export const STOPPED_REPLY_NOTICE ='),end=source.indexOf('async function conversationList(',start);
assert.ok(start>=0&&end>start);
const actual=stripTypeScriptTypes(source.slice(start,end)).replace(/^export /gm,'');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
async function reconcile({abort='unsupported',unreadable=false,busy=false}={}){
 const session={sessionId:'session'},selected={kind:'resident',remote:{abortTurn:async()=>abort}};
 let timer;
 const state={session},updates=[];
 const context=vm.createContext({epoch:1,state,selected,active:selected,session,operation:busy?{}:null,sending:null,
  conversationMemory:new Map([['key','conversation']]),conversationKey:()=> 'key',
  AbortController,STOPPED_REPLY_CHECK_MS:0,findStoppedUserTurn,restoredText:value=>value,
  update:patch=>{updates.push(patch);Object.assign(state,patch);},
  readConversation:async()=>{if(unreadable)throw Error('History unavailable');return {messages:[{id:'user',role:'user',text:'Hello',clientMessageId:'request'}]};},
  setTimeout:callback=>{timer=callback;return 1;},clearTimeout(){},
 });
 vm.runInContext(actual+"\nscheduleStoppedReply(selected,session,'conversation',{clientMessageId:'request',text:'Hello',sentAt:1});",context);
 timer();await settle();await settle();
 return {state,updates};
}

test('a failed or unavailable stop check reports an unknown outcome, not a stopped turn',async()=>{
 for(const options of [{unreadable:true},{},{busy:true}]){
  const {state}=await reconcile(options);
  assert.equal(state.replyNotice,'Outcome unknown');
  assert.notEqual(state.message,'The agent stopped this reply.');
 }
});

test('only an acknowledged abort and a settled history read confirm a stopped reply',async()=>{
 const {state}=await reconcile({abort:'aborted'});
 assert.equal(state.replyNotice,'');
 assert.equal(state.message,'The agent stopped this reply.');
 const unreadable=await reconcile({abort:'aborted',unreadable:true});
 assert.equal(unreadable.state.replyNotice,'Outcome unknown');
});
