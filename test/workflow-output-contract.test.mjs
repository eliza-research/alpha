import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
// Pure workflow output contracts: an execution receipt shows only the typed final text, and a typed
// presentation review binds the exact steps, title, device and run before any notice or speech. No runtime.
const root=resolve(import.meta.dirname,'..');
const run=script=>JSON.parse(execFileSync(process.execPath,['-e',script],{cwd:root,encoding:'utf8',timeout:120000}));
const prelude=`
const P=await import(${JSON.stringify(resolve(root,'apps/app/src/runtime/workflow-protocol.ts'))});
const A=await import(${JSON.stringify(resolve(root,'apps/app/src/runtime/phone-workflow-authoring.ts'))});
const D=await import(${JSON.stringify(resolve(root,'apps/app/src/runtime/workflow-device-contract.ts'))});
const out={};
const message=async task=>{try{await task();return '';}catch(error){return error.constructor.name+': '+error.message;}};
`;

test('execution receipts present typed final text without intermediate inputs or JSON quoting',()=>{
 const out=run(prelude+`
const read=async output=>(await new P.WorkflowProtocol(async()=>({execution:{id:'run',workflowId:'flow',workflowVersionId:'version',status:'finished',startedAt:'2026-10-03T00:00:00Z',finished:true,events:[],output}})).receipt('run','flow',new AbortController().signal)).output;
out.typed=await read([{nodeId:'typed-steps',runId:'run',iteration:0,text:'Final draft\\nSecond line',steps:[{text:'PRIVATE INTERMEDIATE'}]}]);
out.plain=await read('Plain output');
out.generic=await read([{nodeId:'other',text:'Generic data',count:2}]);
out.otherRun=await read([{nodeId:'typed-steps',runId:'different',text:'Do not unwrap'}]);
out.long=await read([{nodeId:'typed-steps',runId:'run',text:'x'.repeat(5000),steps:[]}]);
console.log(JSON.stringify(out));`);
 assert.equal(out.typed,'Final draft\nSecond line');
 assert.equal(out.plain,'Plain output');
 assert.equal(out.generic,JSON.stringify([{nodeId:'other',text:'Generic data',count:2}]));
 assert.equal(out.otherRun,JSON.stringify([{nodeId:'typed-steps',runId:'different',text:'Do not unwrap'}]));
 assert.equal(out.long,'x'.repeat(4000));
});

test('typed presentation review binds exact steps, title, device and run before any effect',()=>{
 const out=run(prelude+`
const device={installationId:'fixture-device',enrollmentId:'fixture-enrollment'};
const spec={version:1,name:'Presentation',description:'',trigger:{kind:'manual'},device,steps:[{id:'input',kind:'Read',operation:'supplied_text',text:'Synthetic result'},{id:'notice',kind:'Notify',operation:'app_notification',source:'input',title:'Exact title'},{id:'speech',kind:'Speak',operation:'read_aloud',source:'input'}]};
const expected={id:'run',workflowId:'workflow',versionId:'version'};
const envelope=async s=>({...expected,runId:'run',spec:s,specDigest:await D.workflowSha(s),status:'waiting-approval',finished:false,cancellationRequestedAt:null});
const review=await D.parseWorkflowPhoneReview(await envelope(spec),expected);
const binding={runId:'run',workflowId:'workflow',versionId:'version',stepId:'notice',specDigest:review.specDigest};
const notice={type:'post_notification',title:'Exact title',body:'Synthetic result'},speech={type:'speak_text',text:'Synthetic result'};
out.kinds=A.normalizePhoneSpec(spec).steps.map(s=>s.kind);
out.notice=await message(()=>D.assertWorkflowOperation(review,binding,device,notice));
out.speech=await message(()=>D.assertWorkflowOperation(review,{...binding,stepId:'speech'},device,speech));
const step=(id,change)=>({...spec,steps:spec.steps.map(s=>s.id===id?{...s,...change}:s)});
for(const [name,bad] of Object.entries({noDevice:{...spec,device:undefined},noticeAsWrite:step('notice',{kind:'Write'}),laterSource:step('speech',{source:'later'}),injectedText:step('speech',{text:'Injected'}),longTitle:step('notice',{title:'x'.repeat(201)}),nulTitle:step('notice',{title:'bad\\0title'})}))out['spec.'+name]=await message(async()=>D.parseWorkflowPhoneReview(await envelope(bad),expected));
out['spec.wrongDigest']=await message(async()=>D.parseWorkflowPhoneReview({...await envelope(spec),specDigest:'0'.repeat(64)},expected));
for(const [name,bad] of Object.entries({otherTitle:{...notice,title:'Different title'},longBody:{...notice,body:'x'.repeat(2001)},nulBody:{...notice,body:'bad\\0text'},extraField:{...notice,extra:'payload'},speechAtNotice:speech}))out['op.'+name]=await message(()=>D.assertWorkflowOperation(review,binding,device,bad));
for(const [name,bad] of Object.entries({otherRun:{...binding,runId:'other'},otherStep:{...binding,stepId:'speech'},otherDigest:{...binding,specDigest:'0'.repeat(64)}}))out['binding.'+name]=await message(()=>D.assertWorkflowOperation(review,bad,device,notice));
out.retiredEnrollment=await message(()=>D.assertWorkflowOperation(review,binding,{...device,enrollmentId:'retired'},notice));
for(const [name,text] of Object.entries({long:'x'.repeat(5001),empty:'',nul:'bad\\0text'}))out['speak.'+name]=await message(()=>D.assertWorkflowOperation(review,{...binding,stepId:'speech'},device,{type:'speak_text',text}));
console.log(JSON.stringify(out));`);
 assert.deepEqual(out.kinds,['Read','Notify','Speak']);
 assert.equal(out.notice,'');assert.equal(out.speech,'');
 assert.equal(out['spec.noDevice'],'PhoneWorkflowSpecError: A verified phone enrollment is required');
 assert.equal(out['spec.noticeAsWrite'],'PhoneWorkflowSpecError: This workflow operation is unavailable');
 assert.equal(out['spec.laterSource'],'PhoneWorkflowSpecError: Choose an earlier step as the input');
 assert.equal(out['spec.injectedText'],'PhoneWorkflowSpecError: Unsupported workflow field');
 for(const key of ['spec.longTitle','spec.nulTitle'])assert.equal(out[key],'PhoneWorkflowSpecError: Complete the workflow text fields within their stated limits',key);
 // Every operation, binding or enrollment mismatch fails closed with the same scope error.
 const scoped=['spec.wrongDigest','op.otherTitle','op.longBody','op.nulBody','op.extraField','op.speechAtNotice','binding.otherRun','binding.otherStep','binding.otherDigest','retiredEnrollment','speak.long','speak.empty','speak.nul'];
 for(const key of scoped)assert.equal(out[key],'WorkflowDeviceScopeError: Workflow phone scope could not be verified',key);
});
