import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync,execFileSync} from 'node:child_process';
import {localEmbeddingEnvironment} from '../scripts/agent-embeddings.mjs';

const root=path.resolve(import.meta.dirname,'..');
const scratch=process.env.ALPHA_EMBEDDING_TEST_ROOT||os.tmpdir();
const sharedModels=path.join(os.homedir(),'.local/state/eliza/models');
const sharedLibrary=path.join(os.homedir(),'.local/state/eliza/local-inference/lib');

test('explicit embedding paths survive unchanged, including spaces and both inputs',()=>{
 const file=path.join(scratch,'reviewed library','libelizainference.dylib');
 const dir=path.join(scratch,'reviewed directory');
 assert.deepEqual(localEmbeddingEnvironment({ELIZA_INFERENCE_LIBRARY:file}),{ELIZA_INFERENCE_LIBRARY:file,MODELS_DIR:sharedModels});
 assert.deepEqual(localEmbeddingEnvironment({ELIZA_INFERENCE_LIB_DIR:dir}),{ELIZA_INFERENCE_LIB_DIR:dir,MODELS_DIR:sharedModels});
 assert.deepEqual(localEmbeddingEnvironment({ELIZA_INFERENCE_LIBRARY:file,ELIZA_INFERENCE_LIB_DIR:dir}),{ELIZA_INFERENCE_LIBRARY:file,ELIZA_INFERENCE_LIB_DIR:dir,MODELS_DIR:sharedModels});
});

test('invalid explicit paths are refused rather than replaced with a default',()=>{
 for(const key of ['ELIZA_INFERENCE_LIBRARY','ELIZA_INFERENCE_LIB_DIR','MODELS_DIR'])
  for(const value of ['relative/library','   ','/absolute\0invalid',42])
   assert.throws(()=>localEmbeddingEnvironment({[key]:value}),/absolute path/);
});

test('an admitted speech library wins over the inherited embedding library',()=>{
 const inherited={ELIZA_INFERENCE_LIBRARY:path.join(scratch,'inherited.dylib'),ELIZA_INFERENCE_LIB_DIR:path.join(scratch,'inherited directory')};
 const admitted={ELIZA_INFERENCE_LIBRARY:path.join(scratch,'speech admitted.dylib')};
 assert.deepEqual(localEmbeddingEnvironment({...inherited,...admitted}),{...inherited,...admitted,MODELS_DIR:sharedModels});
});

test('a fresh profile retains the original shared model directory independently of library overrides',()=>{
 const isolated=path.join(scratch,'brand new profile');
 assert.deepEqual(localEmbeddingEnvironment({ELIZA_STATE_DIR:isolated}),{MODELS_DIR:sharedModels,ELIZA_INFERENCE_LIB_DIR:sharedLibrary});
 assert.deepEqual(localEmbeddingEnvironment({ELIZA_STATE_DIR:isolated,MODELS_DIR:''}),{MODELS_DIR:sharedModels,ELIZA_INFERENCE_LIB_DIR:sharedLibrary});
});
test('an absolute model directory wins independently of library defaults or explicit library paths',()=>{
 const models=path.join(scratch,'explicit models with spaces'),file=path.join(scratch,'explicit inference.dylib'),libDir=path.join(scratch,'explicit libraries');
 assert.deepEqual(localEmbeddingEnvironment({MODELS_DIR:models}),{MODELS_DIR:models,ELIZA_INFERENCE_LIB_DIR:sharedLibrary});
 assert.deepEqual(localEmbeddingEnvironment({MODELS_DIR:models,ELIZA_INFERENCE_LIBRARY:file}),{MODELS_DIR:models,ELIZA_INFERENCE_LIBRARY:file});
 assert.deepEqual(localEmbeddingEnvironment({MODELS_DIR:models,ELIZA_INFERENCE_LIB_DIR:libDir}),{MODELS_DIR:models,ELIZA_INFERENCE_LIB_DIR:libDir});
 assert.deepEqual(localEmbeddingEnvironment({MODELS_DIR:models,ELIZA_INFERENCE_LIBRARY:file,ELIZA_INFERENCE_LIB_DIR:libDir}),{MODELS_DIR:models,ELIZA_INFERENCE_LIBRARY:file,ELIZA_INFERENCE_LIB_DIR:libDir});
});
test('a library override cannot hide an invalid model directory, nor vice versa',()=>{
 const absolute=path.join(scratch,'valid');
 assert.throws(()=>localEmbeddingEnvironment({ELIZA_INFERENCE_LIBRARY:absolute,MODELS_DIR:'relative-models'}),/MODELS_DIR.*absolute path/);
 assert.throws(()=>localEmbeddingEnvironment({MODELS_DIR:absolute,ELIZA_INFERENCE_LIB_DIR:'relative-library'}),/ELIZA_INFERENCE_LIB_DIR.*absolute path/);
});

function launch(launcher,kind){
 const dir=fs.mkdtempSync(path.join(scratch,'embedding-launch-'));
 try{
  const home=path.join(dir,'home'),source=path.join(dir,'source'),profile=path.join(home,'profile');
  const entry=path.join(source,'packages/app/src/runtime/dev-server.ts'),receipt=path.join(dir,'child.json'),bun=path.join(dir,'fake-bun');
  fs.mkdirSync(path.dirname(entry),{recursive:true});fs.writeFileSync(entry,'');
  fs.mkdirSync(path.join(source,'node_modules'));fs.mkdirSync(profile,{recursive:true,mode:0o700});
  fs.mkdirSync(path.join(home,'.config/alphaphone'),{recursive:true});
  fs.writeFileSync(path.join(home,'.config/alphaphone/cerebras-key'),'synthetic-fixture-key',{mode:0o600});
  const config=path.join(profile,'eliza.json'),saved=JSON.stringify({fixtureKeep:'preserve',agents:{list:[{id:'main',default:true,identityName:'Embedding fixture'}]},serviceRouting:{llmText:{backend:'cerebras',transport:'direct',smallModel:'saved',largeModel:'saved'}}})+'\n';
  fs.writeFileSync(config,saved,{mode:0o600});
  const libDir=path.join(dir,'explicit library directory'),library=path.join(dir,'explicit library file.dylib');
  fs.mkdirSync(libDir);fs.writeFileSync(library,'synthetic-not-a-library');
  fs.writeFileSync(bun,`#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(receipt)},JSON.stringify({library:process.env.ELIZA_INFERENCE_LIBRARY??null,libDir:process.env.ELIZA_INFERENCE_LIB_DIR??null,modelsDir:process.env.MODELS_DIR??null}));\n`,{mode:0o700});
  const env={PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:home,TMPDIR:dir,LANG:'en_US.UTF-8',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0',GIT_NO_LAZY_FETCH:'1',GIT_NO_REPLACE_OBJECTS:'1',GIT_CONFIG_COUNT:'2',GIT_CONFIG_KEY_0:'core.hooksPath',GIT_CONFIG_VALUE_0:'/dev/null',GIT_CONFIG_KEY_1:'core.fsmonitor',GIT_CONFIG_VALUE_1:'false',CEREBRAS_API_KEY:'synthetic-fixture-key',ELIZA_ASR_ENABLED:'0',ELIZA_PARADEE_ENABLED:'0',ALPHA_DEV_CARTESIA:'0',ALPHA_ELIZA_SOURCE:source,ALPHA_REMOTE_PROFILE:profile,ALPHA_REMOTE_PORT:'47998',ALPHA_BUN:bun};
  if(kind==='file'||kind==='both')env.ELIZA_INFERENCE_LIBRARY=library;
  if(kind==='directory'||kind==='both')env.ELIZA_INFERENCE_LIB_DIR=libDir;
  const models=path.join(dir,'explicit models');
  if(kind==='models'||kind==='all')env.MODELS_DIR=models;
  if(kind==='all'){env.ELIZA_INFERENCE_LIBRARY=library;env.ELIZA_INFERENCE_LIB_DIR=libDir;}
  execFileSync('/usr/bin/git',['init','-q',source],{env});
  execFileSync('/usr/bin/git',['-C',source,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','--allow-empty','-qm','fixture'],{env});
  const args=[path.join(root,launcher)];
  if(launcher.includes('reviewed-workflow'))args.push('--source',source,'--profile',profile,'--port','47998','--bun',bun);
  const result=spawnSync(process.execPath,args,{cwd:root,env,encoding:'utf8',timeout:15000});
  assert.equal(result.error,undefined,result.error?.message);
  assert.equal(result.status,0,result.stderr);
  const child=JSON.parse(fs.readFileSync(receipt,'utf8'));
  assert.equal(child.library,kind==='file'||kind==='both'||kind==='all'?library:null);
  assert.equal(child.libDir,kind==='directory'||kind==='both'||kind==='all'?libDir:kind==='default'||kind==='models'?path.join(home,'.local/state/eliza/local-inference/lib'):null);
  assert.equal(child.modelsDir,kind==='models'||kind==='all'?models:path.join(home,'.local/state/eliza/models'));
  assert.equal(fs.readFileSync(config,'utf8'),saved,'existing routing and profile bytes stay unchanged');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}

for(const launcher of ['scripts/start-local-remote.mjs','scripts/start-reviewed-workflow-agent.mjs'])
 for(const kind of ['file','directory','both','default','models','all'])
  test(`${launcher} forwards ${kind} embedding inputs into the actual inert child`,()=>launch(launcher,kind));
