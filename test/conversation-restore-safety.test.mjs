import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const source=readFileSync(process.env.ALPHA_RESTORE_SOURCE||'apps/app/src/runtime/connection-ui.tsx','utf8');
const part=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);};
const code=stripTypeScriptTypes([
 part('async function createSelectedConversation(', '/** Only remove'),
 part('async function restoreConversationHistory(', '/** Restored chats'),
 part('async function restoreSavedHistory(', 'type HistoryEntry'),
].join('\n'),{mode:'transform'});
function fixture(){
 let choice={id:'gone',revision:'r1'},createCount=0;
 const state={session:{sessionId:'session'},history:{conversationId:'manual-visible',revision:4,messages:[]}},writes=[],memory=new Map();
 const selected={kind:'remote',remote:{createConversation:async()=>{createCount++;return{id:'new-empty'};}}};
 const box={state,active:selected,epoch:1,Capacitor:{getPlatform:()=> 'android'},service:null,Date,JSON,Error,
  residentCloudFlow:()=>false,conversationKey:()=> 'owner-key',conversationMemory:memory,
  captureConversationChoice:async()=>structuredClone(choice),
  selectConversation:async(_key,expected,id)=>{assert.deepEqual(expected,choice);choice={id,revision:'r2'};},
  conversationList:async()=>[],readConversation:async()=>({messages:[],partial:false,deliveryRevisionAtStart:0}),
  restoredMessages:messages=>messages,cancelStoppedReply(){},scheduleStoppedReply(){throw Error('Unexpected schedule');},
  update:patch=>{writes.push(patch);Object.assign(state,patch);},noSessionError:message=>Error(message),NO_SESSION_FALLBACK:'missing'};
 vm.runInNewContext(code,box);
 return {box,state,memory,writes,get choice(){return choice;},set choice(value){choice=value;},get createCount(){return createCount;}};
}
test('native automatic restore awaits the second asynchronous selection read',async()=>{
 const f=fixture();f.choice={id:'saved',revision:'native'};f.box.conversationList=async()=>[{id:'saved'}];let reads=0,release;
 f.box.captureConversationChoice=async()=>{reads++;if(reads===2)await new Promise(resolve=>release=resolve);return structuredClone(f.choice);};
 const pending=f.box.restoreConversationHistory('saved',new AbortController().signal,true,true);
 while(!release)await Promise.resolve();
 assert.equal(f.state.history.conversationId,'manual-visible');release();await pending;
 assert.equal(f.state.history.conversationId,'saved');assert.equal(reads,2);assert.equal(f.memory.get('owner-key'),'saved');
});
test('a newer manual choice during missing-conversation lookup prevents fallback creation',async()=>{
 const f=fixture();let release;f.box.conversationList=()=>new Promise(resolve=>release=resolve);
 const pending=f.box.restoreSavedHistory(new AbortController().signal);
 while(!release)await Promise.resolve();f.choice={id:'manual-newer',revision:'r2'};release([]);await pending;
 assert.equal(f.choice.id,'manual-newer');assert.equal(f.createCount,0);assert.equal(f.state.history.conversationId,'manual-visible');assert.equal(f.memory.size,0);assert.match(f.state.historyError,/could not be restored/);
});
test('failed fallback compare-and-set cannot publish a new in-memory conversation',async()=>{
 const f=fixture();f.box.selectConversation=async()=>{throw Error('Concurrent selection');};
 await f.box.restoreSavedHistory(new AbortController().signal);
 assert.equal(f.createCount,1);assert.equal(f.choice.id,'gone');assert.equal(f.memory.size,0);assert.equal(f.state.history.conversationId,'manual-visible');assert.match(f.state.historyError,/could not be restored/);
});
test('successful empty fallback clears previous visible history explicitly',async()=>{
 const f=fixture();await f.box.restoreSavedHistory(new AbortController().signal);
 assert.equal(f.choice.id,'new-empty');assert.equal(f.memory.get('owner-key'),'new-empty');assert.equal(f.state.history.conversationId,'new-empty');assert.equal(f.state.history.messages.length,0);assert.equal(f.state.history.automatic,true);
});

test('routine automatic restore stays quiet while partial-history notice remains truthful',async()=>{
 for(const partial of [false,true]){
  const f=fixture();f.choice={id:'saved',revision:'r1'};
  f.box.conversationList=async()=>[{id:'saved'}];
  f.box.readConversation=async()=>({messages:[],partial,deliveryRevisionAtStart:0});
  await f.box.restoreConversationHistory('saved',new AbortController().signal,true,true);
  assert.equal(f.state.history.conversationId,'saved');assert.equal(f.state.historyPartial,partial);
  assert.equal(f.state.message,partial?'Older messages remain on the agent.':'');
 }
});
test('explicit restoration still reports a failed restart-selection save',async()=>{
 const f=fixture();f.choice={id:'saved',revision:'r1'};f.box.conversationList=async()=>[{id:'saved'}];
 f.box.selectConversation=async()=>{throw Error('Storage unavailable');};
 await f.box.restoreConversationHistory('saved',new AbortController().signal,false,false);
 assert.match(f.state.message,/restart selection could not be saved/);assert.equal(f.state.history.conversationId,'saved');
});
