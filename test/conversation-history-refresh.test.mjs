import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync('apps/app/src/runtime/connection-ui.tsx','utf8');
const part=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);};

// Source shape only: the send marks the conversation for the existing resync flush.
test('a reply flagged historyRefreshRequired marks the conversation for resync after the send',()=>{
 assert.match(part('  async send(text: string','    } catch (error) {'),/if\s*\(\s*'historyRefreshRequired' in reply\s*&&\s*reply\.historyRefreshRequired\s*===\s*true\s*\)\s*conversationResync\s*=\s*true;/);
});

import {stripTypeScriptTypes} from './support/strip-types.mjs';
const voiceMethod=stripTypeScriptTypes('function createController(){return {'+part('  async refreshDeveloperVoiceHistory(', '  getPairedVoiceBinding(')+'voiceConversationCurrent(){return scope.current!==false}}}',{mode:'strip'});
function voiceFixture(history=true){
 const saved=[{id:'old',text:'Keep this earlier message'}],session={sessionId:'s'},binding={conversationId:'c'};
 let resolve;const request=new Promise(r=>resolve=r),calls=[],state={session,history:history?{conversationId:'c',sessionId:'s'}:null},selected={kind:'resident',remote:{messages:async(id,signal)=>{calls.push(['read',id,signal]);return request;}}};
 const scope={browserLocalAgentEnabled:true,active:selected,state,epoch:1,restoreConversationHistory:async id=>calls.push(['restore',id]),deliverConversationMessages:(_selected,_session,id,rows)=>{calls.push(['merge',id]);for(const row of rows)if(!saved.some(x=>x.id===row.id))saved.push(row);}};
 const factory=new Function('scope',`with(scope){${voiceMethod};return createController();}`);
 scope.current=true;return {client:factory(scope),scope,saved,calls,binding,resolve,signal:new AbortController().signal};
}
test('voice refresh merges new messages without reloading or dropping the open history',async()=>{
 const f=voiceFixture();const pending=f.client.refreshDeveloperVoiceHistory(f.binding,f.signal);f.resolve({messages:[{id:'new',text:'New reply'}]});await pending;
 assert.deepEqual(f.saved.map(x=>x.id),['old','new']);assert.deepEqual(f.calls.map(x=>x[0]),['read','merge']);
});
test('voice refresh rejects an account replacement before publishing returned messages',async()=>{
 const f=voiceFixture();const pending=f.client.refreshDeveloperVoiceHistory(f.binding,f.signal);f.scope.active={...f.scope.active};f.resolve({messages:[{id:'new',text:'Wrong session'}]});await assert.rejects(pending,/conversation changed/);assert.deepEqual(f.saved.map(x=>x.id),['old']);
});
test('voice refresh restores history once when the conversation has not loaded',async()=>{
 const f=voiceFixture(false);await f.client.refreshDeveloperVoiceHistory(f.binding,f.signal);assert.deepEqual(f.calls,[['restore','c']]);
});
