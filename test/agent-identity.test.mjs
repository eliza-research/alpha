// The locally launched host presents as the product: apps/app/src/product/alpha-product-registration.ts identity is the one
// source for the shell label and for the agent character the launchers hand upstream.
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import {ALPHA_PRODUCT_REGISTRATION as record} from '../apps/app/src/product/alpha-product-registration.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {git} from './fixtures/git-fixture.mjs';
import {AGENT_CHARACTER,AGENT_CHARACTER_ENVIRONMENT} from '../scripts/agent-identity.ts';
import {LOCAL_EMBEDDING_ROUTE} from '../scripts/agent-embeddings.ts';

test('the agent character carries the product identity and inherits the bundled persona',()=>{
 assert.equal(AGENT_CHARACTER.name,record.identity.characterName);
 assert.equal(AGENT_CHARACTER.name,'Alpha');
 assert.ok(AGENT_CHARACTER.bio.some(line=>line.includes(record.identity.appName)));
 // No replacement system prompt: upstream keeps the default preset's style and renders its {{name}} tokens.
 assert.equal('system' in AGENT_CHARACTER,false);
 assert.deepEqual(JSON.parse(AGENT_CHARACTER_ENVIRONMENT.ELIZA_AGENT_CHARACTER_JSON),AGENT_CHARACTER);
});

function launch({route}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-identity-')),profile=path.join(dir,'profile'),source=path.join(dir,'source'),receipt=path.join(dir,'child.json'),bun=path.join(dir,'fake-bun');
 fs.mkdirSync(profile);fs.mkdirSync(path.join(source,'packages/app/src/runtime'),{recursive:true});fs.writeFileSync(path.join(source,'packages/app/src/runtime/dev-server.ts'),'');
 git(source,'init','-q');git(source,'commit','--allow-empty','-qm','fixture');
 fs.writeFileSync(bun,`#!/usr/bin/env bun\nrequire('node:fs').writeFileSync(${JSON.stringify(receipt)},JSON.stringify({character:process.env.ELIZA_AGENT_CHARACTER_JSON??null,libDir:process.env.ELIZA_INFERENCE_LIB_DIR??null,config:JSON.parse(require('node:fs').readFileSync(process.env.ELIZA_CONFIG_PATH,'utf8'))}));`,{mode:0o700});
 const config=path.join(profile,'eliza.json');if(route)fs.writeFileSync(config,JSON.stringify({serviceRouting:{llmText:route},agents:{list:[{id:'retained',default:true,name:'Retained Eliza',identityName:'Retained Eliza'}]},fixtureKeep:'preserve'}),{mode:0o600});
 const before=route?fs.readFileSync(config,'utf8'):null;
 const env={...process.env,ELIZA_ASR_ENABLED:'0',ELIZA_PARADEE_ENABLED:'0',ALPHA_ELIZA_SOURCE:source,ALPHA_REMOTE_PROFILE:profile,ALPHA_REMOTE_PORT:'47998',ALPHA_BUN:bun,CEREBRAS_API_KEY:'synthetic-fixture-key'};
 for(const key of ['ELIZA_SECRET_SWAP_ENABLED','ELIZA_PII_SWAP_ENABLED','CEREBRAS_MODEL','ELIZA_INFERENCE_LIBRARY','ELIZA_INFERENCE_LIB_DIR'])delete env[key];
 try{
  const result=spawnSync(process.execPath,[path.resolve('scripts/start-local-remote.ts')],{env,encoding:'utf8',timeout:scaledTimeout(15000)});
  return {status:result.status,error:result.stderr,child:JSON.parse(fs.readFileSync(receipt,'utf8')),before,after:fs.readFileSync(config,'utf8')};
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}

test('an explicitly pinned existing identity presents as the product without its configuration being rewritten',()=>{
 const r=launch({route:{backend:'cerebras',transport:'direct',smallModel:'saved',largeModel:'saved'}});
 assert.equal(r.status,0,r.error);
 assert.equal(r.after,r.before);
 assert.deepEqual(r.child.config,JSON.parse(r.before));
 assert.deepEqual(JSON.parse(r.child.character),AGENT_CHARACTER);
});

test('a new profile routes embeddings on-device and the child learns where the fused library is staged',()=>{
 const r=launch();
 assert.equal(r.status,0,r.error);
 assert.deepEqual(r.child.config.serviceRouting.embeddings,{...LOCAL_EMBEDDING_ROUTE});
 assert.deepEqual(JSON.parse(r.child.character),AGENT_CHARACTER);
 assert.equal(r.child.libDir,path.join(os.homedir(),'.local/state/eliza/local-inference/lib'));
});

test('the combined launcher refuses the pinned vendor tree whatever directory it is started from',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-combined-guard-'));
 try{
  const node=path.join(dir,'node'),bun=path.join(dir,'bun');
  fs.writeFileSync(node,'#!/bin/sh\necho v26.13.0\n',{mode:0o700});fs.writeFileSync(bun,'#!/bin/sh\necho 1.4.2\n',{mode:0o700});
  for(const source of ['vendor/eliza','vendor/eliza/packages','base/eliza-app']){
   const env={...process.env,ALPHA_NODE_BIN:node,ALPHA_BUN:bun,ALPHA_COMBINED_SOURCE:path.resolve(source),ALPHA_COMBINED_SOURCE_MANIFEST:path.join(dir,'manifest.json')};
   if(!fs.existsSync(source))continue;
   const result=spawnSync(process.execPath,[path.resolve('scripts/start-combined-agent.ts'),'--validate-only'],{cwd:dir,env,encoding:'utf8',timeout:scaledTimeout(15000)});
   assert.notEqual(result.status,0,source);
   assert.match(result.stderr,/Never launch mutable pinned vendor or pristine baseline/,source);
  }
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
