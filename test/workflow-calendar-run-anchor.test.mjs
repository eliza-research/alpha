import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';

const root=resolve(import.meta.dirname,'..');
const run=`
import assert from 'node:assert/strict';
import {WorkflowProtocol} from './apps/app/src/runtime/workflow-protocol.ts';
import {assertWorkflowOperation,workflowSha} from './apps/app/src/runtime/workflow-device-contract.ts';
import {phoneWorkflowRequiredProtocol} from './.eliza/client-features/packages/contracts/src/phone-workflow.ts';

const device={installationId:'phone-x',enrollmentId:'enrollment-x'};
const identity={id:'run-x',workflowId:'workflow-x',versionId:'version-x'};
const signal=new AbortController().signal;
const anchor='2027-03-15T03:55:00.000Z';
const afterMidnight=Date.parse('2027-03-15T04:20:00Z');
const zone='America/New_York';
const relative={calendarIds:['owner-calendar'],days:1,timeZone:zone,maximumEvents:42};
const absolute={calendarIds:relative.calendarIds,start:'2027-03-14T05:00:00.000Z',end:'2027-03-15T04:00:00.000Z',timeZone:zone,maximumEvents:42};
const priorRead={type:'read_calendar_range',...absolute};
const todayRead={...priorRead,start:absolute.end,end:'2027-03-16T04:00:00.000Z'};

async function fetchReview(range,calendarAnchorAt){
 const spec={version:1,name:'Calendar window',description:'',trigger:{kind:'manual'},device,steps:[{id:'read',kind:'Read',operation:'calendar_range',range}]};
 const specDigest=await workflowSha(spec);
 const client=new WorkflowProtocol(async(path,body,received)=>{
  assert.equal(path,'/api/workflow/executions/run-x/phone-review');
  assert.equal(body,undefined);
  assert.equal(received,signal);
  return {runId:identity.id,workflowId:identity.workflowId,versionId:identity.versionId,spec,specDigest,
   status:'waiting-approval',finished:false,cancellationRequestedAt:null,...(calendarAnchorAt===undefined?{}:{calendarAnchorAt})};
 });
 const review=await client.phoneReview(identity,signal);
 return {review,binding:{runId:identity.id,workflowId:identity.workflowId,versionId:identity.versionId,stepId:'read',specDigest}};
}
const anchored=await fetchReview(relative,anchor);
assert.equal(anchored.review.calendarAnchorAt,anchor);
assert.equal(phoneWorkflowRequiredProtocol(anchored.review.spec),5);
assert.equal((Date.parse(absolute.end)-Date.parse(absolute.start))/3600000,23);
assert.doesNotThrow(()=>assertWorkflowOperation(anchored.review,anchored.binding,device,priorRead,afterMidnight));
for(const read of [todayRead,{...priorRead,calendarIds:['foreign-calendar']},{...priorRead,maximumEvents:43}]){
 assert.throws(()=>assertWorkflowOperation(anchored.review,anchored.binding,device,read,afterMidnight));
}
assert.throws(()=>assertWorkflowOperation(anchored.review,anchored.binding,{...device,enrollmentId:'retired'},priorRead,afterMidnight));
await assert.rejects(fetchReview(relative,'2027-03-15'));

const legacy=await fetchReview(relative);
assert.equal(legacy.review.calendarAnchorAt,undefined);
assert.doesNotThrow(()=>assertWorkflowOperation(legacy.review,legacy.binding,device,priorRead,Date.parse('2027-03-15T04:05:00Z')));
assert.throws(()=>assertWorkflowOperation(legacy.review,legacy.binding,device,priorRead,afterMidnight));
const fixed=await fetchReview(absolute);
assert.equal(phoneWorkflowRequiredProtocol(fixed.review.spec),1);
assert.doesNotThrow(()=>assertWorkflowOperation(fixed.review,fixed.binding,device,priorRead,afterMidnight));
assert.throws(()=>assertWorkflowOperation(fixed.review,fixed.binding,device,todayRead,afterMidnight));
const fall=await fetchReview({...relative,days:7},'2027-11-06T12:00:00.000Z');
const fallRead={...priorRead,start:'2027-11-06T04:00:00.000Z',end:'2027-11-13T05:00:00.000Z'};
assert.equal((Date.parse(fallRead.end)-Date.parse(fallRead.start))/3600000,169);
assert.doesNotThrow(()=>assertWorkflowOperation(fall.review,fall.binding,device,fallRead,Date.parse('2027-11-08T12:00:00Z')));
console.log('PASS anchored, legacy and fixed Calendar review');
`;
test('Alpha phone review checks the exact persisted Calendar run day across midnight and DST',()=>{
 assert.match(execFileSync(process.execPath,['-e',run],{
  cwd:root,encoding:'utf8',timeout:scaledTimeout(60000),
 }),/^PASS anchored, legacy and fixed Calendar review/);
});
