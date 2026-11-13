import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const script=`
const c=await import(${JSON.stringify(resolve(root,'apps/app/src/runtime/workflow-device-contract.ts'))});
const route={scope:'a'.repeat(64),origin:'https://agent.invalid',ownerId:'owner',agentId:'agent',workflowId:'flow',runId:'run-1',versionId:'v1'};
const one=await c.workflowApprovalNotice(route,'proposal-1'),again=await c.workflowApprovalNotice(route,'proposal-1'),other=await c.workflowApprovalNotice(route,'proposal-2'),otherRun=await c.workflowApprovalNotice({...route,runId:'run-2'},'proposal-1'),otherVersion=await c.workflowApprovalNotice({...route,versionId:'v2'},'proposal-1');
let rejected=false;try{await c.workflowApprovalNotice(route,'');}catch{rejected=true;}
console.log(JSON.stringify({one,again,other,otherRun,otherVersion,rejected}));`;
test('approval notice identities are opaque, stable per approval and bound to the exact run route',()=>{
 const out=JSON.parse(execFileSync(process.execPath,['-e',script],{cwd:root,encoding:'utf8',timeout:scaledTimeout(120000)}));
 assert.match(out.one.id,/^approval-[a-f0-9]{64}$/);assert.match(out.one.bindingHash,/^[a-f0-9]{64}$/);
 assert.deepEqual(out.again,out.one);
 assert.notEqual(out.other.id,out.one.id);assert.notEqual(out.otherRun.id,out.one.id);
 assert.equal(out.otherVersion.id,out.one.id,'one notice per approval ID');assert.notEqual(out.otherVersion.bindingHash,out.one.bindingHash,'a changed route is refused natively');
 assert.ok(!JSON.stringify(out.one).includes('run-1')&&!JSON.stringify(out.one).includes('proposal'));
 assert.equal(out.rejected,true);
});
