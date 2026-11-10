import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {cloudQaConfiguration} from '../scripts/start-cloud-qa.ts';
function fixture(run){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'alpha-cloud-qa-contract-')));try{const key=path.join(root,'staging-key');fs.writeFileSync(key,'synthetic-staging-key-only',{mode:0o600});return run({root,key,env:{ALPHA_QA_PROFILE:path.join(root,'fresh-profile'),ALPHA_QA_CLOUD_KEY_FILE:key,ALPHA_QA_PORT:'47859',ALPHA_QA_MODEL:'reviewed/provider-model'}});}finally{fs.rmSync(root,{recursive:true,force:true});}}
test('Cloud QA builds the canonical staging authority and exact model without writing a profile or exposing a browser credential',()=>fixture(({env})=>{
 const c=cloudQaConfiguration({...env,ELIZAOS_CLOUD_BASE_URL:'https://api.eliza.app',CEREBRAS_API_KEY:'unrelated-do-not-use'});
 assert.equal(c.authority.ELIZAOS_CLOUD_BASE_URL,'https://api-staging.eliza.app/api/v1');assert.equal(c.authority.ELIZA_DEV_CLOUD_ENV_AUTHORITY,'staging-explicit');assert.equal(c.authority.ELIZAOS_CLOUD_API_KEY,'synthetic-staging-key-only');
 assert.deepEqual(c.route,{backend:'elizacloud',transport:'cloud-proxy',accountId:'elizacloud',smallModel:'reviewed/provider-model',largeModel:'reviewed/provider-model'});assert.equal(fs.existsSync(c.profile),false);assert.equal(Object.keys(c.authority).some(key=>key.startsWith('VITE_')),false);
}));
test('Cloud QA refuses existing personal profiles, protected ports and unreviewed credentials',()=>fixture(({root,key,env})=>{
 const existing=path.join(root,'personal');fs.mkdirSync(existing);fs.writeFileSync(path.join(existing,'history'),'keep');assert.throws(()=>cloudQaConfiguration({...env,ALPHA_QA_PROFILE:existing}),/non-QA/);assert.equal(fs.readFileSync(path.join(existing,'history'),'utf8'),'keep');
 for(const port of ['47839','47849','5203','5209'])assert.throws(()=>cloudQaConfiguration({...env,ALPHA_QA_PORT:port}),/protected/);
 fs.chmodSync(key,0o644);assert.throws(()=>cloudQaConfiguration(env),/owner-only/);fs.chmodSync(key,0o600);
 const link=path.join(root,'key-link');fs.symlinkSync(key,link);assert.throws(()=>cloudQaConfiguration({...env,ALPHA_QA_CLOUD_KEY_FILE:link}),/owner-only/);
 assert.throws(()=>cloudQaConfiguration({...env,ALPHA_QA_MODEL:undefined}),/exact reviewed/);
}));
