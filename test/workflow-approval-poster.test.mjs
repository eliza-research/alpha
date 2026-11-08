import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';
const bundle=await build({stdin:{contents:"export {createWorkflowApprovalPoster,definiteNoticeFailure} from './.eliza/client-features/packages/contracts/src/workflow-approval-poster.ts';export {workflowApprovalNotice} from './apps/app/src/runtime/workflow-device-contract.ts';",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
const {createWorkflowApprovalPoster,workflowApprovalNotice,definiteNoticeFailure}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const owner={scope:'scope',origin:'https://agent.invalid',ownerId:'owner',agentId:'agent'};
const flow={id:'flow',name:'Digest',description:'',active:true,versionId:'v1',steps:[],phoneSpec:{trigger:{kind:'manual'},steps:[]}};
const run={id:'run',workflowId:'flow',versionId:'v1',status:'waiting-approval',finished:false,startedAt:'',events:[]};
const route=(identity,r)=>({...owner,ownerId:identity==='a'?'owner':'other',workflowId:r.workflowId,runId:r.id,versionId:r.versionId});
function fixture(){
 const agent={pending:[{id:'proposal',expiresAt:Date.now()+60_000}],runs:[run],flows:[flow],fail:null,identity:'a',current:true};
 const posted=[],withdrawn=[],calls={pendingForWorkflow:0};let queue=Promise.resolve(),hold=false;const queued=[];
 const session=()=>{const identity=agent.identity;return identity?{identity,current:()=>agent.current&&agent.identity===identity,route:r=>route(identity,r),
  list:async()=>agent.flows,executions:async()=>{if(agent.fail)throw agent.fail;return agent.runs;},phoneReview:async r=>({runId:r.id,workflowId:r.workflowId,versionId:r.versionId,finished:false}),
  pending:async()=>agent.pending,pendingForWorkflow:()=>{calls.pendingForWorkflow++;throw Error('No executable review');}}:null;};
 const poster=createWorkflowApprovalPoster({session,native:()=>({postWorkflowApprovalNotice:async input=>{posted.push(input);return {status:'posted'};},withdrawWorkflowApprovalNotice:async({id})=>{withdrawn.push(id);}}),enqueue:work=>{if(hold)queued.push(work);else queue=queue.then(work).catch(()=>{});},changed:()=>{}});
 return {agent,posted,withdrawn,calls,poster,holdQueue(){hold=true;},queued,async flushQueue(){hold=false;for(const work of queued.splice(0))await work();}};
}
test('an agent-started waiting run with no open receipt posts one redacted notice under the shared identity',async()=>{
 const {posted,poster,calls}=fixture();await poster.poll(true);
 const expected=await workflowApprovalNotice(route('a',run),'proposal');
 assert.equal(posted.length,1);assert.deepEqual(Object.keys(posted[0]).sort(),['bindingHash','expiresAt','id','route']);
 assert.equal(posted[0].id,expected.id);assert.equal(posted[0].bindingHash,expected.bindingHash);assert.equal(calls.pendingForWorkflow,0);
 assert.equal(poster.waiting('a','flow'),true);assert.equal(poster.waiting('b','flow'),false);
});
test('a settled proposal withdraws its notice; a transient read failure keeps it',async()=>{
 const {agent,posted,withdrawn,poster}=fixture();await poster.poll(true);
 agent.fail=Object.assign(Error('offline'),{status:503});await poster.poll(true);assert.deepEqual(withdrawn,[]);assert.equal(poster.waiting('a','flow'),true,'an unreadable workflow keeps showing Waiting for you');
 agent.fail=null;agent.pending=[];await poster.poll(true);
 assert.deepEqual(withdrawn,[posted[0].id]);assert.equal(poster.waiting('a','flow'),false);
 await poster.poll(true);assert.equal(withdrawn.length,1,'a withdrawn notice is not withdrawn again');
});
test('nothing is posted for another owner or once the session is no longer current',async()=>{
 const {agent,posted,withdrawn,poster}=fixture();
 agent.current=false;await poster.poll(true);assert.equal(posted.length,0);
 agent.current=true;await poster.poll(true);assert.equal(posted.length,1);
 agent.identity='b';agent.pending=[];await poster.poll(true);
 assert.equal(posted.length,1);assert.deepEqual(withdrawn,[],'another owner never withdraws or reposts the first owner\'s notice');assert.equal(poster.waiting('a','flow'),false);
 agent.identity=null;await poster.poll(true);assert.equal(posted.length,1);
});

test('queued stale-owner reconciliation makes no native withdrawal or post',async()=>{
 const f=fixture();await f.poster.poll(true);
 f.holdQueue();f.agent.pending=[];
 const pending=f.poster.poll(true);
 for(let i=0;i<30&&!f.queued.length;i++)await Promise.resolve();
 assert.equal(f.queued.length,1);
 f.agent.identity='b';await f.flushQueue();await pending;
 assert.deepEqual(f.withdrawn,[]);assert.equal(f.posted.length,1);
});
test('transient identity text keeps an existing waiting notice',async()=>{
 const f=fixture();await f.poster.poll(true);
 f.agent.fail=Object.assign(Error('identity service temporarily unavailable'),{status:503});
 await f.poster.poll(true);assert.deepEqual(f.withdrawn,[]);assert.equal(f.poster.waiting('a','flow'),true);
 assert.equal(definiteNoticeFailure(Error('enrollment lookup mismatch during retry')),false);
 assert.equal(definiteNoticeFailure({status:404}),true);
});
test('an older waiting run survives a current definition without phone steps',async()=>{
 const f=fixture();await f.poster.poll(true);
 f.agent.flows=[{...flow,versionId:'v2',phoneSpec:null}];await f.poster.poll(true);
 assert.deepEqual(f.withdrawn,[]);assert.equal(f.poster.waiting('a','flow'),true);
 assert.equal(f.posted.at(-1).route.versionId,'v1');
});
test('a known waiting run is checked even after its definition leaves the list',async()=>{
 const f=fixture();await f.poster.poll(true);f.agent.flows=[];
 await f.poster.poll(true);assert.deepEqual(f.withdrawn,[]);assert.equal(f.poster.waiting('a','flow'),true);
 f.agent.runs=[];await f.poster.poll(true);assert.deepEqual(f.withdrawn,[f.posted[0].id]);
});
