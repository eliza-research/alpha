import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

// lens-storage-limits-F04: 200000 characters is a display bound, not invalid history. One long row
// (a pasted document) used to fail the whole restore on every start, and a long proactive message
// was dropped. Canonical text stays complete while rendering clips it with a visible marker.
const ui=readFileSync(new URL('../apps/app/src/runtime/connection-ui.tsx',import.meta.url),'utf8');
const between=(start,end)=>{const from=ui.indexOf(start),to=ui.indexOf(end,from);assert.ok(from>=0&&to>from,start);return ui.slice(from,to).replace(/^export /gm,'');};
const presentation=await import('../apps/app/src/runtime/action-message-presentation.ts');
const code=stripTypeScriptTypes([
  between('function restoredText(','/** Eliza Cloud\'s API answers'),
  between('export const RESTORED_FAILURES','/** The error a failed reply'),
  between('function deliverConversationMessages(','/** A journaled effect belongs'),
  between('function startConversationEvents(','/** Insert canonical delivery IDs'),
].join('\n'),{mode:'strip'});
const MARKER=' [Message shortened for display]';
const model=readFileSync(new URL('../apps/app/src/prototype/model.js',import.meta.url),'utf8');
const renderStart=model.indexOf('    var msgs = this.transcriptWindow(');
const renderEnd=model.indexOf('    var baseSug =',renderStart);
assert.ok(renderStart>=0&&renderEnd>renderStart);
const renderRows=new Function('S','IC','self','panelOpen','isOn',model.slice(renderStart,renderEnd)+';return msgs;');
const displayed=message=>renderRows.call({transcriptWindow:rows=>rows},{msgs:[message]}, {}, {}, true, true)[0].displayText;


function harness(){
  const session={sessionId:'session',agentId:'agent'};let listener;
  const selected={kind:'resident',remote:{subscribeConversationEvents:(onEvent)=>{listener=onEvent;return()=>{};}}};
  const box={epoch:1,active:selected,state:{session},conversationMemory:new Map([['key','chat']]),conversationKey:()=>'key',
    update:patch=>Object.assign(box.state,patch),systemNoticeKind:presentation.systemNoticeKind,systemNoticeDisplayText:presentation.systemNoticeDisplayText,
    phoneContextMessage:()=>({text:''})};
  vm.createContext(box);vm.runInContext(code,box);
  box.startConversationEvents(selected,session);
  return {box,proactive:message=>listener({type:'proactive-message',agentId:'agent',conversationId:'chat',message})};
}

test('a long row retains its full text and renders within the display bound',()=>{
  const {box}=harness();
  const long='a'.repeat(200001);
  const messages=box.restoredMessages([{id:'u1',role:'user',text:long},{id:'a1',role:'assistant',text:long},{id:'a2',role:'assistant',text:'Short reply'}]);
  assert.equal(messages.length,3);
  for(const message of messages.slice(0,2)){assert.equal(message.text,long);assert.equal(displayed(message),'a'.repeat(200000)+MARKER,`${message.id} clipped with the marker`);}
  assert.equal(messages[2].text,'Short reply');
  // Exactly at the bound nothing is added.
  assert.ok(box.restoredMessages([{id:'u2',role:'user',text:'b'.repeat(200000)}])[0].text==='b'.repeat(200000));
});

test('clipping never splits a surrogate pair',()=>{
  const {box}=harness();
  const text='a'.repeat(199999)+'😀'+'tail';
  const message=box.restoredMessages([{id:'u1',role:'user',text}])[0];assert.equal(message.text,text);assert.equal(displayed(message),'a'.repeat(199999)+MARKER);
});

test('a row without a valid id or text is still invalid history',()=>{
  const {box}=harness();
  for(const row of [{id:'',role:'user',text:'x'},{role:'assistant',text:'x'},{id:'a1',role:'assistant',text:42}])
    assert.throws(()=>box.restoredMessages([row]),/invalid history/);
});

test('a proactive 200001-character message is shown clipped, not dropped',()=>{
  const {box,proactive}=harness();
  proactive({id:'p1',role:'assistant',text:'c'.repeat(200001)});
  const delivered=box.state.conversationDelivery.messages;
  assert.equal(delivered.length,1);assert.equal(delivered[0].text,'c'.repeat(200001));assert.equal(displayed(delivered[0]),'c'.repeat(200000)+MARKER,'clipped with the marker');
});
