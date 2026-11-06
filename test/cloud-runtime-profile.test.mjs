import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {gzipSync} from 'node:zlib';
import {verifyCloudResident} from '../scripts/runtime-profile.mjs';
import {parseBuildArgs,buildEnv,gradleFlagArgs} from '../scripts/build-android.mjs';
import {preparedRuntimeProblems,checkoutProblems} from '../scripts/android-build-preflight.mjs';
test('Cloud profile explicitly selects renderer and Gradle without mock switches',()=>{
 const options=parseBuildArgs(['--runtime-profile=cloud']);
 assert.equal(options.runtimeProfile,'cloud');
 const env=buildEnv({ELIZA_DEV_ALLOW_TEST_MOCKS:'1',VITE_ELIZA_RUNTIME_PROFILE:'native'},options);
 assert.equal(env.VITE_ELIZA_RUNTIME_PROFILE,'cloud');assert.equal(env.ELIZA_DEV_ALLOW_TEST_MOCKS,undefined);
 assert.ok(gradleFlagArgs(options).includes('-PELIZA_RUNTIME_PROFILE=cloud'));
 assert.equal(buildEnv({},parseBuildArgs([])).VITE_ELIZA_RUNTIME_PROFILE,'native');
});
test('Cloud profile cannot inherit the unpackaged or synthetic lane',()=>{
 for(const flag of ['--allow-unpackaged-runtime','--test-mocks'])assert.throws(()=>parseBuildArgs(['--runtime-profile=cloud',flag]),/genuine packaged resident/);
 assert.throws(()=>parseBuildArgs(['--runtime-profile=other']),/Unknown option/);
 for(const option of [{allowUnpackagedRuntime:true},{testMocks:true}])assert.match(preparedRuntimeProblems('/missing','/missing',{runtimeProfile:'cloud',...option})[0],/genuine packaged resident/);
});
test('Cloud profile checks the explicitly selected prepared source even when another runtime is staged',()=>{
 const missing=path.join(process.cwd(),'artifacts','missing-cloud-source-'+randomUUID());
 assert.notDeepEqual(preparedRuntimeProblems(process.cwd(),missing,{runtimeProfile:'cloud'}),[]);
});
test('Cloud profile keeps native speech and embeddings guards as default',()=>{
 const gradle=fs.readFileSync('android/app/build.gradle','utf8');
 assert.match(gradle,/ELIZA_RUNTIME_PROFILE.*native/);
 assert.match(gradle,/runtimeProfile == 'cloud'.*runtime-profile.mjs/);
 assert.match(fs.readFileSync('android/local-speech/build.gradle','utf8'),/cloudProfile \|\| \(unpackaged && !nativeOutput\.exists\(\)\)/);
 // Cloud embeddings for the Cloud profile are routed by upstream's native runtime profile; the
 // product host only declares its deployment and never writes routing itself.
 assert.match(fs.readFileSync('vendor/eliza/packages/app/src/runtime/native-runtime-profile.ts','utf8'),/cloud: Object.freeze\(\{\s*id: "cloud",\s*textInference: "elizacloud",\s*embeddings: "elizacloud"/);
 const host=fs.readFileSync('backend/native-google-agent-host.ts','utf8');
 assert.match(host,/export \{nativeCloudRuntime\} from '\.\/native-cloud-runtime-config\.ts';/);assert.doesNotMatch(host,/prepareNativeCloudRuntime|saveElizaConfig/);
});

// Exercise the real admission path with an authenticated tiny source tree. The
// intentionally different Bun hash marks successful completion of database
// admission; this fixture does not stand in for a complete resident payload.
function databaseAdmissionFixture() {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-cloud-database-'));
 const source=path.join(root,'source'),agent=path.join(root,'android/app/src/main/assets/agent');
 const write=(file,bytes)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);};
 const json=(file,value)=>write(file,JSON.stringify(value));
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 const prepared=new Map([
  ['agent-bundle.js',Buffer.from('fixture bundle')],
  ['pglite.wasm',Buffer.from('fixture wasm')],
  ['pglite.data',Buffer.from('fixture data')],
  ['pglite-initdb.bin',gzipSync(Buffer.from('fixture empty database'))],
  ['vector.tar',Buffer.from('fixture vector')],
  ['fuzzystrmatch.tar',Buffer.from('fixture fuzzy')],
 ]);
 write(path.join(source,'bun.lock'),'{}');
 json(path.join(source,'package.json'),{name:'synthetic-cloud-admission',private:true,workspaces:[]});
 json(path.join(source,'turbo.json'),{tasks:{}});
 json(path.join(source,'packages/app/scripts/lib/android-bun-artifacts.lock.json'),{
  channels:{fixture:{version:'fixture',revision:'fixture',artifacts:{aarch64:{binarySha256:'0'.repeat(64)}}}},
 });
 const git=(...args)=>execFileSync('git',args,{cwd:source,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init','--quiet');git('add','.');git('-c','user.name=Alpha test','-c','user.email=alpha-test@invalid','commit','--quiet','-m','Synthetic source');
 const pin=git('rev-parse','HEAD');
 json(path.join(root,'upstream.lock.json'),{commit:pin});
 const stamp={base:pin,patches:[]};
 json(path.join(source,'.alpha-runtime-source.json'),stamp);json(path.join(agent,'alpha-source.json'),stamp);
 const omitted={path:'assets/agent/models/bge-small-en-v1.5-f16.gguf',sha256:'f0b2fef971e8366438bfd2d9aefea1b0115919389448806d290237f638bae999'};
 json(path.join(agent,'alpha-runtime-profile.json'),{version:1,runtimeProfile:'cloud',omittedLocalModels:[omitted]});
 const provenance={schema:'eliza.android_agent_runtime_provenance.v1',bun:{channel:'fixture',version:'fixture',revision:'fixture'},files:[]};
 for(const [name,bytes] of prepared){
  write(path.join(source,'packages/agent/dist-mobile',name.endsWith('.tar')?name+'.gz':name),name.endsWith('.tar')?gzipSync(bytes):bytes);
  write(path.join(agent,name),bytes);
  provenance.files.push({path:'assets/agent/'+name,sha256:hash(bytes),size_bytes:bytes.length});
 }
 write(path.join(root,'android/app/src/main/jniLibs/arm64-v8a/libeliza_bun.so'),'fixture Bun');
 const save=()=>json(path.join(agent,'android-agent-runtime-provenance.json'),provenance);
 save();
 return {root,source,agent,provenance,save,hash};
}

test('Cloud database admission requires the new snapshot even if provenance omits it',()=>{
 const fixture=databaseAdmissionFixture();
 try{
  assert.throws(()=>verifyCloudResident(fixture.root,fixture.source),/Cloud Bun executable differs from pinned artifact: arm64-v8a/);
  fs.unlinkSync(path.join(fixture.agent,'pglite-initdb.bin'));
  fixture.provenance.files=fixture.provenance.files.filter(row=>row.path!=='assets/agent/pglite-initdb.bin');fixture.save();
  assert.throws(()=>verifyCloudResident(fixture.root,fixture.source),/Required Cloud resident database\/bundle missing: pglite-initdb.bin/);
 }finally{fs.rmSync(fixture.root,{recursive:true,force:true});}
});

test('Cloud snapshot bytes remain bound to the prepared build when provenance is rewritten',()=>{
 const fixture=databaseAdmissionFixture();
 try{
  const replacement=gzipSync(Buffer.from('different database'));
  fs.writeFileSync(path.join(fixture.agent,'pglite-initdb.bin'),replacement);
  const row=fixture.provenance.files.find(entry=>entry.path==='assets/agent/pglite-initdb.bin');
  row.sha256=fixture.hash(replacement);row.size_bytes=replacement.length;fixture.save();
  assert.throws(()=>verifyCloudResident(fixture.root,fixture.source),/Cloud PGlite differs from prepared build: pglite-initdb.bin/);
 }finally{fs.rmSync(fixture.root,{recursive:true,force:true});}
});
