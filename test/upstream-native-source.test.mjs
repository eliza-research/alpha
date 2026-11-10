import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {parseNativeBlobBatch,upstreamNativeSource} from '../scripts/upstream-native-source.ts';
const a='a'.repeat(40),b='b'.repeat(40);
const frame=(oid,bytes)=>Buffer.concat([Buffer.from(`${oid} blob ${bytes.length}\n`),bytes,Buffer.from('\n')]);
test('batch parser preserves binary bytes and rejects reordered, malformed or truncated framing',()=>{
 const bytes=Buffer.from([0,10,255,13]);const valid=Buffer.concat([frame(a,bytes),frame(b,Buffer.alloc(0))]);
 assert.deepEqual(parseNativeBlobBatch(valid,[a,b]),[bytes,Buffer.alloc(0)]);
 for(const invalid of [valid.subarray(0,-1),Buffer.concat([valid,Buffer.from('\n')]),Buffer.from(`${a} tree 0\n\n`),Buffer.from(`${a} blob 01\nx\n`),Buffer.from(`${a} blob 9007199254740993\n`),Buffer.from(`${a} missing\n`)])assert.throws(()=>parseNativeBlobBatch(invalid,[a,b]));
 assert.throws(()=>parseNativeBlobBatch(valid,[b,a]));
 const nonAscii=Buffer.from(valid);nonAscii[0]|=128;assert.throws(()=>parseNativeBlobBatch(nonAscii,[a,b]),/encoding/);
});
test('batch source matches git show for binary and executable files and refuses local drift',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'native-batch-')),repo=path.join(root,'vendor/eliza');fs.mkdirSync(path.join(repo,'module'),{recursive:true});
 const git=(...args)=>execFileSync('git',['-C',repo,...args]);
 try{
 git('init','-q');git('config','user.email','fixture@example.invalid');git('config','user.name','Fixture');
 fs.writeFileSync(path.join(repo,'module/binary'),Buffer.from([0,255,10,13]));fs.writeFileSync(path.join(repo,'module/run'),'#!/bin/sh\nexit 0\n',{mode:0o755});git('add','.');git('commit','-qm','fixture');
 const pin=git('rev-parse','HEAD').toString().trim();fs.writeFileSync(path.join(root,'upstream.lock.json'),JSON.stringify({commit:pin}));
 const source=upstreamNativeSource(root),files=source.read('module');assert.equal(files.size,2);
 for(const [name,file]of files)assert.deepEqual(file.bytes,git('show',`${pin}:${name}`));
 assert.equal(files.get('module/run').mode,'100755');
 fs.writeFileSync(path.join(repo,'module/binary'),'changed');assert.throws(()=>source.read('module'),/drift/);assert.throws(()=>upstreamNativeSource(root),/dirty/);
 git('checkout','--','module/binary');fs.chmodSync(path.join(repo,'module/run'),0o644);assert.throws(()=>source.read('module'),/drift/);
 fs.chmodSync(path.join(repo,'module/run'),0o750);assert.equal(source.read('module').get('module/run').mode,'100755');
 fs.chmodSync(path.join(repo,'module/run'),0o755);fs.unlinkSync(path.join(repo,'module/binary'));fs.symlinkSync('run',path.join(repo,'module/binary'));assert.throws(()=>source.read('module'),/Symlink/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
