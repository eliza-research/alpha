import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {sourceDirectory,workerArtifactDirectory} from '../scripts/local-agent-source.ts';

test('normal source and worker selection follows the admitted commit without altering old trees',()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'alpha-selection-')));
 try{
  const manifest=path.join(root,'upstream.lock.json');fs.mkdirSync(path.dirname(manifest),{recursive:true});
  const old=path.join(root,'artifacts/local-agent-source');fs.mkdirSync(old,{recursive:true});fs.writeFileSync(path.join(old,'.alpha-runtime-source.json'),'preserved-old-stamp');
  const first='a'.repeat(40),second='b'.repeat(40);fs.writeFileSync(manifest,JSON.stringify({commit:first}));
  assert.equal(sourceDirectory(root,{}),path.join(root,'artifacts','local-agent-resident-'+first));
  assert.equal(workerArtifactDirectory(root,{}),path.join(root,'artifacts','mobile-workflow-worker-'+first));
  fs.writeFileSync(manifest,JSON.stringify({commit:second}));
  assert.equal(sourceDirectory(root,{}),path.join(root,'artifacts','local-agent-resident-'+second));
  assert.equal(workerArtifactDirectory(root,{}),path.join(root,'artifacts','mobile-workflow-worker-'+second));
  assert.equal(fs.readFileSync(path.join(old,'.alpha-runtime-source.json'),'utf8'),'preserved-old-stamp');
  assert.equal(fs.existsSync(sourceDirectory(root,{})),false);
  fs.writeFileSync(manifest,JSON.stringify({commit:'main'}));assert.throws(()=>sourceDirectory(root,{}),/Exact admitted/);assert.throws(()=>workerArtifactDirectory(root,{}),/Exact admitted/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('explicit fresh overrides remain contained and refuse source aliases',()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'alpha-selection-')));
 try{
  fs.mkdirSync(path.join(root,'artifacts'));
  fs.writeFileSync(path.join(root,'upstream.lock.json'),JSON.stringify({commit:'a'.repeat(40)}));
  assert.equal(sourceDirectory(root,{ALPHA_LOCAL_AGENT_SOURCE_DIR:path.join(root,'artifacts/source')}),path.join(root,'artifacts/source'));
  assert.equal(workerArtifactDirectory(root,{ALPHA_WORKFLOW_WORKER_OUTPUT:'artifacts/worker'}),path.join(root,'artifacts/worker'));
  assert.throws(()=>sourceDirectory(root,{ALPHA_LOCAL_AGENT_SOURCE_DIR:'artifacts/source'}),/absolute/);
  assert.throws(()=>workerArtifactDirectory(root,{ALPHA_WORKFLOW_WORKER_OUTPUT:'../outside'}),/child/);
  fs.symlinkSync(os.tmpdir(),path.join(root,'artifacts/alias'));
  assert.throws(()=>workerArtifactDirectory(root,{ALPHA_WORKFLOW_WORKER_OUTPUT:'artifacts/alias/worker'}),/symlink/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});


test('output selection refuses active unprepared and historical stamped source ancestors',()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'alpha-selection-overlap-')));
 try {
  const source=path.join(root,'artifacts/future-source'),historical=path.join(root,'artifacts/old-source');
  fs.mkdirSync(historical,{recursive:true});fs.writeFileSync(path.join(historical,'.alpha-runtime-source.json'),'old');
  for(const base of [source,historical]) {
   const output=path.join(base,'nested/worker');
   assert.throws(()=>workerArtifactDirectory(root,{ALPHA_LOCAL_AGENT_SOURCE_DIR:source,ALPHA_WORKFLOW_WORKER_OUTPUT:output}),/inside.*prepared source/);
   assert.equal(fs.existsSync(output),false);assert.equal(fs.existsSync(path.dirname(output)),false);
  }
  assert.equal(fs.existsSync(source),false);assert.equal(fs.readFileSync(path.join(historical,'.alpha-runtime-source.json'),'utf8'),'old');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
