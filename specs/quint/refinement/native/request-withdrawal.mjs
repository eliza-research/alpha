import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInputs, checkTraces, qmap, qset} from '../check-traces.mjs';
import {modelTraces, plain} from './itf-replay.mjs';
import {directory, javaTraceCampaign, root} from './java.mjs';
import {withdrawalIds, withdrawalPlatform, withdrawalSource, withdrawalWorkerSource} from './request-withdrawal-platform.mjs';
import {jsonJar} from '../../../../test/fixtures/jvm-tools.mjs';

const model='NativeRequestWithdrawal', renderer='apps/app/src/runtime/local-agent.ts';
const harness='RequestWithdrawalReplay.java';
const fields=['phase','call','renderer','withdrawable','sent','withdrawnAt','answers','outcome'];
const witnesses=['WithdrawnWhileQueuedWitness','WithdrawnWhileEnrollingWitness','WithdrawnAfterDispatchHoldsWorkerWitness','LateCancellationFindsNothingWitness','QueuedBehindBusyWorkersWitness'];
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const stub=`export const Capacitor={isNativePlatform:()=>true,isPluginAvailable:()=>true,getPlatform:()=>'android',convertFileSrc:value=>value};
export function registerPlugin(name){return __ports[name]??={};} export class WebPlugin {}`;

// The original five scenario expressions are executed by Quint, including their assertions.
// Parsing their then-chain supplies commands only. Pure check steps are separately evaluated by
// that original run; the source replay still compares every state field at each check boundary.
function scenarioCommands(source,name){
 const declaration=source.match(new RegExp(`\\brun ${name} = ([\\s\\S]*?)(?=\\n  run |\\n})`));
 assert.ok(declaration,`Original scenario ${name}`);
 const commands=[{action:'init',picks:{}}],expression=declaration[1];
 for(let cursor=0;(cursor=expression.indexOf('.then(',cursor))>=0;){
  let end=cursor+6,depth=1;for(;depth&&end<expression.length;end++)depth+=expression[end]==='('?1:expression[end]===')'?-1:0;
  assert.equal(depth,0);const inner=expression.slice(cursor+6,end-1).trim();
  const matched=inner.match(/^(request|take|dispatch|transportAnswers|abort|cancelRequest)\(([123])\)$/);
  if(matched)commands.push({action:matched[1],picks:{r:Number(matched[2])}});
  else if(inner==='supersede')commands.push({action:'supersede',picks:{}});
  else {assert.ok(inner.startsWith('check('),inner);commands.push({action:'check',picks:{}});}
  cursor=end;
 }
 return commands;
}

function namedTraces(temporary){
 const source=readFileSync(join(root,`specs/quint/native/${model}.qnt`),'utf8');
 const names=[...source.matchAll(/\brun (\w+Test) =/g)].map(match=>match[1]);assert.equal(names.length,5);
 const pattern=join(temporary,'scenario-{test}-{seq}.itf.json');
 const result=spawnSync(process.execPath,[join(root,'node_modules/@informalsystems/quint/dist/src/cli.js'),'test',`specs/quint/native/${model}.qnt`,'--backend=typescript','--seed=20261112',`--out-itf=${pattern}`],{cwd:root,encoding:'utf8',timeout:120000});
 assert.equal(result.status,0,result.stdout+result.stderr);assert.match(result.stdout,/5 passing/);
 return names.map(name=>{
  const matches=readdirSync(temporary).filter(path=>path.startsWith(`scenario-${name}-`)&&path.endsWith('.itf.json'));assert.equal(matches.length,1);
  const states=JSON.parse(readFileSync(join(temporary,matches[0]),'utf8')).states;
  const commands=scenarioCommands(source,name);assert.equal(commands.length,states.length,name);
  return {name,entries:commands.map((command,index)=>({...command,state:plain(states[index].s)}))};
 });
}

/** Independent counters prevent an effect-set projection from hiding duplicate sends/answers. */
export function validateWithdrawalObservation(observation){
 assert.ok(observation.running<=2,'Two native workers');
 for(const request of [1,2,3]){
  assert.ok([0,1].includes(observation.dispatches[request]),'At most one transport dispatch');
  assert.ok([0,1].includes(observation.enrollments[request]),'At most one enrollment');
  const callback=observation.callbacks[request];
  if(callback){assert.ok(callback.resolves+callback.rejects<=1,'At most one native answer');assert.equal(observation.answers[request],callback.resolves+callback.rejects);}
  assert.equal(observation.sent.includes(request),observation.dispatches[request]===1);
  if(['queued','enrolling'].includes(observation.withdrawnAt[request]))assert.equal(observation.dispatches[request],0,'Withdrawn before dispatch never sends');
 }
}

function descriptor({action,picks}){
 if(action==='check'||action==='')return {name:'check',args:[true]};
 return {name:action,args:picks.r?[picks.r]:[]};
}
function expected(state){
 return Object.fromEntries(fields.map(field=>['s.'+field,['withdrawable','sent'].includes(field)?qset(state[field]):typeof state[field]==='object'?qmap([1,2,3].map(id=>[id,state[field][id]])):state[field]]));
}

async function rendererReplay(compiled,entries,observations){
 const requests=new Map(),cancellations=new Map(),ports={Agent:{}};let currentRequest=0,outcome='none',serial=0;
 const factory=new Function('module','exports','__ports','crypto','fetch',compiled),module={exports:{}};
 factory(module,module.exports,ports,{randomUUID(){assert.ok(currentRequest>0);return withdrawalIds[currentRequest];}},()=>{throw Error('Network outside closed fixture');});
 const {LocalAgentProtocol}=module.exports,protocol=new LocalAgentProtocol();
 ports.Agent.request=input=>{
  const id=currentRequest;assert.ok(id&&!requests.has(id),'One fresh actual renderer request');
  const entry={input,controller:controllers.get(id),settled:false,delivered:false,answers:0};requests.set(id,entry);
  return new Promise((resolve,reject)=>Object.assign(entry,{resolve,reject}));
 };
 ports.Agent.cancelRequest=input=>{
  const id=withdrawalIds.indexOf(input.cancelId);assert.ok(id>0&&!cancellations.has(id),'Actual abort emits one matching withdrawal');
  return new Promise(resolve=>cancellations.set(id,{input,resolve}));
 };
 const controllers=new Map(),trace={init:{name:'init',args:[]},steps:[]},actualStates=[];
 for(const [index,entry] of entries.entries()){
  const observation=observations[index],request=entry.picks.r;
  if(entry.action==='request'){
   const controller=new AbortController();controllers.set(request,controller);currentRequest=request;
   const promise=protocol.request('/api/status',undefined,controller.signal);currentRequest=0;
   assert.ok(requests.has(request),'Real protocol invoked native request synchronously');
   requests.get(request).promise=promise.then(value=>Object.assign(requests.get(request),{settled:true,value}),error=>Object.assign(requests.get(request),{settled:true,error}));
  }else if(entry.action==='abort'){
   const item=requests.get(request);assert.ok(item&&!item.settled,'Only a waiting caller aborts');
   item.controller.abort();await flush();assert.equal(item.error?.name,'AbortError');assert.ok(cancellations.has(request));outcome='aborted';
  }
  if(observation.eventSerial!==serial){serial=observation.eventSerial;outcome=observation.nativeOutcome;}
  // Feed only real Java callback deltas into the held Capacitor promise. Expected model values
  // never select whether a bridge promise resolves, rejects, dispatches, or gets withdrawn.
  for(const [idText,callback] of Object.entries(observation.callbacks)){
   const id=Number(idText),item=requests.get(id);assert.ok(item);assert.deepEqual(item.input,observation.inputs[id]);
   const count=callback.resolves+callback.rejects;
   if(count>item.answers){assert.equal(count,item.answers+1);item.answers=count;
    if(callback.resolves)item.resolve(callback.result);else item.reject(Object.assign(new Error(callback.reason),{code:callback.code}));}
  }
  if(entry.action==='cancelRequest'){
   const delivery=cancellations.get(request);assert.ok(delivery,'Cancellation comes from the real abort listener');
   assert.deepEqual(delivery.input,observation.cancellation.input);delivery.resolve(observation.cancellation.result);requests.get(request).delivered=true;
  }
  await flush();validateWithdrawalObservation(observation);
  const renderer=Object.fromEntries([1,2,3].map(id=>{
   const item=requests.get(id);return [id,!item?'none':item.delivered?'cancelled':item.controller.signal.aborted?'aborted':item.settled?'settled':'waiting'];
  }));
  const actual={...Object.fromEntries(fields.filter(field=>!['renderer','outcome'].includes(field)).map(field=>[field,observation[field]])),renderer,outcome};
  assert.deepEqual(actual,entry.state,`${entry.action||'stutter'} ${JSON.stringify(entry.picks)} at checkpoint ${index}`);
  actualStates.push(actual);
  const expect=expected(actual);
  if(index===0)trace.expect=expect;else trace.steps.push({label:`${index}: ${entry.action||'stutter'}`,action:descriptor(entry),expect});
 }
 // Close unfinished caller promises without dispatching any held cancel packet. All modeled
 // checkpoints are already captured; actual Java cleanup separately joins every worker.
 for(const item of requests.values())if(!item.settled)item.controller.abort();
 await flush();return {trace,actualStates};
}

export async function checkNativeRequestWithdrawal(extraSources=[]){
 const temporary=mkdtempSync(join(tmpdir(),'quint-native-withdrawal-'));
 try{
  const platform=withdrawalPlatform(temporary);
  const options={absWorkingDir:root,entryPoints:[renderer],bundle:true,platform:'node',format:'cjs',write:false,metafile:true,define:{'import.meta.env':'{}'},logLevel:'silent',
   plugins:[{name:'withdrawal-closed-platform',setup(builder){builder.onResolve({filter:/^(@capacitor\/core|\.\.\/platform-plugins)$/},args=>({path:args.path,namespace:'withdrawal-platform'}));builder.onLoad({filter:/.*/,namespace:'withdrawal-platform'},()=>({contents:stub,loader:'js'}));}}]};
  const discovery=await build(options),compiled=join(temporary,'renderer.cjs');writeFileSync(compiled,discovery.outputFiles[0].text);
  const generatedSources=[...platform.paths,compiled];
  const sources=[withdrawalSource,withdrawalWorkerSource,...Object.keys(discovery.metafile.inputs).map(path=>resolve(root,path)).filter(existsSync),
   'upstream.lock.json',fileURLToPath(import.meta.url),join(directory,'request-withdrawal-platform.mjs'),join(directory,harness),join(directory,'java.mjs'),join(directory,'Trace.java'),join(directory,'itf-replay.mjs'),...(jsonJar?[jsonJar]:[]),...generatedSources,...extraSources];
  const driverHashes=captureInputs(sources);
  const second=await build(options);assert.equal(second.outputFiles[0].text,readFileSync(compiled,'utf8'),'Executable closure unchanged after capture');
  const named=namedTraces(temporary),random=modelTraces({model,traces:32,maxSteps:30,seed:20261112,witnesses});
  const campaigns=[...named,...random.map((entries,index)=>({name:index<32?`bounded-random-${index}`:`witness-${witnesses[index-32]}`,entries}))];
  const schedules=campaigns.map(({entries},index)=>{const path=join(temporary,`commands-${index}.json`);writeFileSync(path,JSON.stringify(entries.map(({action,picks})=>({action,picks}))));return [path];});
  // The generated schedule contains commands only, never model states. Capture it before the
  // JVM reads it, preserving the original pre-execution hashes of every owning source input.
  for(const [path] of schedules){sources.push(path);generatedSources.push(path);driverHashes[path]=createHash('sha256').update(readFileSync(path)).digest('hex');}
  const observed=javaTraceCampaign(harness,[...platform.paths,withdrawalWorkerSource],schedules);
  const traces=[],actualStates=[];
  for(const [index,{name,entries}] of campaigns.entries()){
   assert.equal(observed[index].length,entries.length);const replay=await rendererReplay(readFileSync(compiled,'utf8'),entries,observed[index]);
   traces.push({...replay.trace,name});actualStates.push(...replay.actualStates);
  }
  const witnessed={
   WithdrawnWhileQueuedWitness:state=>[1,2,3].some(id=>state.withdrawnAt[id]==='queued'&&state.phase[id]==='finished'),
   WithdrawnWhileEnrollingWitness:state=>[1,2,3].some(id=>state.withdrawnAt[id]==='enrolling'&&state.phase[id]==='finished'),
   WithdrawnAfterDispatchHoldsWorkerWitness:state=>[1,2,3].some(id=>state.withdrawnAt[id]==='sent'&&state.phase[id]==='sent'),
   LateCancellationFindsNothingWitness:state=>state.outcome==='nothing-to-withdraw',
   QueuedBehindBusyWorkersWitness:state=>Object.values(state.phase).filter(phase=>['enrolling','sent'].includes(phase)).length===2&&Object.values(state.phase).includes('queued'),
  };
  for(const [name,holds] of Object.entries(witnessed))assert.ok(actualStates.some(holds),`Actual source reached ${name}`);
  // Negative oracle canaries mutate copies of genuine observations. They never feed the source,
  // become passing traces, or publish failed synthetic receipts into the strict inventory.
  const portObservation=observed.flat().find(value=>value.callbacks[1]);assert.ok(portObservation);
  const duplicateDispatch=structuredClone(portObservation);duplicateDispatch.dispatches[1]=2;
  assert.throws(()=>validateWithdrawalObservation(duplicateDispatch),/At most one transport dispatch/);
  const duplicateAnswer=structuredClone(portObservation);duplicateAnswer.callbacks[1].resolves=1;duplicateAnswer.callbacks[1].rejects=1;
  assert.throws(()=>validateWithdrawalObservation(duplicateAnswer),/At most one native answer/);
  const alteredState=structuredClone(actualStates[0]);alteredState.phase[1]='sent';
  assert.throws(()=>assert.deepEqual(alteredState,actualStates[0]),assert.AssertionError);
  // Each generated run is about 15 kB and takes the checker about two CPU-seconds to parse and type, so all 42
  // in one module left little of the fixed 120 s child deadline. Six modules of seven keep every run and bound.
  const receipt=await checkTraces({model,sources,driverHashes,generatedSources,traces,batchSize:7,scope:'bounded-orchestration',assumptions:[
   'Three fresh request ids and two real host-JVM threads execute the exact native request worker, ownership guards, withdrawal and lifecycle invalidation methods; a controlled executor selects queued work only when a slot is free.',
   'Enrollment and transport are bounded closed latches. The fixed monotonic clock excludes deadline expiry. Only admitted plain GET /api/status requests, a successful synthetic enrollment and HTTP 200 response are in this abstraction; route authorization and real server effects are not claimed.',
   'The complete bundled LocalAgentProtocol, native request helper, real AbortController and abort listener run with flags off. Each exact bridge input is matched against the Java input; only real native callback deltas settle bridge promises. Delivered cancellation means the closed bridge delivered the actual abort-generated packet, not a UI acknowledgement.',
   'All eight model fields are checked at every checkpoint, including original five named scenarios and their pure check boundaries, five independently searched witnesses and seeded bounded random schedules. Independent transport and bridge callback counts detect effects hidden by set projection.',
  ]});
  return {receipt,coverage:{namedScenarios:named.length,witnesses:Object.keys(witnessed),canaries:['duplicate-answer','duplicate-dispatch','state-mismatch']},obligations:[{model,obligation:'Android bridge, worker scheduling and external effects',reason:'Closed host-JVM and renderer ports do not establish Binder delivery, Android thread-pool fairness, enrollment credentials, HTTP/device integration or recall of an already dispatched server effect. A cancellation acknowledgement retains outcome unknown.'}]};
 }finally{rmSync(temporary,{recursive:true,force:true});}
}
