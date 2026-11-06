import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

const source=readFileSync('apps/app/src/runtime/connection-ui.tsx','utf8');
const start=source.indexOf('  async performVoiceRequestedActions('),end=source.indexOf('  voiceRendererClientId()',start);
assert(start>0&&end>start);
const method=stripTypeScriptTypes('const controller={'+source.slice(start,end)+'};globalThis.controller=controller;',{mode:'strip'});
const messageId='11111111-2222-4333-8444-555555555555';
function fixture(){
 const state={context:{view:'home',revision:1,sensitive:false},ask:false,owned:true,calls:[]};
 const actions={async pendingReview(){state.calls.push('review')},async performRequested(id,_context,_signal,allowed){state.calls.push(id);return await allowed()?[{status:'succeeded',summary:'Saved'}]:[]}};
 const context=vm.createContext({active:{actions},navigationContext:()=>state.context,structuredClone,validateUuid:value=>value===messageId,readDevicePreferences:async()=>({askBeforeAgentActions:state.ask})});
 vm.runInContext(method,context);context.controller.voiceConversationCurrent=()=>state.owned;
 return {state,context,actions,run:()=>context.controller.performVoiceRequestedActions({},messageId,new AbortController().signal)};
}
test('voice completion executes only the exact message after loading current proposals',async()=>{const h=fixture();const result=await h.run();assert.deepEqual(h.state.calls,['review',messageId]);assert.equal(result[0].status,'succeeded');});
test('ask-first mode leaves voice proposals for review',async()=>{const h=fixture();h.state.ask=true;assert.equal((await h.run()).length,0);assert.deepEqual(h.state.calls,[]);});
test('a context change during preference read prevents voice execution',async()=>{const h=fixture();h.context.readDevicePreferences=async()=>{h.state.context={...h.state.context,revision:2};return {askBeforeAgentActions:false}};await assert.rejects(h.run(),/context changed/);assert.deepEqual(h.state.calls,[]);});
test('an owner change while listing proposals prevents voice execution',async()=>{const h=fixture();h.actions.pendingReview=async()=>{h.state.owned=false};await assert.rejects(h.run(),/context changed/);});
test('the current preference is checked again by the action executor',async()=>{const h=fixture();h.actions.pendingReview=async()=>{h.state.ask=true};assert.equal((await h.run()).length,0);});
