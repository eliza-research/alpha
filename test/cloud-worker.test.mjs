import {spawnSync} from 'node:child_process';
// The product's own Cloud API Worker is described by data: the app's Cloud policy rows plus the
// operator's resource ids (scripts/cloud-worker.ts). The app and its Cloud share one identity.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {workerDeployment,WORKER_SECRETS} from '../scripts/cloud-worker.ts';
import {SHIPPED_CLOUD_DEPLOYMENT} from '../scripts/cloud-deployment-policy.ts';
import {leakedElizaHost} from '../scripts/local-cloud.ts';

const policy=JSON.parse(fs.readFileSync('cloud/policy.example.json','utf8'));
const resources=JSON.parse(fs.readFileSync('cloud/resources.example.json','utf8'));
const identity=JSON.parse(fs.readFileSync('app.config.json','utf8'));

test('the Worker deployment takes every authority from the app policy and every id from the operator',()=>{
 const deployment=workerDeployment(policy,resources);
 assert.equal(deployment.id,identity.slug+'-cloud');
 assert.deepEqual(Object.keys(deployment.environments).sort(),['production','staging']);
 for(const environment of ['production','staging']){
  const row=policy[environment],ids=resources[environment],worker=deployment.environments[environment];
  assert.deepEqual(worker.origins,{web:row.web,app:row.services,api:row.api});
  assert.equal(worker.tenantId,row.tenant);
  assert.equal(worker.serviceName,row.name);
  assert.deepEqual(worker.entitlement,{issuer:row.api,audience:row.entitlementAudience});
  assert.equal(worker.billingUrl,row.services+'/cloud/billing');
  assert.deepEqual(worker.routes,[{pattern:new URL(row.api).host+'/*',zone:ids.zone},{pattern:ids.blobHost+'/*',zone:ids.zone}]);
  assert.equal(worker.accountId,ids.accountId);
  assert.equal(worker.resources.hyperdriveId,ids.hyperdriveId);
  const [callback]=worker.components.web.nativeAuthCallbacks;
  assert.equal(callback.redirectUri,row.web+'/alphaphone/auth/callback');
  assert.equal(callback.androidPackage,identity.appId);
  assert.equal(callback.browserSignIn.apiOrigin,row.api);
  assert.deepEqual(worker.secrets,[...WORKER_SECRETS]);
  // Every component is this product's own: names derive from its API Worker, hosts and tenant from the policy.
  const {login,speech,admission,web}=worker.components;
  assert.equal(login.host,new URL(ids.loginApiUrl).host);
  assert.deepEqual([login.vars.APP_URL,login.vars.PASSKEY_ORIGIN,login.vars.PASSKEY_RP_ID,login.vars.STEWARD_DEFAULT_TENANT_ID,login.vars.EMAIL_FROM],[row.web,row.web,new URL(row.web).hostname,row.tenant,ids.mailFrom]);
  for(const component of [login,speech,admission])assert.ok(component.workerName.startsWith(ids.workerName+'-'),component.workerName);
  assert.equal(worker.durableObjectTransfers.InferenceAdmissionGate,admission.workerName);
  assert.deepEqual(web.nativeAuthCallbacks,[callback]);
 }
 assert.equal(leakedElizaHost(deployment),null);
});

test('secrets are names only, and a shipped, Eliza-naming or incomplete input is refused',()=>{
 for(const name of WORKER_SECRETS)assert.match(name,/^[A-Z][A-Z0-9_]+$/);
 assert.throws(()=>workerDeployment(SHIPPED_CLOUD_DEPLOYMENT,resources),/shipped Cloud deployment/);
 const naming=structuredClone(resources);naming.production.loginApiUrl='https://login.eliza.app';
 assert.throws(()=>workerDeployment(policy,naming),/must not name login\.eliza\.app/);
 const missing=structuredClone(resources);delete missing.staging.hyperdriveId;
 assert.throws(()=>workerDeployment(policy,missing),/resources\.staging\.hyperdriveId is required/);
 const otherZone=structuredClone(resources);otherZone.production.zone='example.net';
 assert.throws(()=>workerDeployment(policy,otherZone),/is not in zone example\.net/);
 const insecure=structuredClone(policy);insecure.production.api='http://api.cloud.example.org';
 assert.throws(()=>workerDeployment(insecure,resources),/canonical HTTPS origins/);
});

test('Worker rendering refuses an output under the pinned source before invoking upstream',()=>{
 const result=spawnSync(process.execPath,['scripts/cloud-worker.ts','render','--policy','cloud/policy.example.json',
  '--resources','cloud/resources.example.json','--upstream','unused','--out','vendor/eliza/cloud-output-fixture'],{encoding:'utf8'});
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/outside the pinned vendor checkout/);
});
