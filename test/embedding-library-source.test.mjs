import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {embeddingLibrarySource} from '../scripts/stage-embedding-host.ts';
test('artifact mapping preserves the original receipt path',()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'alpha-library-map-')));
 try{
  fs.writeFileSync(path.join(root,'libelizainference.so'),'fixture');
  const row={path:'/original/compiled/libelizainference.so'};
  assert.equal(embeddingLibrarySource(row),row.path);
  assert.equal(embeddingLibrarySource(row,root),path.join(root,'libelizainference.so'));
  assert.equal(row.path,'/original/compiled/libelizainference.so');
  assert.throws(()=>embeddingLibrarySource({...row,artifactPath:'../other.so'},root),/Unexpected/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('mapped library must be a regular nonsymlink file',()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'alpha-library-link-')));
 try{
  fs.writeFileSync(path.join(root,'real'),'fixture');fs.symlinkSync('real',path.join(root,'libelizainference.so'));
  assert.throws(()=>embeddingLibrarySource({path:'/original/libelizainference.so'},root),/regular file/);
  assert.throws(()=>embeddingLibrarySource({path:'/original/unexpected.so'},root),/Unexpected/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
