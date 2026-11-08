// The locally launched host presents as the product: config/alpha-product.json identity is the one
// source for the shell label and for the agent character the launchers hand upstream.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync,execFileSync} from 'node:child_process';
import {AGENT_CHARACTER,AGENT_CHARACTER_ENVIRONMENT} from '../scripts/agent-identity.mjs';
import {LOCAL_EMBEDDING_ROUTE} from '../scripts/agent-embeddings.mjs';

const record=JSON.parse(fs.readFileSync('config/alpha-product.json','utf8'));
const LAUNCHERS=['scripts/start-local-remote.mjs','scripts/start-combined-agent.mjs','scripts/start-local-voice-agent.mjs','scripts/start-reviewed-workflow-agent.mjs'];

test('the agent character carries the product identity and inherits the bundled persona',()=>{
 assert.equal(AGENT_CHARACTER.name,record.identity.characterName);
 assert.equal(AGENT_CHARACTER.name,'Alpha');
 assert.ok(AGENT_CHARACTER.bio.some(line=>line.includes(record.identity.appName)));
 // No replacement system prompt: upstream keeps the default preset's style and renders its {{name}} tokens.
 assert.equal('system' in AGENT_CHARACTER,false);
 assert.deepEqual(JSON.parse(AGENT_CHARACTER_ENVIRONMENT.ELIZA_AGENT_CHARACTER_JSON),AGENT_CHARACTER);
});

test('every host launcher hands the character to the child through the upstream override variable',()=>{
 for(const file of LAUNCHERS){const source=fs.readFileSync(file,'utf8');assert.match(source,/\.\.\.AGENT_CHARACTER_ENVIRONMENT/,file);assert.doesNotMatch(source,/ELIZA_AGENT_CHARACTER_JSON|['"]Eliza['"]/,`${file} spells the identity itself`);}
});

test('the pinned upstream applies the override in memory and renders the name into the system prompt',()=>{
 const sandbox=fs.readFileSync('vendor/eliza/packages/agent/src/runtime/sandbox-character.ts','utf8');
 assert.match(sandbox,/env\.ELIZA_AGENT_CHARACTER_JSON\?\.trim\(\)/);
 assert.match(sandbox,/assistant: \{ \.\.\.\(ui\.assistant \?\? \{\}\), name \}/);
 assert.doesNotMatch(sandbox,/writeFileSync|saveConfig/,'the override must not persist into the profile');
 const boot=fs.readFileSync('vendor/eliza/packages/agent/src/runtime/eliza.ts','utf8');
 assert.ok(boot.indexOf('applySandboxCharacterFromEnv(config)')<boot.indexOf(': buildCharacterFromConfig(config)'));
 const build=fs.readFileSync('vendor/eliza/packages/agent/src/runtime/build-character-config.ts','utf8');
 assert.match(build,/const configuredName = configuredUiName \|\| configuredAgentName;/);
 assert.match(build,/\(agentEntry\?\.system \? undefined : getDefaultStylePreset\(language\)\)/);
 const presets=fs.readFileSync('vendor/eliza/packages/host/src/character-presets.characters.ts','utf8');
 assert.match(presets,/id: "eliza",[\s\S]*?system:\s*"You are \{\{name\}\}, made by Eliza Research/);
 assert.match(fs.readFileSync('vendor/eliza/packages/core/src/runtime/system-prompt.ts','utf8'),/replaceNameTokens\(\s*typeof character\?\.system === "string"/);
});

function launch({route}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-identity-')),profile=path.join(dir,'profile'),source=path.join(dir,'source'),receipt=path.join(dir,'child.json'),bun=path.join(dir,'fake-bun');
 fs.mkdirSync(profile);fs.mkdirSync(path.join(source,'packages/app/src/runtime'),{recursive:true});fs.writeFileSync(path.join(source,'packages/app/src/runtime/dev-server.ts'),'');
 execFileSync('git',['init','-q',source]);execFileSync('git',['-C',source,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-qm','fixture']);
 fs.writeFileSync(bun,`#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(receipt)},JSON.stringify({character:process.env.ELIZA_AGENT_CHARACTER_JSON??null,libDir:process.env.ELIZA_INFERENCE_LIB_DIR??null,config:JSON.parse(require('node:fs').readFileSync(process.env.ELIZA_CONFIG_PATH,'utf8'))}));`,{mode:0o700});
 const config=path.join(profile,'eliza.json');if(route)fs.writeFileSync(config,JSON.stringify({serviceRouting:{llmText:route},agents:{list:[{id:'retained',default:true,name:'Retained Eliza',identityName:'Retained Eliza'}]},fixtureKeep:'preserve'}),{mode:0o600});
 const before=route?fs.readFileSync(config,'utf8'):null;
 const env={...process.env,ELIZA_ASR_ENABLED:'0',ELIZA_PARADEE_ENABLED:'0',ALPHA_ELIZA_SOURCE:source,ALPHA_REMOTE_PROFILE:profile,ALPHA_REMOTE_PORT:'47998',ALPHA_BUN:bun,CEREBRAS_API_KEY:'synthetic-fixture-key'};
 for(const key of ['ELIZA_SECRET_SWAP_ENABLED','ELIZA_PII_SWAP_ENABLED','CEREBRAS_MODEL','ELIZA_INFERENCE_LIBRARY','ELIZA_INFERENCE_LIB_DIR'])delete env[key];
 try{
  const result=spawnSync(process.execPath,[path.resolve('scripts/start-local-remote.mjs')],{env,encoding:'utf8',timeout:15000});
  return {status:result.status,error:result.stderr,child:JSON.parse(fs.readFileSync(receipt,'utf8')),before,after:fs.readFileSync(config,'utf8')};
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}

test('an explicitly pinned existing identity presents as the product without its configuration being rewritten',()=>{
 const r=launch({route:{backend:'cerebras',transport:'direct',smallModel:'saved',largeModel:'saved'}});
 assert.equal(r.status,0,r.error);
 assert.equal(r.after,r.before);
 assert.deepEqual(r.child.config,JSON.parse(r.before));
 assert.deepEqual(JSON.parse(r.child.character),AGENT_CHARACTER);
 // Reviewed routing is never migrated silently; the omitted embedding route is reported for review.
 assert.match(r.error,/serviceRouting omits embeddings/);
 assert.match(r.error,new RegExp(JSON.stringify(LOCAL_EMBEDDING_ROUTE).replace(/[{}"]/g,'\\$&')));
});

test('a new profile routes embeddings on-device and the child learns where the fused library is staged',()=>{
 const r=launch();
 assert.equal(r.status,0,r.error);
 assert.deepEqual(r.child.config.serviceRouting.embeddings,{...LOCAL_EMBEDDING_ROUTE});
 assert.deepEqual(JSON.parse(r.child.character),AGENT_CHARACTER);
 assert.equal(r.child.libDir,path.join(os.homedir(),'.local/state/eliza/local-inference/lib'));
 assert.doesNotMatch(r.error,/serviceRouting omits embeddings/);
});
