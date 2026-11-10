import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {deploymentOutputs} from '../scripts/cloud-deployment.ts';
import {CLOUD_DEPLOYMENT} from '../scripts/cloud-deployment-policy.ts';

test('email send and verification use each configured tenant and preserve PKCE',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-email-deployment-'));
 try {
  for(const dir of ['scripts','apps/app/src/runtime'])fs.mkdirSync(path.join(root,dir),{recursive:true});
  for(const file of ['scripts/cloud-email-code.ts','app.config.json'])fs.copyFileSync(file,path.join(root,file));
  fs.writeFileSync(path.join(root,'package.json'),'{"type":"module"}');
  const config=structuredClone(CLOUD_DEPLOYMENT);
  config.production.tenant='another-app-production';config.staging.tenant='another-app-staging';
  const generated='apps/app/src/runtime/cloud-deployment.generated.ts';
  fs.writeFileSync(path.join(root,generated),deploymentOutputs(config)[generated]);
  const adapter=await import(pathToFileURL(path.join(root,'scripts/cloud-email-code.ts')).href);
  for(const env of ['production','staging']){
   const send=adapter.emailCodeSendBody(env,'test@example.org','synthetic-verifier');
   const verify=adapter.emailCodeVerifyBody(env,'test@example.org','123456','synthetic-verifier');
   assert.equal(send.tenantId,config[env].tenant);assert.equal(verify.tenantId,config[env].tenant);
   assert.equal(send.pkce.codeChallengeMethod,'S256');assert.equal(send.pkce.codeChallenge.length,43);
   assert.equal(verify.pkce.codeVerifier,'synthetic-verifier');assert.equal(verify.code,'123456');
   assert.equal(send.client,'ai.alphacompute.alphaphone');assert.equal(verify.client,send.client);
  }
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});
