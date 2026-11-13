import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {buildPreparedWorkflowWorker} from '../scripts/prepared-workflow-worker.ts';
import {stageWorkerArtifact} from '../scripts/workflow-worker-artifact.ts';
import {sha256 as workerHash} from '../scripts/sha256.ts';

test('product delegates admitted identity and verifies generic producer output without compiler fallback',async()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'alpha-producer-'))),source=path.join(root,'artifacts/source'),output=path.join(root,'artifacts/worker');
 try {
  fs.mkdirSync(source,{recursive:true});fs.writeFileSync(path.join(source,'.alpha-runtime-source.json'),'fixture-admitted-source');fs.writeFileSync(path.join(source,'bun.lock'),'fixture-lock');
  await assert.rejects(buildPreparedWorkflowWorker(root,source,output),/lacks the generic/);
  const producer=path.join(source,'packages/scripts/plugins/plugin-workflow/build-workflow-artifact.ts');fs.mkdirSync(path.dirname(producer),{recursive:true});
  fs.writeFileSync(producer,`import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
export async function buildWorkflowArtifact(options){const {sourceRoot,outputDir,sourceIdentity}=options;fs.writeFileSync(path.join(sourceRoot,'received.json'),JSON.stringify(options));const hash=x=>createHash('sha256').update(x).digest('hex');const files={};for(const name of ['node_modules/smthrs/package.json','node_modules/zod/package.json','node_modules/effect/package.json','node_modules/@smthrs/engine/package.json','dependencies.json']){const f=path.join(outputDir,name);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,'{}');files[name]=hash('{}');}fs.writeFileSync(path.join(outputDir,'manifest.json'),JSON.stringify({version:1,sourceStampSha256:sourceIdentity,lockSha256:hash(fs.readFileSync(path.join(sourceRoot,'bun.lock'))),files}));if(fs.existsSync(path.join(sourceRoot,'drift')))fs.writeFileSync(path.join(sourceRoot,'bun.lock'),'changed');}
`);
  const result=await buildPreparedWorkflowWorker(root,source,output);assert.equal(result.manifest.sourceStampSha256,workerHash(Buffer.from('fixture-admitted-source')));assert.deepEqual(JSON.parse(fs.readFileSync(path.join(source,'received.json'))),{sourceRoot:source,outputDir:output,sourceIdentity:result.manifest.sourceStampSha256});
  const staged=path.join(root,'android/assets/worker');stageWorkerArtifact(output,staged,{sourceStampSha256:result.manifest.sourceStampSha256,lockSha256:result.manifest.lockSha256});assert.equal(fs.readFileSync(path.join(staged,'manifest.json'),'utf8'),fs.readFileSync(path.join(output,'manifest.json'),'utf8'));
  await assert.rejects(buildPreparedWorkflowWorker(root,source,output),/fresh worker/);
  await assert.rejects(buildPreparedWorkflowWorker(root,source,path.join(root,'outside')),/fresh worker/);
  fs.symlinkSync(path.join(root,'artifacts'),path.join(root,'artifacts/alias'));
  await assert.rejects(buildPreparedWorkflowWorker(root,source,path.join(root,'artifacts/alias/new')),/symlinks/);
  fs.writeFileSync(path.join(source,'drift'),'yes');await assert.rejects(buildPreparedWorkflowWorker(root,source,path.join(root,'artifacts/drifted')),/provenance changed/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});


test('producer rejects active and historical source overlap before import or writes',async()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'alpha-overlap-')));
 const source=path.join(root,'artifacts/active'),historical=path.join(root,'artifacts/historical');
 try {
  fs.mkdirSync(source,{recursive:true});fs.mkdirSync(historical,{recursive:true});
  fs.writeFileSync(path.join(historical,'.alpha-runtime-source.json'),'historical-stamp');
  const producer=path.join(source,'packages/scripts/plugins/plugin-workflow/build-workflow-artifact.ts');fs.mkdirSync(path.dirname(producer),{recursive:true});
  fs.writeFileSync(producer,`throw new Error('PRODUCER_IMPORT_MUST_NOT_RUN');`);
  const snapshot=()=>[source,historical].map(dir=>fs.readdirSync(dir,{recursive:true}).sort().map(name=>{const f=path.join(dir,name);return [name,fs.statSync(f).isFile()?workerHash(fs.readFileSync(f)):null];}));
  const before=snapshot();
  for(const output of [path.join(source,'nested/worker'),path.join(historical,'nested/worker')]) {
   await assert.rejects(buildPreparedWorkflowWorker(root,source,output),/inside.*prepared source/);
   assert.equal(fs.existsSync(output),false);assert.equal(fs.existsSync(path.dirname(output)),false);
   assert.deepEqual(snapshot(),before);
  }
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
