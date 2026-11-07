import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';
const bundle=await build({stdin:{contents:"export {createWorkflowApprovalPoster} from './apps/app/src/runtime/workflow-device-contract.ts';export {workflowApprovalNotice} from './apps/app/src/runtime/workflow-device-contract.ts';",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
const {createWorkflowApprovalPoster,workflowApprovalNotice}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const owner={scope:'scope',origin:'https://agent.invalid',ownerId:'owner',agentId:'agent'};
const flow={id:'flow',name:'Digest',description:'',active:true,versionId:'v1',steps:[],phoneSpec:{trigger:{kind:'manual'},steps:[]}};
const run={id:'run',workflowId:'flow',versionId:'v1',status:'waiting-approval',finished:false,startedAt:'',events:[]};
const route=(identity,r)=>({...owner,ownerId:identity==='a'?'owner':'other',workflowId:r.workflowId,runId:r.id,versionId:r.versionId});
function fixture(){
 const agent={pending:[{id:'proposal',expiresAt:Date.now()+60_000}],runs:[run],fail:null,identity:'a',current:true};
 const posted=[],withdrawn=[],calls={pendingForWorkflow:0};let queue=Promise.resolve();
 const session=()=>agent.identity?{identity:agent.identity,current:()=>agent.current,route:r=>route(agent.identity,r),
  list:async()=>[flow],executions:async()=>{if(agent.fail)throw agent.fail;return agent.runs;},phoneReview:async r=>({runId:r.id,workflowId:r.workflowId,versionId:r.versionId,finished:false}),
  pending:async()=>agent.pending,pendingForWorkflow:()=>{calls.pendingForWorkflow++;throw Error('No executable review');}}:null;
 const poster=createWorkflowApprovalPoster({session,native:()=>({postWorkflowApprovalNotice:async input=>{posted.push(input);return {status:'posted'};},withdrawWorkflowApprovalNotice:async({id})=>{withdrawn.push(id);}}),enqueue:work=>{queue=queue.then(work).catch(()=>{});},changed:()=>{}});
 return {agent,posted,withdrawn,calls,poster};
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
