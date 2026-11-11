import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sourceModule} from '../specs/quint/refinement/services/support.mjs';

test('source execution waits for a reproduced dependency graph after capture',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'alpha-source-bundle-capture-'));
 try{
  const entry=join(directory,'entry.mjs'),dependency=join(directory,'dependency.mjs');
  writeFileSync(entry,"import {value} from './dependency.mjs';globalThis.__alphaBundleCaptureRuns=(globalThis.__alphaBundleCaptureRuns??0)+1;export {value};");
  writeFileSync(dependency,'export const value=1;');
  let captures=0;const sets=[];
  const actual=await sourceModule(entry,{},paths=>{captures++;sets.push(paths);assert.equal(globalThis.__alphaBundleCaptureRuns,undefined,'Discovery and bound rebuild must not execute source');});
  assert.equal(actual.value,1);assert.equal(globalThis.__alphaBundleCaptureRuns,1);assert.equal(captures,2);assert.deepEqual(sets[0],sets[1]);
 }finally{delete globalThis.__alphaBundleCaptureRuns;rmSync(directory,{recursive:true,force:true});}
});

test('a changed discovered dependency is refused before any source execution',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'alpha-source-bundle-drift-'));
 try{
  const entry=join(directory,'entry.mjs'),dependency=join(directory,'dependency.mjs');
  writeFileSync(entry,"import {value} from './dependency.mjs';globalThis.__alphaBundleDriftExecuted=true;export {value};");writeFileSync(dependency,'export const value=1;');
  let captured=false;
  await assert.rejects(sourceModule(entry,{},()=>{if(!captured){captured=true;writeFileSync(dependency,'export const value=2;');}}),/Source bundle changed after dependency capture/);
  assert.equal(globalThis.__alphaBundleDriftExecuted,undefined);
 }finally{delete globalThis.__alphaBundleDriftExecuted;rmSync(directory,{recursive:true,force:true});}
});
