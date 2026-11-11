import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import vm from 'node:vm';
import fs from 'node:fs';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';

const bundle=await build({stdin:{contents: "export * from './apps/app/src/runtime/automations-protocol.ts'; export * from './apps/app/src/runtime/workflow-local-time.ts';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'neutral',logLevel:'silent'});
const protocol=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const {AutomationsProtocol}=protocol;
const workflow={id:'workflow:flow',type:'workflow',title:'Reviewed workflow',description:'Existing typed steps',enabled:false,status:'paused',workflowId:'flow',schedules:[]};
const prompt={id:'trigger:prompt',type:'coordinator_text',title:'Owner prompt',description:'Review a supplied document',enabled:false,status:'paused',triggerId:'prompt',schedules:[{triggerType:'cron',cronExpression:'0 9 * * 1',timezone:'UTC'}]};
const schedule={taskId:'scheduled-task',kind:'recap',promptInstructions:'Manual recap',trigger:{kind:'manual'},state:{status:'scheduled'},source:'default_pack',ownerVisible:true,metadata:{recordKey:'weekly-review'}};
const reminder={definition:{id:'definition',title:'Check the draft',description:'',status:'active',timezone:'UTC',cadence:{kind:'once',dueAt:'2020-01-01T12:00:00Z'}},occurrence:{id:'occurrence',state:'pending'},latestAttempt:null};
// One hour can land in the repeated local hour at the autumn DST boundary.
// This general future fixture is distinct from the explicit DST cases below.
const future=()=>protocol.automationLocalDateInput(Date.now()+24*3600000);
async function fixture(handler){
 const calls=[];
 const server=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const call={path:req.url,method:req.method,body:raw?JSON.parse(raw):undefined};calls.push(call);assert.equal(req.headers.authorization,'Bearer synthetic-owner');
  try{const result=await handler(call,req,res);if(res.destroyed)return;res.writeHead(result?.status||200,{'Content-Type':'application/json'});res.end(JSON.stringify(result?.body??result??{}));}catch(error){res.writeHead(500);res.end(JSON.stringify({error:error.message}));}
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const request=async(path,method,body,signal)=>{const response=await fetch(`http://127.0.0.1:${server.address().port}`+path,{method,body:body===undefined?undefined:JSON.stringify(body),headers:{Authorization:'Bearer synthetic-owner','Content-Type':'application/json'},signal});const result=await response.json();if(!response.ok)throw Object.assign(Error('Fixture request refused'),{status:response.status,code:result.code});return result;};
 return {calls,request,client:new AutomationsProtocol(request),close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
const read=({path})=>path==='/api/automations'?{automations:[workflow,prompt]}:path.startsWith('/api/lifeops/scheduled-tasks')?{tasks:[schedule]}:path==='/api/lifeops/reminders'?{reminders:[reminder]}:path==='/api/lifeops/definitions'?{definitions:[]}:path==='/api/triggers/prompt'?{trigger:{id:'prompt',displayName:'Owner prompt',instructions:'Keep the original selection',triggerType:'cron',cronExpression:'0 9 * * 1',timezone:'UTC'}}:path.endsWith('/runs')?{runs:[{status:'success',startedAtIso:'2026-10-08T12:00:00Z'}]}:{};
const signal=()=>new AbortController().signal;

test('unified read uses all four canonical sources and keeps stable source identities',async()=>{const f=await fixture(read);try{const snapshot=await f.client.list(signal());assert.deepEqual(snapshot.rows.map(row=>row.kind).sort(),['prompt','reminder','schedule','workflow']);assert.equal(snapshot.issues.length,0);assert.deepEqual(f.calls.map(call=>call.path).sort(),['/api/automations','/api/lifeops/definitions','/api/lifeops/reminders','/api/lifeops/scheduled-tasks?ownerVisibleOnly=1']);assert.equal(snapshot.rows.find(row=>row.kind==='schedule').enabled,false);assert.equal(snapshot.rows.find(row=>row.kind==='schedule').key,'scheduled:scheduled-task');}finally{await f.close();}});
test('missing capability and denied owner remain distinct while other sources stay usable',async()=>{const f=await fixture(call=>call.path.includes('scheduled-tasks')?{status:404,body:{}}:call.path.includes('/reminders')?{status:403,body:{}}:read(call));try{const snapshot=await f.client.list(signal());assert.equal(snapshot.rows.length,2);assert.deepEqual(snapshot.issues.map(issue=>[issue.source,issue.unavailable]),[['schedules',true],['reminders',false]]);assert.match(snapshot.issues[1].message,/owner/);}finally{await f.close();}});
test('unlisted scheduled rows and malformed identities fail their source instead of leaking into a healthy empty list',async()=>{const f=await fixture(call=>call.path.includes('scheduled-tasks')?{tasks:[{...schedule,ownerVisible:false}]}:read(call));try{const snapshot=await f.client.list(signal());assert.equal(snapshot.rows.some(row=>row.kind==='schedule'),false);assert.equal(snapshot.issues[0].source,'schedules');for(const id of ['../other','a/b','a%2fb','a?x=1',' a','a..b'])assert.throws(()=>protocol.automationId(id));}finally{await f.close();}});
for(const conversation of [undefined,'00000000-0000-4000-8000-000000000010'])test(`prompt creation is paused and preserves its delivery conversation: ${conversation||'legacy'}`,async()=>{const f=await fixture(call=>({trigger:{id:'prompt',...call.body},...(call.body.deliveryConversationId?{deliveryConversationId:call.body.deliveryConversationId}:{})}));if(conversation)f.client=new AutomationsProtocol(f.request,conversation);try{const draft={title:'  Draft review  ',instructions:'Read only the supplied document',triggerType:'once',scheduledAt:future(),cron:'',eventKind:'',timezone:'UTC'};await f.client.savePrompt(draft,signal());assert.equal(f.calls[0].method,'POST');assert.equal(f.calls[0].body.enabled,false);assert.equal(f.calls[0].body.wakeMode,'inject_now');assert.equal(f.calls[0].body.deliveryConversationId,conversation);await f.client.savePrompt({...draft,triggerType:'cron',cron:'0 9 * * 1'},signal(),'prompt');assert.equal(f.calls[1].method,'PUT');assert.equal(Object.hasOwn(f.calls[1].body,'enabled'),false);assert.equal(Object.hasOwn(f.calls[1].body,'wakeMode'),false);await assert.rejects(f.client.savePrompt({...draft,scheduledAt:'2020-01-01T12:00'},signal()),/future/);assert.equal(f.calls.length,2);}finally{await f.close();}});
test('scheduled Run uses fire rather than acknowledgment and reports a non-fired outcome',async()=>{const f=await fixture(()=>({fire:{kind:'skipped',reason:'Owner paused this item',task:schedule}}));try{await assert.rejects(f.client.scheduledVerb('scheduled-task','fire',signal()),/Owner paused/);assert.deepEqual(f.calls.map(call=>call.path),['/api/lifeops/scheduled-tasks/scheduled-task/fire']);}finally{await f.close();}});
test('LifeOps reminders use the existing in-app definition/idempotency contract and preserve unchanged past due dates',async()=>{const f=await fixture(call=>call.path.includes('/occurrences/')?{occurrence:{id:'occurrence',state:'pending'}}:{definition:{id:call.method==='POST'?'created':'definition',...call.body}});try{await f.client.createReminder({message:'Review this draft',due:future(),timezone:'UTC',idempotencyKey:'same-owned-key'},signal());assert.equal(f.calls[0].body.idempotencyKey,'same-owned-key');assert.equal(f.calls[0].body.metadata.nativeProjection,'in_app_only');assert.equal(f.calls[0].body.reminderPlan.steps[0].channel,'in_app');const row=(await new AutomationsProtocol(async()=>({reminders:[reminder],automations:[],tasks:[]})).list(signal())).rows[0];await f.client.editReminder(row,'Changed message',protocol.automationLocalDateInput(reminder.definition.cadence.dueAt),signal());assert.deepEqual(f.calls[1].body,{title:'Changed message'});await f.client.snoozeReminder('occurrence',signal());await f.client.cancelReminder('definition',signal());assert.deepEqual(f.calls.slice(1).map(call=>[call.path,call.method]),[['/api/lifeops/definitions/definition','PUT'],['/api/lifeops/occurrences/occurrence/snooze','POST'],['/api/lifeops/definitions/definition','PUT']]);}finally{await f.close();}});

const routine={definition:{id:'routine',kind:'routine',title:'Stretch',description:'',status:'active',timezone:'UTC',cadence:{kind:'daily'},metadata:{ownerSurface:'OWNER_ROUTINES'}}};
const goal={definition:{id:'goal',kind:'task',title:'Run a marathon',description:'',status:'paused',timezone:'UTC',cadence:{kind:'unscheduled'},metadata:{ownerSurface:'OWNER_GOALS'}}};
const readDefinitions=call=>call.path==='/api/lifeops/definitions'?{definitions:[routine,goal,{definition:reminder.definition},{definition:{...routine.definition,id:'old',status:'archived'}},{definition:{...routine.definition,id:'todo',kind:'task',metadata:{ownerSurface:'OWNER_TODOS'}}}]}:read(call);
test('routines and goals come from LifeOps definitions without duplicating reminder rows',async()=>{const f=await fixture(readDefinitions);try{const snapshot=await f.client.list(signal());assert.equal(snapshot.issues.length,0);assert.deepEqual(snapshot.rows.filter(row=>row.kind==='routine').map(row=>[row.title,row.source,row.enabled,row.schedule]),[['Stretch','Agent routine',true,'Daily'],['Run a marathon','Agent goal',false,'']]);assert.deepEqual(snapshot.rows.filter(row=>row.id==='definition').map(row=>row.kind),['reminder']);}finally{await f.close();}});
test('a failed definitions read becomes an issue while the other sources stay listed',async()=>{const f=await fixture(call=>call.path==='/api/lifeops/definitions'?{status:500,body:{}}:read(call));try{const snapshot=await f.client.list(signal());assert.equal(snapshot.rows.length,4);assert.deepEqual(snapshot.issues.map(issue=>[issue.source,issue.unavailable]),[['definitions',false]]);assert.match(snapshot.issues[0].message,/Routines and goals could not refresh/);}finally{await f.close();}});
test('routine pause and delete use the definition routes and require confirmation from the agent',async()=>{const f=await fixture(call=>call.method==='DELETE'?{deleted:true}:{definition:{...routine.definition,...call.body}});try{await f.client.setDefinitionEnabled('routine',false,signal());await f.client.deleteDefinition('routine',signal());assert.deepEqual(f.calls.map(call=>[call.method,call.path,call.body]),[['PUT','/api/lifeops/definitions/routine',{status:'paused'}],['DELETE','/api/lifeops/definitions/routine',undefined]]);}finally{await f.close();}
 const refused=await fixture(()=>({deleted:false}));try{await assert.rejects(refused.client.deleteDefinition('routine',signal()),/not confirmed/);}finally{await refused.close();}});

const {homeReadIsStale,presentHomeWorkflowFreshness}=await import('../apps/app/src/prototype/home-cards.ts');
const transformed=file=>stripTypeScriptTypes(fs.readFileSync(file,'utf8').replace(/^import .*;\n/gm,'').replace(/export /g,''),{mode:'transform'});
function adapterFixture(request,storage={},options={}){
 const listeners=new Set(),events=new Map(),session={sessionId:'session',origin:'https://synthetic.invalid',ownerId:'owner',agentId:'agent'};
 const controller={getAutomationsClient:()=>({sessionId:session.sessionId,request}),getSnapshot:()=>({session,open:false}),subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},open:()=>{throw Error('Unexpected account chooser');}};
 const showAgentStatus=()=>{throw Error('Unexpected agent status route');};
 const localStorage=new Proxy({getItem:key=>storage[key]??null,setItem:(key,value)=>storage[key]=value,removeItem:key=>delete storage[key]},{ownKeys:()=>Object.keys(storage),getOwnPropertyDescriptor:()=>({configurable:true,enumerable:true})});
 let view=options.view===undefined?'workflows':options.view,workflowOpened='',deviceOpened='',newWorkflow=0;
 class Shell{live=true;renderVals(){return options.homeFallback||{};}componentDidMount(){}componentWillUnmount(){}S(){return {view};}vset(){}vget(){return {};}api(){return api;}openView(next){view=next;}refreshReminders(id){deviceOpened=id;}newDeviceReminderDraft(){deviceOpened='new-draft';}}
 const api={ic:{bell:'bell',spark:'sparkles',cal:'calendar',flow:'workflow'},track:()=>'',kx:()=>0,isActive:()=>true};
 const views={workflows:{render:()=>({cards:[],managementCards:[],openWorkflow:id=>workflowOpened=id,newFlow:()=>newWorkflow++,detail:false,builder:false,runOpen:false}),back:()=>false,onLeave(){},refreshManagement:options.refreshManagement}};
 const windowEvents=new Map();
 const reviews={asked:[],answer:false};
 const dom=options.dom?new JSDOM('<div class="os"><button id="origin">Filters</button></div>',{pretendToBeVisual:true}):null;
 if(dom){dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.document.querySelector('.os').inert=false;}
 const context={...protocol,homeReadIsStale,presentHomeWorkflowFreshness,connectionController:controller,showAgentStatus,DailyApps:{listReminders:async()=>({reminders:options.deviceReminders??[{id:'device',title:'On-device reminder',body:'Existing phone row',at:Date.now()+10000,status:'scheduled'}]})},Capacitor:{getPlatform:()=> 'android',isNativePlatform:()=>options.native!==false},localStorage,window:dom?.window||{dispatchEvent(event){for(const fn of windowEvents.get(event.type)||[])fn(event);},addEventListener(name,fn){const f=windowEvents.get(name)||new Set();f.add(fn);windowEvents.set(name,f);},removeEventListener(name,fn){windowEvents.get(name)?.delete(fn);}},document:dom?.window.document||{hidden:false,addEventListener:(name,fn)=>events.set(name,fn),removeEventListener(){}},getComputedStyle:dom?.window.getComputedStyle,innerWidth:400,innerHeight:800,catalog:JSON.parse(fs.readFileSync('apps/app/src/icon-catalog.json','utf8')),queueMicrotask,AbortController,Date:options.now?class extends Date{static now(){return options.now();}}:Date,crypto,Event,console,
  // The in-app review is rendered by apps/app/src/browser/review.ts; this fixture answers it.
  BrowserReviews:class{confirm(id,title,details,label,choice){reviews.asked.push({id,title,details,label});return Promise.resolve(reviews.answer&&choice?.current?.()!==false);}cancel(){}cancelAll(){}}};
 vm.runInNewContext('(()=>{'+transformed('.eliza/client-features/packages/contracts/src/workflow-intents.ts')+'\nglobalThis.SharedWorkflowIntentStore=WorkflowIntentStore;globalThis.sharedWorkflowIntentKey=workflowIntentKey;globalThis.emptyWorkflowIntentArchive=emptyWorkflowIntentArchive;globalThis.storageWorkflowIntentBackend=storageWorkflowIntentBackend;globalThis.workflowIntentOwnerPrefix=workflowIntentOwnerPrefix;})();',context);
 vm.runInNewContext(transformed('apps/app/src/runtime/workflow-intents.ts')+'\nglobalThis.WorkflowIntentStore=WorkflowIntentStore;globalThis.workflowIntentKey=workflowIntentKey;',context);
 vm.runInNewContext(transformed('.eliza/client-features/packages/ui/src/utils/automation-feed-filter.ts')+'\nglobalThis.FEED_FILTERS=FEED_FILTERS;globalThis.passesFilter=passesFilter;',context);
 for(const [file,names] of [
  ['.eliza/client-features/packages/ui/src/utils/cron-format.ts',['CRON_PRESETS','formatSchedule']],
  ['.eliza/client-features/packages/ui/src/utils/reminder-presentation.ts',['canSnoozeReminder','reminderDeliveryLabel','reminderDue']],
  ['apps/app/src/icon-style.ts',['iconStyle']],
  ['apps/app/src/runtime/modal-inert.ts',['holdPhoneInert']],
  ['apps/app/src/prototype/workflow-filters.ts',['openWorkflowFilters','workflowFilterLabel']],
 ])vm.runInNewContext(transformed(file)+'\n'+names.map(name=>'globalThis.'+name+'='+name+';').join(''),context);
 context.AUTOMATIONS_COMMITTED_EVENT='alpha:automations-committed';
 vm.runInNewContext(transformed('apps/app/src/runtime/workflow-request-recovery.ts')+'\nglobalThis.createWorkflowRequestRecovery=createWorkflowRequestRecovery;',context);
 vm.runInNewContext(transformed('apps/app/src/prototype/automations-adapter.ts')+'\nglobalThis.install=installAutomationsAdapter;',context);
 context.install(Shell,views);const shell=new Shell();shell.componentDidMount();
 return {window:context.window,reviews,document:context.document,notify:(sessionId=session.sessionId)=>context.window.dispatchEvent(dom?new dom.window.CustomEvent(context.AUTOMATIONS_COMMITTED_EVENT,{detail:{sessionId}}):{type:context.AUTOMATIONS_COMMITTED_EVENT,detail:{sessionId}}),leave:()=>views.workflows.onLeave(),setView:next=>view=next,home:()=>shell.renderVals(),render:()=>views.workflows.render({},api),close:()=>shell.componentWillUnmount(),storage,retire:()=>{session.sessionId='replacement';session.ownerId='other';for(const fn of listeners)fn();},back:()=>views.workflows.back(),get workflowOpened(){return workflowOpened;},get deviceOpened(){return deviceOpened;},get newWorkflow(){return newWorkflow;}};
}
const wait=async fn=>{for(let count=0;count<300;count++){if(fn())return;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('Unified automation UI did not settle.');};
test('unified workflow management shares list cancellation and cannot outlive its visible owner visit',async()=>{
 let release,probeSignal,current;
 const held=new Promise(resolve=>release=resolve),calls=[];
 const app=adapterFixture(async(path,method)=>{calls.push({path,method});return read({path});},{},{refreshManagement:async(signal,valid)=>{probeSignal=signal;current=valid;await held;}});
 try{
  app.render();await wait(()=>probeSignal);
  assert.equal(current(),true);assert.equal(app.render().automation.loading,true);
  app.leave();app.setView('');assert.equal(probeSignal.aborted,true);assert.equal(current(),false);
  release();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.home().homeWorkflowHasRows,undefined);
  assert.equal(calls.filter(call=>call.path==='/api/automations').length,1);
  assert.equal(calls.filter(call=>call.method!=='GET').length,0);
 }finally{release();app.close();}
});
test('unified Workflows keeps browser request recovery in its management controls',async()=>{
 const f=await fixture(read);
 const browser=adapterFixture(f.request,{}, {native:false});
 const native=adapterFixture(f.request);
 try{
  for(const app of [browser,native])app.render();
  await wait(()=>[browser,native].every(app=>!app.render().automation.loading&&app.render().cards.length===5));
  const recovery=app=>app.render().automation.managementCards.filter(card=>card.name==='Recovery');
  assert.equal(recovery(browser).length,1);
  assert.equal(typeof recovery(browser)[0].open,'function');
  assert.equal(recovery(native).length,0);
 }finally{browser.close();native.close();await f.close();}
});

test('editing an existing daily schedule preserves its clock without enabling it or running it',async()=>{
 const before=process.env.TZ;process.env.TZ='America/Los_Angeles';
 const task={...schedule,promptInstructions:'Good morning',trigger:{kind:'cron',expression:'0 8 * * *',tz:'UTC'},metadata:{recordKey:'gm'}};
 const f=await fixture(call=>call.path.startsWith('/api/lifeops/scheduled-tasks')?(call.method==='GET'?{tasks:[task]}:{task:{...task,...call.body}}):read(call)),app=adapterFixture(f.request);
 try{
  app.render();await wait(()=>app.render().cards.length===5&&!app.render().automation.loading);app.render().cards.find(card=>card.name==='Good morning').open();
  assert.match(app.render().automation.schedule,/^Next /);assert.doesNotMatch(app.render().automation.schedule,/UTC|America\//);
  app.render().automation.scheduleMore.find(action=>action.label==='Edit schedule').run();assert.equal(app.render().automation.editedScheduleTime,'08:00');
  app.render().automation.changeScheduleTime({target:{value:'10:00'}});app.back();assert.equal(app.render().automation.editingSchedule,false);assert.equal(f.calls.filter(call=>call.method!=='GET').length,0);
  app.render().automation.scheduleMore.find(action=>action.label==='Edit schedule').run();assert.equal(app.render().automation.editedScheduleTime,'08:00');
  app.render().automation.saveScheduleEdit();assert.equal(f.calls.filter(call=>call.method!=='GET').length,0);
  app.render().automation.confirm();await wait(()=>f.calls.some(call=>call.method==='POST')&&!app.render().automation.busy);
  const writes=f.calls.filter(call=>call.method!=='GET');assert.equal(writes.length,1);assert.equal(writes[0].path,'/api/lifeops/scheduled-tasks/scheduled-task/edit');
  assert.deepEqual(writes[0].body,{promptInstructions:'Good morning'});
 }finally{app.close();await f.close();if(before===undefined)delete process.env.TZ;else process.env.TZ=before;}
});

test('the actual schedule menu renders visible text and accessible names for every action',async()=>{
 const f=await fixture(read),app=adapterFixture(f.request);
 try{
  app.render();await wait(()=>app.render().cards.length===5&&!app.render().automation.loading);app.render().cards.find(card=>card.name==='Weekly review').open();
  const dom=new JSDOM('<!doctype html><body></body>'),document=dom.window.document,template=document.createElement('template');const htmlSource=fs.readFileSync('apps/app/src/prototype/template.html','utf8'),start=htmlSource.indexOf('<div class="schedule-controls">');template.innerHTML=htmlSource.slice(start,htmlSource.indexOf('\n        <div class="automation-actions">',start));
  const source=fs.readFileSync('apps/app/src/prototype/dc-lite.js','utf8').replace(/^import .*;\n/gm,'');
  const node=vm.runInNewContext(source.slice(0,source.indexOf('  const templateElement'))+';node;',{React,document,iconStyle:()=>({})});
  const html=renderToStaticMarkup(node(template.content.querySelector('.schedule-controls'),{workflows:{automation:app.render().automation},ic:{}},'controls'));
  const buttons=[...new JSDOM(html).window.document.querySelectorAll('button')];
  assert.deepEqual(buttons.map(button=>button.textContent),['Run now','Edit schedule','10 min','Complete','Dismiss']);
  for(const button of buttons)assert.equal(button.getAttribute('aria-label'),button.textContent==='10 min'?'Snooze 10 minutes':button.textContent);
 }finally{app.close();await f.close();}
});
test('actual Alpha adapter unifies five kinds, filters, delegates workflow/device detail and reviews canonical actions',async()=>{const f=await fixture(read),app=adapterFixture(f.request);try{app.render();await wait(()=>app.render().cards.length===5&&!app.render().automation.loading);assert.equal(app.home().homeWorkflowHasRows,true);assert.equal(app.home().homeWorkflowRows.length,2);assert.equal(app.home().homeWorkflowTime,'View automations');assert.deepEqual(Array.from(app.home().homeWorkflowRows,row=>row.name).sort(),['Check the draft','On-device reminder']);assert.match(app.home().homeWorkflowFreshness,/^Loaded \d{1,2}:\d{2}/);assert.match(app.home().homeWorkflowDescription,/^Automations from your agent and reminders on this phone, loaded \d/);app.render().automation.filters.find(filter=>filter.name==='Schedules').pick();assert.deepEqual(Array.from(app.render().cards,card=>card.name),['Weekly review']);app.render().automation.filters.find(filter=>filter.name==='All').pick();app.render().cards.find(card=>card.name==='Reviewed workflow').open();assert.equal(app.workflowOpened,'flow');app.render().cards.find(card=>card.name==='On-device reminder').open();assert.equal(app.deviceOpened,'device');}finally{app.close();await f.close();}});
test('unknown mutation stays locked in the existing owner request journal after adapter recreation',async()=>{let writes=0;const f=await fixture((call,_req,res)=>{if(call.method!=='GET'){writes++;res.destroy();return;}return read(call);});const storage={};let app=adapterFixture(f.request,storage);try{app.render();await wait(()=>app.render().cards.length===5&&!app.render().automation.loading);app.render().cards.find(card=>card.name==='Owner prompt').open();app.render().automation.actions.find(action=>action.label==='Enable').run();assert.equal(writes,0);app.render().automation.confirm();await wait(()=>writes===1&&!app.render().automation.busy);assert.equal(app.render().automation.locked,true);assert.equal(Object.keys(storage).length,1);app.close();app=adapterFixture(f.request,storage);app.render();await wait(()=>app.render().cards.length===5&&!app.render().automation.loading);app.render().cards.find(card=>card.name==='Owner prompt').open();assert.equal(app.render().automation.actions.find(action=>action.label==='Enable').disabled,true);assert.equal(writes,1);}finally{app.close();await f.close();}});
test('retiring an owner while a detail read waits cannot open an editor or dispatch a late mutation',async()=>{let release;const paused=new Promise(resolve=>release=resolve);let detailStarted=false;const f=await fixture(async call=>{if(call.path==='/api/triggers/prompt'){detailStarted=true;await paused;}return read(call);});const app=adapterFixture(f.request);try{app.render();await wait(()=>app.render().cards.length===5&&!app.render().automation.loading);app.render().cards.find(card=>card.name==='Owner prompt').open();app.render().automation.actions.find(action=>action.label==='Edit prompt').run();await wait(()=>detailStarted);app.retire();assert.equal(app.home().homeWorkflowHasRows,undefined);release();await new Promise(resolve=>setTimeout(resolve,20));assert.equal(app.render().automation.editing,false);assert.equal(f.calls.filter(call=>call.method!=='GET').length,0);}finally{release();app.close();await f.close();}});

for(const status of [408,409,425,429])test(`a mutation followed by HTTP ${status} remains unknown after recreation`,async()=>{
 let writes=0;const f=await fixture(call=>{if(call.method!=='GET'){writes++;return {status,body:{code:'REPLY_UNCONFIRMED'}};}return read(call);});const storage={};let app=adapterFixture(f.request,storage);
 try{app.render();await wait(()=>app.render().cards.length===5&&!app.render().automation.loading);app.render().cards.find(card=>card.name==='Owner prompt').open();app.render().automation.actions.find(action=>action.label==='Enable').run();app.render().automation.confirm();await wait(()=>writes===1&&!app.render().automation.busy);assert.equal(app.render().automation.locked,true);assert.equal(Object.keys(storage).length,1);app.close();app=adapterFixture(f.request,storage);app.render();await wait(()=>app.render().cards.length===5&&!app.render().automation.loading);app.render().cards.find(card=>card.name==='Owner prompt').open();assert.equal(app.render().automation.actions.find(action=>action.label==='Enable').disabled,true);assert.equal(writes,1);}finally{app.close();await f.close();}
});
const openPrompt=async app=>{app.render();await wait(()=>app.render().cards.length===5&&!app.render().automation.loading);app.render().cards.find(card=>card.name==='Owner prompt').open();};
const reviewed=(app,label)=>{app.render().automation.actions.find(action=>action.label===label).run();app.render().automation.confirm();};
test('an unknown enable or delete settles when the refreshed row shows it applied',async()=>{
 let enabled=false,deleted=false;const f=await fixture((call,_req,res)=>{if(call.method==='PUT'){enabled=true;return {status:408,body:{}};}if(call.method==='DELETE'){deleted=true;res.destroy();return;}if(call.path==='/api/automations')return {automations:[workflow,...(deleted?[]:[{...prompt,enabled,status:enabled?'active':'paused'}])]};return read(call);});const app=adapterFixture(f.request);
 try{await openPrompt(app);reviewed(app,'Enable');await wait(()=>enabled&&!app.render().automation.busy&&!app.render().automation.loading);assert.equal(app.render().automation.locked,false);assert.equal(Object.keys(app.storage).length,0);
  reviewed(app,'Delete prompt');await wait(()=>deleted&&!app.render().automation.busy&&!app.render().automation.loading);assert.equal(Object.keys(app.storage).length,0);assert.equal(app.render().cards.some(card=>card.name==='Owner prompt'),false);}finally{app.close();await f.close();}
});
test('an unknown Run now stays locked after refresh, and Allow another releases it only after the owner confirms',async()=>{
 let runs=0;const f=await fixture((call,_req,res)=>{if(call.method==='POST'){runs++;res.destroy();return;}return read(call);});const app=adapterFixture(f.request);
 try{await openPrompt(app);reviewed(app,'Run now');await wait(()=>runs===1&&!app.render().automation.busy&&!app.render().automation.loading);assert.equal(app.render().automation.locked,true);assert.equal(Object.keys(app.storage).length,1);
  app.reviews.answer=false;app.render().automation.allowAnother();await new Promise(resolve=>setTimeout(resolve,20));assert.equal(app.render().automation.locked,true);assert.equal(Object.keys(app.storage).length,1);assert.deepEqual(app.reviews.asked,[{id:'allow-another-automation',title:'Allow another try?',details:'The last request may already have gone through. Trying again could run it twice.',label:'Allow another try'}]);
  app.reviews.answer=true;app.render().automation.allowAnother();await wait(()=>!app.render().automation.locked&&!app.render().automation.busy);assert.equal(Object.keys(app.storage).length,0);assert.equal(app.render().automation.actions.find(action=>action.label==='Run now').disabled,false);assert.equal(runs,1);}finally{app.close();await f.close();}
});
test('a new prompt refused with 429 does not lock new prompts; an unknown one locks the form until Allow another',async()=>{
 let posts=0,status=429;const f=await fixture(call=>{if(call.method==='POST'){posts++;return {status,body:{}};}return read(call);});const app=adapterFixture(f.request);
 const draft=()=>{app.render().automation.createPrompt();app.render().automation.fields.find(field=>field.name==='instructions').change({target:{value:'Read only the supplied text'}});};
 try{app.render();await wait(()=>app.render().cards.length===5&&!app.render().automation.loading);draft();app.render().automation.save();await wait(()=>posts===1&&!app.render().automation.busy);assert.equal(Object.keys(app.storage).length,0);assert.equal(app.render().automation.locked,false);assert.doesNotMatch(app.render().automation.message,/^Unknown$/);
  status=503;app.render().automation.save();await wait(()=>posts===2&&!app.render().automation.busy);assert.match(app.render().automation.message,/^Unknown$/);assert.equal(app.render().automation.locked,true);app.render().automation.save();assert.equal(posts,2);
  app.reviews.answer=true;app.render().automation.allowAnother();await wait(()=>!app.render().automation.locked&&!app.render().automation.busy);assert.equal(Object.keys(app.storage).length,0);app.render().automation.save();await wait(()=>posts===3&&!app.render().automation.busy);}finally{app.close();await f.close();}
});
test('a structured unknown outcome is retained even when its HTTP status normally rejects input',async()=>{
 const f=await fixture(call=>call.method==='GET'?read(call):{status:400,body:{code:'AUTOMATION_OUTCOME_UNKNOWN'}}),app=adapterFixture(f.request);
 try{app.render();await wait(()=>app.render().cards.length===5&&!app.render().automation.loading);app.render().cards.find(card=>card.name==='Owner prompt').open();app.render().automation.actions.find(action=>action.label==='Enable').run();app.render().automation.confirm();await wait(()=>f.calls.some(call=>call.method==='PUT')&&!app.render().automation.busy);assert.equal(app.render().automation.locked,true);assert.equal(Object.keys(app.storage).length,1);}finally{app.close();await f.close();}
});
test('enable refused at the agent active-automation limit (429) is re-read: still paused is a known refusal, enabled is confirmed',async()=>{
 const limited=state=>call=>call.method==='GET'?(call.path==='/api/triggers/prompt'?{trigger:{id:'prompt',displayName:'Owner prompt',instructions:'Keep the original selection',triggerType:'cron',cronExpression:'0 9 * * 1',timezone:'UTC',enabled:state}}:read(call)):{status:429,body:{error:'Active trigger limit reached (100)'}};
 let f=await fixture(limited(false));
 try{await assert.rejects(f.client.setPromptEnabled('prompt',true,signal()),error=>error instanceof protocol.AutomationOutcomeError&&error.message===protocol.AUTOMATION_LIMIT_MESSAGE);assert.deepEqual(f.calls.map(call=>call.method+' '+call.path),['PUT /api/triggers/prompt','GET /api/triggers/prompt']);}finally{await f.close();}
 f=await fixture(limited(true));
 try{await f.client.setPromptEnabled('prompt',true,signal());}finally{await f.close();}
 f=await fixture(limited(true));
 try{await assert.rejects(f.client.setPromptEnabled('prompt',false,signal()),error=>error.status===429&&!(error instanceof protocol.AutomationOutcomeError));assert.equal(f.calls.length,1);}finally{await f.close();}
 const g=await fixture(limited(false)),app=adapterFixture(g.request);
 try{app.render();await wait(()=>app.render().cards.length===5&&!app.render().automation.loading);app.render().cards.find(card=>card.name==='Owner prompt').open();app.render().automation.actions.find(action=>action.label==='Enable').run();app.render().automation.confirm();await wait(()=>g.calls.some(call=>call.method==='PUT')&&!app.render().automation.busy);assert.equal(app.render().automation.locked,false);assert.doesNotMatch(app.render().automation.message,/^Unknown$/);assert.equal(Object.keys(app.storage).length,0);assert.equal(app.render().automation.actions.find(action=>action.label==='Enable').disabled,false);}finally{app.close();await g.close();}
});
test('nonexistent local DST time is rejected before either prompt or reminder mutation',async()=>{
 const previous=process.env.TZ;process.env.TZ='America/New_York';const f=await fixture(call=>({trigger:{id:'prompt',...call.body},definition:{id:'definition',...call.body}}));
 try{await assert.rejects(f.client.savePrompt({title:'Gap',instructions:'Supplied text only',triggerType:'once',scheduledAt:'2030-03-10T02:30',cron:'',eventKind:'',timezone:'Asia/Tokyo'},signal()),/does not exist/);await assert.rejects(f.client.createReminder({message:'Gap',due:'2030-03-10T02:30',timezone:'Asia/Tokyo',idempotencyKey:'same'},signal()),/does not exist/);await assert.rejects(f.client.editReminder({kind:'reminder',id:'definition',record:reminder},'Changed','2030-03-10T02:30',signal()),/does not exist/);assert.equal(f.calls.length,0);}finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;await f.close();}
});
test('once and reminder edit inputs use local time while stored zones stay unchanged',async()=>{
 const when=new Date(Date.now()+3600000).toISOString();
 const f=await fixture(call=>{if(call.path==='/api/triggers/prompt'&&call.method==='GET')return {trigger:{id:'prompt',displayName:'Owner prompt',instructions:'Keep this source',enabled:false,triggerType:'once',scheduledAtIso:when,timezone:'Asia/Tokyo'}};if(call.method==='PUT')return call.path.startsWith('/api/triggers')?{trigger:{id:'prompt',...call.body,enabled:false}}:{definition:{id:'definition',...call.body}};if(call.path==='/api/lifeops/reminders')return {reminders:[{...reminder,definition:{...reminder.definition,timezone:'Asia/Tokyo',cadence:{kind:'once',dueAt:when}}}]};return read(call);});const app=adapterFixture(f.request);
 try{app.render();await wait(()=>app.render().cards.length===5&&!app.render().automation.loading);app.render().cards.find(card=>card.name==='Owner prompt').open();app.render().automation.actions.find(action=>action.label==='Edit prompt').run();await wait(()=>app.render().automation.editing);assert.equal(app.render().automation.whenFields.find(field=>field.name==='scheduledAt').label,'Date and time');app.render().automation.moreFields.find(field=>field.name==='title').change({target:{value:'Revised prompt'}});app.render().automation.save();await wait(()=>f.calls.some(call=>call.method==='PUT')&&!app.render().automation.busy);const saved=f.calls.find(call=>call.method==='PUT');assert.equal(saved.body.timezone,'Asia/Tokyo');assert.equal(saved.body.scheduledAtIso,when);app.render().automation.close();app.render().cards.find(card=>card.name==='Check the draft').open();app.render().automation.actions.find(action=>action.label==='Edit reminder').run();assert.equal(app.render().automation.fields.find(field=>field.name==='due').label,'Due');}finally{app.close();await f.close();}
});

test('unchanged repeated local times keep the original later offset and sub-minute precision',async()=>{
 const previous=process.env.TZ;process.env.TZ='America/New_York';const original='2030-11-03T06:30:47.123Z';const f=await fixture(call=>call.path.startsWith('/api/triggers')?{trigger:{id:'prompt',...call.body}}:{definition:{id:'definition',...call.body}});
 try{const local=protocol.automationLocalDateInput(original);assert.equal(local,'2030-11-03T01:30');await f.client.savePrompt({title:'Keep exact instant',instructions:'Supplied text',triggerType:'once',scheduledAt:local,originalScheduledAt:original,originalEnabled:false,cron:'',eventKind:'',timezone:'Asia/Tokyo'},signal(),'prompt');assert.equal(f.calls[0].body.scheduledAtIso,original);assert.equal(f.calls[0].body.timezone,'Asia/Tokyo');await f.client.editReminder({kind:'reminder',id:'definition',record:{definition:{...reminder.definition,cadence:{kind:'once',dueAt:original}}}},'Changed message',local,signal());assert.equal(Object.hasOwn(f.calls[1].body,'cadence'),false);}finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;await f.close();}
});

// The real template must never ship ahead of its controller again.
test('production Workflows template has every top-level automation binding',async()=>{
 const template=fs.readFileSync('apps/app/src/prototype/template.html','utf8');
 const expected=[...new Set([...template.matchAll(/workflows\.automation\.([A-Za-z_$][\w$]*)/g)].map(match=>match[1]))];
 const f=await fixture(read),app=adapterFixture(f.request);
 try{app.render();await wait(()=>app.render().cards.length===5&&!app.render().automation.loading);const model=app.render().automation;assert.ok(expected.length>16);assert.deepEqual(expected.filter(name=>!Object.hasOwn(model,name)),[]);}finally{app.close();await f.close();}
});
const presentationBundle=await build({entryPoints:['.eliza/client-features/packages/ui/src/utils/reminder-presentation.ts'],bundle:true,write:false,format:'esm',platform:'neutral',logLevel:'silent'});
const presentation=await import('data:text/javascript;base64,'+Buffer.from(presentationBundle.outputFiles[0].text).toString('base64'));
test('shared canonical reminder labels and snooze policy cover delivery, terminal and acknowledged states',()=>{
 const row=(status='active',state='pending',outcome=null,metadata={})=>({definition:{status,cadence:{kind:'once',dueAt:'2030-01-01T12:00:00Z'}},occurrence:state?{state,metadata}:null,latestAttempt:outcome?{outcome}:null});
 for(const [status,state,outcome,label] of [
  ['archived','pending',null,'cancelled'],['paused','pending',null,'paused'],['completed','pending',null,'completed'],
  ...['snoozed','completed','skipped','expired','muted'].map(state=>['active',state,null,state]),
  ['active','mystery',null,'unknown'],['active','pending','delivered_in_app','delivered'],['active','visible','blocked_channel','blocked'],['active','pending','skipped_duplicate','duplicate'],['active','pending','other','unknown'],['active','pending',null,'scheduled'],['active',null,null,'unscheduled'],
 ])assert.equal(presentation.reminderDeliveryLabel(row(status,state,outcome)),label);
 for(const state of ['pending','visible','snoozed'])assert.equal(presentation.canSnoozeReminder(row('active',state)),true);
 for(const status of ['archived','completed','paused'])assert.equal(presentation.canSnoozeReminder(row(status)),false);
 for(const state of [null,'completed','skipped','expired','muted','unknown'])assert.equal(presentation.canSnoozeReminder(row('active',state)),false);
 assert.equal(presentation.canSnoozeReminder(row('active','visible',null,{reminderAcknowledgedAt:'2026-10-25T10:00:00Z'})),false);
});
test('snoozed occurrence due is displayed and message-only edit preserves the original cadence instant',async()=>{
 const due=new Date(Date.now()+7200000).toISOString(),snoozed={...reminder,occurrence:{id:'occurrence',state:'snoozed',dueAt:reminder.definition.cadence.dueAt,snoozedUntil:due}};
 const f=await fixture(call=>call.path==='/api/lifeops/reminders'?{reminders:[snoozed]}:call.method==='PUT'?{definition:{...snoozed.definition,...call.body}}:read(call));const app=adapterFixture(f.request);
 try{app.render();await wait(()=>app.render().cards.length===5&&!app.render().automation.loading);app.render().cards.find(card=>card.name==='Check the draft').open();assert.equal(app.render().automation.status,'Snoozed');assert.equal(app.render().automation.schedule,new Date(due).toLocaleString(undefined,{dateStyle:'full',timeStyle:'short'}));app.render().automation.actions.find(action=>action.label==='Edit reminder').run();const fields=app.render().automation.fields;assert.equal(fields.find(field=>field.name==='due').value,protocol.automationLocalDateInput(due));fields.find(field=>field.name==='message').change({target:{value:'Only the message changes'}});app.render().automation.save();await wait(()=>f.calls.some(call=>call.method==='PUT')&&!app.render().automation.busy);assert.deepEqual(f.calls.find(call=>call.method==='PUT').body,{title:'Only the message changes'});assert.equal(presentation.reminderDue(snoozed),due);}finally{app.close();await f.close();}
});
for(const status of ['archived','completed'])test(`canonical ${status} reminder has details but no edit/cancel/snooze controls`,async()=>{
 const f=await fixture(call=>call.path==='/api/lifeops/reminders'?{reminders:[{...reminder,definition:{...reminder.definition,status}}]}:read(call));const app=adapterFixture(f.request);
 try{app.render();await wait(()=>app.render().cards.length===5&&!app.render().automation.loading);app.render().cards.find(card=>card.name==='Check the draft').open();assert.equal(app.render().automation.status,status==='archived'?'Cancelled':'Completed');assert.equal(app.render().automation.actions.length,0);assert.equal(f.calls.some(call=>call.method!=='GET'),false);}finally{app.close();await f.close();}
});
test('acknowledged reminder keeps edit/cancel and disables snooze using canonical eligibility',async()=>{
 const f=await fixture(call=>call.path==='/api/lifeops/reminders'?{reminders:[{...reminder,occurrence:{id:'occurrence',state:'visible',metadata:{reminderAcknowledgedAt:'2026-10-25'}}}]}:read(call));const app=adapterFixture(f.request);
 try{app.render();await wait(()=>app.render().cards.length===5&&!app.render().automation.loading);app.render().cards.find(card=>card.name==='Check the draft').open();assert.deepEqual(Array.from(app.render().automation.actions,x=>x.label),['Edit reminder','10 min','Cancel reminder']);const snooze=app.render().automation.actions[1];assert.equal(snooze.disabled,true);snooze.run();assert.equal(app.render().automation.review,false);assert.equal(f.calls.some(call=>call.method!=='GET'),false);}finally{app.close();await f.close();}
});
test('A filters use the actual dialog, stage independent type/status choices, cancel safely and render Lucide assets',async()=>{
 const f=await fixture(read),app=adapterFixture(f.request,{}, {dom:true});
 try{app.render();await wait(()=>app.render().cards.length===5&&!app.render().automation.loading);app.render().automation.openFilters();let dialog=app.document.querySelector('dialog');assert.ok(dialog.open);assert.equal(app.document.querySelector('.os').inert,true);assert.ok(dialog.querySelector('[data-alpha-icon="/icons/lucide/x.svg"]'));const choose=(label)=>Array.from(dialog.querySelectorAll('button')).find(button=>button.textContent===label).click();choose('Reminders');choose('Inactive');assert.equal(app.render().automation.filterLabel,'All workflows');dialog.querySelector('[aria-label="Close filters"]').click();assert.equal(app.render().automation.filterLabel,'All workflows');assert.equal(app.document.querySelector('.os').inert,false);app.render().automation.openFilters();dialog=app.document.querySelector('dialog');choose('Reminders');choose('Active');choose('Done');assert.equal(app.render().automation.filterLabel,'Reminders · Active');assert.equal(app.render().cards.length,2);assert.equal(app.render().automation.itemCount,'2 items');app.render().automation.openFilters();assert.equal(app.back(),true);assert.equal(app.document.querySelector('dialog'),null);app.render().automation.openFilters();app.window.dispatchEvent(new app.window.CustomEvent('alpha-back',{cancelable:true}));assert.equal(app.document.querySelector('dialog'),null);app.render().automation.openFilters();app.retire();assert.equal(app.document.querySelector('dialog'),null);assert.equal(app.document.querySelector('.os').inert,false);}finally{app.close();await f.close();}
});
test('current-session committed events coalesce one refresh and defer it while an unsaved reminder editor is open',async()=>{
 const f=await fixture(read),app=adapterFixture(f.request);
 try{app.render();await wait(()=>app.render().cards.length===5&&!app.render().automation.loading);const count=()=>f.calls.filter(x=>x.path==='/api/lifeops/reminders').length;assert.equal(count(),1);app.notify('other-session');app.render();await new Promise(resolve=>setTimeout(resolve,10));assert.equal(count(),1);app.notify();app.notify();app.render();await wait(()=>count()===2&&!app.render().automation.loading);app.render().cards.find(card=>card.name==='Check the draft').open();app.render().automation.actions.find(x=>x.label==='Edit reminder').run();app.render().automation.fields.find(x=>x.name==='message').change({target:{value:'Unsaved source stays intact'}});app.notify();app.render();await new Promise(resolve=>setTimeout(resolve,10));assert.equal(count(),2);assert.equal(app.render().automation.fields.find(x=>x.name==='message').value,'Unsaved source stays intact');app.render().automation.close();app.render();await wait(()=>count()===3&&!app.render().automation.loading);assert.equal(f.calls.some(x=>x.method!=='GET'),false);}finally{app.close();await f.close();}
});
test('retired-owner list replies and completion events cannot repopulate old reminder state or clear its journal',async()=>{
 let release,second=false;const blocked=new Promise(resolve=>release=resolve);const writes=[];const request=async(path,method,body)=>{if(method!=='GET')writes.push(path);if(second&&path==='/api/lifeops/reminders')await blocked;return read({path});};const app=adapterFixture(request);
 try{app.render();await wait(()=>app.render().cards.length===5&&!app.render().automation.loading);second=true;app.notify();app.render();await new Promise(resolve=>setTimeout(resolve,10));app.retire();app.setView('home');release();await new Promise(resolve=>setTimeout(resolve,10));assert.equal(app.home().homeWorkflowHasRows,undefined);assert.equal(app.render().cards.length,0);app.notify('session');assert.equal(app.render().cards.length,0);assert.equal(writes.length,0);assert.equal(Object.keys(app.storage).length,0);}finally{release();app.close();}
});

test('Alpha reminder status text follows current canonical English labels',async()=>{
 const strings=JSON.parse(fs.readFileSync('vendor/eliza/packages/ui/src/i18n/locales/en.json','utf8'));
 const cases=[['unscheduled',null,null],['blocked',{id:'occurrence',state:'visible'},{outcome:'blocked_channel'}],['duplicate',{id:'occurrence',state:'visible'},{outcome:'skipped_duplicate'}],['unknown',{id:'occurrence',state:'unrecognized'},null]];
 for(const [status,occurrence,latestAttempt] of cases){const f=await fixture(call=>call.path==='/api/lifeops/reminders'?{reminders:[{...reminder,occurrence,latestAttempt}]}:read(call)),app=adapterFixture(f.request);try{app.render();await wait(()=>app.render().cards.length===5&&!app.render().automation.loading);assert.equal(app.render().cards.find(card=>card.name==='Check the draft').statusLabel,({unscheduled:'—',unknown:'Unknown'})[status]??strings['automationsreminders.status.'+status]);}finally{app.close();await f.close();}}
});
test('a routine row offers Pause and Delete behind the owner review',async()=>{
 const f=await fixture(call=>call.method==='DELETE'?{deleted:true}:readDefinitions(call));const app=adapterFixture(f.request);
 try{app.render();await wait(()=>app.render().cards.length===7&&!app.render().automation.loading);app.render().cards.find(card=>card.name==='Stretch').open();assert.deepEqual(Array.from(app.render().automation.actions,action=>action.label),['Pause','Delete routine']);app.render().automation.actions.find(action=>action.label==='Delete routine').run();assert.equal(f.calls.some(call=>call.method!=='GET'),false);assert.equal(app.render().automation.review,true);app.render().automation.confirm();await wait(()=>f.calls.some(call=>call.method==='DELETE')&&!app.render().automation.busy);assert.deepEqual(f.calls.filter(call=>call.method!=='GET').map(call=>call.method+' '+call.path),['DELETE /api/lifeops/definitions/routine']);}finally{app.close();await f.close();}
});


test('Home hides only a fresh complete empty unified snapshot',async()=>{
 let now=new Date(2026,10,7,12).getTime();
 const f=await fixture(call=>call.path==='/api/automations'?{automations:[]}:call.path.includes('scheduled-tasks')?{tasks:[]}:call.path.includes('/reminders')?{reminders:[]}:call.path.includes('/definitions')?{definitions:[]}:{});
 const app=adapterFixture(f.request,{}, {deviceReminders:[],now:()=>now});
 try{
  assert.equal(app.home().homeWorkflowConfirmedEmpty,false);
  app.render();await wait(()=>app.home().homeWorkflowConfirmedEmpty===true);
  now+=86400000;assert.equal(app.home().homeWorkflowConfirmedEmpty,false,'yesterday is not a fresh empty read');
  now-=86400001;assert.equal(app.home().homeWorkflowConfirmedEmpty,false,'future timestamps are not accepted');
  app.retire();assert.equal(app.home().homeWorkflowConfirmedEmpty,false,'another owner cannot inherit the empty snapshot');
  assert.ok(f.calls.every(call=>call.method==='GET'));
 }finally{app.close();await f.close();}
});

// The runner stores the one-off snooze in firedAt without rewriting the recurrence.
test('scheduled snooze displays the acknowledged local time and preserves its cron',async()=>{
 const until='2026-11-10T10:00:00.000Z';const snoozed={...schedule,trigger:{kind:'cron',expression:'0 8 * * *',tz:'owner_local'},state:{status:'scheduled',firedAt:until,lastDecisionLog:`snoozed until ${until} (ladder reset)`}};
 const f=await fixture(call=>call.path.startsWith('/api/lifeops/scheduled-tasks')?{tasks:[snoozed]}:read(call));try{const row=(await f.client.list(signal())).rows.find(row=>row.kind==='schedule');assert.equal(row.status,'snoozed');assert.match(row.schedule,/Every day at 8am/);assert.ok(row.schedule.includes('Snoozed until '+protocol.workflowSnoozeTime(until)));assert.deepEqual(row.record.trigger,snoozed.trigger);assert.equal(f.calls.some(call=>call.method!=='GET'),false);}finally{await f.close();}
});

test('snooze uses an explicit future instant and requires its exact durable readback',async()=>{
 const until=new Date(Date.now()+600000).toISOString();let wrong=false;
 const f=await fixture(call=>({task:{taskId:'scheduled-task',state:{status:'scheduled',firedAt:wrong?'2000-01-01T00:00:00.000Z':call.body.untilIso}}}));
 try{await f.client.snoozeSchedule('scheduled-task',until,signal());assert.deepEqual(f.calls[0].body,{untilIso:until});wrong=true;await assert.rejects(f.client.snoozeSchedule('scheduled-task',until,signal()),/not confirmed/);const n=f.calls.length;await assert.rejects(f.client.snoozeSchedule('scheduled-task','2000-01-01T00:00:00Z',signal()),/future/);assert.equal(f.calls.length,n);}finally{await f.close();}
});

test('ten-minute snooze confirms one scheduled instant, then refreshes the same recurring task',async()=>{
 let task={...schedule,trigger:{kind:'cron',expression:'0 8 * * *',tz:'owner_local'}};
 const f=await fixture(call=>{
  if(call.path.endsWith('/snooze')){task={...task,state:{status:'scheduled',firedAt:call.body.untilIso,lastDecisionLog:`snoozed until ${call.body.untilIso} (ladder reset)`}};return {task};}
  return call.path.startsWith('/api/lifeops/scheduled-tasks')?{tasks:[task]}:read(call);
 });const app=adapterFixture(f.request);
 try{app.render();await wait(()=>app.render().cards.length===5&&!app.render().automation.loading);app.render().cards.find(card=>card.name==='Weekly review').open();const expected=protocol.scheduledSnoozeAt({record:task,status:task.state.status});app.render().automation.scheduleMore.find(action=>action.label==='10 min').run();assert.equal(f.calls.some(call=>call.method==='POST'),false);assert.match(app.render().automation.reviewPrompt,/^Snooze until /);app.render().automation.confirm();await wait(()=>app.render().automation.schedule.includes('Snoozed until ')&&!app.render().automation.busy);const mutation=f.calls.find(call=>call.path.endsWith('/snooze'));assert.ok(Math.abs(Date.parse(mutation.body.untilIso)-Date.parse(expected))<1000);assert.equal('minutes' in mutation.body,false);assert.deepEqual(task.trigger,{kind:'cron',expression:'0 8 * * *',tz:'owner_local'});}finally{app.close();await f.close();}
});

test('8am recurrence snoozes to8:10 and repairs an earlier from-now deferral',()=>{
 const now=new Date(2026,10,10,1,0).getTime(),before=new Date(2026,10,10,1,54).toISOString(),task={...schedule,trigger:{kind:'cron',expression:'0 8 * * *',tz:'owner_local'},state:{status:'scheduled',firedAt:before}};
 assert.equal(protocol.scheduledSnoozeAt({record:task,status:'snoozed'},now),new Date(2026,10,10,8,10).toISOString());
 const valid=new Date(2026,10,10,8,10).toISOString();task.state.firedAt=valid;assert.equal(protocol.scheduledSnoozeAt({record:task,status:'snoozed'},new Date(2026,10,10,8,5).getTime()),new Date(2026,10,10,8,20).toISOString());
});
