import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {embeddingBuildRemap} from '../scripts/embedding-build-remap.mjs';
const root=path.resolve(import.meta.dirname,'..');
const run=(...args)=>spawnSync(process.execPath,['scripts/prepare-embedding-host.mjs',...args],{cwd:root,encoding:'utf8'});

test('build path remapping uses stable SDK and native build paths without receipt files',()=>{
 const inputs={sdk:'/different/android-sdk',staging:'/isolated/source',fork:'/isolated/engine',build:'/isolated/jni'};
 const env=embeddingBuildRemap(root,inputs);
 assert.ok(env.CCC_OVERRIDE_OPTIONS.includes('+-ffile-prefix-map=/different/android-sdk=/work/android-sdk'));
 assert.ok(env.CCC_OVERRIDE_OPTIONS.includes('+-ffile-prefix-map=/isolated/jni=/alphaphone-embedding-host/jni-build'));
 assert.throws(()=>embeddingBuildRemap(root,{...inputs,sdk:'/sdk with spaces'}),/absolute paths without whitespace/);
});
test('native preparation refuses writes into vendor or prepared runtime source',()=>{
 for(const output of ['vendor/eliza/.forbidden-embedding-host','artifacts/forbidden-embedding-host']){
  const result=run('--fork',root,'--output',path.join(root,output));
  assert.notEqual(result.status,0);assert.match(result.stderr,/Output must be outside|Output must not traverse a symlink/);assert.equal(fs.existsSync(path.join(root,output)),false);
 }
});
test('native preparation preserves an existing artifact and rejects symlink output parents',()=>{
 const temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'alpha-embed-prepare-')));
 try{
  const existing=path.join(temp,'retained');fs.mkdirSync(existing);fs.writeFileSync(path.join(existing,'receipt'),'retained');
  const retained=run('--fork',root,'--output',existing);assert.notEqual(retained.status,0);assert.match(retained.stderr,/Output already exists/);assert.equal(fs.readFileSync(path.join(existing,'receipt'),'utf8'),'retained');
  fs.symlinkSync(existing,path.join(temp,'link'),'dir');
  const linked=run('--fork',root,'--output',path.join(temp,'link','new'));assert.notEqual(linked.status,0);assert.match(linked.stderr,/must not traverse a symlink/);assert.equal(fs.existsSync(path.join(existing,'new')),false);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
test('wrong engine revision is refused before creating output or running a build',()=>{
 const temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'alpha-embed-pin-'))),output=path.join(temp,'output');
 try{const result=run('--fork',root,'--output',output,'--build');assert.notEqual(result.status,0);assert.match(result.stderr,/Engine checkout must be clean at the exact Eliza gitlink/);assert.equal(fs.existsSync(output),false);}finally{fs.rmSync(temp,{recursive:true,force:true});}
});
