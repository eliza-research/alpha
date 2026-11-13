import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {stripTypeScriptTypes} from '../../../../test/support/strip-types.mjs';
import {captureInputs, checkTraces} from '../check-traces.mjs';

const root=fileURLToPath(new URL('../../../../',import.meta.url));
const driver=fileURLToPath(import.meta.url);
const action=(name,...args)=>({name,args});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
// Bun runs a hundred immediates in well under a millisecond, before an off-thread digest can answer, so the bound is also a wall-clock one.
async function wait(ready){const deadline=Date.now()+5000;for(let i=0;i<100||Date.now()<deadline;i++){if(ready())return;await tick();}throw Error('Actual workflow source did not reach the selected boundary');}
const common=['upstream.lock.json','.eliza/client-features/.source.json','scripts/prepare-client-features.ts','test/support/strip-types.mjs',driver];

async function prepared(extraSources,entry,implementation,transform){
 const sources=[...common,...extraSources,implementation];let hashes=captureInputs(sources);
 const compile=()=>build({stdin:{contents:entry,resolveDir:root,loader:'ts'},bundle:true,write:false,metafile:true,format:'esm',platform:'node',define:{'import.meta.env':'{}'},logLevel:'silent'});
 const bundle=await compile();
 sources.push(...Object.keys(bundle.metafile.inputs).filter(path=>existsSync(join(root,path))));
 const before=captureInputs(sources);for(const [path,hash]of Object.entries(hashes))assert.equal(before[path],hash,'Source changed during dependency compilation: '+path);hashes=before;
 const bound=await compile();
 assert.deepEqual(Object.keys(bound.metafile.inputs).sort(),Object.keys(bundle.metafile.inputs).sort(),'Workflow dependency graph changed after capture');
 assert.equal(bound.outputFiles[0].text,bundle.outputFiles[0].text,'Workflow dependency bytes changed after capture');
 const after=captureInputs(sources);for(const [path,hash]of Object.entries(hashes))assert.equal(after[path],hash,'Workflow dependency changed before execution: '+path);
 const directory=mkdtempSync(join(tmpdir(),'alpha-workflow-source-'));
 const deps=join(directory,'dependencies.mjs'),code=join(directory,'observed-source.js');
 writeFileSync(deps,bundle.outputFiles[0].contents);
 writeFileSync(code,stripTypeScriptTypes(transform(readFileSync(join(root,implementation),'utf8')),{mode:'strip'}));
 sources.push(deps,code);Object.assign(hashes,captureInputs([deps,code]));
 try{return {sources,hashes,generated:[deps,code],code:readFileSync(code,'utf8'),deps:await import(deps),close:()=>rmSync(directory,{recursive:true,force:true})};}
 catch(error){rmSync(directory,{recursive:true,force:true});throw error;}
}

const authoringEntry=`export * from './apps/app/src/runtime/workflow-local-time.ts';
export {normalizePhoneSpec,assertPhoneCapabilities,describePhoneTrigger,phoneTriggerClockChangeNote} from './apps/app/src/runtime/phone-workflow-authoring.ts';
export {workflowSha,workflowBytes} from './apps/app/src/runtime/workflow-device-contract.ts';
export {WorkflowTypedRejected} from './apps/app/src/runtime/workflow-protocol.ts';
export {checkWorkflowScope,WORKFLOW_OPERATION_LABELS} from './.eliza/client-features/packages/contracts/src/workflow-scope.ts';
export {projectNoteForModel} from './.eliza/client-features/plugins/plugin-notes/src/types.ts';`;

function authoringFixture(p,mutant){
 let code=p.code;
 if(mutant==='pending-edit'){
  const needle='if(locked()||!draft)return;run();';assert.ok(code.includes(needle));code=code.replace(needle,'if(!draft)return;run();');
 }
 const records=new Map(),calls=[],minted=[],saved=[];
 let fail=false,holdWrites=false,writeGate=deferred(),writeEntered=false;
 const catalog={catalogRevision:'catalog',compilerRevision:'compiler',maximumSteps:32,maximumSpecBytes:100000,triggers:[{kind:'manual',available:true}],palette:[{kind:'Read',operations:[{id:'supplied_text',available:true}]}]};
 const storage={async secureRead({slot}){return {value:records.get(slot)??null};},async secureCompareExchange(input){
  if(holdWrites){writeEntered=true;await writeGate.promise;}if(fail)throw Error('Synthetic secure storage refused');
  if((records.get(input.slot)??null)!==input.expectedValue)return {status:'conflict'};
  records.set(input.slot,input.value);return {status:'saved'};
 }};
 const client={async phoneCatalog(){return catalog;},async validatePhone(spec){return {spec:p.deps.normalizePhoneSpec(spec),specDigest:await p.deps.workflowSha(spec)};},
  savePhone(spec,cap,pending,signal){const row={...deferred(),spec:structuredClone(spec),pending:structuredClone(pending),signal};calls.push(row);
   assert.ok([...records.values()].some(raw=>raw&&JSON.parse(raw).pending?.mutationId===pending.mutationId),'A save reached the client before its identity was durably accepted by the closed storage port');return row.promise;},
  async phoneSaveReceipt(){return null;}};
 const box=vm.createContext({...p.deps,AbortController,TextEncoder,console,document:{hidden:false},browserLocalAgentEnabled:true,browserDevProfile:false,testMocksEnabled:false,developmentWorkflowDraftStore:storage,registerPlugin:()=>({}),
  crypto:{randomUUID(){const id='00000000-0000-4000-8000-'+String(minted.length+1).padStart(12,'0');minted.push(id);return id;}},
  connectionController:{getWorkflowClient:()=>({sessionId:'session',client}),getSnapshot:()=>({session:{origin:'https://synthetic.invalid',ownerId:'owner',agentId:'agent'},open:false}),getWorkflowDeviceTarget:()=>null}});
 vm.runInContext(code,box);const actual=box.createWorkflowAuthoring(()=>({toast(){}}),()=>{},async id=>saved.push(id));
 const api={ic:{},get:()=>({})};
 const inspect=()=>box.observeAuthoring();
 return {actual,calls,minted,saved,records,catalog,
  async open(){await actual.open({id:'flow',name:'Draft',versionId:'v1',phoneSpec:{version:1,name:'Draft',description:'',trigger:{kind:'manual'},steps:[{id:'s1',kind:'Read',operation:'supplied_text',text:'input'}]}});await tick();},
  observe(){const v=inspect(),pending=v.draft?.pending;return {'s.draft':!!v.draft,'s.spec':Number(v.draft?.spec.name.match(/^Edit (\d)$/)?.[1]??0),'s.pending':pending?minted.indexOf(pending.mutationId)+1:0,'s.minted':minted.length,'s.busy':v.busy,'s.unreceipted':v.unreceipted,'s.resendReview':v.resendReview,'s.storageFailed':!!v.storage?.failed,'s.discardAsk':v.discard,'s.committed':saved.length>0};},
  edit(value){actual.render(api).onName({target:{value:'Edit '+value}});},
  save(){return actual.render(api).save();},recover(){return actual.render(api).refresh();},resend(){return actual.render(api).resend();},discard(){return actual.render(api).discard();},
  async unknown(){calls.at(-1).reject(Error('Synthetic transport has no answer'));await tick();},
  async refused(){calls.at(-1).reject(new p.deps.WorkflowTypedRejected('Changed'));await tick();},
  failWrites(){fail=true;},holdWrites(){holdWrites=true;},writeEntered:()=>writeEntered,releaseWrites(){holdWrites=false;writeGate.resolve();},
  close(){for(const call of calls)call.reject(Error('Fixture closed'));actual.close();},
 };
}

/** Local authoring custody only: the agent's save/application algorithm is deliberately not observed. */
export async function checkWorkflowAuthoring(extraSources=[],options={}){
 const implementation='apps/app/src/prototype/workflow-authoring.ts';
 const p=await prepared(extraSources,authoringEntry,implementation,text=>{
  const seam=' return {get active(){return active;},open,close,render,flushForAppUpdate};';assert.ok(text.includes(seam));
  return text.replace(/^import .*;\n/gm,'').replaceAll('export function','function').replace(seam,' globalThis.observeAuthoring=()=>({draft,busy,unreceipted,resendReview,storage,discard,review});\n'+seam)+'\nglobalThis.createWorkflowAuthoring=createWorkflowAuthoring;';
 });
 const traces=[];
 try{
  for(const mode of ['review-edit','pending-unknown','exact-resend','refusal','discard','failed-storage']){
   const f=authoringFixture(p,options.mutant);await f.open();const t={name:'actual authoring '+mode,expect:f.observe(),steps:[]};
   const point=(label,actions)=>t.steps.push({label,action:actions,expect:f.observe()});
   try{
    if(mode==='discard'){await f.discard();point('first discard only reviews',action('discardTap'));await f.discard();point('confirmed discard clears private draft',action('discardTap'));}
    else if(mode==='failed-storage'){f.failWrites();f.edit(1);await tick();point('actual refused storage locks edited bytes',[action('edit'),action('storageFails')]);f.edit(2);await tick();assert.equal(f.observe()['s.spec'],1,'Storage failure must lock edits');}
    else {
     f.edit(1);await tick();point('actual local edit',action('edit'));
     await f.save();point('first save reviews without sending',action('saveTap'));assert.equal(f.calls.length,0);
     if(mode==='review-edit'){f.edit(2);await tick();point('edit after review requires a fresh review',action('edit'));await f.save();point('review new exact bytes',action('saveTap'));}
     else {
      f.holdWrites();const task=f.save();await wait(f.writeEntered);assert.equal(f.calls.length,0,'Identity storage must finish before dispatch');f.releaseWrites();await wait(()=>f.calls.length===1);point('pending identity is stored before held client dispatch',action('saveTap'));
      const durable=JSON.parse([...f.records.values()].find(Boolean));assert.equal(durable.pending.mutationId,f.calls[0].pending.mutationId);
      f.edit(2);await tick();assert.equal(f.observe()['s.spec'],1,'Pending save must lock draft editing');
      if(mode==='refusal'){await f.refused();await task;point('typed refusal unlocks exact non-save',[action('agentChange'),action('refusalReply')]);f.edit(2);await tick();point('edit after known refusal',action('edit'));}
      else {await f.unknown();await task;point('unknown reply retains identity',action('unknownReply',true));
       await f.recover();point('receipt-only refresh enables explicit resend',action('recover',true));assert.equal(f.calls.length,1);
       if(mode==='exact-resend'){await f.resend();point('first resend asks for confirmation',action('resendTap'));const repeat=f.resend();await wait(()=>f.calls.length===2);point('confirmed resend retains original identity',action('resendTap'));assert.deepEqual(f.calls[1].pending,f.calls[0].pending);assert.deepEqual(f.calls[1].spec,f.calls[0].spec);await f.unknown();await repeat;point('second unknown answer remains locked',action('unknownReply',true));}
       await f.discard();assert.equal(f.observe()['s.draft'],true,'Pending identity cannot be discarded');
      }
     }
    }
    traces.push(t);
   }finally{f.close();}
  }
  return await checkTraces({model:'WorkflowAuthoring',sources:p.sources,driverHashes:p.hashes,generatedSources:p.generated,traces,scope:'bounded-orchestration',assumptions:[
   'The complete unchanged Alpha authoring function and real normalization, capability, digest and scope helpers execute. The sole source seam reads closure state. Six local custody schedules use one typed read-only manual workflow, actual draft CAS calls and held transport promises.',
   'The observed projection is local draft presence/name equality class, pending identity, actual UUID mint count, busy/recovery/confirmation/storage flags and the real saved callback. Agent application, deduplication, wire delivery, receipt validation and saves/applied counters are not observed or established by these controlled client ports.',
   'Secure storage is a synthetic compare-exchange port, not Android Keystore or physical crash durability. Full compiler changes, restart, successful remote save and arbitrary concurrent authoring/storage interleavings remain separate obligations.',
  ]});
 }finally{p.close();}
}

const noticeEntry=`export {resolveWorkflowTap,readyTapStep,tapRecheck} from './apps/app/src/runtime/workflow-device-contract.ts';
export {WorkflowIntentStore,storageWorkflowIntentBackend} from './.eliza/client-features/packages/contracts/src/workflow-intents.ts';`;

function noticeFixture(p,mutant){
 let code=p.code;
 if(mutant==='forget-opened-tap'){const needle='openedTap=result.token;';assert.ok(code.includes(needle));code=code.replace(needle,'openedTap=null;');}
 const queued=[],storage=new Map();let ledger='new',question=false,opens=0,failConsume=false,hold,readCalls=0,consumeCalls=0;
 const session={origin:'https://synthetic.invalid',ownerId:'owner',agentId:'agent'},scope='scope';
 const tap={token:'tap',scope,...session,workflowId:'flow',runId:'run',versionId:'v1',retained:true,operationId:'operation',bindingHash:'b'.repeat(64)};
 const localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)};
 const native={async pendingWorkflowTap(){readCalls++;const current=hold;if(current)await current.promise;return ledger==='pending'?{...tap,question}:{};},async consumeWorkflowTap(){consumeCalls++;if(failConsume)throw Error('Synthetic consume refused');ledger='consumed';return {};}};
 const client={async receipt(){return {id:'run',workflowId:'flow',versionId:'v1',finished:true,status:'completed'};},async detail(){return {id:'flow',versionId:'v1',name:'Flow'};}};
 class RealIntentStore extends p.deps.WorkflowIntentStore{constructor(owner){super(owner,{backend:p.deps.storageWorkflowIntentBackend({getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},'',()=>[...storage.keys()])});}}
 const owner={live:true,S:()=>({view:'workflows'}),toast(){},openView(){opens++;}};
 const box=vm.createContext({...p.deps,WorkflowIntentStore:RealIntentStore,localStorage,AbortController,queueMicrotask:fn=>queued.push(fn),registerPlugin:()=>native,Capacitor:{isNativePlatform:()=>true},
  connectionController:{getWorkflowClient:()=>({scope,sessionId:'session',client}),getSnapshot:()=>({session,open:false})},alphaClient:{getState:()=>({context:{sensitive:false}})},document:{hidden:false},
  owner,authoring:{active:false,close(){}},publish(){},reviewWorkflowNoticeQuestion(){throw Error('Question review is outside this bounded run-tap campaign');}});
 vm.runInContext(code,box);
 return {readCalls:()=>readCalls,consumeCalls:()=>consumeCalls,opens:()=>opens,
  observe(){const v=box.inspect();return {'s.ledger':ledger,'s.question':question,'s.tapBusy':v.tapBusy,'s.tapRequested':!!v.tapRequested,'s.tapDeferred':v.tapDeferred,'s.noticeQuestion':!!v.noticeQuestion,'s.openedTap':!!v.openedTap,'s.runOpen':!!v.receipt,'s.opens':opens};},
  tap(){ledger='pending';question=false;},hold(){hold=deferred();},check(){return box.checkNotice('event');},release(){hold?.resolve();hold=null;},fail(value){failConsume=value;},async flush(){while(queued.length){queued.shift()();await tick();}},
  foreignAccount(){storage.set('alpha.workflow.run-accounts.v1',JSON.stringify([{owner:JSON.stringify([session.origin,session.ownerId,session.agentId]),account:'foreign-account',workflowId:tap.workflowId,runId:tap.runId}]));},
 };
}

/** Exact run-tap handler with real authenticated resolver and real owner intent-store load. */
export async function checkWorkflowNoticeTaps(extraSources=[],options={}){
 const implementation='apps/app/src/prototype/workflow-adapter.ts';
 const p=await prepared(extraSources,noticeEntry,implementation,text=>{
  const start=text.indexOf(" let tapBusy=false"),end=text.indexOf(' const dismissTap=',start);assert.ok(start>=0&&end>start);
  const ownershipStart=text.indexOf("const RUN_ACCOUNTS='"),ownershipEnd=text.indexOf('/** Existing remote workflows only;',ownershipStart);
  const accountStart=text.indexOf(' const runAccounts=workflowRunAccounts();'),accountEnd=text.indexOf(' /** The runs the signed-in account may see.',accountStart);
  assert.ok(ownershipStart>=0&&ownershipEnd>ownershipStart&&accountStart>=0&&accountEnd>accountStart,'Exact durable run ownership helper and receiver declarations');
  const prefix="let noticeQuestion,editor=null,operation=null,generation=0,detail=null,detailSession=null,receipt=null,runs=[],phase='idle',intentStore=null,phoneReview=null,phoneSteps=[],phoneConfirm=null,phoneStatus='',approvalReceipt=null,approvalReview=null,reviewRun=false,reviewActivation=false,reviewCancel=false;\n";
  return text.slice(ownershipStart,ownershipEnd)+prefix+text.slice(accountStart,accountEnd)+text.slice(start,end)+'\nglobalThis.checkNotice=checkNotice;globalThis.inspect=()=>({tapBusy,tapRequested,tapDeferred,noticeQuestion,openedTap,receipt});';
 });
 const traces=[];
 try{
  for(const mode of ['consume-success','failed-consume-retry','event-while-reading']){
   const f=noticeFixture(p,options.mutant),t={name:'actual notification run tap '+mode,expect:f.observe(),steps:[]};
   const point=(label,actions)=>t.steps.push({label,action:actions,expect:f.observe()});
   f.tap();point('closed native ledger records owner tap',action('userTap',false));f.hold();const pending=f.check();await wait(()=>f.readCalls()===1);point('actual handler starts authenticated pending read',action('checkNotice'));
   if(mode==='event-while-reading'){await f.check();point('second event requests one read after the first',[action('wakeEvent'),action('checkNotice')]);}
   f.fail(mode==='failed-consume-retry');f.release();await pending;point('actual open and consume result',action('resolveDone',mode!=='failed-consume-retry'));
   if(mode==='event-while-reading'){await f.flush();point('queued repeat sees no pending tap',[action('checkNotice'),action('resolveDone',true)]);}
   if(mode==='failed-consume-retry'){
    for(const consumed of [false,true]){f.fail(!consumed);f.hold();const retry=f.check();await tick();point('retry reads the same retained tap',[action('wakeEvent'),action('checkNotice')]);f.release();await retry;point('retry consumes without reopening',action('resolveDone',consumed));assert.equal(f.opens(),1,'Failed consume must not reopen a run');}
   }
   assert.equal(f.opens(),1);assert.ok(f.consumeCalls()>=1);traces.push(t);
  }
  // This separate source-only privacy probe is not projected into a successful model action.
  const foreign=noticeFixture(p);foreign.foreignAccount();foreign.tap();await foreign.check();
  const privacyProbe={opens:foreign.opens(),consumeCalls:foreign.consumeCalls(),ledger:foreign.observe()['s.ledger'],runOpen:foreign.observe()['s.runOpen']};
  assert.deepEqual(privacyProbe,{opens:0,consumeCalls:0,ledger:'pending',runOpen:false},'Actual durable foreign-account ownership retains the tap');
  const receipt=await checkTraces({model:'WorkflowNoticeTaps',sources:p.sources,driverHashes:p.hashes,generatedSources:p.generated,traces,scope:'bounded-orchestration',assumptions:[
   'The exact complete Alpha checkNotice function and its real authenticated resolveWorkflowTap/readyTapStep/tapRecheck dependencies execute. The owner intent store is the real shared store over closed memory storage. The extraction only supplies outer renderer variables and a read-only closure seam.',
   'Three non-question run-tap schedules observe the closed native ledger, handler concurrency flags, real run receipt presence, remembered token and independently counted shell opens/consume calls. The native notification ledger is a controlled port; Android tap delivery, account authority and physical durable consume are separate.',
   'A separate source-only probe seeds the real run-account storage with a foreign account and requires no shell open or consume while retaining the tap. It is not projected as a successful model resolve action. Question DOM review/compose/cancel, operation and view-generation races, other absent/foreign/stale-version taps, process restart and arbitrary event schedules remain unobserved obligations. The source campaign does not establish the entire model or installed notification behavior.',
  ]});
  return {...receipt,partialSourcePrivacyProbe:privacyProbe};
 }finally{p.close();}
}
