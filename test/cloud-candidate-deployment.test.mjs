// A candidate Cloud deployment (ALPHA_CLOUD_DEPLOYMENT_FILE): the product can be built and its
// operator tools run against its own Cloud for development and cutover rehearsal, while every
// distributed build stays on the shipped policy. Also the local standalone Cloud's pure helpers.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {checkCloudDeployment,deploymentOutputs,storageFingerprint,STORAGE_NAMESPACES} from '../scripts/cloud-deployment.ts';
import {CLOUD_DEPLOYMENT,CLOUD_DEPLOYMENT_IS_CANDIDATE,SHIPPED_CLOUD_DEPLOYMENT} from '../scripts/cloud-deployment-policy.ts';
import {cloudSdkBases} from '../scripts/cloud-sdk-authority.ts';
import {auditWebBundle,STAGING_CLOUD_TEXT,DENYLIST} from '../scripts/audit-production-bundle.ts';
import {leakedElizaHost,localRegistration,LOCAL_CLOUD} from '../scripts/local-cloud.ts';

const candidate={
 production:{api:'https://api.cloud.example.org',web:'https://cloud.example.org',services:'https://services.cloud.example.org',tenant:'examplecloud',name:'Example Cloud',entitlementAudience:'example-phone'},
 staging:{api:'https://api-staging.cloud.example.org',web:'https://staging.cloud.example.org',services:'https://services-staging.cloud.example.org',tenant:'examplecloud-staging',name:'Example Cloud',entitlementAudience:'example-phone'},
};
const withTemp=run=>{const temp=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-cloud-candidate-'));try{return run(temp);}finally{fs.rmSync(temp,{recursive:true,force:true});}};
const write=(directory,outputs)=>{for(const [file,contents] of Object.entries(outputs)){fs.mkdirSync(path.dirname(path.join(directory,file)),{recursive:true});fs.writeFileSync(path.join(directory,file),contents);}};
const env=file=>({...process.env,ALPHA_CLOUD_DEPLOYMENT_FILE:file});

test('without a candidate file every tool uses the shipped deployment and its installed credential namespace',()=>{
 assert.equal(CLOUD_DEPLOYMENT_IS_CANDIDATE,false);
 assert.equal(CLOUD_DEPLOYMENT,SHIPPED_CLOUD_DEPLOYMENT);
 assert.equal(storageFingerprint(SHIPPED_CLOUD_DEPLOYMENT),STORAGE_NAMESPACES.at(-1),'installed phones keep their sign-in');
 checkCloudDeployment();
});

test('a candidate deployment builds with its own namespace and never with a shipped one',()=>withTemp(temp=>{
 write(temp,deploymentOutputs(candidate));
 const options={config:candidate,sdkBases:cloudSdkBases(candidate)};
 // The same configuration as a shipped build is refused until a migration is reviewed.
 assert.throws(()=>checkCloudDeployment(temp,{...options,candidate:false}),/Cloud storage namespace would change/);
 checkCloudDeployment(temp,{...options,candidate:true});
 const outputs=Object.values(deploymentOutputs(candidate)).join('\n');
 assert.ok(outputs.includes('cloud-deployment:'+storageFingerprint(candidate)+':'));
 assert.ok(!outputs.includes(STORAGE_NAMESPACES.at(-1)),'a candidate build cannot read a shipped build\'s credentials');
 assert.equal(leakedElizaHost(outputs),null,'no generated authority names a deployed Eliza Cloud');
 // A candidate file that repeats a shipped deployment is not a candidate.
 write(temp,deploymentOutputs(SHIPPED_CLOUD_DEPLOYMENT));
 assert.throws(()=>checkCloudDeployment(temp,{config:SHIPPED_CLOUD_DEPLOYMENT,candidate:true}),/must differ from every shipped deployment/);
}));

test('the candidate file reaches the operator registration and cannot pass the committed build check',()=>withTemp(temp=>{
 const file=path.join(temp,'candidate.json');
 fs.writeFileSync(file,JSON.stringify(candidate));
 const registration=spawnSync(process.execPath,['scripts/cloud-readiness.ts','registration','--json'],{encoding:'utf8',env:env(file)});
 assert.equal(registration.status,0,registration.stderr);
 const printed=JSON.parse(registration.stdout);
 assert.equal(printed.registration.api,candidate.production.api);
 assert.equal(printed.registration.tenant,candidate.production.tenant);
 assert.equal(printed.registration.callback,candidate.production.web+'/alphaphone/auth/callback');
 assert.equal(leakedElizaHost(registration.stdout),null,'the operator values for a candidate Cloud name no Eliza host');
 // The committed generated authorities are the shipped ones: a candidate build has to regenerate them, visibly.
 const check=spawnSync(process.execPath,['scripts/cloud-deployment.ts','--check'],{encoding:'utf8',env:env(file)});
 assert.notEqual(check.status,0);
 assert.match(check.stderr,/Stale Cloud deployment output/);
 // An invalid candidate fails at generation, before any build.
 fs.writeFileSync(file,JSON.stringify({...candidate,production:{...candidate.production,api:'http://api.cloud.example.org'}}));
 const invalid=spawnSync(process.execPath,['scripts/cloud-deployment.ts','--check'],{encoding:'utf8',env:env(file)});
 assert.notEqual(invalid.status,0);
 assert.match(invalid.stderr,/canonical HTTPS origins|Invalid Cloud API origin/);
}));

test('the production bundle audit refuses a candidate Cloud build and derives staging hosts from the policy',()=>withTemp(temp=>{
 fs.writeFileSync(path.join(temp,'index.html'),'<!doctype html><title>Alpha Phone</title>');
 fs.writeFileSync(path.join(temp,'build-flags.json'),JSON.stringify({testMocks:false}));
 assert.deepEqual(auditWebBundle(temp,{candidateCloud:false}).errors.filter(error=>error.includes('candidate')),[]);
 assert.ok(auditWebBundle(temp,{candidateCloud:true}).errors.some(error=>error.includes('candidate Cloud deployment')));
 assert.deepEqual([...STAGING_CLOUD_TEXT],[new URL(SHIPPED_CLOUD_DEPLOYMENT.staging.api).host,new URL(SHIPPED_CLOUD_DEPLOYMENT.staging.services).host,new URL(SHIPPED_CLOUD_DEPLOYMENT.staging.web).host+'/alphaphone',SHIPPED_CLOUD_DEPLOYMENT.staging.tenant]);
 for(const entry of STAGING_CLOUD_TEXT)assert.ok(DENYLIST.includes(entry),entry);
}));

test('the local standalone Cloud carries its own identity and detects a leaked Eliza host',()=>{
 assert.equal(leakedElizaHost(LOCAL_CLOUD),null);
 const identity=JSON.parse(fs.readFileSync('app.config.json','utf8'));
 assert.deepEqual(localRegistration('https://127.0.0.1:8787'),{clientId:identity.appId,environment:'staging',redirectUri:'https://127.0.0.1:8787/alphaphone/auth/callback'});
 for(const [text,host] of [['{"url":"https://api.eliza.app/x"}','api.eliza.app'],['see cloud.eliza.app/billing','cloud.eliza.app'],['https://ELIZA.APP','eliza.app'],['mail login@eliza.app','eliza.app'],['https://www.elizacloud.ai','www.elizacloud.ai']])
  assert.equal(leakedElizaHost(text),host,text);
 for(const text of ['https://eliza.application.example','provider elizacloud','https://noteliza.app.example','alphacloud-local'])assert.equal(leakedElizaHost(text),null,text);
});
