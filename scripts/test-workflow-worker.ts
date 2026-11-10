import {workerArtifactDirectory} from './local-agent-source.ts';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,cpSync,rmSync,readdirSync,lstatSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,relative} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const artifact=workerArtifactDirectory(resolve(import.meta.dirname,'..'));
const manifest=JSON.parse(readFileSync(join(artifact,'manifest.json'),'utf8'));
assert.equal(manifest.version,1);
const seen=new Set();function verify(dir: any){for(const name of readdirSync(dir)){const file=join(dir,name),stat=lstatSync(file);assert.ok(!stat.isSymbolicLink(),'Artifact must not depend on external symlinks');if(stat.isDirectory())verify(file);else{assert.ok(stat.isFile(),'Only regular artifact files are supported');const rel=relative(artifact,file);if(rel==='manifest.json')continue;assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'),manifest.files[rel],rel);seen.add(rel);}}}verify(artifact);assert.equal(seen.size,Object.keys(manifest.files).length);
const dependencies=JSON.parse(readFileSync(join(artifact,'dependencies.json'),'utf8'));
for(const name of ['smthrs','@smthrs/engine','effect','zod','react','drizzle-orm'])assert.ok(dependencies.some((pkg: any)=>pkg.name===name&&typeof pkg.version==='string'),`Missing provenance for ${name}`);
const temporary=mkdtempSync(join(tmpdir(),'alpha-workflow-worker-'));
try {
 cpSync(artifact,temporary,{recursive:true});
 writeFileSync(join(temporary,'workflow.tsx'),`/** @jsxImportSource smthrs */
import {createSmithers} from 'smthrs/create';
import {z} from 'zod';
import {appendFileSync} from 'node:fs';
const {Workflow,Task,smithers,outputs}=createSmithers({output:z.object({text:z.string()})},{dbPath:process.env.ELIZA_SMTHRS_DB_PATH});
export default smithers(()=><Workflow name="isolated-phone-worker"><Task id="supplied-text" output={outputs.output} noRetry>{async()=>{appendFileSync('executions.txt','ran\\n');return {text:'Synthetic reviewed task completed'};}}</Task></Workflow>);
`);
 writeFileSync(join(temporary,'verify.ts'),`import {Effect} from 'effect';
import {runWorkflow,approveNode,denyNode,signalRun} from 'smthrs';
import {cancelRunSubtree} from '@smthrs/engine/cancel-subtree';
import {openSmithersStore} from 'smthrs/openSmithersStore';
import workflow from './workflow.tsx';
if([approveNode,denyNode,signalRun,cancelRunSubtree,openSmithersStore].some(value=>typeof value!=='function'))throw Error('Missing control export');
const result=await Effect.runPromise(runWorkflow(workflow,{runId:process.env.RUN_ID,input:{},workflowPath:process.cwd()+'/workflow.tsx',rootDir:process.cwd(),onProgress:()=>{}}));
console.log('ALPHA_WORKER_RESULT '+JSON.stringify(result));process.exit(result.status==='finished'?0:1);
`);
 const runId=randomUUID();
 const env={PATH:process.env.PATH,HOME:temporary,TMPDIR:temporary,RUN_ID:runId,ELIZA_SMTHRS_DB_PATH:join(temporary,'runs.sqlite'),MSGPACKR_NATIVE_ACCELERATION_DISABLED:'true'};
 const invoke=()=>{const stdout=execFileSync(process.env.ALPHA_BUN||'bun',['--no-install','verify.ts'],{cwd:temporary,env,encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024});const line=stdout.split('\n').find((line: any)=>line.startsWith('ALPHA_WORKER_RESULT '));assert.ok(line,'Missing terminal result');return JSON.parse(line.slice('ALPHA_WORKER_RESULT '.length));};
 const first=invoke(),second=invoke();
 assert.equal(first.status,'finished');assert.equal(second.status,'finished');
 assert.equal(readFileSync(join(temporary,'executions.txt'),'utf8'),'ran\n');
 writeFileSync(join(temporary,'approval.tsx'),`/** @jsxImportSource smthrs */
import {createSmithers} from 'smthrs/create';
import {approvalDecisionSchema} from 'smthrs';
import {z} from 'zod';
import {appendFileSync} from 'node:fs';
const {Workflow,Sequence,Approval,Task,smithers,outputs}=createSmithers({decision:approvalDecisionSchema,output:z.object({text:z.string()})},{dbPath:process.env.ELIZA_SMTHRS_DB_PATH});
export default smithers(()=><Workflow name="isolated-approval"><Sequence><Approval id="review" output={outputs.decision} request={{title:'Approve synthetic local marker?'}}/><Task id="guarded" output={outputs.output} noRetry>{async()=>{appendFileSync(process.env.RUN_ID+'.txt','approved\\n');return {text:'Approved local marker'};}}</Task></Sequence></Workflow>);
`);
 writeFileSync(join(temporary,'signal.tsx'),`/** @jsxImportSource smthrs */
import {createSmithers} from 'smthrs/create';
import {z} from 'zod';
import {appendFileSync} from 'node:fs';
const {Workflow,Signal,Task,smithers,outputs}=createSmithers({signal:z.object({text:z.string()}),output:z.object({text:z.string()})},{dbPath:process.env.ELIZA_SMTHRS_DB_PATH});
export default smithers(()=><Workflow name="isolated-signal"><Signal id="ready" schema={outputs.signal}>{data=><Task id="consume" output={outputs.output} noRetry>{async()=>{appendFileSync(process.env.RUN_ID+'.txt',data.text+'\\n');return {text:data.text};}}</Task>}</Signal></Workflow>);
`);
 writeFileSync(join(temporary,'control.ts'),`import {Effect} from 'effect';
import {runWorkflow,approveNode,denyNode,signalRun} from 'smthrs';
import {cancelRunSubtree} from '@smthrs/engine/cancel-subtree';
import {openSmithersStore} from 'smthrs/openSmithersStore';
const runId=process.env.RUN_ID;
let result;
if(process.env.CONTROL==='run'){
 const path=process.env.FIXTURE==='signal'?'./signal.tsx':'./approval.tsx';
 const {default:workflow}=await import(path);const events=[];
 result=await Effect.runPromise(runWorkflow(workflow,{runId,input:{},workflowPath:process.cwd()+'/'+path,rootDir:process.cwd(),onProgress:event=>events.push(event)}));
 result={...result,events};
}else{
 const store=await openSmithersStore({mode:'write',backend:'sqlite',dbPath:process.env.ELIZA_SMTHRS_DB_PATH});
 try{
  if(process.env.CONTROL==='cancel')await cancelRunSubtree(store.adapter,runId);
  else if(process.env.CONTROL==='signal')await Effect.runPromise(signalRun(store.adapter,runId,'ready',{text:process.env.SIGNAL_TEXT},{receivedBy:'artifact-test'}));
  else await Effect.runPromise((process.env.CONTROL==='approve'?approveNode:denyNode)(store.adapter,runId,'review',Number(process.env.ITERATION),'Synthetic local decision','artifact-test'));
  result={status:(await Effect.runPromise(store.adapter.getRun(runId)))?.status};
 }finally{await store.cleanup();}
}
console.log('ALPHA_WORKER_RESULT '+JSON.stringify(result));process.exit(0);
`);
 const control=(runId: any,action: any,iteration: any=0,extra: any={})=>{
  const stdout=execFileSync(process.env.ALPHA_BUN||'bun',['--no-install','control.ts'],{cwd:temporary,env:{...env,...extra,RUN_ID:runId,CONTROL:action,ITERATION:String(iteration)},encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024});
  const line=stdout.split('\n').find((line: any)=>line.startsWith('ALPHA_WORKER_RESULT '));assert.ok(line,'Missing control result');return JSON.parse(line.slice('ALPHA_WORKER_RESULT '.length));
 };
 for(const action of ['approve','deny','cancel']){
  const id=randomUUID(),marker=join(temporary,id+'.txt');
  const paused=control(id,'run');assert.equal(paused.status,'waiting-approval',JSON.stringify(paused));assert.equal(existsSync(marker),false,'Guarded task ran before approval');
  const iteration=paused.events.find((event: any)=>event.nodeId==='review'&&Number.isInteger(event.iteration))?.iteration;assert.ok(Number.isInteger(iteration),'Missing durable approval iteration');
  const restored=control(id,'run');assert.equal(restored.status,'waiting-approval');assert.equal(existsSync(marker),false,'Restart bypassed approval');
  const decision=control(id,action,iteration);
  if(action==='cancel')assert.equal(decision.status,'cancelled');
  const resumed=control(id,'run');
  assert.equal(resumed.status,action==='approve'?'finished':action==='deny'?'failed':'cancelled',JSON.stringify(resumed));
  if(action==='approve'){
   assert.equal(readFileSync(marker,'utf8'),'approved\n');assert.equal(control(id,'run').status,'finished');assert.equal(readFileSync(marker,'utf8'),'approved\n','Approval replay duplicated execution');
  }else assert.equal(existsSync(marker),false,`${action} allowed guarded execution`);
 }
 const signalId=randomUUID(),signalText='Synthetic signal 🟠 '+ 'preserved '.repeat(2000)+'complete';
 const signalEnv={FIXTURE:'signal',SIGNAL_TEXT:signalText},signalMarker=join(temporary,signalId+'.txt');
 assert.equal(control(signalId,'run',0,signalEnv).status,'waiting-event');
 assert.equal(control(signalId,'run',0,signalEnv).status,'waiting-event');
 assert.equal(existsSync(signalMarker),false,'Signal wait executed early');
 control(signalId,'signal',0,signalEnv);
 assert.equal(control(signalId,'run',0,signalEnv).status,'finished');
 assert.equal(control(signalId,'run',0,signalEnv).status,'finished');
 assert.equal(readFileSync(signalMarker,'utf8'),signalText+'\n','Signal payload was lost or executed twice');
 console.log(JSON.stringify({artifact,files:seen.size,isolatedDirectory:true,completedRuns:2,taskExecutions:1,controls:['approve','deny','cancel','signal'],approvalSurvivedRestart:true,signalSurvivedRestart:true,nativeAcceptance:false}));
} finally {rmSync(temporary,{recursive:true,force:true});}
