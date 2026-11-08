import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync}from'node:fs';
import {stripTypeScriptTypes}from'node:module';
import{findViewActionHandoff}from'../.eliza/client-features/packages/core/src/views/view-action-handoff.ts';
import{createCompletedActionNavigationState}from'../.eliza/client-features/packages/core/src/views/completed-action-navigation.ts';
import{NAVIGATE_VIEW_EVENT}from'../.eliza/client-features/packages/core/src/events.ts';
import {tsImport} from 'tsx/esm/api';
const {alphaNavigation}=await tsImport('../apps/app/src/product/alpha-product.ts',import.meta.url);
// Notes, Workflows and Camera are available; the product registry resolves ids, paths and Home.
const views=alphaNavigation(view=>['notes','workflows','camera'].includes(view));
const text=readFileSync('apps/app/src/runtime/view-navigation.ts','utf8');
const ViewNavigationClient=new Function('NAVIGATE_VIEW_EVENT','createCompletedActionNavigationState','findViewActionHandoff','alphaCanonicalViewId','alphaViewKey','alphaViewPaths','AlphaClientError',stripTypeScriptTypes(text,{mode:'transform'}).replace(/^import[\s\S]*?;\n/gm,'').replace(/^export /gm,'')+';return ViewNavigationClient;')(NAVIGATE_VIEW_EVENT,createCompletedActionNavigationState,findViewActionHandoff,views.canonicalViewId,views.viewKey,views.viewPaths,class extends Error{});
const source=readFileSync('apps/app/src/prototype/agent-adapter.ts','utf8');
const helper=source.slice(source.indexOf('  function openInternalView('),source.indexOf('  function context(shell:',source.indexOf('  function openInternalView(')));
const projection=source.slice(source.indexOf('  p.applyRealtimeVoiceNavigation = async function('),source.indexOf('  p.sendVoiceTurn = async function('));
function harness({claimFailure=false,retireAfterClaim=false,viewId="notes",localView="notes"}={}){
 globalThis.window=new EventTarget();globalThis.document={hidden:false};
 let active=true,commits=0,flushCommit,context={view:'home',revision:1,sensitive:false};const requests=[],finishes=[];
 const client=new ViewNavigationClient(async(path,body)=>{
  requests.push({path,body});
  if(path.endsWith('interact-claim')){assert.equal(commits,0);if(claimFailure)throw Error('Actual claim was refused');if(retireAfterClaim)active=false;return{claimId:'fixture-owned-claim'};}
  assert.equal(path,'/api/views/interact-result');assert.equal(commits,1);assert.equal(context.view,localView);assert.equal(body.result.switched,true);return{accepted:true};
 },()=>active,()=>context);
 let capturedAttempt;
 const controller={voiceConversationCurrent:()=>active,captureViewNavigation:value=>({client,attempt:capturedAttempt=client.capture(value)})};
 const p={};const alphaClient={getState:()=>({context})};
 const sync=shell=>{context={view:shell.state.view||'home',revision:context.revision+1,sensitive:false};};
 const code=stripTypeScriptTypes(helper+projection,{mode:'transform'});
 new Function('p','connectionController','alphaClient','alphaViewKey','alphaViewPaths','views','context',code)(p,controller,alphaClient,views.viewKey,views.viewPaths,{notes:{},home:{},workflows:{},camera:{}},sync);
 const shell={live:true,state:{view:null,chat:'full'},S(){return this.state;},goHome(chat){this.state.view=null;this.state.chat=chat;},openView(view,_patch,chat){this.state.view=view;this.state.chat=chat;},setState(_patch,done){flushCommit=()=>{commits++;done?.();};},voiceConversationContext(){if(!active)throw Error('Owner changed');return context;},toast(){}};
 const id='11111111-1111-4111-8111-111111111111',binding={requestId:id,clientId:client.clientId,installationId:'33333333-3333-4333-8333-333333333333',viewId,viewType:'gui'};
 const event={viewId,viewPath:'/'+viewId,traceId:'owned-turn',navigationPrepared:true,completedActionHandoffId:id,navigationBinding:binding};
 const navigation={async apply(_view,check,commit){check();return commit('full',()=>{});},finish(delivered){finishes.push(delivered);}};
 return{event,requests,finishes,client,get capturedAttempt(){return capturedAttempt;},apply:value=>p.applyRealtimeVoiceNavigation.call(shell,{...value,binding:{},assertCurrent(){if(!active)throw Error('Owner changed');},navigation}),flush(){assert.equal(typeof flushCommit,'function');flushCommit();},retire(){active=false;},get commits(){return commits;},close(){client.dispose();},shell};
}
const settle=async()=>{for(let n=0;n<30;n++)await Promise.resolve();};
test('actual realtime projection reuses canonical claim→commit callback→accepted result before success',async()=>{
 const f=harness();try{let complete=false;const pending=f.apply(f.event).then(value=>{complete=true;return value;});await settle();assert.equal(complete,false);assert.equal(f.commits,0);assert.deepEqual(f.requests.map(r=>r.path),['/api/views/interact-claim']);f.flush();assert.equal(await pending,true);assert.deepEqual(f.requests.map(r=>r.path),['/api/views/interact-claim','/api/views/interact-result']);assert.equal(f.requests[1].body.requestId,f.event.completedActionHandoffId);assert.equal(f.shell.S().view,'notes');assert.equal(f.shell.S().chat,'full');assert.deepEqual(f.finishes,[true]);}finally{f.close();}
});
test('malformed prepared binding never falls through to visual-only legacy success',async()=>{
 const f=harness();try{await assert.rejects(f.apply({...f.event,navigationBinding:{...f.event.navigationBinding,viewId:'chat'}}),/could not be confirmed/);assert.equal(f.commits,0);assert.equal(f.shell.S().view,null);assert.equal(f.requests.length,0);assert.deepEqual(f.finishes,[false]);}finally{f.close();}
});
test('a refused claim and owner retirement after claim never execute the view or invent a result',async()=>{
 for(const mode of[{claimFailure:true},{retireAfterClaim:true}]){const f=harness(mode);try{await assert.rejects(f.apply(f.event));assert.equal(f.commits,0);assert.equal(f.shell.S().view,null);assert.deepEqual(f.requests.map(r=>r.path),['/api/views/interact-claim']);assert.deepEqual(f.finishes,[false]);}finally{f.close();}}
});
test('owner rotation during commit makes completion unknown and never sends a stale acknowledgment',async()=>{
 const f=harness();try{const pending=f.apply(f.event);await settle();f.retire();f.flush();await assert.rejects(pending,/could not be confirmed/);assert.equal(f.requests.length,1);assert.equal(f.commits,1);assert.deepEqual(f.finishes,[false]);}finally{f.close();}
});

test('actual prepared projection normalizes chat and automations through canonical commit',async()=>{
 for(const [viewId,localView]of [['chat','home'],['automations','workflows']]){const f=harness({viewId,localView});try{const pending=f.apply(f.event);await settle();assert.equal(f.requests.length,1);f.flush();assert.equal(await pending,true);assert.equal(f.shell.S().view,localView==='home'?null:localView);assert.equal(f.requests[1].body.result.switched,true);assert.deepEqual(f.finishes,[true]);}finally{f.close();}}
});

test('camera continuation gets a context only after the matching navigation acknowledgement',async()=>{
 const f=harness({viewId:'camera',localView:'camera'});try{
  const capture=f.client.capture({view:'home',revision:1,sensitive:false});
  assert.equal(f.client.currentAttempt({view:'home',revision:1,sensitive:false}),capture);
  assert.equal(f.client.deliveredContext(capture),undefined);
  const pending=f.client.deliver([{actionName:'VIEWS_SHOW',success:true,values:{mode:'show',viewId:'camera',viewPath:'/camera',viewType:'gui',completedActionHandoffId:f.event.completedActionHandoffId,navigationPrepared:true,navigationBinding:f.event.navigationBinding}}],capture,async()=>{f.shell.state.view='camera';f.shell.setState({},()=>{});f.flush();return true;});
  await pending.catch(()=>{});
  assert.equal(f.client.deliveredContext(capture),undefined,'a visual switch without the owned context commit is insufficient');
 }finally{f.close();}
 const g=harness({viewId:'camera',localView:'camera'});try{
  const pending=g.apply(g.event);await settle();assert.equal(g.client.deliveredContext(g.capturedAttempt),undefined);g.flush();assert.equal(await pending,true);
  assert.deepEqual(g.client.deliveredContext(g.capturedAttempt),{view:'camera',revision:2,sensitive:false});
  assert.equal(g.client.currentAttempt({view:'home',revision:1,sensitive:false}),undefined);
 }finally{g.close();}
});

test('realtime voice accepts older workflow and Home ids at their older paths',async()=>{
 for(const [viewId,viewPath,localView] of [['workflows','/workflows','workflows'],['workflows','/apps/workflows','workflows'],['home','/home','home'],['home','/','home']]){const f=harness({viewId,localView});try{const pending=f.apply({...f.event,viewPath});await settle();assert.equal(f.requests.length,1,`${viewId} ${viewPath}`);f.flush();assert.equal(await pending,true);assert.equal(f.shell.S().view,localView==='home'?null:localView);assert.deepEqual(f.finishes,[true]);}finally{f.close();}}
});
test('realtime voice refuses a path of another view or an unknown id before any claim',async()=>{
 for(const [viewId,viewPath] of [['workflows','/notes'],['automations','/workflows'],['chat','/home'],['unknown-view','/unknown-view']]){const f=harness({viewId,localView:'home'});try{await assert.rejects(f.apply({...f.event,viewPath}),/not available/);assert.equal(f.requests.length,0);assert.equal(f.commits,0);assert.equal(f.shell.S().view,null);}finally{f.close();}}
});
