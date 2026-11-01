import {authoredBrowserDestination,browserDestinationMatches} from '../.eliza/client-features/packages/contracts/src/browser-request-grounding.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {randomUUID} from 'node:crypto';
import {createDeviceActionExecution} from '../vendor/eliza/packages/contracts/src/device-action-execution.ts';
import {parseBrowserAddressInput} from '../.eliza/client-features/plugins/plugin-native-browser-surface/src/address-input.ts';
import {BrowserTabSession} from '../.eliza/client-features/plugins/plugin-native-browser-surface/src/tab-host.ts';
const root=process.env.ALPHA_RECEIPT_SOURCE_ROOT||'.';
const read=p=>fs.readFileSync(root+'/'+p,'utf8');
const agent=read('apps/app/src/prototype/agent-adapter.ts'),browser=read('apps/app/src/prototype/browser-adapter.ts'),device=read('apps/app/src/runtime/device-actions.ts');
const ts=s=>stripTypeScriptTypes(s,{mode:'transform'});
const {browserNavigationSummary,projectActionMessages,succeededBrowserDestination}=await import('data:text/javascript;base64,'+Buffer.from(ts(read('apps/app/src/runtime/action-message-presentation.ts'))).toString('base64'));
const navigateCode=ts(browser.slice(browser.indexOf('  async function navigate('),browser.indexOf('  async function command(')));
const browserCode=ts(browser.slice(browser.indexOf('    this.browserNavigateApproved ='),browser.indexOf('    // Identity only:')));
const executorCode=agent.slice(agent.indexOf("      if (!this.browserNavigateApproved) return"),agent.indexOf('\n    });\n    context(this);',agent.indexOf("      if (!this.browserNavigateApproved) return")));
import {DeviceActions,deviceJournalContext} from './fixtures/device-action-policy.mjs';
const cancelCode=ts(agent.slice(agent.indexOf('    if(shell.pendingActionApproval&&'),agent.indexOf('\n    const blocked=',agent.indexOf('    if(shell.pendingActionApproval&&'))));
function harness({native=false,origin='notes',receiptFailure=false,dispatchFailure=false,finishFailure=false,beforeReceipt,afterDispatch,pending=false}={}){
 const journalResults=[],receiptBodies=[],events=[],controller=new AbortController(),session={sessionId:'s',ownerId:'o',agentId:'a'},initial={view:origin,sensitive:false,revision:1,...(origin==='browser'?{selectedObject:{kind:'browser-tab',id:'existing',revision:'0'}}:{})};
 let currentContext=initial,live=true,disposed=false,selected='existing';
 const state={cur:selected,tabs:[{id:selected,hist:['newtab'],pos:0}]},tabs=new BrowserTabSession({session:'native-session'}),document={hidden:false};void tabs.ensure(selected,false,()=>Promise.resolve());
 const shell={pendingActionApproval:controller,pendingActionApprovalContext:initial,pendingActionApprovalSession:session,
  vset(_key,patch){Object.assign(state,patch);if(origin==='browser'&&state.cur!==initial.selectedObject.id){currentContext={...initial,revision:2,selectedObject:{kind:'browser-tab',id:state.cur,revision:String(tabs.revision(state.cur))}};cancel();}},
  openView(){events.push('present');currentContext={view:'browser',sensitive:false,revision:2};cancel();}};
 const listeners=new Set(),connection={session,open:false},connectionController={getSnapshot:()=>connection},alphaClient={getState:()=>({context:currentContext,pending}),subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);}};
 // The chat request that carried a direct-request action settles: alphaClient clears pending and emits.
 const settle=()=>{pending=false;for(const listener of [...listeners])listener();};
 const cancel=()=>vm.runInNewContext(cancelCode,{shell,document,connection,currentContext});
 const browserContext={URL,Error,parseBrowserAddressInput,document,Capacitor:{isNativePlatform:()=>native},session:'native-session',state:()=>state,tabs,shell,get disposed(){return disposed;},profileUnsupportedTab:undefined,newTabId:()=> 'new-tab',isPrivate:()=>false,restored:new Map(),restoreAttempts:new Map(),
 ensure(id){return tabs.creation(id)??tabs.ensure(id,false,()=>Promise.resolve());},
 Browser:{async navigate(){controller.signal.throwIfAborted();events.push('dispatch');if(dispatchFailure)throw Error('dispatch failed');afterDispatch?.({controller,changeTab:()=>{void tabs.ensure('foreign',false,()=>Promise.resolve());state.cur='foreign';},dispose:()=>disposed=true});},async close(){}},refresh(){},report(){}};
 const browserNavigateApproved=vm.runInNewContext('(function(){'+navigateCode+'\n'+browserCode+';return this.browserNavigateApproved;}).call({})',browserContext);
 const executor=vm.runInNewContext(ts('(async function(operation,signal,expectedContext){'+executorCode+'})'),{connectionController,alphaClient,document,browserNavigationSummary,setTimeout}).bind({browserNavigateApproved,get live(){return live;}});
 const p={id:'proposal',digest:'digest',operation:{type:'browser_navigate',url:'https://example.com'},expiresAt:Date.now()+60000};
 const globals={Error,Date,JSON,deviceJournalContext,createDeviceActionExecution,crypto:{randomUUID},contextKey:JSON.stringify,actionScope:async()=> 'hash',assertProposalContext(){}};
 for(const name of ['isClockOperation','isNativeNotesQuery','isSmsSend','isPhoneDial','isMapsOperation','isCameraCapture','isLibraryOperation','isReminderCreate','isReminderOperation','isNotesOperation','isCalendarOperation','isForegroundReview','isOriginalDeviceReadOperationType'])globals[name]=()=>false;

 const journal={async reserve(input){events.push('reserve');return {created:true,entry:{...input,phase:'reserved'}};},async markApplying(){events.push('applying');},async finish(record){journalResults.push(record);events.push('finish');if(finishFailure)throw Error('journal failed');}};
 const owner=new DeviceActions(session,{installationId:'i',enrollmentId:'e'},'c'.repeat(64),async()=>{},journal,async(op,_id,context,signal)=>executor(op,signal,context));
 owner.proposals.set(p.id,{proposal:p,context:initial});
 owner.mutation=async(proposal,suffix,body)=>{if(suffix==='receipt')receiptBodies.push(body);events.push(suffix);if(suffix==='receipt')await beforeReceipt?.({controller,document,session:connection,externalView(){currentContext={view:'calendar',sensitive:false,revision:3};cancel();}});controller.signal.throwIfAborted();if(suffix==='receipt'&&receiptFailure)throw Error('network unavailable');return {...proposal,state:suffix==='claim'?'executing':'done',attemptId:'attempt'};};
 return {journalResults,receiptBodies,events,controller,document,owner,settle,changeView(){currentContext={view:'calendar',sensitive:false,revision:3};},async run(){return DeviceActions.prototype.approve.call(owner,p.id,initial,controller.signal);},setLive:v=>live=v};
}
for(const native of [false,true])for(const origin of ['notes','browser']){
 const label=(native?'native':'web')+' from '+origin;
 test(`${label}: exact action journals and uploads its receipt before Browser presentation`,async()=>{
  const h=harness({native,origin}),r=await h.run();
  assert.equal(r.status,'succeeded');assert.equal(r.summary,'Opened example.com.');
  assert.deepEqual(h.events,['reserve','decision','claim','applying','dispatch','finish','receipt','present']);
  assert.equal(h.controller.signal.aborted,true,'self-presentation may retire context only after receipt');
  assert.equal(h.events.filter(e=>e==='dispatch').length,1);
  assert.equal(h.journalResults.length,1);assert.equal(h.receiptBodies.length,1);
  assert.deepEqual(Object.keys(h.journalResults[0].result),['operationId']);
  assert.deepEqual(Object.keys(h.receiptBodies[0].receipt),['outcome','operationId']);
  assert.equal(h.receiptBodies[0].attemptId,'attempt');assert.equal(h.receiptBodies[0].receipt.outcome,'applied');
 });
 test(`${label}: genuine receipt failure remains pending with one dispatch and no automatic retry`,async()=>{
  const h=harness({native,origin,receiptFailure:true}),r=await h.run();assert.match(r.summary,/Server receipt is pending/);assert.equal(h.events.filter(e=>e==='receipt').length,1);assert.equal(h.events.filter(e=>e==='dispatch').length,1);assert.equal(h.events.at(-1),'present');
 });
 test(`${label}: pre-effect cancellation never dispatches or presents`,async()=>{const h=harness({native,origin});h.controller.abort();const r=await h.run();assert.equal(r.status,'unknown');assert.deepEqual(h.events,[]);});
 test(`${label}: cancelled external view change during receipt never forces Browser foreground`,async()=>{const h=harness({native,origin,beforeReceipt:({externalView})=>externalView()}),r=await h.run();assert.match(r.summary,/pending/);assert.equal(h.events.filter(e=>e==='dispatch').length,1);assert.ok(!h.events.includes('present'));});
 test(`${label}: durable journal failure never presents or uploads`,async()=>{const h=harness({native,origin,finishFailure:true}),r=await h.run();assert.equal(r.status,'unknown');assert.ok(!h.events.includes('present'));assert.ok(!h.events.includes('receipt'));});
 test(`${label}: failed dispatch never presents and is not repeated`,async()=>{const h=harness({native,origin,dispatchFailure:true}),r=await h.run();assert.equal(r.status,'unknown');assert.equal(h.events.filter(e=>e==='dispatch').length,1);assert.ok(!h.events.includes('present'));});
 for(const change of ['changeTab','dispose'])test(`${label}: ${change} after dispatch cannot redirect presentation`,async()=>{const h=harness({native,origin,afterDispatch:args=>args[change]()}),r=await h.run();assert.equal(r.status,'succeeded');assert.ok(!h.events.includes('present'));});
 test(`${label}: changed owner session before receipt completion cannot present`,async()=>{const h=harness({native,origin,beforeReceipt:({session})=>session.session={sessionId:'different'}}),r=await h.run();assert.equal(r.status,'succeeded');assert.ok(!h.events.includes('present'));});
 test(`${label}: hidden foreground cannot present after receipt`,async()=>{const h=harness({native,origin,beforeReceipt:({document})=>document.hidden=true}),r=await h.run();assert.equal(r.status,'succeeded');assert.ok(!h.events.includes('present'));});
 // Live 2026-10-30 "open example.com": Browser opened inside the chat request that carried the reply, cancelled it,
 // and the chat showed "Stopped." plus a stop notice. Presentation now waits for that request to settle.
 test(`${label}: direct-request presentation waits for the carrying request to settle`,async()=>{
  const h=harness({native,origin,pending:true}),r=await h.run();
  assert.equal(r.status,'succeeded');assert.equal(r.summary,'Opened example.com.');
  assert.ok(!h.events.includes('present'));assert.equal(h.controller.signal.aborted,false,'the carrying request is not cancelled');
  h.settle();await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(h.events.at(-1),'present');assert.equal(h.events.filter(e=>e==='dispatch').length,1);
 });
 test(`${label}: a screen change before the request settles drops deferred presentation`,async()=>{
  const h=harness({native,origin,pending:true}),r=await h.run();assert.equal(r.status,'succeeded');
  h.changeView();h.settle();await new Promise(resolve=>setTimeout(resolve,0));
  assert.ok(!h.events.includes('present'));
 });
}

const connectionSource=read('apps/app/src/runtime/connection-ui.tsx');
const deliverySource=ts(connectionSource.slice(connectionSource.indexOf('function deliverRequestedActionReceipts('),connectionSource.indexOf('/** Coalesced reconnect/foreground-settlement')));
const mergeSource=ts(connectionSource.slice(connectionSource.indexOf('export function mergeConversationDelivery'),connectionSource.indexOf('const actionReceipts =')).replace('export ',''));

const deliveryStart=connectionSource.indexOf('            const performed=await selected.actions.performRequested(reply.userMessageId,context,requestSignal');
const deliveryEnd=connectionSource.indexOf('            assertCurrent();',deliveryStart)+'            assertCurrent();'.length;
const directDelivery=ts('(async function(){'+connectionSource.slice(deliveryStart,deliveryEnd)+'})');
function deliveryHarness(selected,session,receipts,controller){
 const state={session,conversationDelivery:undefined};const updates=[];const globals={succeededBrowserDestination,items:[],active:selected,epoch:1,state,conversationMemory:new Map([['key','conversation']]),conversationKey:()=> 'key',update:patch=>{updates.push(patch);Object.assign(state,patch);},selected,session,generation:1,id:'conversation',reply:{userMessageId:'canonical-user'},authoredRequest:{messageId:'canonical-user',text:'Open https://example.com/',current:()=>controller.signal.throwIfAborted()},context:{view:'notes',revision:1},requestSignal:controller.signal,readDevicePreferences:async()=>({askBeforeAgentActions:false}),assertCurrent:()=>controller.signal.throwIfAborted()};
 vm.runInNewContext(deliverySource+';globalThis.deliver=deliverRequestedActionReceipts;',globals);return {globals,state,updates,run:()=>vm.runInNewContext(directDelivery,globals)(),deliver:()=>globals.deliver(selected,session,1,'conversation','canonical-user',receipts,globals.items)};
}
test('direct navigation journals once and shows Browser after the chat request settles; its exact receipt survives reopening',async()=>{
 const h=harness({native:true,pending:true}),p=[...h.owner.proposals.values()][0].proposal;p.requestMessageId='canonical-user';const card=h.owner.card(p,{view:'notes',sensitive:false,revision:1});h.owner.card=()=>({});h.owner.approve=()=>h.run();
 h.owner.proposals.get(p.id).requestKey=h.owner.requestKey('canonical-user');
 const selected={actions:h.owner},d=deliveryHarness(selected,h.owner.session,[],h.controller);d.globals.items=[{proposal:card}];
 await d.run();assert.equal(h.controller.signal.aborted,false,'the reply request is not cancelled');assert.equal(h.events.filter(e=>e==='dispatch').length,1);assert.ok(!h.events.includes('present'));
 h.settle();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(h.events.at(-1),'present');
 const delivery=d.state.conversationDelivery;assert.equal(delivery.messages.length,1);assert.equal(delivery.messages[0].inReplyTo,'canonical-user');assert.equal(delivery.messages[0].text,'Opened example.com.');assert.equal(delivery.messages[0].browserDestination,'https://example.com');
 const user={id:'optimistic-user',from:'user',text:'Open example.com.'},pause={id:'streamed-pause',from:'agent',text:'Review this request on your phone before it can run.'};const original=[user,pause];
 const merge=vm.runInNewContext(mergeSource+';mergeConversationDelivery',{});const reopened=merge(original,delivery.messages);const shown=projectActionMessages(reopened.map(m=>({...m,displayText:m.text,hasCalendarText:true})),reopened);
 assert.deepEqual(Array.from(shown,m=>m.id),['optimistic-user','device-receipt:proposal']);assert.equal(shown[1].displayText,'Opened example.com.');assert.equal(original[1].text,pause.text,'raw stored protocol remains intact');assert.equal(merge(reopened,delivery.messages).length,3,'redelivery is idempotent');
 // Live tj-79465dcbc873b2: with the agent reply "Opening example.com." in the turn, that reply is the one line shown.
 const answered=merge([user,{id:'reply',from:'agent',text:'Opening example.com.'}],delivery.messages);
 assert.deepEqual(Array.from(projectActionMessages(answered.map(m=>({...m,displayText:m.text,hasCalendarText:true})),answered),m=>m.id),['optimistic-user','reply']);
});
test('completed receipt delivery cannot cross owner, conversation or generation changes',()=>{
 for(const retire of [d=>d.globals.active={},d=>d.state.session={sessionId:'foreign'},d=>d.globals.epoch=2,d=>d.globals.conversationMemory.set('key','different')]){
  const selected={},session={sessionId:'owner'},d=deliveryHarness(selected,session,[{proposalId:'p',status:'succeeded',summary:'Opened example.com.'}],new AbortController());retire(d);d.deliver();assert.equal(d.updates.length,0);
 }
});

for(const authored of ['Move it to 4 pm','Open https://example.com/other',undefined])test(`ordinary caller leaves ungrounded browser proposal pending: ${authored}`,async()=>{
 const h=harness({native:true}),p=[...h.owner.proposals.values()][0].proposal;p.requestMessageId='canonical-user';h.owner.card=()=>({});h.owner.approve=()=>h.run();
 h.owner.proposals.get(p.id).requestKey=h.owner.requestKey('canonical-user');
 const selected={actions:h.owner},d=deliveryHarness(selected,h.owner.session,[],h.controller);d.globals.authoredRequest=authored===undefined?undefined:{messageId:'canonical-user',text:authored,current:()=>h.controller.signal.throwIfAborted()};
 // A model reply repeating a URL never supplies the authored permission.
 d.globals.reply.text='Opening https://example.com/ now.';
 await d.run();assert.equal(h.controller.signal.aborted,false);assert.ok(!h.events.includes('dispatch'));assert.ok(!h.events.includes('present'));assert.equal(h.owner.proposals.size,1);assert.equal(d.state.conversationDelivery,undefined);
});
