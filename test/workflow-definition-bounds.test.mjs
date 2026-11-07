import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
// MVP-32 at the protocol boundary: generated candidates stay inside the reviewed bounds, a typed workflow
// carries only the manual trigger or a reviewed local-time trigger (shared upstream contract), migrated or
// unreadable definitions never take the list down, and a retained submission can be repeated only under its
// own identity. Synthetic agent responses; no runtime.
const root=resolve(import.meta.dirname,'..');
const run=script=>JSON.parse(execFileSync(process.execPath,['--import=tsx','--input-type=module','-e',script],{cwd:root,encoding:'utf8',timeout:120000}));
const prelude=`
const P=await import(${JSON.stringify(resolve(root,'apps/app/src/runtime/workflow-protocol.ts'))});
const A=await import(${JSON.stringify(resolve(root,'apps/app/src/runtime/phone-workflow-authoring.ts'))});
const D=await import(${JSON.stringify(resolve(root,'apps/app/src/runtime/workflow-device-contract.ts'))});
const signal=new AbortController().signal,out={};
const message=async task=>{try{await task();return '';}catch(error){return error.constructor.name+': '+error.message;}};
const catalogBody={specVersion:1,generationProtocol:1,catalogRevision:'c1',compilerRevision:'k1',maximumSteps:32,maximumSpecBytes:65536,triggers:[{kind:'manual',available:true},{kind:'schedule',available:false,reason:'Schedules are available only for reviewed digests.'}],palette:[{kind:'Read',operations:[{id:'supplied_text',available:true}]},{kind:'Write',operations:[{id:'compose_draft',available:true},{id:'model_draft',available:true}]}]};
const catalog=A.parsePhoneCatalog(catalogBody);
const base={version:1,name:'Generated',description:'',trigger:{kind:'manual'},steps:[{id:'a',kind:'Read',operation:'supplied_text',text:'x'},{id:'b',kind:'Write',operation:'compose_draft',source:'a',prefix:'',suffix:''}]};
const answer=async spec=>({spec,specDigest:await D.workflowSha(A.normalizePhoneSpec(spec)),catalogRevision:'c1',compilerRevision:'k1',active:false});
`;

test('a generated candidate outside the reviewed bounds is rejected before it can be reviewed',()=>{
 const out=run(prelude+`
const generate=(respond,operations=['supplied_text','compose_draft'],prompt='Draft an agenda')=>message(()=>new P.WorkflowProtocol(async path=>{if(path!=='/api/workflow/phone/generate')throw Error(path);return respond();}).generatePhone(prompt,catalog,operations,signal));
out.valid=await generate(()=>answer(base));
out.schedule=await generate(async()=>({...await answer(base),spec:{...base,trigger:{kind:'schedule',cron:'0 7 * * *'}}}));
out.extraTriggerField=await generate(async()=>({...await answer(base),spec:{...base,trigger:{kind:'manual',cron:'0 7 * * *'}}}));
out.unknownOperation=await generate(async()=>({...await answer(base),spec:{...base,steps:[...base.steps,{id:'c',kind:'Send',operation:'send_email',source:'b',to:'someone@example.com'}]}}));
out.unofferedOperation=await generate(()=>answer({...base,steps:[base.steps[0],{id:'b',kind:'Write',operation:'model_draft',source:'a',instruction:'Summarize'}]}));
out.addedSchedule=await generate(()=>answer({...base,trigger:{kind:'time',localTime:'07:30',timeZone:'UTC',days:[1,2,3,4,5]}}));
out.tooManySteps=await generate(()=>({spec:{...base,steps:Array.from({length:33},(_,i)=>({id:'s'+i,kind:'Read',operation:'supplied_text',text:'x'}))},specDigest:'0',catalogRevision:'c1',compilerRevision:'k1',active:false}));
out.oversized=await generate(async()=>({...await answer(base),padding:'x'.repeat(80000)}));
out.active=await generate(async()=>({...await answer(base),active:true}));
out.wrongDigest=await generate(async()=>({...await answer(base),specDigest:'f'.repeat(64)}));
out.wrongCompiler=await generate(async()=>({...await answer(base),compilerRevision:'k2'}));
out.addedDevice=await generate(()=>answer({...base,device:{installationId:'install-1',enrollmentId:'enroll-1'}}));
out.addedReadScope=await generate(()=>answer({...base,device:{installationId:'install-1',enrollmentId:'enroll-1'},steps:[{id:'a',kind:'Read',operation:'selected_notes',notes:[]},base.steps[1]]}),['selected_notes','compose_draft']);
out.emptyPrompt=await generate(()=>answer(base),undefined,'   ');out.longPrompt=await generate(()=>answer(base),undefined,'x'.repeat(4001));
out.noGenerator=await message(()=>new P.WorkflowProtocol(async()=>{throw Error('must not be requested');}).generatePhone('Draft',A.parsePhoneCatalog({...catalogBody,generationProtocol:undefined}),['supplied_text'],signal));
out.clarify=await message(()=>new P.WorkflowProtocol(async()=>{throw new P.WorkflowHttpError(422,{error:'Workflow needs clarification: Which notes?'});}).generatePhone('Draft',catalog,['supplied_text'],signal));
console.log(JSON.stringify(out));`);
 assert.equal(out.valid,'');
 assert.equal(out.schedule,'PhoneWorkflowSpecError: This workflow trigger is unavailable');
 assert.equal(out.extraTriggerField,'PhoneWorkflowSpecError: Unsupported workflow field');
 assert.equal(out.unknownOperation,'PhoneWorkflowSpecError: This workflow operation is unavailable');
 assert.equal(out.unofferedOperation,'Error: Generated draft changed the available device or operations');
 // A schedule is owner-set; a generated draft that adds one is refused before review.
 assert.equal(out.addedSchedule,'Error: Generated draft changed when this workflow runs');
 assert.equal(out.tooManySteps,'PhoneWorkflowSpecError: Add between 1 and 32 steps');
 assert.equal(out.oversized,'Error: Generated draft exceeds the response limit');
 for(const key of ['active','wrongDigest','wrongCompiler'])assert.equal(out[key],'Error: Agent validation changed the reviewed workflow',key);
 assert.match(out.addedDevice,/Generated draft changed the available device or operations|A verified phone enrollment is required|Invalid/);
 assert.notEqual(out.addedReadScope,'');
 assert.equal(out.emptyPrompt,'Error: Describe the workflow in 1–4000 characters');assert.equal(out.longPrompt,'Error: Describe the workflow in 1–4000 characters');
 assert.equal(out.noGenerator,'Error: Typed generation is unavailable on this agent');
 assert.equal(out.clarify,'Error: Workflow needs clarification: Which notes?');
});

test('a typed workflow carries the manual trigger or a reviewed local time, and the agent must offer it',()=>{
 const out=run(prelude+`
const weekdays={kind:'time',localTime:'07:30',timeZone:'Europe/Paris',days:[1,2,3,4,5]};
out.manual=A.normalizePhoneSpec(base).trigger;out.time=A.normalizePhoneSpec({...base,trigger:weekdays}).trigger;
out.describe=[A.describePhoneTrigger(weekdays),A.describePhoneTrigger({kind:'manual'})];
for(const [name,trigger] of Object.entries({schedule:{kind:'schedule'},cron:{kind:'cron',expression:'* * * * *'},event:{kind:'event'},legacyTime:{kind:'time',t:7},unordered:{...weekdays,days:[5,1]},noDays:{...weekdays,days:[]},badZone:{...weekdays,timeZone:'Mars/Olympus'},badTime:{...weekdays,localTime:'7:30'},missing:undefined}))out[name]=await message(async()=>A.normalizePhoneSpec({...base,trigger}));
out.noManual=await message(async()=>A.assertPhoneCapabilities(A.normalizePhoneSpec(base),A.parsePhoneCatalog({...catalogBody,triggers:[{kind:'manual',available:false,reason:'Paused'},{kind:'time',available:true}]})));
out.scheduleOnly=await message(async()=>A.assertPhoneCapabilities(A.normalizePhoneSpec(base),A.parsePhoneCatalog({...catalogBody,triggers:[{kind:'time',available:true}]})));
out.timeUnoffered=await message(async()=>A.assertPhoneCapabilities(A.normalizePhoneSpec({...base,trigger:weekdays}),catalog));
out.timeOffered=await message(async()=>A.assertPhoneCapabilities(A.normalizePhoneSpec({...base,trigger:weekdays}),A.parsePhoneCatalog({...catalogBody,triggers:[{kind:'manual',available:true},{kind:'time',available:true,label:'At a set local time'}]})));
console.log(JSON.stringify(out));`);
 assert.deepEqual(out.manual,{kind:'manual'});
 assert.deepEqual(out.time,{kind:'time',localTime:'07:30',timeZone:'Europe/Paris',days:[1,2,3,4,5]});
 assert.deepEqual(out.describe,['Weekdays at 07:30 (Europe/Paris)','Only when you choose Run now']);
 for(const name of ['schedule','cron','event'])assert.equal(out[name],'PhoneWorkflowSpecError: This workflow trigger is unavailable',name);
 assert.equal(out.legacyTime,'PhoneWorkflowSpecError: Unsupported workflow field');
 for(const name of ['unordered','noDays','badZone','badTime'])assert.equal(out[name],'PhoneWorkflowSpecError: Choose a local time, a valid time zone and at least one day',name);
 assert.notEqual(out.missing,'');
 for(const name of ['noManual','scheduleOnly','timeUnoffered'])assert.equal(out[name],'PhoneWorkflowSpecError: Agent capabilities changed. Review the available steps again.',name);
 assert.equal(out.timeOffered,'');
});

test('migrated and unreadable definitions stay listed; only a readable typed definition is offered the typed editor',()=>{
 const out=run(prelude+`
const flow=(id,metadata)=>({id,name:'Flow '+id,description:'',active:false,versionId:'v-'+id,steps:[{label:'Step'}],...(metadata?{metadata}:{})});
const flows=[flow('typed',{elizaPhoneWorkflowSpec:JSON.stringify(base)}),flow('legacy'),flow('broken',{elizaPhoneWorkflowSpec:'{"version":1,"name":'}),flow('scalar',{elizaPhoneWorkflowSpec:'null'}),flow('array',{elizaPhoneWorkflowSpec:'[]'}),flow('huge',{elizaPhoneWorkflowSpec:JSON.stringify({...base,description:'x'.repeat(70000)})}),flow('scheduled',{elizaPhoneWorkflowSpec:JSON.stringify({...base,trigger:{kind:'schedule'}})}),flow('timed',{elizaPhoneWorkflowSpec:JSON.stringify({...base,trigger:{kind:'time',localTime:'06:00',timeZone:'UTC',days:[0,6]}})}),flow('hosted',{elizaPhoneWorkflowSpec:JSON.stringify(base),elizaHostedDigestV1:'{}'})];
const client=new P.WorkflowProtocol(async path=>{if(path==='/api/workflow/status')return {engine:'smthrs',status:'ready'};if(path==='/api/workflow/workflows')return {workflows:flows};throw Error(path);});
const listed=await client.list(signal);out.ids=listed.map(row=>row.id);out.typed=listed.filter(row=>row.phoneSpec!==undefined).map(row=>row.id);out.hosted=listed.filter(row=>row.hostedDigest).map(row=>row.id);
out.editable=[];for(const row of listed){if(row.phoneSpec===undefined)continue;try{A.normalizePhoneSpec(row.phoneSpec);out.editable.push(row.id);}catch{}}
console.log(JSON.stringify(out));`);
 assert.deepEqual(out.ids,['typed','legacy','broken','scalar','array','huge','scheduled','timed','hosted']);
 assert.deepEqual(out.typed,['typed','scheduled','timed','hosted']);
 assert.deepEqual(out.hosted,['hosted']);
 // A migrated definition with an unsupported trigger is listed but cannot enter the typed editor; a reviewed local-time trigger can.
 assert.deepEqual(out.editable,['typed','timed','hosted']);
});

test('a retained submission is repeated only under its own identity and reviewed version',()=>{
 const out=run(prelude+`
const id='11111111-1111-4111-8111-111111111111',calls=[];let mode='ok';
const execution=(version='v1')=>({id:'run-1',workflowId:'flow',workflowVersionId:version,status:'queued',startedAt:'2026-10-10T00:00:00.000Z',finished:false,events:[]});
const client=new P.WorkflowProtocol(async(path,body)=>{calls.push({path,body});if(path==='/api/workflow/status')return {engine:'smthrs',status:'ready',...(mode==='legacy'?{}:{manualSubmissionProtocol:1})};
 if(mode==='refused')throw new P.WorkflowHttpError(409,{code:'WORKFLOW_VERSION_NOT_ADMITTED',workflowId:'flow',submissionId:body.submissionId,expectedVersionId:body.expectedVersionId});
 if(mode==='conflict')throw new P.WorkflowHttpError(409,{error:'Submission key already bound to another request'});
 return {submissionId:mode==='other-id'?'22222222-2222-4222-8222-222222222222':body.submissionId,execution:execution(mode==='other-version'?'v2':'v1')};});
out.ok=(await client.resubmit('flow','v1',id,signal)).id;out.sent=calls.filter(call=>call.path.endsWith('/run')).map(call=>call.body);
for(const next of ['refused','conflict','other-id','other-version','legacy']){mode=next;out[next]=await message(()=>client.resubmit('flow','v1',id,signal));}
mode='ok';const before=calls.length;out.badId=await message(()=>client.resubmit('flow','v1','not-a-uuid',signal));out.badIdRequests=calls.slice(before).filter(call=>call.path.endsWith('/run')).length;
console.log(JSON.stringify(out));`);
 assert.equal(out.ok,'run-1');
 assert.deepEqual(out.sent,[{input:{},submissionId:'11111111-1111-4111-8111-111111111111',expectedVersionId:'v1'}]);
 assert.match(out.refused,/^WorkflowAdmissionRejected: /);
 assert.match(out.conflict,/^WorkflowHttpError: /);
 assert.equal(out['other-id'],'Error: Submission identity mismatch');
 assert.equal(out['other-version'],'Error: Execution identity or reviewed version changed');
 assert.equal(out.legacy,'Error: Agent does not support submission reconciliation');
 assert.equal(out.badId,'Error: Invalid retained submission');assert.equal(out.badIdRequests,0);
});

test('only the agent’s refusal of this exact typed edit is a known non-save',()=>{
 const out=run(prelude+`
const expected={mutationId:'33333333-3333-4333-8333-333333333333',specDigest:'d',compilerRevision:'k1',workflowId:'flow',versionId:'v1'};
const save=(status,body,target=expected)=>message(()=>new P.WorkflowProtocol(async()=>{throw new P.WorkflowHttpError(status,body);}).savePhone(A.normalizePhoneSpec(base),catalog,target,signal));
const refusal={code:'WORKFLOW_TYPED_NOT_APPLIED',workflowId:'flow',mutationId:expected.mutationId,expectedVersionId:'v1'};
out.exact=await save(409,refusal);
out.otherWorkflow=await save(409,{...refusal,workflowId:'other'});out.otherMutation=await save(409,{...refusal,mutationId:'44444444-4444-4444-8444-444444444444'});out.otherVersion=await save(409,{...refusal,expectedVersionId:'v0'});
out.otherStatus=await save(500,refusal);out.otherCode=await save(409,{...refusal,code:'WORKFLOW_KEY_CONFLICT'});
out.create=await save(409,refusal,{mutationId:expected.mutationId,specDigest:'d',compilerRevision:'k1'});
out.network=await message(()=>new P.WorkflowProtocol(async()=>{throw new TypeError('Failed to fetch');}).savePhone(A.normalizePhoneSpec(base),catalog,expected,signal));
console.log(JSON.stringify(out));`);
 assert.match(out.exact,/^WorkflowTypedRejected: This workflow changed on the agent before your edit was saved\. Nothing was saved\.$/);
 for(const key of ['otherWorkflow','otherMutation','otherVersion','otherStatus','otherCode','create'])assert.match(out[key],/^WorkflowHttpError: /,key);
 assert.equal(out.network,'TypeError: Failed to fetch');
});
