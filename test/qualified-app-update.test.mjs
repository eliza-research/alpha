import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import YAML from 'yaml';

test('qualified publication binds source, private output and exact reviewed voice without signing keys',()=>{
  execFileSync('python3',['-B','test/qualified-app-update.test.py'],{cwd:new URL('..',import.meta.url),stdio:'pipe',timeout:30_000});
});

test('publication workflow preserves protected review, exact source and verification before writes',()=>{
  const source=fs.readFileSync(new URL('../.github/workflows/publish-qualified-app-update.yml',import.meta.url),'utf8');
  const workflow=YAML.parse(source);
  assert.deepEqual(Object.keys(workflow.on),['workflow_dispatch']);
  assert.deepEqual(workflow.permissions,{});
  assert.deepEqual(workflow.concurrency,{group:'alpha-app-stable-publication','cancel-in-progress':false});
  assert.deepEqual(workflow.jobs.admit.permissions,{contents:'read',actions:'read'});
  const publish=workflow.jobs.publish;
  assert.equal(publish.environment,'release');
  assert.deepEqual(publish.permissions,{actions:'read',contents:'write','id-token':'write'});
  assert.match(workflow.jobs.admit.if,/inputs.workflow_commit == github.sha/);
  const steps=publish.steps;
  assert(steps.filter(step=>step.uses?.startsWith('actions/checkout@')).every(step=>step.with['persist-credentials']===false));
  const verification=steps.findIndex(step=>step.run?.includes('node scripts/verify-apks.mjs --cloud-voice-evidence='));
  const delivery=steps.findIndex(step=>step.run?.includes('node scripts/deliver-app-update.mjs --variant launcher'));
  assert(verification>=0&&delivery>verification);
  assert.match(steps[verification].run,/qualified-stage\/cloud-voice.json/);
  const secretSteps=steps.filter(step=>JSON.stringify(step.env||{}).includes('secrets.'));
  assert.equal(secretSteps.length,0,'private delivery must not depend on a copied storage token');
  assert(!/APP_RELEASE_KEYSTORE|RELEASE_KEY_PASSPHRASE|RECIPIENT_PRIVATE|openssl cms|sign-release-apks/.test(source));
  for(const step of steps.filter(step=>step.uses))assert.match(step.uses,/@[0-9a-f]{40}$/);
});

// Only reviewed main-branch release jobs can mint the short-lived artifact credential.
test('artifact identity is confined to protected signing and publication jobs',()=>{
 const identity=JSON.parse(fs.readFileSync(new URL('../scripts/ci/private-artifact-identity.json',import.meta.url),'utf8'));
 assert.equal(identity.projectId,'alpha-aosp-lab-20261024');
 assert.deepEqual(identity.roles.map(role=>role.includedPermissions),[['storage.objects.get'],['storage.objects.create']]);
 for(const claim of ["assertion.repository_id == '1396333361'","assertion.repository_owner_id == '314117943'","assertion.ref == 'refs/heads/main'","assertion.environment == 'release'","assertion.event_name == 'workflow_dispatch'"])assert(identity.attributeCondition.includes(claim));
 assert(identity.roles[1].condition.expression.endsWith("/objects/signed/')"));
 const cases=[['release-cloud-app-signing.yml','sign'],['publish-qualified-app-update.yml','publish']];
 for(const [file,name] of cases){
  const source=fs.readFileSync(new URL('../.github/workflows/'+file,import.meta.url),'utf8'),workflow=YAML.parse(source),job=workflow.jobs[name];
  assert.equal(job.environment,'release');assert.equal(job.permissions['id-token'],'write');
  assert(!workflow.jobs.admit.permissions['id-token']);assert(!workflow.jobs.admit.steps?.some(step=>step.uses?.startsWith('google-github-actions/auth@')));
  const index=job.steps.findIndex(step=>step.id==='private_storage_auth'),auth=job.steps[index];
  assert(index>=0);assert.equal(auth.uses,'google-github-actions/auth@7c6bc770dae815cd3e89ee6cdf493a5fab2cc093');
  assert.equal(auth.with.workload_identity_provider,identity.providerResource);
  assert.equal(auth.with.service_account,identity.serviceAccountEmail);
  assert.equal(auth.with.token_format,'access_token');assert.equal(auth.with.access_token_lifetime,'3600s');
  assert.equal(auth.with.access_token_scopes,'https://www.googleapis.com/auth/devstorage.read_write');
  assert.equal(auth.with.create_credentials_file,false);assert.equal(auth.with.export_environment_variables,false);
  const consumers=job.steps.filter(step=>step.env?.ALPHA_PRIVATE_STORAGE_TOKEN);assert(consumers.length);
  for(const step of consumers){assert.equal(step.env.ALPHA_PRIVATE_STORAGE_TOKEN,'${{ steps.private_storage_auth.outputs.access_token }}');assert(job.steps.indexOf(step)>index);}
  assert(!source.includes('secrets.ALPHA_PRIVATE_APK_STORAGE_TOKEN'));
 }
});
