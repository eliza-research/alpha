import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const artifactHash = createHash('sha256').update('x').digest('hex');
import os from 'node:os';
import path from 'node:path';
import {buildPinnedVoice} from '../scripts/build-pinned-voice.mjs';

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'voice-build-')));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  const output = path.join(root, 'out'), record = path.join(output, 'build-record.json');
  const pin = {sourceCommit:'a'.repeat(40), nativeCommit:'b'.repeat(40)};
  const args = ['--workspace', path.join(root, 'workspace'), '--out', output];
  const run = () => {fs.mkdirSync(path.join(output, 'jniLibs/arm64-v8a'), {recursive:true});fs.writeFileSync(path.join(output,'jniLibs/arm64-v8a/libelizainference.so'),'x');fs.writeFileSync(record, JSON.stringify({files:[{path:'jniLibs/arm64-v8a/libelizainference.so',sha256:artifactHash,bytes:1}]}));};
  return {root,output,record,pin,args,run};
}
test('fresh successful voice builds retain file evidence and receive checked source provenance', t => {
  const f=fixture(t);
  const checked=[];
  buildPinnedVoice(f.root,f.args,{readIdentity:()=>f.pin,verifyUpstream:root=>checked.push([root,fs.existsSync(f.record)]),run:f.run});
  assert.deepEqual(checked,[[f.root,true]]);
  const record=JSON.parse(fs.readFileSync(f.record));
  assert.equal(record.sourceCommit,f.pin.sourceCommit);assert.equal(record.nativeCommit,f.pin.nativeCommit);
  assert.equal(record.files[0].sha256,artifactHash);
  assert.throws(()=>buildPinnedVoice(f.root,f.args,{readIdentity:()=>f.pin,verifyUpstream:()=>{},run:()=>assert.fail('must not run')}),/fresh directory/);
});
test('failed or source-changing builds never receive current provenance', t => {
  const f=fixture(t);let reads=0;
  assert.throws(()=>buildPinnedVoice(f.root,f.args,{readIdentity:()=>++reads===1?f.pin:{...f.pin,nativeCommit:'d'.repeat(40)},verifyUpstream:()=>{},run:f.run}),/source changed/);
  assert.equal(JSON.parse(fs.readFileSync(f.record)).sourceCommit,undefined);
  fs.rmSync(f.output,{recursive:true});
  assert.throws(()=>buildPinnedVoice(f.root,f.args,{readIdentity:()=>f.pin,verifyUpstream:()=>{},run:()=>{f.run();throw Error('build failed');}}),/build failed/);
  assert.equal(JSON.parse(fs.readFileSync(f.record)).sourceCommit,undefined);
});
test('conflicting builder provenance is refused and output cannot be directed into vendor', t => {
  const f=fixture(t);
  assert.throws(()=>buildPinnedVoice(f.root,f.args,{readIdentity:()=>f.pin,verifyUpstream:()=>{},run:()=>{f.run();fs.writeFileSync(f.record,JSON.stringify({sourceCommit:'0'.repeat(40)}));}}),/different source/);
  assert.throws(()=>buildPinnedVoice(f.root,['--out',path.join(f.root,'vendor','output')]),/outside vendor/);
});

test('a successful process cannot attest artifact bytes that differ from its build record', t => {
  const f=fixture(t);
  assert.throws(()=>buildPinnedVoice(f.root,f.args,{readIdentity:()=>f.pin,verifyUpstream:()=>{},run:()=>{f.run();fs.writeFileSync(path.join(f.output,'jniLibs/arm64-v8a/libelizainference.so'),'y');}}),/artifact hash differs/);
  assert.equal(JSON.parse(fs.readFileSync(f.record)).sourceCommit,undefined);
});

test('a build that leaves vendor/eliza unbuildable receives no provenance', t => {
  const f=fixture(t);
  assert.throws(()=>buildPinnedVoice(f.root,f.args,{readIdentity:()=>f.pin,verifyUpstream:()=>{throw Error('Unexpected untracked runtime source: .cache/other/x');},run:f.run}),/Unexpected untracked runtime source/);
  assert.equal(JSON.parse(fs.readFileSync(f.record)).sourceCommit,undefined);
});
