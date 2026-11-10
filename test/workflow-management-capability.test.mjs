import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
if(!process.versions.bun&&!process.execArgv.some(value=>value==='tsx'||value==='--import=tsx')){
 const child=spawnSync(process.execPath,['--import','tsx',process.argv[1]],{stdio:'inherit',timeout:60000});
 if(child.error)throw child.error;process.exit(child.status??1);
}
const {workflowRendererFixture}=await import('../scripts/workflow-renderer-fixture.ts');
const source=fs.readFileSync('apps/app/src/prototype/workflow-adapter.ts','utf8').replace(/^import .*;\n/gm,'').replace('export function','function')+'\nglobalThis.install=installWorkflowAdapter;';
function fixture(){
 let session={sessionId:'same-id',ownerId:'first',agentId:'agent',origin:'https://synthetic.invalid'},answer=async()=>true,publications=0,statusReads=0,listReads=0;
 const controller={getSnapshot:()=>({session,open:false}),getWorkflowClient:()=>({sessionId:session.sessionId,client:{lifecycleSupported:async signal=>{statusReads++;return answer(signal);},list:async()=>{listReads++;return [];}}}),subscribe:()=>()=>{}};
 class Shell{live=true;componentDidMount(){}componentWillUnmount(){}S(){return {view:'workflows'};}vset(){publications++;}}
 const context=workflowRendererFixture({connectionController:controller,queueMicrotask,AbortController,Date,console});
 const views={workflows:{automationsManaged:true}};
 vm.runInNewContext(stripTypeScriptTypes(source,{mode:'strip'}),context);context.install(Shell,views);
 const shell=new Shell();shell.componentDidMount();
 const render=()=>views.workflows.render({},{isActive:()=>true,track:()=>'',kx:()=>'',ic:{clock:'clock',check:'check'},toast:()=>{}});
 return {probe:views.workflows.refreshManagement,removed:()=>render().managementCards.some(card=>card.name==='Removed workflows'),answer:value=>answer=value,replaceOwner:()=>{session={...session,ownerId:'replacement'};},get publications(){return publications;},get statusReads(){return statusReads;},get listReads(){return listReads;},close:()=>shell.componentWillUnmount()};
}
test('management probes only capability and withdraws unsupported or unavailable removal history',async()=>{
 const f=fixture();try{
  await f.probe(new AbortController().signal,()=>true);assert.equal(f.removed(),true);
  f.answer(async()=>false);await f.probe(new AbortController().signal,()=>true);assert.equal(f.removed(),false);
  f.answer(async()=>true);await f.probe(new AbortController().signal,()=>true);assert.equal(f.removed(),true);
  f.answer(async()=>{throw Error('Unavailable');});await assert.rejects(f.probe(new AbortController().signal,()=>true),/Unavailable/);assert.equal(f.removed(),false);
  assert.equal(f.statusReads,4);assert.equal(f.listReads,0);
 }finally{f.close();}
});
for(const retirement of ['aborted','left','owner'])test(`late management capability cannot publish after ${retirement}`,async()=>{
 const f=fixture(),abort=new AbortController();let release,current=true;
 f.answer(()=>new Promise(resolve=>release=resolve));
 try{
  const pending=f.probe(abort.signal,()=>current);
  if(retirement==='aborted')abort.abort();else if(retirement==='left')current=false;else f.replaceOwner();
  const before=f.publications;release(true);await pending;
  assert.equal(f.removed(),false);assert.equal(f.publications,before);assert.equal(f.statusReads,1);assert.equal(f.listReads,0);
 }finally{f.close();}
});
