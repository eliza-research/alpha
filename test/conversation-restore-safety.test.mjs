import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import vm from 'node:vm';
import {deferred} from './fixtures/wait-for.mjs';
const source=readFileSync('apps/app/src/runtime/connection-ui.tsx','utf8');
const part=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);};
const code=stripTypeScriptTypes([
 part('async function createSelectedConversation(', '/** Only remove'),
 part('async function restoreConversationHistory(', '/** Restored chats'),
 part('async function restoreSavedHistory(', 'type HistoryEntry'),
].join('\n'),{mode:'strip'});
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
 const f=fixture();f.choice={id:'saved',revision:'native'};f.box.conversationList=async()=>[{id:'saved'}];let reads=0,release;const reached=deferred();
 f.box.captureConversationChoice=async()=>{reads++;if(reads===2){const gate=new Promise(resolve=>release=resolve);reached.resolve();await gate;}return structuredClone(f.choice);};
 const pending=f.box.restoreConversationHistory('saved',new AbortController().signal,true,true);
 await Promise.race([reached.promise,pending.then(()=>{throw Error('restore finished without the second read');})]);
 assert.equal(f.state.history.conversationId,'manual-visible');release();await pending;
 assert.equal(f.state.history.conversationId,'saved');assert.equal(reads,2);assert.equal(f.memory.get('owner-key'),'saved');
});
test('a newer manual choice during missing-conversation lookup prevents fallback creation',async()=>{
 const f=fixture();let release;const reached=deferred();f.box.conversationList=()=>{const list=new Promise(resolve=>release=resolve);reached.resolve();return list;};
 const pending=f.box.restoreSavedHistory(new AbortController().signal);
 await Promise.race([reached.promise,pending.then(()=>{throw Error('restore finished without the conversation lookup');})]);f.choice={id:'manual-newer',revision:'r2'};release([]);await pending;
 assert.equal(f.choice.id,'manual-newer');assert.equal(f.createCount,0);assert.equal(f.state.history.conversationId,'manual-visible');assert.equal(f.memory.size,0);assert.match(f.state.historyError,/Couldn’t restore/);
});
test('failed fallback compare-and-set cannot publish a new in-memory conversation',async()=>{
 const f=fixture();f.box.selectConversation=async()=>{throw Error('Concurrent selection');};
 await f.box.restoreSavedHistory(new AbortController().signal);
 assert.equal(f.createCount,1);assert.equal(f.choice.id,'gone');assert.equal(f.memory.size,0);assert.equal(f.state.history.conversationId,'manual-visible');assert.match(f.state.historyError,/Couldn’t restore/);
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
  assert.equal(f.state.message,'');
 }
});
test('explicit restoration still reports a failed restart-selection save',async()=>{
 const f=fixture();f.choice={id:'saved',revision:'r1'};f.box.conversationList=async()=>[{id:'saved'}];
 f.box.selectConversation=async()=>{throw Error('Storage unavailable');};
 await f.box.restoreConversationHistory('saved',new AbortController().signal,false,false);
 assert.match(f.state.message,/not saved/);assert.equal(f.state.history.conversationId,'saved');
});
test('a restored failure row shows Alpha copy instead of the agent\'s saved failure prose',async()=>{
 const {systemNoticeKind,systemNoticeDisplayText}=await import('../apps/app/src/runtime/action-message-presentation.ts');
 const {isCalendarReadFailureCode}=await import('../.eliza/client-features/packages/contracts/src/calendar.ts');
 const box={systemNoticeKind,systemNoticeDisplayText,isCalendarReadFailureCode,restoredText:text=>text,Error};
 vm.runInNewContext(stripTypeScriptTypes([part('export const RESTORED_FAILURES','/** A completed Calendar read').replace(/^export /,''),part('function restoredMessages(','/** Eliza Cloud'),part('function calendarRefusalKept(','/** The error a failed reply')].join('\n'),{mode:'strip'})+';globalThis.restoredMessages=restoredMessages;',box);
 const prose='Connect an LLM provider to start chatting. Open Settings → Providers, or choose Eliza Cloud during first-run setup.';
 const rows=box.restoredMessages([
  {id:'u1',role:'user',text:'Hello'},
  {id:'a1',role:'assistant',text:prose,failureKind:'provider_issue'},
  {id:'a2',role:'assistant',text:'Heard part',failureKind:'interrupted',interrupted:true},
  {id:'a3',role:'assistant',text:'A normal reply.'},
  {id:'a4',role:'assistant',text:'I couldn\'t confirm that Calendar request.',failureKind:'reply_generation_error',terminalFailure:{kind:'reply_generation_error',transient:false,code:'CALENDAR_READ_RECEIPT_MISMATCH'}},
 ]);
 assert.deepEqual(JSON.parse(JSON.stringify(rows[1])),{id:'a1',from:'agent',text:'This reply couldn’t be completed.',unfinished:true,failureKind:'provider_issue'});
 assert.ok(!JSON.stringify(rows).includes('Settings → Providers'));
 assert.equal(rows[2].text,'Heard part');assert.equal(rows[2].unfinished,true);
 assert.equal(rows[3].text,'A normal reply.');assert.equal(rows[3].unfinished,undefined);
 assert.equal(rows[4].text,'I couldn\'t confirm that Calendar request.','a Calendar refusal keeps its answer');assert.equal(rows[4].unfinished,undefined);
});

// Exercise the real restore and event listener with a read held across a later
// request. An old history publication disconnects the visible chat's active send.
const stoppedVoiceCode=stripTypeScriptTypes([
 part('let stoppedReply:', '/** A restart can land'),
 part('let residentStartInBackground', '/** Release only this operation'),
 part('async function restoreConversationHistory(', '/** Restored chats'),
 part('function startConversationEvents(', '/** Insert canonical delivery IDs'),
 'globalThis.controller={',part('  async refreshDeveloperVoiceHistory(', '  getPairedVoiceBinding()'),
 'voiceConversationCurrent:binding=>binding.conversationId===\'saved\'};',
].join('\n'),{mode:'strip'});
function stoppedVoiceFixture(){
 const session={sessionId:'session',agentId:'agent'},pending=[],writes=[],channel={};
 const rows=[{id:'question',role:'user',text:'What time is it?'}];
 const state={session,history:{revision:1,messages:[]}},selected={kind:'resident',remote:{subscribeConversationEvents(listener){channel.listener=listener;}}};
 const box={state,active:selected,epoch:1,service:null,sending:null,operation:null,planRecheck:null,signInReadinessOwner:null,testMocksEnabled:true,
  browserLocalAgentEnabled:true,AbortController,AbortSignal,DOMException,Error,JSON,Reflect,clearTimeout,
  anyAbortSignal:signals=>AbortSignal.any(signals),conversationKey:()=> 'owner',conversationMemory:new Map([['owner','saved']]),
  captureConversationChoice:async()=>({id:'saved',revision:'r1'}),conversationList:async()=>[{id:'saved'}],residentCloudFlow:()=>false,
  readConversation:()=>{const reply=deferred(),messages=rows.slice();pending.push({reply,messages});return reply.promise;},restoredMessages:messages=>messages,
  update:patch=>{writes.push(patch);Object.assign(state,patch);},noSessionError:message=>Error(message),NO_SESSION_FALLBACK:'missing',
  runQueuedResidentRebind(){},runQueuedSignInReturn(){},scheduleResidentAutoRetry(){},residentRecoveryReason(){},
  closeConversationEvents:undefined,deliverConversationMessages(){throw Error('Unexpected proactive delivery');},checkResidentAlive(){},
 };
 vm.runInNewContext(stoppedVoiceCode,box);box.startConversationEvents(selected,session);
 const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
 const refresh=()=>box.controller.refreshDeveloperVoiceHistory({conversationId:'saved'},new AbortController().signal,true);
 return {box,state,writes,rows,pending,settle,refresh,
  updated:(id='saved')=>channel.listener({type:'conversation-updated',conversation:{id}}),
  release:async i=>{const read=pending[i];read.reply.resolve({messages:read.messages,partial:false,deliveryRevisionAtStart:0});await settle();},
 };
}
test('Direct voice Stop reads its final receipt and repeats once when the saved receipt is announced',async()=>{
 const f=stoppedVoiceFixture(),first=f.refresh();first.catch(()=>{});await f.settle();assert.equal(f.pending.length,1);
 f.rows.push({id:'receipt',role:'assistant',text:'This reply did not finish.'});f.updated('another');await f.settle();assert.equal(f.pending.length,1);
 f.updated();await f.settle();assert.equal(f.pending.length,2);await f.release(1);
 assert.deepEqual(f.state.history.messages.map(row=>row.id),['question','receipt']);
 await f.release(0);await assert.rejects(first,{name:'AbortError'});assert.equal(f.state.history.revision,2);
 f.updated();await f.settle();assert.equal(f.pending.length,2,'only one receipt-triggered repeat');
});
test('a completed newer operation retires an in-flight Direct Stop read',async()=>{
 const f=stoppedVoiceFixture(),first=f.refresh();first.catch(()=>{});await f.settle();
 await f.box.work('New request',async()=>{});assert.equal(f.box.operation,null);
 await f.release(0);await assert.rejects(first,{name:'AbortError'});assert.equal(f.state.history.revision,1);
 f.updated();await f.settle();assert.equal(f.pending.length,1,'a finished new request cannot revive the old read');
});
test('a newer send or retired conversation cannot be overwritten by the Direct Stop read',async()=>{
 for(const mode of ['sending','retired']){
  const f=stoppedVoiceFixture(),first=f.refresh();first.catch(()=>{});await f.settle();
  const request=new AbortController();if(mode==='sending')f.box.sending=request;else f.box.cancelStoppedReply();
  await f.release(0);await assert.rejects(first,{name:'AbortError'});assert.equal(request.signal.aborted,false);assert.equal(f.state.history.revision,1);
 }
});
test('ordinary conversation updates do not start a Direct Stop history read',async()=>{
 const f=stoppedVoiceFixture();f.updated();await f.settle();assert.equal(f.pending.length,0);assert.equal(f.writes.length,0);
});
test('a receipt saved after the first Direct Stop read still refreshes once',async()=>{
 const f=stoppedVoiceFixture(),first=f.refresh();await f.settle();await f.release(0);await first;
 f.rows.push({id:'receipt',role:'assistant',text:'Stopped'});f.updated();await f.settle();await f.release(1);
 assert.deepEqual(f.state.history.messages.map(row=>row.id),['question','receipt']);
 f.updated();await f.settle();assert.equal(f.pending.length,2);
});
test('an older voice session finishing Stop cannot retire the current stopped conversation read',async()=>{
 const f=stoppedVoiceFixture(),first=f.refresh();first.catch(()=>{});await f.settle();
 await assert.rejects(f.box.controller.refreshDeveloperVoiceHistory({conversationId:'older'},new AbortController().signal,true),/conversation changed/);
 f.rows.push({id:'receipt',role:'assistant',text:'Current stopped reply'});f.updated();await f.settle();
 assert.equal(f.pending.length,2,'the current record still receives its announced receipt');
 await f.release(1);await f.release(0);await assert.rejects(first,{name:'AbortError'});
 assert.deepEqual(f.state.history.messages.map(row=>row.id),['question','receipt']);
});
test('the browser event channel forwards saved conversation announcements alongside proactive messages',async()=>{
 const source=readFileSync('apps/app/src/runtime/local-agent.ts','utf8'),start=source.indexOf('function subscribeBrowserConversationEvents('),end=source.indexOf('\nfunction record(',start);
 assert.ok(start>=0&&end>start);
 const ready=deferred(),received=[],sockets=[];
 class Socket{static OPEN=1;readyState=1;constructor(){sockets.push(this);queueMicrotask(()=>this.onopen?.());}close(){}}
 const box={crypto:{randomUUID:()=> 'client'},AbortController,DOMException,URL,JSON,Date,Error,Math,setTimeout,clearTimeout,location:{host:'localhost:5173'},WebSocket:Socket};
 vm.runInNewContext(stripTypeScriptTypes(source.slice(start,end)),box);
 const bridge={request:async()=>({status:200,body:JSON.stringify({wsUrl:'ws://localhost:5173/__alpha-local-renderer/ws?sessionId=ticket',expiresAt:Date.now()+60000})})};
 const stop=box.subscribeBrowserConversationEvents(bridge,'owner',value=>received.push(value.type),state=>{if(state==='connected')ready.resolve();});
 try{await ready.promise;for(const type of ['agent_event','conversation-updated','proactive-message','status'])sockets[0].onmessage({data:JSON.stringify({type})});assert.deepEqual(received,['conversation-updated','proactive-message']);}
 finally{stop();}
});
