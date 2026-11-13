import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import YAML from 'yaml';
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';

test('qualified publication binds source, private output and exact reviewed voice without signing keys',()=>{
  execFileSync('python3',['-B','test/qualified-app-update.test.py'],{cwd:new URL('..',import.meta.url),stdio:'pipe',timeout:scaledTimeout(30_000)});
});

// Only reviewed main-branch release jobs can mint the short-lived artifact credential.
test('artifact identity is confined to protected signing and publication jobs',()=>{
 const identity=JSON.parse(fs.readFileSync(new URL('../scripts/ci/private-artifact-identity.json',import.meta.url),'utf8'));
 assert.equal(identity.projectId,'alpha-aosp-lab-20261024');
 assert.deepEqual(identity.roles.map(role=>role.includedPermissions),[['storage.objects.get'],['storage.objects.create']]);
 for(const claim of ["assertion.repository_id == '1396333361'","assertion.ref == 'refs/heads/main'","assertion.environment == 'release'","assertion.event_name == 'workflow_dispatch'"])assert(identity.attributeCondition.includes(claim));
 assert.deepEqual([...identity.attributeCondition.matchAll(/"([^"]+\.yml@refs\/heads\/main)"/g)].map(match=>match[1]),[
  'eliza-research/alpha/.github/workflows/release.yml@refs/heads/main',
  'eliza-research/alpha/.github/workflows/release-os-ota-signing.yml@refs/heads/main',
 ]);
 assert(identity.roles[1].condition.expression.endsWith("/objects/signed/')"));
 const cases=[['release.yml','sign','admit-signing'],['release.yml','publish','admit-publication']];
 for(const [file,name,admission] of cases){
  const workflow=YAML.parse(fs.readFileSync(new URL('../.github/workflows/'+file,import.meta.url),'utf8')),job=workflow.jobs[name];
  assert.equal(job.environment,'release');assert.equal(job.permissions['id-token'],'write');
  assert(!workflow.jobs[admission].permissions['id-token']);assert(!workflow.jobs[admission].steps?.some(step=>step.uses?.startsWith('google-github-actions/auth@')));
  const index=job.steps.findIndex(step=>step.id==='private_storage_auth'),auth=job.steps[index];
  assert(index>=0);assert.equal(auth.uses,'google-github-actions/auth@7c6bc770dae815cd3e89ee6cdf493a5fab2cc093');
  assert.equal(auth.with.workload_identity_provider,identity.providerResource);
  assert.equal(auth.with.service_account,identity.serviceAccountEmail);
  assert.equal(auth.with.token_format,'access_token');assert.equal(auth.with.access_token_lifetime,'3600s');
  assert.equal(auth.with.access_token_scopes,'https://www.googleapis.com/auth/devstorage.read_write');
  assert.equal(auth.with.create_credentials_file,false);assert.equal(auth.with.export_environment_variables,false);
  const consumers=job.steps.filter(step=>step.env?.ALPHA_PRIVATE_STORAGE_TOKEN);assert(consumers.length);
  if(name==='sign'){
   const source=job.steps.find(step=>step.with?.path==='qualified-producer');assert(source);
   assert.equal(source.with.ref,'${{ fromJSON(inputs.plan).alphaCommit }}');
  }
  for(const step of consumers){assert.equal(step.env.ALPHA_PRIVATE_STORAGE_TOKEN,'${{ steps.private_storage_auth.outputs.access_token }}');assert(job.steps.indexOf(step)>index);}
 }
 const osJob=YAML.parse(fs.readFileSync(new URL('../.github/workflows/release-os-ota-signing.yml',import.meta.url),'utf8')).jobs.sign;
 assert(identity.attributeCondition.includes('release-os-ota-signing.yml@refs/heads/main'));
 assert.equal(osJob.environment,'release');
 assert.deepEqual(osJob.permissions,{contents:'read','id-token':'write'});
 assert.match(osJob.if,/github.ref == 'refs\/heads\/main'.*inputs.workflow_commit == github.sha/);
 const keySteps=osJob.steps.filter(step=>JSON.stringify(step.env||{}).includes('secrets.'));
 assert.equal(keySteps.length,1);
 assert.deepEqual(Object.keys(keySteps[0].env).sort(),['ALPHA_OS_RELEASE_KEYS_PART1_B64','ALPHA_OS_RELEASE_KEYS_PART2_B64','ALPHA_OS_RELEASE_KEYS_PASSPHRASE'].sort());
 assert(!keySteps[0].env.ALPHA_PRIVATE_STORAGE_TOKEN);
 for(const id of ['input_auth','output_auth']){
  const index=osJob.steps.findIndex(step=>step.id===id),auth=osJob.steps[index];
  assert(index>=0);
  assert.equal(auth.uses,'google-github-actions/auth@7c6bc770dae815cd3e89ee6cdf493a5fab2cc093');
  assert.equal(auth.with.workload_identity_provider,identity.providerResource);
  assert.equal(auth.with.service_account,identity.serviceAccountEmail);
  assert.equal(auth.with.create_credentials_file,false);
  assert.equal(auth.with.export_environment_variables,false);
 }
});
