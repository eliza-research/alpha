import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import YAML from 'yaml';
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';

test('qualified publication binds source, private output and exact reviewed voice without signing keys',()=>{
  execFileSync('python3',['-B','test/qualified-app-update.test.py'],{cwd:new URL('..',import.meta.url),stdio:'pipe',timeout:scaledTimeout(30_000)});
});

const RELEASE=new URL('../.github/workflows/release.yml',import.meta.url);

test('publication preserves protected review, exact source and verification before writes',()=>{
  const source=fs.readFileSync(RELEASE,'utf8');
  const workflow=YAML.parse(source);
  assert.deepEqual(Object.keys(workflow.on),['workflow_dispatch']);
  assert.deepEqual(workflow.permissions,{});
  assert.deepEqual(workflow.concurrency,{group:'release','cancel-in-progress':false});
  assert.deepEqual(workflow.jobs['admit-publication'].permissions,{contents:'read',actions:'read'});
  const publish=workflow.jobs.publish;
  assert.equal(publish.environment,'release');
  assert.deepEqual(publish.permissions,{actions:'read',contents:'write','id-token':'write'});
  assert.match(workflow.jobs['admit-publication'].if,/inputs.operation == 'publish' && inputs.workflow_commit == github.sha/);
  const steps=publish.steps;
  assert(steps.filter(step=>step.uses?.startsWith('actions/checkout@')).every(step=>step.with['persist-credentials']===false));
  assert(!steps.some(step=>step.uses?.startsWith('actions/setup-node@')));
  const install=steps.findIndex(step=>step['working-directory']==='qualified-product'&&step.run?.includes('install --frozen-lockfile'));
  assert.match(steps[install].run,/^test -f bun\.lock\nbun install --frozen-lockfile --ignore-scripts\n$/);
  const projection=steps.findIndex(step=>step.run?.includes('run upstream:prepare-client'));
  const verification=steps.findIndex(step=>step.run?.includes('run android:verify --'));
  const delivery=steps.findIndex(step=>step.run?.includes('scripts/deliver-app-update.ts --variant launcher'));
  assert(install>=0&&projection>install&&verification>projection&&delivery>verification);
  for(const index of [install,projection,verification,delivery])assert.equal(steps[index]['working-directory'],'qualified-product');
  assert.equal(steps[delivery].run,'bun scripts/deliver-app-update.ts --variant launcher --apk-manifest artifacts/apk-manifest.json');
  assert.match(steps[verification].run,/qualified-stage\/cloud-voice.json/);
  const restore=steps.findIndex(step=>step.run?.includes('--product \"$GITHUB_WORKSPACE/qualified-product\"'));
  assert(restore>=0&&restore<verification);
  assert.match(steps[restore].run,/cp android\/release-signer\.json qualified-product\/android\/release-signer\.json/);
  const secretSteps=steps.filter(step=>JSON.stringify(step.env||{}).includes('secrets.'));
  assert.equal(secretSteps.length,0,'private delivery must not depend on a copied storage token');
  const publication=YAML.stringify({admit:workflow.jobs['admit-publication'],publish});
  assert(!/APP_RELEASE_KEYSTORE|RELEASE_KEY_PASSWORD|RECIPIENT_PRIVATE|openssl cms|sign-release-apks/.test(publication));
  for(const step of steps.filter(step=>step.uses))assert.match(step.uses,/@[0-9a-f]{40}$/);
});

test('publication verifies only a native qualification', t => {
  const step = YAML.parse(fs.readFileSync(RELEASE, 'utf8')).jobs.publish.steps.find(step => step.run?.includes('android:verify --'));
  assert.ok(step);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-qualified-profile-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const stage = path.join(root, 'qualified-stage');
  fs.mkdirSync(stage);
  const summary = path.join(stage, 'qualification-summary.json');
  const evidence = path.join(stage, 'cloud-voice.json');
  const run = profile => {
    fs.writeFileSync(summary, JSON.stringify({runtimeProfile: profile}));
    return spawnSync('bash', ['-e', '-c', 'bun() { printf "%s\\n" bun "$@"; }\n' + step.run], {
      cwd: root, env: {...process.env, RUNNER_TEMP: root}, encoding: 'utf8', timeout: 10_000,
    });
  };
  const native = run('native');
  assert.equal(native.status, 0, native.stderr);
  assert.deepEqual(native.stdout.trim().split('\n'), ['bun', 'run', 'android:verify', '--', `--cloud-voice-evidence=${evidence}`]);
  for (const profile of ['cloud', 'other']) {
    const refused = run(profile);
    assert.equal(refused.status, 1);
    assert.equal(refused.stdout, '');
  }
});

test('publication retains the exact Alpha Compute manifest only after both signed release rows qualify', () => {
  const steps = YAML.parse(fs.readFileSync(RELEASE, 'utf8')).jobs.publish.steps;
  const gate = steps.find(step => step.name === 'Require both qualified release rows before publication');
  const upload = steps.find(step => step.uses?.startsWith('actions/upload-artifact@'));
  assert.ok(gate && upload);
  assert.ok(upload.with.path.split('\n').includes('${{ runner.temp }}/qualified-stage/apk-manifest.json'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-qualified-manifest-'));
  try {
    const staged = path.join(root, 'qualified-stage');
    const artifacts = path.join(root, 'qualified-product', 'artifacts');
    fs.mkdirSync(staged);
    fs.mkdirSync(artifacts, {recursive: true});
    const input = path.join(artifacts, 'apk-manifest.json');
    const retained = path.join(staged, 'apk-manifest.json');
    const summary = {
      runtimeProfile: 'native', versionCode: 72, voiceEvidenceSHA256: 'c'.repeat(64),
      signedApkSHA256: {launcher: 'a'.repeat(64), standalone: 'b'.repeat(64)},
    };
    fs.writeFileSync(path.join(staged, 'qualification-summary.json'), JSON.stringify(summary));
    const rows = ['launcher', 'standalone'].map(variant => ({
      variant, mode: 'release', packageName: 'ai.alphacompute.alphaphone', distributable: true,
      versionCode: summary.versionCode, sha256: summary.signedApkSHA256[variant],
      cloudVoice: {evidenceSha256: summary.voiceEvidenceSHA256},
    }));
    const manifest = {testMocks: false, runtimeProfile: 'native', updateChannel: {kind: 'public'}, results: rows};
    const run = () => spawnSync('bash', ['-e', '-c', gate.run], {
      cwd: root, env: {...process.env, RUNNER_TEMP: root}, encoding: 'utf8', timeout: 10_000,
    });
    fs.writeFileSync(input, JSON.stringify({...manifest, results: [rows[0], {...rows[1], sha256: 'd'.repeat(64)}]}));
    const refused = run();
    assert.equal(refused.status, 1);
    assert.equal(fs.existsSync(retained), false);
    fs.writeFileSync(path.join(staged, 'qualification-summary.json'), JSON.stringify({...summary, runtimeProfile: 'cloud'}));
    fs.writeFileSync(input, JSON.stringify({...manifest, runtimeProfile: 'cloud'}));
    const legacy = run();
    assert.equal(legacy.status, 1);
    assert.equal(fs.existsSync(retained), false);
    fs.writeFileSync(path.join(staged, 'qualification-summary.json'), JSON.stringify(summary));
    const bytes = JSON.stringify(manifest, null, 4) + '\n';
    fs.writeFileSync(input, bytes);
    const verified = run();
    assert.equal(verified.status, 0, verified.stderr);
    assert.equal(fs.readFileSync(retained, 'utf8'), bytes);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
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
 const source=fs.readFileSync(RELEASE,'utf8'),workflow=YAML.parse(source);
 for(const [admit,name] of [['admit-signing','sign'],['admit-publication','publish']]){
  const job=workflow.jobs[name];
  assert.equal(job.environment,'release');assert.equal(job.permissions['id-token'],'write');
  assert(!workflow.jobs[admit].permissions['id-token']);assert(!workflow.jobs[admit].steps?.some(step=>step.uses?.startsWith('google-github-actions/auth@')));
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
   const staged=job.steps.find(step=>step.run?.includes('ALPHA_ADMITTED_APK_DIR='));assert(staged);
   assert(staged.run.indexOf('unset ALPHA_PRIVATE_STORAGE_TOKEN')<staged.run.indexOf('await import('));
  }
  for(const step of consumers){assert.equal(step.env.ALPHA_PRIVATE_STORAGE_TOKEN,'${{ steps.private_storage_auth.outputs.access_token }}');assert(job.steps.indexOf(step)>index);}
  assert(!source.includes('secrets.ALPHA_PRIVATE_APK_STORAGE_TOKEN'));
 }
 const osSource=fs.readFileSync(new URL('../.github/workflows/release-os-ota-signing.yml',import.meta.url),'utf8');
 const osWorkflow=YAML.parse(osSource),osJob=osWorkflow.jobs.sign;
 assert(identity.attributeCondition.includes('release-os-ota-signing.yml@refs/heads/main'));
 assert.equal(osJob.environment,'release');
 assert.deepEqual(osJob.permissions,{contents:'read','id-token':'write'});
 assert.match(osJob.if,/github.ref == 'refs\/heads\/main'.*inputs.workflow_commit == github.sha/);
 const download=osJob.steps.findIndex(step=>step.run?.includes('sign-os-ota.py download'));
 const signing=osJob.steps.findIndex(step=>step.run?.includes('sign-os-ota.py sign'));
 const upload=osJob.steps.findIndex(step=>step.run?.includes('sign-os-ota.py upload'));
 assert(download>=0&&signing>download&&upload>signing);
 const keySteps=osJob.steps.filter(step=>JSON.stringify(step.env||{}).includes('secrets.'));
 assert.equal(keySteps.length,1);
 assert.deepEqual(Object.keys(keySteps[0].env).sort(),['ALPHA_OS_RELEASE_KEYS_PART1_B64','ALPHA_OS_RELEASE_KEYS_PART2_B64','ALPHA_OS_RELEASE_KEYS_PASSPHRASE'].sort());
 assert(!keySteps[0].env.ALPHA_PRIVATE_STORAGE_TOKEN);
 for(const [id,consumer] of [['input_auth',download],['output_auth',upload]]){
  const index=osJob.steps.findIndex(step=>step.id===id),auth=osJob.steps[index];
  assert(index>=0&&index<consumer);
  assert.equal(auth.uses,'google-github-actions/auth@7c6bc770dae815cd3e89ee6cdf493a5fab2cc093');
  assert.equal(auth.with.workload_identity_provider,identity.providerResource);
  assert.equal(auth.with.service_account,identity.serviceAccountEmail);
  assert.equal(auth.with.create_credentials_file,false);
  assert.equal(auth.with.export_environment_variables,false);
  assert.equal(osJob.steps[consumer].env.ALPHA_PRIVATE_STORAGE_TOKEN,'${{ steps.'+id+'.outputs.access_token }}');
 }
});
