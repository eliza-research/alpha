import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';

// Executes the owning controller's real post-turn orchestration and failure mapper.
// Only transport, membership refresh and proposal-list boundaries are controlled.
// This does not qualify the browser renderer, provider, native journal or billing backend.
const source=readFileSync('apps/app/src/runtime/connection-ui.tsx','utf8');
const mapStart=source.indexOf('function replyFailure(');
const mapEnd=source.indexOf('/** After a failed reply',mapStart);
assert(mapStart>=0&&mapEnd>mapStart);
const start=source.indexOf('      let responseFailure: Error | undefined;');
const end=source.indexOf('    } catch (error) {',start);
assert(start>=0&&end>start);
const mapper=stripTypeScriptTypes(source.slice(mapStart,mapEnd),{mode:'transform'});
const orchestration=stripTypeScriptTypes(`async function finish(){${source.slice(start,end)}}`,{mode:'transform'});
const labels=source.match(/export const REPLY_FAILURES = (\{[\s\S]*?\n\}) as const;/);
assert(labels,'canonical reply labels must remain available');
const replyLabels=new Function(`return (${labels[1]})`)();
const applied=source.match(/export const EFFECT_APPLIED_INTERRUPTED = ('[^\n]*');/);
assert(applied,'canonical applied-before-failure copy must remain available');
const appliedText=new Function(`return ${applied[1]}`)();

class ClientError extends Error {constructor(code,message){super(message);this.code=code;}}
const userMessageId='9f1dc45a-4011-4e44-947a-30d999d24fa5';
const verifiedSession={sessionId:'session',ownerId:'owner',agentId:'agent',origin:'https://fixture.invalid'};
const notice='An agent action could not be shown on this phone. Reviewed reminder creation was not negotiated.';

async function finish({kind='handler_error',limit=null,effectApplied=false,resident=false,account=false,hasServerId=true}={}){
 const state={message:'Connected',residentInference:'cloud',cloudAccount:account?{userId:'owner'}:null,
   lastServiceLimit:{kind:'prior-limit',observedAt:1},fundingRefused:false,membershipDismissed:true};
 const events={posts:1,lists:0,decisions:0,claims:0,receipts:0,effects:0,refresh:0,planRecheck:0};
 const selected={kind:resident?'resident':'remote',actions:{async pendingReview(){events.lists++;return[{proposalId:'saved-action',proposal:null,notice}];},
   async performRequested(){events.effects++;throw Error('failed turns must never execute');}}};
 const env={state,selected,isAndroid:false,AlphaClientError:ClientError,REPLY_FAILURES:replyLabels,
   RATE_LIMITED:'The AI request rate limit was reached.',cloud:{environment:'production'},
   connectionController:{recheckPlanAfterRefusal(){events.planRecheck++;}},
   update(patch){Object.assign(state,patch);},refreshMembershipBalance(){events.refresh++;return Promise.resolve();},
   fundingRefusedReply:()=> 'Billing refused. Check your subscription; nothing was purchased.',
   cloudServiceName:()=> 'Eliza Cloud',serviceLimitMessage:()=> 'Rate limit reached. Wait before sending again.',
   residentCloudFlow:()=>true,inferenceUnavailableReply:()=> 'AI is unavailable. Check its connection.'};
 const failure=new Function(...Object.keys(env),`${mapper};return replyFailure;`)(...Object.values(env));
 const record={kind,code:'CONTROLLED_FAILURE',transient:false};
 const context={view:'home',sensitive:false,timeZone:'UTC',revision:1};
 const run={...env,context,reply:{text:'PRIVATE_PROVIDER_FAILURE_CANARY',terminalFailure:record,...(hasServerId?{userMessageId}:{})},
   replyFailure:failure,effectAppliedBeforeFailure:()=>effectApplied,EFFECT_APPLIED_INTERRUPTED:appliedText,
   isAndroid:false,ownProviderSelected:()=>false,isCalendarReadFailureCode:()=>false,
   failureKindOf:reply=>reply.terminalFailure?.kind,readServiceLimit:()=>limit,
   retractReadiness(){state.message='';},validateUuid:value=>value===userMessageId,
   message:{context},id:'conversation',session:{...verifiedSession},generation:1,
   requestSignal:new AbortController().signal,assertCurrent(){},directRequestedActions:false,
   authoredRequestText:'Review only. Do not execute.',announcedProposals:new WeakMap(),
   appRecordInvalidations:()=>[],automationsCommitted:()=>false,
   cameraNavigation:null,cameraAttempt:null};
 const invoke=new Function(...Object.keys(run),`${orchestration};return finish();`);
 let result,error;
 try{result=await invoke(...Object.values(run));}catch(cause){error=cause;}
 return{state,events,result,error};
}

// Exercise the actual dispatched-error caller and existing bounded-notice/card
// renderer contract too. No transport, browser, provider or device is opened.
const adapter=readFileSync('apps/app/src/prototype/agent-adapter.ts','utf8');
const renderStart=adapter.indexOf("        const recorded=e&&typeof e==='object'");
const renderEnd=adapter.indexOf('\n      }\n    }\n    finally { if(this.sendAttempt===attempt)',renderStart);
assert(renderStart>=0&&renderEnd>renderStart);
const errorPresentation=stripTypeScriptTypes(`function present(){${adapter.slice(renderStart,renderEnd)}}`,{mode:'transform'});
const helpersStart=adapter.indexOf('function planActionCard(');
const helpersEnd=adapter.indexOf('/** Decline one pending proposal',helpersStart);
assert(helpersStart>=0&&helpersEnd>helpersStart);
const helpers=stripTypeScriptTypes(adapter.slice(helpersStart,helpersEnd),{mode:'transform'});
const sayStart=adapter.indexOf('  p.agentSay = function');
const sayEnd=adapter.indexOf('  p.reply = function',sayStart);
assert(sayStart>=0&&sayEnd>sayStart);
const say=stripTypeScriptTypes(adapter.slice(sayStart,sayEnd).replace('p.agentSay =','const agentSay ='),{mode:'transform'});
function present(error,{current=true,reconciling=false,conversationId='conversation',session=verifiedSession,deferUpdates=false}={}){
 const state={chat:'sheet',msgs:[{id:'local-user',from:'user',text:'Synthetic request'}]};
 let selectedConversation=conversationId,selectedSession={...session};
 const pending=[];
 const apply=patch=>{const next=typeof patch==='function'?patch(state):patch;if(next)Object.assign(state,next);};
 const shell={live:true,setState(patch){if(deferUpdates&&typeof patch==='function')pending.push(patch);else apply(patch);}};
 const env={e:error,message:error.message,opened:false,streamed:false,streamedId:'stream',userId:'local-user',
   sameChat:()=>current,AlphaClientError:ClientError,selectedCloudName:()=> 'Eliza Cloud',
   connectionController:{getSnapshot:()=>({replyNotice:reconciling?'Stopped.':'',kind:'resident',session:selectedSession}),
     getSelectedConversationId:()=>selectedConversation},context(){}};
 const call=new Function(...Object.keys(env),`${helpers}\n${say}\n${errorPresentation}\nthis.agentSay=agentSay;return present.call(this);`);
 const render=()=>call.call(shell,...Object.values(env));render();
 return{state,render,notices:()=>state.msgs.filter(m=>m.card?.systemNotice),failures:()=>state.msgs.filter(m=>m.interrupted),
   switchConversation(id){selectedConversation=id;},switchSession(session){selectedSession={...session};},
   pending:()=>pending.length,flush(){while(pending.length)apply(pending.shift());}};
}
function noEffects(result){assert.deepEqual({...result.events,refresh:0,planRecheck:0},
 {posts:1,lists:1,decisions:0,claims:0,receipts:0,effects:0,refresh:0,planRecheck:0});}
function visibleFailureAndNotice(r){
 assert.equal(r.result,undefined);assert(r.error instanceof ClientError);assert.deepEqual(r.error.notices,[notice]);
 const view=present(r.error);assert.equal(view.failures().length,1);assert.equal(view.notices().length,1);
 assert.equal(view.notices()[0].text,notice);assert.equal(view.notices()[0].card.done,true);
 assert.equal(view.notices()[0].card.proposalId,undefined,'notice is never an approval');
 assert.doesNotMatch(JSON.stringify(view.state),/PRIVATE_PROVIDER_FAILURE_CANARY/);
 view.render();assert.equal(view.notices().length,1,'stable request notice identity coalesces repeat presentation');
 return view;
}
for(const kind of ['handler_error','fatal_error','unknown_failure'])test(`${kind}: failure remains interrupted while unsupported notice is visible once`,async()=>{
 const r=await finish({kind});noEffects(r);const view=visibleFailureAndNotice(r);
 assert.match(view.failures()[0].text,/Sorry, I couldn’t finish that reply/);
 assert.doesNotMatch(view.failures()[0].text,/Pending phone actions are available|succeeded|created/i);
 assert.equal(r.error.planAction,undefined);assert.equal(r.error.userMessageId,userMessageId);
 assert.equal(r.state.lastServiceLimit.kind,'prior-limit','failure never clears existing limit');
});
for(const kind of ['provider_issue','generation_timeout','interrupted'])test(`${kind}: typed failure and notice both survive without success conversion`,async()=>{
 const r=await finish({kind});noEffects(r);const view=visibleFailureAndNotice(r);
 assert.equal(r.error.code,'transport-failed');assert.equal(r.error.failureKind,kind);
 assert.equal(r.error.userMessageId,userMessageId);assert.equal(view.failures()[0].text,r.error.message);
 assert.equal(r.state.message,'');assert.equal(r.state.lastServiceLimit.kind,'prior-limit');
});
test('service-limit timing/state remains intact with one notice and no retry',async()=>{
 const limit={kind:'request-rate',retryAfterSeconds:23,resetAt:'2030-01-01T00:00:00.000Z'};
 const r=await finish({kind:'rate_limited',limit});noEffects(r);visibleFailureAndNotice(r);
 assert.equal(r.error.failureKind,'rate_limited');assert.equal(r.error.serviceLimit,limit.kind);
 assert.equal(r.state.lastServiceLimit.retryAfterSeconds,23);assert.equal(r.state.lastServiceLimit.resetAt,limit.resetAt);
 assert.equal(r.error.planAction,undefined);assert.equal(r.events.refresh,0);
});
test('billing refusal keeps its funding action, visible failure and once-only notice',async()=>{
 const r=await finish({kind:'insufficient_credits',limit:{kind:'billing-refused'},account:true});noEffects(r);
 const view=visibleFailureAndNotice(r);assert.equal(r.error.planAction,'funding');
 assert.equal(view.failures()[0].card.planAction,'funding');assert.equal(r.error.serviceLimit,'billing-refused');
 assert.equal(r.state.fundingRefused,true);assert.equal(r.state.membershipDismissed,false);assert.equal(r.events.refresh,1);
});
test('provider-less resident keeps its retry card and notice without sending again',async()=>{
 const r=await finish({kind:'no_provider',resident:true,account:true});noEffects(r);const view=visibleFailureAndNotice(r);
 assert.equal(r.error.planAction,'retry');assert.equal(view.failures()[0].card.planAction,'retry');
 assert.equal(r.error.failureKind,'no_provider');assert.equal(r.events.posts,1);
});
for(const kind of ['handler_error','provider_issue','insufficient_credits'])test(`${kind}: applied-effect failure and notice never claim nothing happened`,async()=>{
 const r=await finish({kind,effectApplied:true,account:true,limit:kind==='insufficient_credits'?{kind:'billing-refused'}:null});noEffects(r);
 const view=visibleFailureAndNotice(r);assert.match(view.failures()[0].text,/requested action went through/);
 assert.doesNotMatch(JSON.stringify(view.state),/Nothing has been approved or performed automatically/);
 if(kind==='insufficient_credits'){assert.equal(r.error.planAction,'funding');assert.equal(r.state.fundingRefused,true);}
});
test('bounded notice contract rejects malformed or oversized values and limits output',async()=>{
 const r=await finish();r.error.notices=[null,'',42,'x'.repeat(501),...Array.from({length:7},(_,i)=>`Safe notice ${i}`)];
 const view=present(r.error);assert.equal(view.notices().length,5);assert(view.notices().every(m=>m.text.startsWith('Safe notice ')));
});
test('a changed chat and a stopped reconciliation do not reveal the old action notice',async()=>{
 const r=await finish();assert.equal(present(r.error,{current:false}).notices().length,0);
 r.error.code='cancelled';assert.equal(present(r.error,{reconciling:true}).notices().length,0);
});


test('same session with another selected conversation never displays the old notice',async()=>{
 const r=await finish();noEffects(r);visibleFailureAndNotice(r);
 assert.equal(present(r.error,{conversationId:'other-conversation'}).notices().length,0);
});
for(const [field,value] of [['ownerId','other-owner'],['agentId','other-agent'],['origin','https://other.invalid']]){
 test(`same session ID with changed ${field} never displays the old notice`,async()=>{
  const r=await finish();noEffects(r);visibleFailureAndNotice(r);
  assert.equal(present(r.error,{session:{...verifiedSession,[field]:value}}).notices().length,0);
 });
}
for(const binding of [undefined,{conversationId:'conversation'},{conversationId:'',session:verifiedSession}]){
 test(`missing or ambiguous failure binding suppresses notice: ${JSON.stringify(binding)}`,async()=>{
  const r=await finish();noEffects(r);visibleFailureAndNotice(r);r.error.messageBinding=binding;
  assert.equal(present(r.error).notices().length,0);
 });
}
test('local failure binding survives without inventing a missing server message identity',async()=>{
 const r=await finish({hasServerId:false});noEffects(r);
 assert.equal(r.error.userMessageId,undefined);
 assert.deepEqual(r.error.messageBinding,{conversationId:'conversation',session:verifiedSession});
 visibleFailureAndNotice(r);
});
for(const change of ['conversation','full-session'])test(`deferred state settlement rechecks ${change} before publishing a notice`,async()=>{
 const r=await finish();noEffects(r);visibleFailureAndNotice(r);
 const view=present(r.error,{deferUpdates:true});assert(view.pending()>0,'the caller scheduled real state updaters');
 assert.equal(view.notices().length,0);
 if(change==='conversation')view.switchConversation('other-conversation');
 else view.switchSession({...verifiedSession,ownerId:'other-owner'});
 view.flush();assert.equal(view.notices().length,0);
});
