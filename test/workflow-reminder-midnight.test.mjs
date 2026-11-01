import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';

// Execute the actual development request handler with an in-memory existing
// proposal. No account, model, native bridge, or filesystem store is started.
const source=readFileSync(new URL('../apps/app/src/browser/development-workflows.ts',import.meta.url),'utf8');
const handler=stripTypeScriptTypes(source.slice(source.indexOf('async function workflowRequest(')),{mode:'transform'});
test('a reminder read keeps its approved day when re-opened and completed after midnight',async()=>{
 const operation={type:'read_selected_reminders',window:'open_and_completed_today',day:'2026-10-29',timeZone:'UTC',maximumItems:2};
 const result={kind:'reminders',reminders:[{id:'r1',title:'Yesterday completed',dueAt:'2026-10-29T12:00:00.000Z',status:'completed',completedAt:'2026-10-29T23:59:00.000Z',revision:'a'.repeat(64)}]};
 const run={id:'11111111-1111-4111-8111-111111111111',workflowId:'w',workflowVersionId:'v',status:'waiting-approval',finished:false,stepIndex:0,proposalIds:{read:'p'},values:{},events:[],spec:{device:{installationId:'i',enrollmentId:'e'},steps:[{id:'read',kind:'Read',operation:'selected_reminders',scope:{window:operation.window,timeZone:'UTC',maximumItems:2}}]}};
 const proposal={id:'p',state:'pending',expiresAt:'2026-10-30T01:00:00.000Z',payload:{operation},receipt:{result}};
 const state={workflows:[],receipts:[],runs:[run]},identity={profile:'p'},rechecks=[];
 class AfterMidnight extends Date{static now(){return Date.parse('2026-10-30T00:01:00.000Z');}}
 const deps={Date:AfterMidnight,localStorage:{getItem:()=>JSON.stringify({kind:'development',profile:'p'})},verifyDevelopmentIdentity:async()=>{},assertDevelopmentIdentity:()=>{},editExecutionPart:async(_i,_part,_initial,edit)=>edit(state,{}),developmentProposal:()=>proposal,existingWorkflowProposal:()=>proposal,developmentCredential:()=>({installationId:'i',enrollmentId:'e'}),workflowSha:async()=> 'digest',phoneWorkflowLocalDay:()=> '2026-10-30',authorWorkflowProposal:async(_i,_id,op)=>{assert.deepEqual(op,operation);rechecks.push(op);},validateWorkflowResult:async(op,value)=>{assert.deepEqual(op,operation);assert.equal(value,result);return value;}};
 const request=new Function(...Object.keys(deps),handler+';return workflowRequest;')(...Object.values(deps));
 await request(identity,`/api/workflow/executions/${run.id}/phone-review`,undefined);
 assert.equal(rechecks.length,1,'re-opening preserves the stored proposal instead of generating the next day');
 proposal.state='completed';
 await request(identity,`/api/workflow/executions/${run.id}`,undefined);
 assert.equal(run.status,'succeeded');assert.equal(run.finished,true);assert.deepEqual(JSON.parse(run.values.read),result);assert.equal(rechecks.length,1);
});
