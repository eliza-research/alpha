import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
// AP-11 scheduled triggers at the protocol boundary. A typed workflow's local-time schedule is turned on only
// for the exact reviewed version; a scheduled run reports the occurrence it ran for, and a missed or skipped
// occurrence is presented as not run. Synthetic agent responses; no runtime, device or scheduler.
const root=resolve(import.meta.dirname,'..');
const run=script=>JSON.parse(execFileSync(process.execPath,['--import=tsx','--input-type=module','-e',script],{cwd:root,encoding:'utf8',timeout:120000}));
const prelude=`
const P=await import(${JSON.stringify(resolve(root,'apps/app/src/runtime/workflow-protocol.ts'))});
const D=await import(${JSON.stringify(resolve(root,'apps/app/src/runtime/workflow-device-contract.ts'))});
const signal=new AbortController().signal,out={};
const message=async task=>{try{await task();return '';}catch(error){return error.constructor.name+': '+error.message;}};
const weekdays={kind:'time',localTime:'07:30',timeZone:'UTC',days:[1,2,3,4,5]};
const spec={version:1,name:'Morning',description:'',trigger:weekdays,steps:[{id:'a',kind:'Read',operation:'supplied_text',text:'x'}]};
const flow=(active,versionId='v1')=>({id:'flow',name:'Morning',description:'',active,versionId,steps:[{label:'Read'}],metadata:{elizaPhoneWorkflowSpec:JSON.stringify(spec)}});
`;

test('turning a schedule on names the reviewed version, and a changed workflow is a known non-change',()=>{
 const out=run(prelude+`
const agent=(status,activate)=>{const calls=[];return {calls,client:new P.WorkflowProtocol(async(path,body)=>{calls.push({path,body});if(path==='/api/workflow/status')return {engine:'smthrs',status:'ready',...status};if(path==='/api/workflow/workflows/flow')return flow(false);if(path.endsWith('/activate'))return activate(body);throw Error(path);})};};
const exact=agent({typedScheduleProtocol:1},()=>flow(true,'v2'));out.exact=(await exact.client.activate('flow','v1',signal)).active;out.exactBody=exact.calls.find(c=>c.path.endsWith('/activate')).body;
const legacy=agent({},()=>flow(true,'v2'));await legacy.client.activate('flow','v1',signal);out.legacyBody=legacy.calls.find(c=>c.path.endsWith('/activate')).body;
const refusal={code:'WORKFLOW_ACTIVATION_NOT_APPLIED',workflowId:'flow',expectedVersionId:'v1'};
out.changed=await message(()=>agent({typedScheduleProtocol:1},()=>{throw new P.WorkflowHttpError(409,refusal);}).client.activate('flow','v1',signal));
out.otherVersion=await message(()=>agent({typedScheduleProtocol:1},()=>{throw new P.WorkflowHttpError(409,{...refusal,expectedVersionId:'v0'});}).client.activate('flow','v1',signal));
out.otherCode=await message(()=>agent({typedScheduleProtocol:1},()=>{throw new P.WorkflowHttpError(409,{error:'Manual typed workflows run only when the owner starts them'});}).client.activate('flow','v1',signal));
out.stale=await message(()=>agent({typedScheduleProtocol:1},()=>flow(true)).client.activate('flow','v0',signal));
out.supported=[await agent({typedScheduleProtocol:1}).client.typedSchedulesSupported(signal),await agent({}).client.typedSchedulesSupported(signal)];
console.log(JSON.stringify(out));`);
 assert.equal(out.exact,true);
 assert.deepEqual(out.exactBody,{expectedVersionId:'v1'});
 assert.deepEqual(out.legacyBody,{});
 assert.match(out.changed,/^WorkflowActivationRejected: This workflow changed before its schedule was turned on\. Nothing was enabled\./);
 assert.match(out.otherVersion,/^WorkflowHttpError: /);
 assert.match(out.otherCode,/^WorkflowHttpError: /);
 assert.equal(out.stale,'Error: Workflow changed. Review it again before enabling.');
 assert.deepEqual(out.supported,[true,false]);
});

test('scheduled runs report their occurrence; missed and overlapping occurrences read as not run',()=>{
 const out=run(prelude+`
const occurrence=(status)=>({scheduledAt:'2026-10-26T07:30:00.000Z',trigger:weekdays,status,text:''});
const execution=(id,input,output,extra={})=>({id,workflowId:'flow',workflowVersionId:'v2',status:'finished',startedAt:'2026-10-26T07:30:01.000Z',finished:true,input,...(output===undefined?{}:{output}),events:[],...extra});
const rows=[
 execution('ran',{typedSchedule:occurrence('ready'),scheduledAtMs:1},[{nodeId:'typed-steps',runId:'ran',text:'Done'}]),
 execution('missed',{typedSchedule:{...occurrence('missed'),text:'The scheduled time passed while the agent was not running.'}},{status:'missed',scheduledAt:'2026-10-26T07:30:00.000Z',text:'The scheduled time passed while the agent was not running.'}),
 execution('overlap',{typedSchedule:{...occurrence('overlap'),text:'An earlier run was still active.'}},{status:'overlap',scheduledAt:'2026-10-26T07:30:00.000Z',text:'An earlier run was still active.'}),
 execution('late-start',{typedSchedule:occurrence('ready')},{status:'missed',scheduledAt:'2026-10-26T07:30:00.000Z',text:'The agent stopped before this scheduled run started.'}),
 execution('manual',{},[{nodeId:'typed-steps',runId:'manual',text:'Manual'}]),
 // A generic schedule's missed occurrence is read only from the engine-written missedOccurrenceAt; a
 // workflow whose own output has the missed-record shape ran, and an unfinished or malformed marker is ignored.
 execution('generic-missed',{},{status:'missed',scheduledAt:'2026-10-26T07:30:00.000Z',text:'Not run'},{missedOccurrenceAt:'2026-10-26T07:30:00.000Z'}),
 execution('generic-forged',{},{status:'missed',scheduledAt:'2026-10-26T07:30:00.000Z',text:'Forged'}),
 execution('generic-bad-marker',{},{status:'missed',scheduledAt:'2026-10-26T07:30:00.000Z',text:'Bad marker'},{missedOccurrenceAt:'soon'}),
 execution('generic-overlap',{},{status:'overlap',scheduledAt:'2026-10-26T07:30:00.000Z',text:'Skipped'}),
];
const client=new P.WorkflowProtocol(async path=>{if(path==='/api/workflow/workflows/flow/executions')return {executions:rows};throw Error(path);});
const runs=await client.executions('flow',signal);out.rows=runs.map(r=>[r.id,r.occurrence?.status??null,r.output]);
out.bad=await message(()=>new P.WorkflowProtocol(async()=>({executions:[execution('bad',{typedSchedule:{...occurrence('ready'),status:'late'}},undefined)]})).executions('flow',signal));
console.log(JSON.stringify(out));`);
 assert.deepEqual(out.rows,[
  ['ran','ready','Done'],
  ['missed','missed','The scheduled time passed while the agent was not running.'],
  ['overlap','overlap','An earlier run was still active.'],
  ['late-start','missed','The agent stopped before this scheduled run started.'],
  ['manual',null,'Manual'],
  ['generic-missed','missed','Not run'],
  ['generic-forged',null,'Forged'],
  ['generic-bad-marker',null,'Bad marker'],
  ['generic-overlap','overlap','Skipped'],
 ]);
 assert.equal(out.bad,'PhoneWorkflowSpecError: Invalid scheduled occurrence');
});

test('a scheduled run is reviewed on the phone like a manual one, against its pinned trigger',()=>{
 const out=run(prelude+`
const device={installationId:'install-1',enrollmentId:'enroll-1'};
const reviewed={...spec,device,steps:[...spec.steps,{id:'n',kind:'Notify',operation:'app_notification',source:'a',title:'Result'}]};
const body=async(value)=>({runId:'run-1',workflowId:'flow',versionId:'v2',specDigest:await D.workflowSha(value),spec:value,status:'waiting-approval',finished:false,cancellationRequestedAt:null});
const review=await D.parseWorkflowPhoneReview(await body(reviewed),{id:'run-1',workflowId:'flow',versionId:'v2'});out.trigger=review.spec.trigger;
out.bad=await message(async()=>D.parseWorkflowPhoneReview(await body({...reviewed,trigger:{kind:'schedule',cron:'0 7 * * *'}}),{id:'run-1',workflowId:'flow',versionId:'v2'}));
console.log(JSON.stringify(out));`);
 assert.deepEqual(out.trigger,{kind:'time',localTime:'07:30',timeZone:'UTC',days:[1,2,3,4,5]});
 assert.equal(out.bad,'PhoneWorkflowSpecError: This workflow trigger is unavailable');
});

test('a scheduled time skipped by a forward clock change is named in the review text',()=>{
 const out=run(`
const A=await import(${JSON.stringify(resolve(root,'apps/app/src/runtime/phone-workflow-authoring.ts'))});
const now=Date.UTC(2027,0,15,12);const note=(localTime,timeZone,days=[0,1,2,3,4,5,6])=>A.phoneTriggerClockChangeNote({kind:'time',localTime,timeZone,days},now);
console.log(JSON.stringify({gap:note('02:30','America/New_York'),edge:note('02:00','America/New_York'),after:note('03:00','America/New_York'),before:note('01:45','America/New_York'),
 otherDays:note('02:30','America/New_York',[1,2,3,4,5]),autumnOnly:note('01:30','America/New_York'),utc:note('02:30','UTC'),london:note('01:15','Europe/London'),bad:note('02:30','Not/AZone')}));`);
 assert.equal(out.gap,'On 2027-03-14 the clock in America/New_York moves forward from 02:00 to 03:00, so 02:30 does not occur and this workflow does not run that day.');
 assert.match(out.edge,/^On 2027-03-14 .* so 02:00 does not occur/);
 assert.equal(out.after,'');
 assert.equal(out.before,'');
 assert.equal(out.otherDays,'',"the spring change is on a Sunday, which this weekday schedule never runs");
 assert.equal(out.autumnOnly,'',"a repeated autumn hour still occurs and fires once");
 assert.equal(out.utc,'');
 assert.equal(out.london,'On 2027-03-28 the clock in Europe/London moves forward from 01:00 to 02:00, so 01:15 does not occur and this workflow does not run that day.');
 assert.equal(out.bad,'');
});
