/**
 * Verify, build both distributions and retain immutable matching app/test artifacts.
 *
 *   node scripts/build-archive.mjs [--test-mocks | --runtime-profile=cloud] test-results/<new-archive>
 *
 * Default archives the flag-off distribution build from artifacts/. --test-mocks
 * archives the separate, never-distributable test-mocks build from
 * artifacts/test-mocks/ for mock-isolation instrumentation suites only.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {archiveWebPayload} from './apk.mjs';
import {parseBuildArgs,buildEnv as androidBuildEnv} from './build-android.mjs';
import {readUpdateChannel} from './update-channel.mjs';
const cli=process.argv.slice(2);
const buildArgs=cli.filter(arg=>arg==='--test-mocks'||arg==='--runtime-profile=cloud'||arg==='--local-embeddings');
const options=parseBuildArgs(buildArgs);
const {testMocks,runtimeProfile='native',localEmbeddings=false}=options;
const positional=cli.filter(arg=>!buildArgs.includes(arg));
assert.ok(positional.length===1&&!positional[0].startsWith('--'),'Use: node scripts/build-archive.mjs [--test-mocks | --runtime-profile=cloud] test-results/<new-archive>');
const [destination]=positional;
const sourceDir=testMocks?'artifacts/test-mocks':'artifacts';
// Distribution archives are always flag-off; build-android also strips these.
const buildEnv=androidBuildEnv(process.env,options);
const verifyEnv=androidBuildEnv(process.env,{testMocks:false,runtimeProfile});
// Source tests construct their own synthetic channel inputs. The real private
// capability is used only by the native build and its digest-bound verifier.
for(const name of ['ALPHA_UPDATE_CHANNEL','ALPHA_PRIVATE_UPDATE_MANIFEST_FILE','ALPHA_PRIVATE_UPDATE_MANIFEST_SHA256'])delete verifyEnv[name];
const updateChannel=readUpdateChannel(buildEnv,JSON.parse(fs.readFileSync('app.config.json','utf8')).updateManifestUrl);
assert.ok(destination && path.resolve(destination).startsWith(path.resolve('test-results')+path.sep), 'Use a new archive beneath test-results');
assert.ok(!fs.existsSync(destination), 'Archive already exists; preserve earlier evidence');
fs.mkdirSync(destination,{recursive:true});
const snapshot=()=>JSON.parse(execFileSync(process.execPath,['scripts/source-snapshot.mjs'],{encoding:'utf8'}));
// Generated native Java is a build input: finish its normal source admission
// before freezing the baseline. Gradle repeats this stage; final equality below
// still rejects any non-deterministic regeneration or later source drift.
const nativeStageLog=fs.openSync(path.join(destination,'native-source-prestage.log'),'wx');
try{
 // The generated Gradle host is a build input too; android:build regenerates identical bytes.
 execFileSync(process.execPath,['scripts/android-host.mjs'],{stdio:['ignore',nativeStageLog,nativeStageLog],timeout:180000,env:buildEnv});
 execFileSync(process.execPath,['scripts/stage-local-agent-sources.mjs'],{stdio:['ignore',nativeStageLog,nativeStageLog],timeout:180000,env:buildEnv});
}
finally{fs.closeSync(nativeStageLog);}
// Capacitor generates res/xml/config.xml, an authenticated native build input.
// Complete normal sync before freezing; the build repeats sync and equality
// below still rejects drift in this file or any other captured input.
const capacitorStageLog=fs.openSync(path.join(destination,'capacitor-prestage.log'),'wx');
try{execFileSync('npm',['run','android:sync'],{stdio:['ignore',capacitorStageLog,capacitorStageLog],timeout:600000,env:buildEnv});}
finally{fs.closeSync(capacitorStageLog);}
const before=snapshot();
fs.writeFileSync(path.join(destination,'inputs-before.json'),JSON.stringify(before,null,2));
fs.writeFileSync(path.join(destination,'configuration.json'),JSON.stringify({testMocks,runtimeProfile,updateChannel,...(localEmbeddings?{localEmbeddings:true}:{}),mapsConfigured:Boolean(process.env.VITE_MAPS_BASE_URL),mapsProvider:testMocks&&process.env.VITE_MAPS_BASE_URL?'regional-gateway':'cloud',startedAt:new Date().toISOString()},null,2));
for(const command of ['verify','android:build']){
 const log=fs.openSync(path.join(destination,command.replace(':','-')+'.log'),'wx');
 const extra=command==='android:build'&&buildArgs.length?['--',...buildArgs]:[];
 // Full verification includes the real staged JVM/runtime campaigns. Retain a
 // finite two-hour verification budget and the existing twenty-minute APK budget.
 try{execFileSync('npm',['run',command,...extra],{stdio:['ignore',log,log],timeout:command==='verify'?7200000:1200000,env:command==='verify'?verifyEnv:buildEnv});}
 finally{fs.closeSync(log);}
 console.log(command+': passed');
}
const after=snapshot();
fs.writeFileSync(path.join(destination,'inputs-after.json'),JSON.stringify(after,null,2));
assert.equal(after.digest,before.digest,'Build inputs changed; do not qualify this archive');
const manifest={};
function retain(source,name){const target=path.join(destination,name);fs.copyFileSync(source,target,fs.constants.COPYFILE_EXCL);manifest[name]=crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');}
// Retain exactly the build verify-apks checked, with its flag state.
const verification=JSON.parse(fs.readFileSync(path.join(sourceDir,'apk-manifest.json'),'utf8'));
assert.equal(verification.testMocks,testMocks,`Archive expects a testMocks=${testMocks} build`);
assert.equal(verification.runtimeProfile||'native',runtimeProfile,'Verified APK runtime profile differs from archive');
assert.deepEqual(verification.updateChannel,updateChannel,'Verified APK update channel differs from archive');
assert.equal(verification.localEmbeddings===true,localEmbeddings,'Verified embedding capability differs from archive');
// apk-manifest.json keeps its six-APK name->hash shape for existing consumers;
// release mappings are retained beside it with their own hashes.
const mappings={};
for(const variant of ['standalone','launcher']){
 const releases=['release','release-unsigned'].filter(suffix=>fs.existsSync(path.join(sourceDir,`${variant}-${suffix}.apk`)));
 assert.equal(releases.length,1,`Expected exactly one ${variant} release APK`);
 for(const suffix of ['debug',releases[0]]){
  const name=`${variant}-${suffix}.apk`;
  const row=verification.results.find(entry=>entry.file===path.join(sourceDir,name));
  assert.ok(row,`${sourceDir}/${name} is not in the verified APK manifest`);
  retain(path.join(sourceDir,name),name);
  assert.equal(manifest[name],row.sha256,`${sourceDir}/${name} changed after verification`);
 }
 retain(testMocks?path.join(sourceDir,`${variant}-androidTest.apk`):`android/app/build/outputs/apk/androidTest/${variant}/debug/app-${variant}-debug-androidTest.apk`,`${variant}-androidTest.apk`);
 const mapping=path.join(sourceDir,'mapping',`${variant}-release-mapping.txt`);
 if(fs.existsSync(mapping)){
  const target=path.join(destination,`${variant}-release-mapping.txt`);
  fs.copyFileSync(mapping,target,fs.constants.COPYFILE_EXCL);
  mappings[`${variant}-release-mapping.txt`]=crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
 }
}
fs.writeFileSync(path.join(destination,'release-mappings.json'),JSON.stringify(mappings,null,2)+'\n',{flag:'wx'});
fs.copyFileSync(path.join(sourceDir,'apk-manifest.json'),path.join(destination,'apk-verification.json'),fs.constants.COPYFILE_EXCL);
// build-android restores working web assets to flag-off after a test-mocks build.
// Preserve the exact payload from our already hash-checked, archived APK instead.
archiveWebPayload(path.join(destination,'standalone-debug.apk'),path.join(destination,'web-dist'),{testMocks});
fs.writeFileSync(path.join(destination,'apk-manifest.json'),JSON.stringify(manifest,null,2));
console.log(JSON.stringify({archive:destination,sourceFingerprint:after.digest,apks:Object.keys(manifest).length}));
