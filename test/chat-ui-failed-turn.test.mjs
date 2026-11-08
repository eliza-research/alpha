import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
// A turn the agent recorded but could not finish: the sent bubble keeps the agent's user row
// identity (one bubble after the conversation re-read), and a turn that failed after its action
// committed says the action went through instead of the generic failure.
const ui=fs.readFileSync('apps/app/src/runtime/connection-ui.tsx','utf8'),adapter=fs.readFileSync('apps/app/src/prototype/agent-adapter.ts','utf8');
const between=(source,start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a,start);return source.slice(a,b);};
const ts=source=>stripTypeScriptTypes(source,{mode:'transform'});
// The pinned receipt normalizer itself (its error class stubbed; the module resolves `.js` specifiers only under a bundler).
const {normalizeEffectReceipts}=await import('data:text/javascript;base64,'+Buffer.from(ts(fs.readFileSync('.eliza/client-features/packages/core/src/types/effects.ts','utf8')).replace('import { ElizaError } from "../errors.js";','class ElizaError extends Error{}')).toString('base64'));
const effectApplied=new Function('normalizeEffectReceipts',ts(between(ui,'function effectAppliedBeforeFailure(','\n}\n')+'\n}')+';return effectAppliedBeforeFailure;')(normalizeEffectReceipts);
const merge=new Function(ts(between(ui,'export function mergeConversationDelivery','\n}\n').replace('export ','')+'\n}')+';return mergeConversationDelivery;')();
const EFFECT_COPY=ui.match(/export const EFFECT_APPLIED_INTERRUPTED = '([^']+)';/)[1];
const at='2026-10-29T19:00:00.000Z';
const receipt=(overrides={})=>({receiptId:'r1',operation:'calendar.event.create',resource:{kind:'calendar.event',id:'e1'},artifacts:[],idempotency:{key:null,replayed:false},observedAt:at,outcome:'applied',commit:{kind:'durable',id:'c1',committedAt:at},...overrides});
const send=between(ui,'  async send(text: string','    } catch (error) {');

test('a failed turn counts as effect-applied on TURN_INTERRUPTED_AFTER_EFFECT or an applied receipt that was not rolled back',()=>{
 assert.equal(effectApplied({terminalFailure:{kind:'handler_error',code:'TURN_INTERRUPTED_AFTER_EFFECT',transient:false,message:'x'}}),true);
 assert.equal(effectApplied({failureKind:'rate_limited',actionResults:[{actionName:'CALENDAR_CREATE_EVENT',success:true,effectReceipts:[receipt()]}]}),true);
 assert.equal(effectApplied({failureKind:'handler_error',actionResults:[{effectReceipts:[receipt(),receipt({receiptId:'r2',outcome:'rolled_back',commit:undefined,rollback:{receiptId:'rb',revertedReceiptIds:['r1'],rolledBackAt:at}})]}]}),false,'a rolled-back effect is not an applied one');
 assert.equal(effectApplied({failureKind:'handler_error',actionResults:[{effectReceipts:[receipt({outcome:'failed',commit:undefined,failure:{code:'X',retryable:false,acceptance:'rejected'}})]}]}),false);
 assert.equal(effectApplied({failureKind:'handler_error',actionResults:[{effectReceipts:[{receiptId:'bad'}]},{success:true}]}),false,'malformed receipts prove nothing');
 assert.equal(effectApplied({terminalFailure:{kind:'rate_limited',message:'x',transient:true}}),false);
 assert.equal(effectApplied({failureKind:'provider_issue'}),false);
});

test('the failed turn says the action went through, keeps a mapped limit, and never claims nothing happened',()=>{
 assert.doesNotMatch(EFFECT_COPY,/—/,'no em dash in shipped copy');
 assert.match(EFFECT_COPY,/action went through/);assert.match(EFFECT_COPY,/reply was cut off/);assert.match(EFFECT_COPY,/Nothing was run again\./);
 const failure=between(send,'responseFailure = replyFailure(',"if ('failureKind' in responseFailure) retractReadiness();");
 assert.match(failure,/if\(effectApplied\)\{const mapped=responseFailure instanceof AlphaClientError\?responseFailure/);
 assert.match(failure,/mapped&&mapped\.failureKind!=='interrupted'\?`\$\{EFFECT_APPLIED_INTERRUPTED\} \$\{mapped\.message\}`:EFFECT_APPLIED_INTERRUPTED/,'a mapped provider or Cloud limit keeps its retry text after the effect notice');
 assert.match(failure,/mapped\?\.serviceLimit===undefined\?\{\}:\{serviceLimit:mapped\.serviceLimit\}/,'the Cloud limit still reaches the plan or billing card');
 assert.match(send,/const effectApplied=failed&&effectAppliedBeforeFailure\(reply\);/);
 assert.match(send,/Pending phone actions are available for separate review\.\$\{effectApplied\?'':' Nothing has been approved or performed automatically\.'\}/,'a committed write is not followed by "nothing performed"');
});

test('a failed turn the agent recorded carries its user row identity, thrown or returned with proposals',()=>{
 assert.match(send,/const messageBinding=\{conversationId:id,session:\{\.\.\.session\}\},recorded=typeof reply\.userMessageId==='string'\?\{userMessageId:reply\.userMessageId,messageBinding\}:\{\};/);
 // Execute the actual throw boundary rather than fixing its statement layout.
 const failureBoundary=between(send,'      if (responseFailure && !proposals?.length) {','      if(!failed&&directRequestedActions');
 class FixtureClientError extends Error{constructor(code,message){super(message);this.code=code;}}
 const reject=new Function('responseFailure','proposals','messageBinding','recorded','notices','AlphaClientError',ts(failureBoundary));
 const binding={conversationId:'recorded-conversation',session:{sessionId:'s',ownerId:'o',agentId:'a',origin:'https://fixture.invalid'}};
 const recorded={userMessageId:'recorded-user-row',messageBinding:binding},notices=['Saved action needs attention'];
 assert.throws(()=>reject(new Error('PRIVATE_PROVIDER_CANARY'),[],binding,recorded,notices,FixtureClientError),error=>{
  assert(error instanceof FixtureClientError);assert.equal(error.code,'transport-failed');
  assert.equal(error.message,'The agent request failed. Check connection and action history before sending another request.');
  assert.equal(error.userMessageId,recorded.userMessageId);assert.equal(error.messageBinding,binding);assert.deepEqual(error.notices,notices);
  assert.doesNotMatch(error.message,/PRIVATE_PROVIDER_CANARY/);return true;
 });
 const typed=Object.assign(new FixtureClientError('transport-failed','Mapped billing refusal'),{failureKind:'insufficient_credits',serviceLimit:'billing-refused',planAction:'funding'});
 assert.throws(()=>reject(typed,[],binding,recorded,notices,FixtureClientError),error=>{
  assert.equal(error,typed);assert.equal(error.userMessageId,recorded.userMessageId);assert.equal(error.messageBinding,binding);
  assert.equal(error.failureKind,'insufficient_credits');assert.equal(error.serviceLimit,'billing-refused');assert.equal(error.planAction,'funding');return true;
 });
 assert.doesNotThrow(()=>reject(typed,[{id:'reviewable-proposal'}],binding,recorded,notices,FixtureClientError),'reviewable proposal still takes the existing return path');
 assert.match(send,/\.\.\.\(!responseFailure\?\{\.\.\.\(typeof reply\.messageId==='string'\?\{messageId:reply\.messageId\}:\{\}\),messageBinding\}:\{\}\), \.\.\.recorded,/,'the failed assistant row keeps the phone text; only the user row identity is adopted');
 // The adapter adopts it on every dispatched failure branch, before the interrupted bubble is added.
 const dispatched=between(adapter,'        if(fromComposer)await this.composerDraft?.commit();\n        // The agent recorded','        else if(this.live&&e instanceof AlphaClientError&&typeof (e as {failureKind?:unknown}).failureKind===\'string\'){');
 assert.match(dispatched,/const recorded=e&&typeof e==='object'\?e as \{userMessageId\?:unknown;messageBinding\?:unknown\}:\{\};/);
 assert.match(dispatched,/if\(this\.live&&sameChat\(\)&&typeof recorded\.userMessageId==='string'&&recorded\.messageBinding&&typeof recorded\.messageBinding==='object'\)this\.setState\(\(previous:Shell\)=>\(\{msgs:previous\.msgs\.map\(\(item:Shell\)=>item\.id===userId\?\{\.\.\.item,id:recorded\.userMessageId,messageBinding:recorded\.messageBinding\}:item\)\}\)\);/);
});

test('after the identity is adopted a conversation re-read merges onto the sent bubble instead of adding a second one',()=>{
 const userId='local-optimistic',server='0ea1c9e0-0723-098c-b53e-e7376e803dc5',assistant='b1f7c6d2-3a4e-4f58-9a1b-2c3d4e5f6a7b',text='what notes do I have?';
 const binding={conversationId:'c1',session:{sessionId:'s',ownerId:'o',agentId:'a'}};
 const sent=[{id:'earlier',from:'user',text:'hi',messageBinding:binding},{id:userId,from:'user',text}];
 const failure=Object.assign(new Error('The agent could not complete this response.'),{userMessageId:server,messageBinding:binding});
 const recorded=failure&&typeof failure==='object'?failure:{};
 const adopted=typeof recorded.userMessageId==='string'&&recorded.messageBinding&&typeof recorded.messageBinding==='object'?sent.map(item=>item.id===userId?{...item,id:recorded.userMessageId,messageBinding:recorded.messageBinding}:item):sent;
 const errored=[...adopted,{id:'error-bubble',from:'agent',text:'The agent could not complete this response.',interrupted:true}];
 const delivered=[{id:'earlier',from:'user',text:'hi',messageBinding:binding},{id:server,from:'user',text,messageBinding:binding},{id:assistant,from:'agent',text:'',interrupted:true,messageBinding:binding}];
 const merged=merge(errored,delivered);
 assert.equal(merged.filter(item=>item.from==='user'&&item.text===text).length,1,'one user bubble after the re-read');
 assert.equal(merged.find(item=>item.text===text).id,server);
 // Without the adopted identity (a stream error frame carries none) the saved row still replaces the unconfirmed bubble.
 const unadopted=merge([...sent,errored.at(-1)],delivered);
 assert.equal(unadopted.filter(item=>item.from==='user'&&item.text===text).length,1);assert.equal(unadopted.find(item=>item.text===text).id,server);
 // A confirmed bubble with the same words is a separate message and is never replaced.
 assert.equal(merge([...sent.slice(0,1),{id:'kept',from:'user',text,messageBinding:binding}],delivered).filter(item=>item.from==='user'&&item.text===text).length,2);
});
