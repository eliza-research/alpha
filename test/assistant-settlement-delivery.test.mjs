import {systemNoticeKind,systemNoticeDisplayText,collapseSystemNotices} from '../apps/app/src/runtime/action-message-presentation.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Actual adapter methods, actual delivery projection/merge and a controlled transport/React queue.
// No SDK, app start, HTTP, model, microphone or device. These are UI-state ordering regressions.
const sourceRoot=process.env.ALPHA_SETTLEMENT_SOURCE_ROOT?path.resolve(process.env.ALPHA_SETTLEMENT_SOURCE_ROOT):fileURLToPath(new URL('../',import.meta.url));
const candidateRoot=fileURLToPath(new URL('../',import.meta.url));
const read=relative=>fs.readFileSync(relative==='apps/app/src/prototype/agent-adapter.ts'&&process.env.ALPHA_ACK_AGENT_SOURCE?process.env.ALPHA_ACK_AGENT_SOURCE:path.join(relative==='apps/app/src/prototype/agent-adapter.ts'?candidateRoot:sourceRoot,relative),'utf8');
const adapter=read('apps/app/src/prototype/agent-adapter.ts');
const connection=read('apps/app/src/runtime/connection-ui.tsx');
const between=(source,start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a,start);return source.slice(a,b);};
const ts=source=>stripTypeScriptTypes(source,{mode:'transform'});
const voice=between(adapter,'  p.sendVoiceTurn = async function','  p.send = async function');
const send=between(adapter,'  p.send = async function','  p.agentSay = function');
const say=between(adapter,'  p.agentSay = function','  p.reply = function');
const plan=between(adapter,'function planActionCard(','/** Context notices');
const notices=between(adapter,'function replyNotices(','/** Decline one pending proposal');
const merge=between(connection,'export function mergeConversationDelivery','const actionReceipts =').replace('export ','');
const history=between(connection,'function restoredMessages(','/** Eliza Cloud\'s API');
const failureKind=between(connection,'function failureKindOf(','/** The error a failed reply');
const delivery=between(adapter,'      const delivery=connectionController.getSnapshot().conversationDelivery;','      syncStoppedReplyNotice');
const compiled=ts(`${plan}\n${notices}\n${merge}\n${history}\n${failureKind}\nfunction methods(){const p={};\n${voice}\n${send}\n${say}\np.receiveCanonicalDelivery=function(){const session=connectionController.getSnapshot().session?.sessionId;\n${delivery}\n};return p;}globalThis.methods=methods();globalThis.projectHistory=restoredMessages;`);
const USER='03160f61-656a-4ceb-8495-8d7bd3eaf220',REPLY='b714dcf4-46d3-443d-8ff9-998942438767';
const ROOM='a954925f-5698-4639-b1ea-6d1bb760a142';
const RECEIPT={proposalId:'device-operation-1',summary:'The reviewed operation was applied.'};
const clone=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const flush=async()=>{for(let n=0;n<30;n++)await Promise.resolve();};

function fixture(){
  const initial={sessionId:'session-a',agentId:'agent-a',ownerId:'owner-a',origin:'https://agent.invalid'};
  let session=initial,room=ROOM,revision=1,deliveryValue,pending=false,onText;
  const accepted={view:'calendar',revision:7,sensitive:false};
  const binding={conversationId:ROOM,session:{...initial}};
  const gate=deferred(),sent=[],published=[],patches=[],held=[];
  let holdOne=false;
  const controller={
    getSnapshot:()=>({session,history:{conversationId:room},conversationDelivery:deliveryValue,busy:false,open:false}),
    getSelectedConversationId:()=>room,
    getCloudEnvironment:()=>undefined,getCloudClient:()=>undefined,
    captureViewNavigation:()=>({}),
    voiceConversationCurrent:value=>room===value.conversationId&&JSON.stringify(session)===JSON.stringify(value.session),
  };
  const client={getState:()=>({context:accepted,pending}),send:(...args)=>{
    sent.push(args);onText=args[1];pending=true;return gate.promise.finally(()=>{pending=false;});
  }};
  const shell={
    live:true,state:{msgs:[],draft:'Question',typing:false,chat:'sheet',shade:false,view:'calendar'},
    S(){return this.state;},async connectAgent(){},toast(){},
    draftBindingTask:Promise.resolve(),
    composerDraft:{holding:false,binding:'fixture-draft',async hold(_text,current){assert.equal(current(),true);this.holding=true;},async commit(){this.holding=false;},release(){},abandon(){}},
    setState(update,callback){
      if(typeof update==='function'&&holdOne){holdOne=false;held.push({update,callback});return;}
      const patch=typeof update==='function'?update(this.state):update;patches.push(patch);
      if(patch)this.state={...this.state,...patch};callback?.();
    },
  };
  const box={
    systemNoticeKind,systemNoticeDisplayText,collapseSystemNotices,
    console,Error,DOMException,AbortController,Promise,JSON,Object,Date,Set,Map,queueMicrotask,
    crypto:{randomUUID},document:{hidden:false,querySelector:()=>null},
    alphaClient:client,connectionController:controller,context(){},
    selectedCloudName:()=> 'Eliza Cloud',localTurnStatus:new EventTarget(),batchVoiceProgressEvents:new EventTarget(),batchVoiceReplyEvents:new EventTarget(),
    sourceOf:()=>undefined,NotDispatched:class NotDispatched extends Error{},
    AlphaClientError:class AlphaClientError extends Error{},
    privateLocalPreviewEnabled:false,residentAlwaysPresent:false,pageLeaving:false,
    NO_AGENT_VOICE:'Choose an agent',RESIDENT_STARTING_NOTICE:'Starting',RESIDENT_RECOVERING_NOTICE:'Recovering',
    deliverChatNavigation:async()=>false,
    retainReadReply(){},completeReadReply:async()=>{},proposalCard:()=>undefined,
    publishCommittedDeviceChanges:(receipt,_client,owner)=>published.push({receipt,owner}),
    transportSettled:async()=>{},dispatched:()=>true,releaseComposerSend(){},
    restoredText:text=>text,
  };
  vm.runInNewContext(compiled,box);
  Object.assign(shell,box.methods);
  const reply=(extra={})=>({text:'Final reply',messageId:REPLY,userMessageId:USER,messageBinding:clone(binding),...extra});
  return {
    shell,client,controller,binding,box,sent,published,patches,held,
    async start(kind,extra={}){
      const signal=new AbortController().signal;
      const task=kind==='voice'?shell.sendVoiceTurn({text:'Question',turnId:'turn-1',voiceTurnSignal:{},signal,binding,context:accepted,assertCurrent(){},...extra}):shell.send();
      // Observe rejection even while a queued voice update waits for its callback.
      task.catch(()=>{});await flush();assert.equal(sent.length,1,'one actual adapter dispatch reached the recording port');return {task};
    },
    stream(text='Partial reply'){assert.equal(typeof onText,'function');onText(text);},
    deliver({text='Final reply',withUser=true,receipt=false}={}){
      const rows=[...(withUser?[{id:USER,role:'user',text:'Question'}]:[]),{id:REPLY,role:'assistant',text,planAction:'plan'}];
      const messages=box.projectHistory(rows);
      if(receipt)messages.push({id:`device-receipt:${RECEIPT.proposalId}`,from:'agent',text:RECEIPT.summary,deviceReceipt:true,inReplyTo:USER});
      deliveryValue={sessionId:session.sessionId,conversationId:room,revision:revision++,messages};
      shell.receiveCanonicalDelivery();
    },
    resolve(extra){gate.resolve(reply(extra));},
    deferNextFunction(){holdOne=true;},
    rebind(){session={sessionId:'session-b',agentId:'agent-b',ownerId:'owner-b',origin:'https://other.invalid'};room='foreign-room';},
    chooseAnotherConversation(){room='foreign-room';},
    drainHeld(){const item=held.shift();assert.ok(item,'the real functional updater was deferred');const patch=item.update(shell.state);patches.push(patch);if(patch)shell.state={...shell.state,...patch};item.callback?.();return patch;},
  };
}

for(const kind of ['text','voice']){
  for(const streamed of [false,true])test(`${kind}: ordinary ${streamed?'streamed':'unstreamed'} settlement adopts each canonical ID once`,async()=>{
    const h=fixture(),{task}=await h.start(kind);if(streamed)h.stream();h.resolve({planAction:'plan'});await task;
    assert.deepEqual(Array.from(h.shell.state.msgs,row=>row.id),[USER,REPLY]);
    const reply=h.shell.state.msgs.find(row=>row.id===REPLY);
    assert.equal(reply.text,'Final reply');assert.notEqual(reply.streaming,true);assert.equal(reply.card?.planAction,'plan');
    assert.equal(reply.messageBinding.conversationId,ROOM);
    assert.equal(h.shell.state.typing,false);assert.equal(h.sent.length,1);
  });
  test(`${kind}: saved delivery before settlement leaves one user/reply and preserves binding/revision/receipt`,async()=>{
    const h=fixture(),{task}=await h.start(kind);h.stream();h.deliver({receipt:true});h.deliver({receipt:true});
    const canonical=h.shell.state.msgs.find(row=>row.id===REPLY),receipt=h.shell.state.msgs.find(row=>row.deviceReceipt);
    h.resolve({completedActions:[RECEIPT]});await task;
    assert.equal(h.shell.state.msgs.filter(row=>row.id===USER).length,1);
    assert.equal(h.shell.state.msgs.filter(row=>row.id===REPLY).length,1);
    assert.equal(new Set(h.shell.state.msgs.map(row=>row.id)).size,h.shell.state.msgs.length);
    assert.deepEqual(clone(h.shell.state.msgs.find(row=>row.id===REPLY)),clone(canonical),'keep authoritative delivered fields');
    assert.equal(canonical.conversationDeliveryRevision,1);assert.equal(canonical.messageBinding.conversationId,ROOM);
    assert.equal(h.shell.state.msgs.find(row=>row.deviceReceipt),receipt);
    assert.equal(receipt.inReplyTo,USER);assert.equal(receipt.messageBinding,undefined);
    assert.equal(h.published.length,1);assert.equal(h.sent.length,1);
  });
  for(const streamed of [false,true])test(`${kind}: delivered reply retains its text/metadata and final plan card (${streamed?'streamed':'unstreamed'})`,async()=>{
    const h=fixture(),{task}=await h.start(kind);if(streamed)h.stream();h.deliver({text:'Authoritative saved reply'});
    const before=h.shell.state.msgs.find(row=>row.id===REPLY),binding=before.messageBinding;
    assert.equal(before.card,null,'actual canonical-delivery projection has no plan metadata');
    h.resolve({planAction:'plan'});await task;
    const row=h.shell.state.msgs.find(row=>row.id===REPLY);
    assert.equal(h.shell.state.msgs.filter(item=>item.id===REPLY).length,1);
    assert.equal(row.text,'Authoritative saved reply');assert.deepEqual(clone(row.messageBinding),clone(binding));
    assert.equal(row.conversationDeliveryRevision,1);
    assert.equal(row.card?.planAction,'plan','the normal controller plan action must remain actionable');
  });
  test(`${kind}: a rebound before final response cannot append the old reply`,async()=>{
    const h=fixture(),{task}=await h.start(kind);h.stream();h.rebind();
    h.shell.state={...h.shell.state,msgs:[{id:'foreign-message',from:'agent',text:'Other owner'}]};
    h.resolve();if(kind==='voice')await assert.rejects(task,/changed/);else await task;
    assert.deepEqual(h.shell.state.msgs,[{id:'foreign-message',from:'agent',text:'Other owner'}]);
  });
  test(`${kind}: a deferred settlement rechecks binding before a React state patch commits`,async()=>{
    const h=fixture(),{task}=await h.start(kind);h.stream();h.deferNextFunction();h.resolve();await flush();
    assert.equal(h.held.length,1);h.rebind();
    const foreign=[{id:'foreign-message',from:'agent',text:'Other owner'}];h.shell.state={...h.shell.state,msgs:foreign};
    const patch=h.drainHeld();assert.equal(patch,null,'stale settlement must not commit any message patch');
    if(kind==='voice')await assert.rejects(task,/changed/);else await task;
    assert.equal(h.shell.state.msgs,foreign);
  });
}

test('the ordinary controller reply contract exposes planAction while stored-history projection discards it',()=>{
  const contract=between(connection,'  async send(text: string','    } catch (error) {');
  assert.match(contract,/planAction:\s*notice === 'offline' \? 'retry' : signedIn \? 'plan' : 'sign-in'/);
  const h=fixture(),rows=h.box.projectHistory([{id:REPLY,role:'assistant',text:'Saved reply',planAction:'plan'}]);
  assert.equal(rows.length,1);assert.equal(rows[0].text,'Saved reply');assert.equal(rows[0].planAction,undefined);
});

// The single Calendar design removes source plumbing while retaining conditional recovery.
test('Calendar Settings keeps one Google entry and conditional recovery without source-picker plumbing',()=>{
  const template=read('apps/app/src/prototype/template.html');
  const settings=read('apps/app/src/prototype/settings-adapter.ts');
  const start=settings.indexOf('// calendar-settings:begin'),end=settings.indexOf('// calendar-settings:end',start);
  assert(start>=0&&end>start,'current Settings Calendar block is present');
  const calendar=settings.slice(start,end);
  assert.doesNotMatch(template,/calendar\.calendarAuthorityChoices|calendar\.canConfirmCalendarTransition/);
  assert.match(calendar,/label:'Google Calendar'/);assert.match(calendar,/googleConnectionController\.openCalendar\(scope\)/);
  assert.match(calendar,/go:calendarView\.confirmCalendarTransition/);assert.match(calendar,/cap:'Recovery',hasCap:true/);
  assert.match(calendar,/label:'Recover saved events'/);assert.match(calendar,/label:'Return to Calendar'/);
  assert.match(calendar,/label:'Retry calendar'/);assert.match(calendar,/back:\(\)=>api\.set\(\{page:null\}\)/);
  assert.doesNotMatch(calendar,/sourceRows|cap:'Calendar sources'|label:'Current source'|cap:'Sync'/);
});

for(const kind of ['text','voice'])test(`${kind}: focused existing non-null card metadata stays authoritative`,async()=>{
  const h=fixture(),{task}=await h.start(kind);h.stream();
  const card={type:'generic',planAction:'retry',title:'Existing reviewed control',limit:{retryAfterSeconds:30},reviewed:true};
  h.shell.agentSay('Existing canonical reply',card,{id:REPLY,messageBinding:clone(h.binding)});
  h.deliver();const before=h.shell.state.msgs.find(row=>row.id===REPLY);
  h.resolve({planAction:'plan'});await task;
  const after=h.shell.state.msgs.find(row=>row.id===REPLY);
  assert.equal(after.card,card);assert.deepEqual(clone(after),clone(before));
  assert.equal(h.shell.state.msgs.filter(row=>row.id===REPLY).length,1);
});
for(const change of ['owner','conversation'])test(`text: focused queued unstreamed agentSay refuses changed ${change}`,async()=>{
  const h=fixture(),{task}=await h.start('text');h.deferNextFunction();h.resolve({planAction:'plan'});await flush();
  assert.equal(h.held.length,1);if(change==='owner')h.rebind();else h.chooseAnotherConversation();
  const foreign=[{id:'foreign-message',from:'agent',text:'New selected conversation'}];h.shell.state={...h.shell.state,msgs:foreign};
  assert.equal(h.drainHeld(),null);await task;assert.equal(h.shell.state.msgs,foreign);
});

// New owning regressions exercise the actual selected sendVoiceTurn method, not a reimplementation.
test('batch progress callback is exact turn/room/owner-bound and never a stored chat reply',async()=>{
 const f=fixture(),cues=[],reply=[];const {task}=await f.start('voice',{onProgress:value=>cues.push(value),onReplyStarted:()=>reply.push('final-start')});
 const base={turnId:'turn-1',conversationId:f.binding.conversationId,ownerId:f.binding.session.ownerId,kind:'thinking',label:'Checking calendar'};
 for(const patch of [{turnId:'foreign'},{conversationId:'foreign'},{ownerId:'foreign'}])f.box.batchVoiceProgressEvents.dispatchEvent(new CustomEvent('progress',{detail:{...base,...patch}}));
 assert.equal(cues.length,0);f.box.batchVoiceProgressEvents.dispatchEvent(new CustomEvent('progress',{detail:base}));assert.equal(cues.length,1);assert.ok(f.shell.state.msgs.every(row=>row.text!=='On it.'));
 f.stream();assert.equal(reply.length,0,'display/provisional token alone is not final-reply proof');f.box.batchVoiceReplyEvents.dispatchEvent(new CustomEvent('reply',{detail:base}));assert.equal(reply.length,1);f.resolve();await task;const before=cues.length;f.box.batchVoiceProgressEvents.dispatchEvent(new CustomEvent('progress',{detail:base}));assert.equal(cues.length,before,'listener removed after terminal reply');
});
test('aborted selected voice request removes progress listener without another send',async()=>{
 const f=fixture(),abort=new AbortController(),cues=[];const {task}=await f.start('voice',{signal:abort.signal,onProgress:value=>cues.push(value)});abort.abort();f.resolve();await assert.rejects(task);
 f.box.batchVoiceProgressEvents.dispatchEvent(new CustomEvent('progress',{detail:{turnId:'turn-1',conversationId:f.binding.conversationId,ownerId:f.binding.session.ownerId,kind:'thinking',label:'Checking'}}));assert.equal(cues.length,0);assert.equal(f.sent.length,1);
});
test('voice: a turn the agent chose not to answer keeps the user row and settles with nothing to say',async()=>{
 const f=fixture(),{task}=await f.start('voice');f.stream();f.resolve({ignored:true,text:'',messageId:undefined});
 const result=await task;
 assert.deepEqual(Array.from(f.shell.state.msgs,row=>row.id),[USER]);
 assert.equal(f.shell.state.msgs[0].messageBinding.conversationId,ROOM);
 assert.equal(result.text,'');assert.equal(result.complete,true);assert.equal(result.userMessageId,USER);
 assert.equal(result.assistantMessageId,'turn-1','the turn names no stored reply');
 assert.equal(f.shell.state.typing,false);assert.equal(f.sent.length,1);
});
test('voice: an ignored turn without a saved user message is not confirmed',async()=>{
 const f=fixture(),{task}=await f.start('voice');f.resolve({ignored:true,text:'',messageId:undefined,userMessageId:undefined});
 await assert.rejects(task,/could not be matched/);
});
