import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import {systemNoticeKind,systemNoticeDisplayText,collapseSystemNotices} from '../apps/app/src/runtime/action-message-presentation.ts';

// The shell's send (p.send in apps/app/src/prototype/agent-adapter.ts) and composer sizing, executed
// from their source with the connection, client, draft and DOM replaced by ports. No app start,
// transport, model or device.
const adapter=fs.readFileSync(new URL('../apps/app/src/prototype/agent-adapter.ts',import.meta.url),'utf8');
const between=(start,end)=>{const a=adapter.indexOf(start),b=adapter.indexOf(end,a);assert.ok(a>=0&&b>a,start);return adapter.slice(a,b);};
const ts=source=>stripTypeScriptTypes(source,{mode:'strip'});
const ownership=between('export function composerNeedsSizing(','export function installAgentAdapter(').replace(/^export /gm,'');
const send=between('  p.send = async function','  p.agentSay = function');
const say=between('  p.agentSay = function','  p.reply = function');
const plan=between('function planActionCard(','/** Context notices');
const notices=between('function replyNotices(','/** Decline one pending proposal');
const sizing=between('  const sizedComposers=','  const notesDataset=');
const compiled=ts(`${ownership}\n${plan}\n${notices}\nfunction methods(){const p={};\n${send}\n${say}\nreturn p;}\n${sizing}\nglobalThis.methods=methods();globalThis.exported={composerNeedsSizing,sizeComposer};`);
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});promise.catch(()=>{});return {promise,resolve,reject};};
const flush=async()=>{for(let n=0;n<40;n++)await Promise.resolve();};
const ROOM='a954925f-5698-4639-b1ea-6d1bb760a142';

function fixture(){
  const session={sessionId:'session-a',agentId:'agent-a',ownerId:'owner-a',origin:'https://agent.invalid'};
  const context={view:'calendar',revision:7,sensitive:false},sent=[],holds=[];
  let composers=[];
  const settled=new Map();
  class AlphaClientError extends Error{constructor(code,message){super(message);this.code=code;}}
  class NotDispatched extends Error{}
  const shell={
    live:true,sendAttempt:null,toasts:[],
    state:{msgs:[],draft:'',typing:false,chat:'sheet',shade:false,view:'calendar'},
    S(){return this.state;},async connectAgent(){},toast(text){this.toasts.push(text);},
    draftBindingTask:Promise.resolve(),
    composerDraft:{holding:false,binding:'fixture-draft',async hold(text){holds.push(text);this.holding=true;},async commit(){this.holding=false;},release(){this.holding=false;},abandon(){this.holding=false;}},
    setState(update,callback){const patch=typeof update==='function'?update(this.state):update;if(patch)this.state={...this.state,...patch};callback?.();},
  };
  const box={
    systemNoticeKind,systemNoticeDisplayText,collapseSystemNotices,
    console,Error,DOMException,AbortController,Promise,JSON,Object,Date,Set,Map,WeakMap,Math,String,queueMicrotask,
    crypto:{randomUUID},document:{hidden:false,querySelector:()=>null,querySelectorAll:()=>composers},
    alphaClient:{getState:()=>({context,pending:false}),send(text){const reply=deferred(),entry={text,reply,attempt:shell.sendAttempt};sent.push(entry);return reply.promise;}},
    connectionController:{
      getSnapshot:()=>({session,history:{conversationId:ROOM},busy:false,open:false}),
      getSelectedConversationId:()=>ROOM,getCloudEnvironment:()=>undefined,getCloudClient:()=>undefined,
      captureViewNavigation:()=>({}),continueRequestedCamera:async()=>[],
    },
    context(){},selectedCloudName:()=>'Eliza Cloud',localTurnStatus:new EventTarget(),
    sourceOf:()=>undefined,NotDispatched,AlphaClientError,
    privateLocalPreviewEnabled:false,residentAlwaysPresent:false,pageLeaving:false,
    RESIDENT_STARTING_NOTICE:'Starting',RESIDENT_RECOVERING_NOTICE:'Recovering',CAMERA_CONTEXT_NOTICE:'camera',
    deliverChatNavigation:async()=>false,requestAnimationFrame:()=>0,cancelAnimationFrame(){},
    retainReadReply(){},completeReadReply:async()=>{},proposalCard:()=>undefined,publishCommittedDeviceChanges(){},
    transportSettled:attempt=>settled.get(attempt)??Promise.resolve(),dispatched:()=>true,releaseComposerSend(){},
    restoredText:text=>text,
  };
  vm.runInNewContext(compiled,box);
  Object.assign(shell,box.methods);
  return {
    ...box.exported,shell,sent,holds,AlphaClientError,
    send(...args){const task=shell.send(...args);task.catch(()=>{});return task;},
    settleLater(attempt){const gate=deferred();settled.set(attempt,gate.promise);return gate;},
    answer(entry,text='Done.'){entry.reply.resolve({text,messageId:randomUUID(),userMessageId:randomUUID(),messageBinding:{conversationId:ROOM,session:{...session}}});},
    setComposers(value){composers=value;},
  };
}

test('a send given its text reaches the transport with an empty composer and never holds the composer draft',async()=>{
  const h=fixture();
  const pending=h.send('Share my location with Sam');await flush();
  assert.deepEqual(h.sent.map(entry=>entry.text),['Share my location with Sam'],'the answer is sent although the composer is empty');
  assert.deepEqual(h.holds,[]);assert.equal(h.shell.state.typing,true);
  assert.equal(JSON.stringify(h.shell.state.msgs.map(message=>[message.from,message.text])),JSON.stringify([['user','Share my location with Sam']]));
  h.answer(h.sent[0]);await pending;
  assert.equal(h.shell.state.typing,false);assert.equal(h.shell.sendAttempt,null);

  h.shell.state={...h.shell.state,draft:'typed text'};
  const typed=h.send();await flush();
  assert.equal(h.sent.at(-1).text,'typed text');assert.deepEqual(h.holds,['typed text']);assert.equal(h.shell.state.draft,'');
  h.answer(h.sent.at(-1));await typed;
  assert.equal(h.shell.state.typing,false);
});

test('a send cut off by a history reload does not clear the typing indicator of the send that followed it',async()=>{
  const h=fixture();
  const first=h.send('first message');await flush();
  // The transport is still settling when the reload cancels the request and clears the indicator.
  const settling=h.settleLater(h.sent[0].attempt);
  h.shell.setState({typing:false});
  h.sent[0].reply.reject(new h.AlphaClientError('cancelled','Request cancelled.'));await flush();
  const second=h.send('second message');await flush();
  assert.equal(h.sent.length,2);assert.equal(h.shell.state.typing,true);
  h.shell.setState({turnStatus:'Working'});
  settling.resolve();await first;
  assert.equal(h.shell.state.typing,true,'the newer send still shows its reply as pending');
  assert.equal(h.shell.state.turnStatus,'Working','the newer send keeps its status line');
  assert.equal(h.shell.sendAttempt,h.sent[1].attempt,'the newer attempt is still the tracked one');
  h.answer(h.sent[1]);await second;
  assert.equal(h.shell.state.typing,false);assert.equal(h.shell.state.turnStatus,'');assert.equal(h.shell.sendAttempt,null);
});

test('a finished send leaves the typing indicator to a voice turn in flight',async()=>{
  const h=fixture();
  const pending=h.send('a question');await flush();
  h.shell.voiceSendTurnId='turn-1';
  h.answer(h.sent[0]);await pending;
  assert.equal(h.shell.state.typing,true);
});

test('a typed message is sent when the voice stop it waited for was never confirmed',async()=>{
  const f=fixture();let stops=0;
  f.shell.stopVoiceConversation=()=>{stops++;return Promise.reject(Error('Could not confirm voice media stopped'));};
  f.shell.setState({draft:'Move lunch to one'});
  f.send();await flush();
  assert.equal(stops,1);assert.equal(f.sent.length,1,'the message reached the transport');
  assert.equal(f.sent[0].text,'Move lunch to one');assert.equal(f.shell.S().draft,'');
  // Every later message goes out too: the unconfirmed stop stays latched for voice only.
  f.answer(f.sent[0]);await flush();
  f.send('And invite Sam');await flush();
  assert.equal(stops,2);assert.equal(f.sent.length,2);assert.equal(f.sent[1].text,'And invite Sam');
});
test('a draft changed while an unconfirmed voice stop was pending is not sent',async()=>{
  const f=fixture(),stop=deferred();
  f.shell.stopVoiceConversation=()=>stop.promise;
  f.shell.setState({draft:'First wording'});
  const task=f.send();await flush();assert.equal(f.sent.length,0,'the send waits for the stop');
  f.shell.setState({draft:'Second wording'});stop.reject(Error('Could not confirm voice media stopped'));
  await task;assert.equal(f.sent.length,0);assert.equal(f.shell.S().draft,'Second wording');
});
test('the composer is measured only when its text, width or applied height changed',()=>{
  const h=fixture();
  let reads=0;
  const style={height:'44px'};
  const input={value:'hello',clientWidth:300,style,get scrollHeight(){reads++;return 66;}};
  h.setComposers([input]);
  h.sizeComposer();
  assert.equal(reads,1);assert.equal(style.height,'66px');
  h.sizeComposer();h.sizeComposer();
  assert.equal(reads,1,'an unchanged composer is not laid out again');
  input.value='hello there';h.sizeComposer();
  assert.equal(reads,2);
  input.clientWidth=280;h.sizeComposer();
  assert.equal(reads,3);
  style.height='44px';h.sizeComposer();
  assert.equal(reads,4,'a render that put the base height back is corrected');
  assert.equal(style.height,'66px');
  assert.equal(h.composerNeedsSizing(undefined,'',0,''),true);
  assert.equal(h.composerNeedsSizing({value:'a',width:1,height:'44px'},'a',1,'44px'),false);
});
