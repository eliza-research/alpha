/**
 * Verify, build the launcher APKs and retain immutable matching app/test artifacts.
 *
 *   bun scripts/build-archive.ts test-results/<new-archive>
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {archiveWebPayload} from './apk.ts';
import {buildEnv as androidBuildEnv} from './build-android.ts';
import {publicUpdateChannel} from './update-channel.ts';
const cli=process.argv.slice(2);
const runtimeProfile='native';
assert.ok(cli.length===1&&!cli[0].startsWith('--'),'Use: bun scripts/build-archive.ts test-results/<new-archive>');
const [destination]=cli;
// Full verification compiles Calendar host tests which run real SQLite queries.
// Check this before preparation or model verification starts.
try{execFileSync('sqlite3',['--version'],{stdio:'ignore',timeout:10000});}
catch(cause){throw new Error('Build verification needs the sqlite3 command-line tool on PATH. Install it before starting an archive.',{cause});}
const sourceDir='artifacts';
// Archives are always flag-off; build-android also strips these.
const buildEnv=androidBuildEnv(process.env);
const verifyEnv=androidBuildEnv(process.env);
const updateChannel=publicUpdateChannel(JSON.parse(fs.readFileSync('app.config.json','utf8')).updateManifestUrl);
assert.ok(destination && path.resolve(destination).startsWith(path.resolve('test-results')+path.sep), 'Use a new archive beneath test-results');
assert.ok(!fs.existsSync(destination), 'Archive already exists; preserve earlier evidence');
fs.mkdirSync(destination,{recursive:true});
const snapshot=()=>JSON.parse(execFileSync(process.execPath,['scripts/source-snapshot.ts'],{encoding:'utf8'}));
// Generated native Java is a build input: finish its normal source admission
// before freezing the baseline. Gradle repeats this stage; final equality below
// still rejects any non-deterministic regeneration or later source drift.
const nativeStageLog=fs.openSync(path.join(destination,'native-source-prestage.log'),'wx');
try{
 // The generated Gradle host is a build input too; android:build regenerates identical bytes.
 execFileSync(process.execPath,['scripts/android-host.ts'],{stdio:['ignore',nativeStageLog,nativeStageLog],timeout:180000,env:buildEnv});
 execFileSync(process.execPath,['scripts/stage-local-agent-sources.ts'],{stdio:['ignore',nativeStageLog,nativeStageLog],timeout:180000,env:buildEnv});
}
finally{fs.closeSync(nativeStageLog);}
// Capacitor generates res/xml/config.xml, an authenticated native build input.
// Complete normal sync before freezing; the build repeats sync and equality
// below still rejects drift in this file or any other captured input.
const capacitorStageLog=fs.openSync(path.join(destination,'capacitor-prestage.log'),'wx');
try{execFileSync('bun',['run','android:sync'],{stdio:['ignore',capacitorStageLog,capacitorStageLog],timeout:600000,env:buildEnv});}
finally{fs.closeSync(capacitorStageLog);}
const before=snapshot();
fs.writeFileSync(path.join(destination,'inputs-before.json'),JSON.stringify(before,null,2));
fs.writeFileSync(path.join(destination,'configuration.json'),JSON.stringify({testMocks:false,runtimeProfile,updateChannel,mapsProvider:'cloud',startedAt:new Date().toISOString()},null,2));
for(const command of ['verify','android:build']){
 const log=fs.openSync(path.join(destination,command.replace(':','-')+'.log'),'wx');
 // Full verification includes the real staged JVM/runtime campaigns. Retain a
 // finite two-hour verification budget and the existing twenty-minute APK budget.
 try{execFileSync('bun',['run',command],{stdio:['ignore',log,log],timeout:command==='verify'?7200000:1200000,env:command==='verify'?verifyEnv:buildEnv});}
 finally{fs.closeSync(log);}
 console.log(command+': passed');
}
const after=snapshot();
fs.writeFileSync(path.join(destination,'inputs-after.json'),JSON.stringify(after,null,2));
assert.equal(after.digest,before.digest,'Build inputs changed; do not qualify this archive');
const manifest: Record<string, string>={};
function retain(source: string,name: string){const target=path.join(destination,name);fs.copyFileSync(source,target,fs.constants.COPYFILE_EXCL);manifest[name]=crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');}
// Retain exactly the build verify-apks checked, with its flag state.
const verification: {testMocks: boolean; runtimeProfile?: string; updateChannel: unknown; results: {file: string; sha256: string}[]}=JSON.parse(fs.readFileSync(path.join(sourceDir,'apk-manifest.json'),'utf8'));
assert.equal(verification.testMocks,false,'Archive expects a flag-off build');
assert.equal(verification.runtimeProfile||'native',runtimeProfile,'Verified APK runtime profile differs from archive');
assert.deepEqual(verification.updateChannel,updateChannel,'Verified APK update channel differs from archive');
// apk-manifest.json is the name->hash map of the archived APKs;
// the release mapping is retained beside it with its own hash.
const mappings: Record<string,string>={};
const variant='launcher';
const releases=['release','release-unsigned'].filter(suffix=>fs.existsSync(path.join(sourceDir,`${variant}-${suffix}.apk`)));
assert.equal(releases.length,1,`Expected exactly one ${variant} release APK`);
for(const suffix of ['debug',releases[0]]){
 const name=`${variant}-${suffix}.apk`;
 const row=verification.results.find(entry=>entry.file===path.join(sourceDir,name));
 assert.ok(row,`${sourceDir}/${name} is not in the verified APK manifest`);
 retain(path.join(sourceDir,name),name);
 assert.equal(manifest[name],row.sha256,`${sourceDir}/${name} changed after verification`);
}
retain(`android/app/build/outputs/apk/androidTest/${variant}/debug/app-${variant}-debug-androidTest.apk`,`${variant}-androidTest.apk`);
const mapping=path.join(sourceDir,'mapping',`${variant}-release-mapping.txt`);
if(fs.existsSync(mapping)){
 const target=path.join(destination,`${variant}-release-mapping.txt`);
 fs.copyFileSync(mapping,target,fs.constants.COPYFILE_EXCL);
 mappings[`${variant}-release-mapping.txt`]=crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
}
fs.writeFileSync(path.join(destination,'release-mappings.json'),JSON.stringify(mappings,null,2)+'\n',{flag:'wx'});
fs.copyFileSync(path.join(sourceDir,'apk-manifest.json'),path.join(destination,'apk-verification.json'),fs.constants.COPYFILE_EXCL);
// Preserve the exact web payload from the hash-checked, archived APK.
archiveWebPayload(path.join(destination,'launcher-debug.apk'),path.join(destination,'web-dist'));
fs.writeFileSync(path.join(destination,'apk-manifest.json'),JSON.stringify(manifest,null,2));
console.log(JSON.stringify({archive:destination,sourceFingerprint:after.digest,apks:Object.keys(manifest).length}));
