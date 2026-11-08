// The production send method and ViewNavigationClient run unchanged; only connection,
// storage and remote service ports are finite fixtures. No model or live provider calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {transformSync} from 'esbuild';
import {loadBrowserModule} from './fixtures/browser-source.mjs';
const {ViewNavigationClient}=await loadBrowserModule('apps/app/src/runtime/view-navigation.ts');
const originalDocument=globalThis.document;
globalThis.document=Object.assign(new EventTarget(),{hidden:false});
test.after(()=>{globalThis.document=originalDocument;});
const source=fs.readFileSync('apps/app/src/runtime/connection-ui.tsx','utf8');
const start=source.indexOf('  async send(text:');
const end=source.indexOf('\n  },\n};',start);
assert.ok(start>=0&&end>start,'Actual connectionController.send method exists');
const compiled=transformSync('const controller={'+source.slice(start,end+5)+'};',{loader:'ts'}).code;
for(const availability of ['rejected','pending'])test(`ordinary Notes/Calendar/text sends proceed when optional command feed is ${availability}`,async()=>{
 const calls=[];
 const context={view:'notes',revision:1,sensitive:false};
 const client=new ViewNavigationClient(async()=>({}),()=>true,()=>context,()=>({ready:availability==='rejected'?Promise.reject(Error('Renderer feed unavailable')):new Promise(()=>{}),close(){}}));
 const session={sessionId:'owner-session',ownerId:'owner',agentId:'agent',origin:'resident'};
 const active={kind:'resident',userTextFormatVersion:1,remote:{async send(id,text,options){calls.push({id,text,options});return {text:'Current records read successfully.',actionResults:[]};}}};
 const state={session,open:false,busy:false};
 const sandbox={ownProviderSelected:()=>false,AbortController,AbortSignal,DOMException,CustomEvent,Date,console,navigator:{onLine:true},state,active,epoch:1,clientObservationSession:undefined,operation:null,sending:null,requestedCameraContinuation:undefined,residentAlwaysPresent:true,isAndroid:true,testMocksEnabled:false,NO_AGENT_SEND:'not connected',phoneContextMessage:(text,context)=>({text,context}),boundNavigation:()=>client,noSessionError:message=>Error(message),cancelStoppedReply(){},ensureSelectedConversation:async()=> 'owned-room',readDevicePreferences:async()=>({askBeforeAgentActions:true}),calendarAgendaObservation:async()=>undefined,withResidentMapsNavigation:async(request,id,signal,send)=>send(),appRecordInvalidations:()=>[],automationsCommitted:()=>false,update:patch=>Object.assign(state,patch),runQueuedResidentRebind(){},refusalRecheckPending:false,setTimeout,window:new EventTarget(),validateUuid:()=>true,expired:()=>false,failureKindOf:()=>undefined,calendarRefusalKept:()=>false,AlphaClientError:class extends Error{}};
 vm.createContext(sandbox);vm.runInContext(compiled+';globalThis.controller=controller;',sandbox);
 try {
  for(const prompt of ['Refresh my notes list.','What is on my calendar?','Hello.']){
   const reply=await Promise.race([sandbox.controller.send(prompt,context,crypto.randomUUID(),new AbortController().signal),new Promise((resolve,reject)=>setTimeout(()=>reject(Error('Optional renderer blocked ordinary send')),100))]);
   assert.equal(reply.text,'Current records read successfully.');
  }
  assert.equal(calls.length,3);assert.deepEqual(calls.map(call=>call.text),['Refresh my notes list.','What is on my calendar?','Hello.']);
  assert.ok(calls.every(call=>call.options.metadata.viewDelivery==='completed-action'));
  assert.equal(client.interactionAvailable(),false);
 } finally {client.dispose();}
});
// A VIEWS handoff naming a view this phone does not map leaves the agent's reply standing:
// the real client returns unavailable before any claim, and the chat shows a short note.
test('an unmapped VIEWS handoff is reported in chat without a claim or a throw',async()=>{
 const {stripTypeScriptTypes}=await import('node:module');
 const adapter=fs.readFileSync('apps/app/src/prototype/agent-adapter.ts','utf8');
 const start=adapter.indexOf('  function openInternalView('),helper=adapter.slice(start,adapter.indexOf('  function canonicalNotesKey(',start));
 const requests=[],context={view:'home',revision:1,sensitive:false};
 const client=new ViewNavigationClient(async(path,body)=>{requests.push({path,body});return {};},()=>true,()=>context);
 const sandbox={views:{},alphaClient:{getState:()=>({context})},context(){}};
 vm.createContext(sandbox);
 vm.runInContext(`${stripTypeScriptTypes(helper,{mode:'strip'})};globalThis.deliver=deliverChatNavigation;`,sandbox);
 const said=[],toasts=[],shell={live:true,S:()=>({view:'home'}),agentSay(text,card){said.push({text,card});},toast(message){toasts.push(message);},openView(){throw Error('No screen may open');},goHome(){throw Error('No screen may open');}};
 const binding={requestId:'owned-handoff',clientId:client.clientId,viewId:'wallet',viewType:'gui',installationId:'owned-installation'};
 const result={actionName:'VIEWS',success:true,values:{mode:'show',viewId:'wallet',viewPath:'/wallet',viewType:'gui',navigationPrepared:true,completedActionHandoffId:'owned-handoff',navigationBinding:binding}};
 try {
  assert.equal((await client.deliver([result],client.capture(context),async()=>true)).status,'unavailable');
  assert.equal(await sandbox.deliver(shell,{client,attempt:client.capture(context)},[result]),false);
  assert.deepEqual(requests,[]);assert.deepEqual(toasts,[]);
  assert.equal(said.length,1);assert.equal(said[0].text,'That screen is not on this phone.');
 } finally {client.dispose();}
});
