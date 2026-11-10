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
  assert.deepEqual(publish.permissions,{actions:'read',contents:'write'});
  assert.match(workflow.jobs.admit.if,/inputs.workflow_commit == github.sha/);
  const steps=publish.steps;
  assert(steps.filter(step=>step.uses?.startsWith('actions/checkout@')).every(step=>step.with['persist-credentials']===false));
  const verification=steps.findIndex(step=>step.run?.includes('node scripts/verify-apks.mjs --runtime-profile=cloud --cloud-voice-evidence='));
  const delivery=steps.findIndex(step=>step.run?.includes('node scripts/deliver-app-update.mjs --variant launcher'));
  assert(verification>=0&&delivery>verification);
  assert.match(steps[verification].run,/qualified-stage\/cloud-voice.json/);
  const secretSteps=steps.filter(step=>JSON.stringify(step.env||{}).includes('secrets.'));
  assert.equal(secretSteps.length,1);
  assert.deepEqual(Object.keys(secretSteps[0].env).filter(key=>key.startsWith('ALPHA_')),['ALPHA_PRIVATE_STORAGE_TOKEN']);
  assert(!/APP_RELEASE_KEYSTORE|RELEASE_KEY_PASSPHRASE|RECIPIENT_PRIVATE|openssl cms|sign-release-apks/.test(source));
  for(const step of steps.filter(step=>step.uses))assert.match(step.uses,/@[0-9a-f]{40}$/);
});
