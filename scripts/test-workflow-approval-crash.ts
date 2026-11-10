/** Actual process kill at canonical-engine/PG-projection gap, isolated approval profile only. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import type { WorkflowApproval } from '../apps/app/src/runtime/workflow-protocol.ts';
import { workflowHost, writeHostReport, type ApprovalFixture, type HostProcess, type HostReport } from './fixtures/workflow-host.ts';
const host = workflowHost(47854, 'local-workflow-approvals', { timeout: 60_000 });
const {profile,expectOk: call} = host;
host.restore();
const prepare = process.argv.includes('--prepare');
const result: HostReport = {scope:'Canonical engine decision committed before wrapper projection; actual SIGKILL/restart of isolated47854; synthetic own-file only',testedAt:new Date().toISOString(),passed:false};
try{if(prepare){
 const fixture=host.read<ApprovalFixture>('approval-fixture.json'),metadata=host.read<HostProcess>('process.json');assert.equal(metadata.port,47854);assert.equal(metadata.profile,profile);const prior=await call(`/api/workflow/executions/${fixture.runId}/approvals`);const owner=prior.approvals[0].decidedBy;assert.equal(typeof owner,'string');
 const started=await call(`/api/workflow/workflows/${fixture.workflowId}/run`,{submissionId:crypto.randomUUID(),expectedVersionId:fixture.versionId,input:{}});const runId=started.execution.id;let a: WorkflowApproval | undefined;for(let i=0;i<100;i++){const r=await call(`/api/workflow/executions/${runId}/approvals`);if(r.approvals.length){a=r.approvals[0];break;}await new Promise(r=>setTimeout(r,100));}assert.ok(a, 'Expected a canonical approval');assert.equal(a.status,'pending');
 const tenant=fs.readdirSync(path.join(profile,'.eliza/smthrs')).find(id=>fs.existsSync(path.join(profile,'.eliza/smthrs',id,fixture.workflowId,'runs.sqlite')));assert.ok(tenant);
 const code=`import {controlSmithersRun} from ${JSON.stringify(path.join(metadata.source,'plugins/plugin-workflow/src/services/smithers-runtime.ts'))};const data=JSON.parse(await Bun.stdin.text());await controlSmithersRun(data.tenant,data.workflowId,{kind:'approve',runId:data.runId,nodeId:data.nodeId,iteration:data.iteration,decidedBy:data.owner});`;
 execFileSync('bun',['--conditions=eliza-source','--eval',code],{cwd:profile,input:JSON.stringify({tenant,workflowId:fixture.workflowId,runId,nodeId:a.nodeId,iteration:a.iteration,owner}),stdio:['pipe','pipe','pipe'],timeout:30000});
 const canonical=await call(`/api/workflow/executions/${runId}/approvals`);assert.equal(canonical.approvals[0].status,'approved');const projected=(await call(`/api/workflow/executions/${runId}`)).execution;assert.ok(!(projected.approvals??[]).some(p=>p.status==='approved'));assert.equal(fs.readFileSync(fixture.effect,'utf8'),'approved-effect\n');
 host.write('approval-crash.json',{...fixture,runId,a,pid:metadata.pid} satisfies ApprovalFixture);process.kill(metadata.pid,'SIGKILL');Object.assign(result,{phase:'prepare',canonicalApproved:true,projectionNotCommitted:true,effectNotRun:true,hardStop:true,passed:true});
 }else{
 const saved=host.read<ApprovalFixture>('approval-crash.json'),metadata=host.read<HostProcess>('process.json');assert.notEqual(metadata.pid,saved.pid);assert.equal(metadata.port,47854);
 const r=await call(`/api/workflow/executions/${saved.runId}/approvals`);assert.equal(r.approvals[0].status,'approved');assert.equal(r.approvals[0].requestDigest,saved.a.requestDigest);
 for(let i=0;i<120;i++){const receipt=(await call(`/api/workflow/executions/${saved.runId}`)).execution;if(receipt.finished){assert.equal(receipt.status,'finished');break;}await new Promise(r=>setTimeout(r,250));}
 assert.equal(fs.readFileSync(saved.effect,'utf8'),'approved-effect\napproved-effect\n');const duplicate=await call(`/api/workflow/executions/${saved.runId}/approvals/${saved.a.nodeId}/${saved.a.iteration}`,{approved:true,expectedVersionId:saved.versionId,requestDigest:saved.a.requestDigest});assert.equal(duplicate.approvals[0].status,'approved');assert.equal(fs.readFileSync(saved.effect,'utf8'),'approved-effect\napproved-effect\n');Object.assign(result,{phase:'verify',newProcess:true,canonicalReceiptSurvived:true,sameDigest:true,guardedEffectExactlyOnce:true,duplicateDecisionNoEffect:true,passed:true});
 }
}catch(e){result.error=e instanceof Error ? e.message : String(e);}
writeHostReport('test-results/workflow-approvals', prepare ? 'crash-prepare.json' : 'crash-verify.json', result);
