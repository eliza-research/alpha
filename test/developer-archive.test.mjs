import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {assembleDeveloperArchive,parseDeveloperArchiveArgs} from '../scripts/developer-archive.ts';

const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
/** A verify-apks output folder with synthetic bytes. */
function build(root,{testMocks=false}={}){
 const dir=path.join(root,'artifacts'),tests=path.join(dir,'instrumentation'),variant='launcher';
 fs.mkdirSync(tests,{recursive:true});
 fs.writeFileSync(path.join(dir,`${variant}-debug.apk`),`${variant} app`);fs.writeFileSync(path.join(tests,`${variant}-androidTest.apk`),`${variant} test`);
 const manifest={testMocks,results:[{variant,mode:'debug',sha256:sha(path.join(dir,`${variant}-debug.apk`)),versionCode:7},{variant,mode:'release',sha256:'0'.repeat(64),distributable:false}],
  instrumentation:{[variant]:{sha256:sha(path.join(tests,`${variant}-androidTest.apk`))}}};
 fs.writeFileSync(path.join(dir,'apk-manifest.json'),JSON.stringify(manifest));return dir;
}
const temporary=t=>{const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'developer-archive-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;};

test('developer archive holds the admitted APK pair under the campaign names with their hashes',t=>{
 const root=temporary(t),dir=build(root);
 const {target,manifest,record}=assembleDeveloperArchive({apkDir:'artifacts',destination:'test-results/archive',root,source:{commit:'a'.repeat(40),dirty:false}});
 const names=['launcher-androidTest.apk','launcher-debug.apk'];
 assert.deepEqual(Object.keys(manifest).sort(),names);
 assert.deepEqual(fs.readdirSync(target).sort(),['apk-manifest.json','archive-source.json',...names].sort());
 // The shape scripts/android-workflow-native.ts admits: every archived file hashes to its manifest entry.
 const written=JSON.parse(fs.readFileSync(path.join(target,'apk-manifest.json'),'utf8'));
 for(const name of names)assert.equal(sha(path.join(target,name)),written[name],name);
 assert.equal(written['launcher-debug.apk'],sha(path.join(dir,'launcher-debug.apk')));
 assert.equal(written['launcher-androidTest.apk'],sha(path.join(dir,'instrumentation/launcher-androidTest.apk')));
 assert.equal(record.kind,'developer-archive');assert.equal(record.qualifiedBuildArchive,false);assert.equal(record.testMocks,false);
 assert.equal(record.verifiedManifestSha256,sha(path.join(dir,'apk-manifest.json')));assert.deepEqual(record.versionCodes,{launcher:7});
 assert.deepEqual(record.source,{commit:'a'.repeat(40),dirty:false});
});
test('a build recorded with test mocks on is refused',t=>{
 const root=temporary(t);build(root,{testMocks:true});
 assert.throws(()=>assembleDeveloperArchive({apkDir:'artifacts',destination:'test-results/wrong',root}),/records testMocks=true/);
 assert.ok(!fs.existsSync(path.join(root,'test-results/wrong')));
});
test('an APK that differs from the verified manifest, or is missing, leaves no archive',t=>{
 const root=temporary(t),dir=build(root);
 fs.writeFileSync(path.join(dir,'instrumentation/launcher-androidTest.apk'),'rebuilt after verification');
 assert.throws(()=>assembleDeveloperArchive({apkDir:'artifacts',destination:'test-results/a',root}),/does not match the instrumentation APK recorded/);
 assert.ok(!fs.existsSync(path.join(root,'test-results/a')));
 build(root);fs.writeFileSync(path.join(dir,'launcher-debug.apk'),'replaced');
 assert.throws(()=>assembleDeveloperArchive({apkDir:'artifacts',destination:'test-results/b',root}),/does not match the verified/);
 build(root);fs.rmSync(path.join(dir,'launcher-debug.apk'));
 assert.throws(()=>assembleDeveloperArchive({apkDir:'artifacts',destination:'test-results/c',root}),/Missing/);
 fs.rmSync(path.join(dir,'apk-manifest.json'));
 assert.throws(()=>assembleDeveloperArchive({apkDir:'artifacts',destination:'test-results/d',root}),/apk-manifest\.json is missing/);
 assert.ok(!fs.existsSync(path.join(root,'test-results')));
});
test('the destination is a new folder beneath test-results',t=>{
 const root=temporary(t);build(root);
 assert.throws(()=>assembleDeveloperArchive({apkDir:'artifacts',destination:'artifacts/archive',root}),/beneath test-results/);
 assert.throws(()=>assembleDeveloperArchive({apkDir:'artifacts',destination:'test-results/../outside',root}),/beneath test-results/);
 assembleDeveloperArchive({apkDir:'artifacts',destination:'test-results/once',root});
 const before=sha(path.join(root,'test-results/once/apk-manifest.json'));
 assert.throws(()=>assembleDeveloperArchive({apkDir:'artifacts',destination:'test-results/once',root}),/already exists/);
 assert.equal(sha(path.join(root,'test-results/once/apk-manifest.json')),before,'an existing archive is left as it was');
});
test('arguments: one destination, known options only',()=>{
 assert.deepEqual(parseDeveloperArchiveArgs(['test-results/x']),{apkDir:'artifacts',destination:'test-results/x'});
 assert.deepEqual(parseDeveloperArchiveArgs(['--apk-dir=out','test-results/x']),{apkDir:'out',destination:'test-results/x'});
 for(const argv of [[],['a','b'],['--force','test-results/x'],['--apk-dir']])assert.throws(()=>parseDeveloperArchiveArgs(argv),/Use: bun scripts\/developer-archive\.ts/);
});
test('the command prints the archive and its hashes',t=>{
 const root=temporary(t);build(root);
 spawnSync('git',['init','-q'],{cwd:root});spawnSync('git',['-c','user.email=t@example.invalid','-c','user.name=t','commit','-q','--allow-empty','-m','base'],{cwd:root});
 const run=spawnSync(process.execPath,[path.resolve('scripts/developer-archive.ts'),'test-results/cli'],{cwd:root,encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);assert.match(run.stdout,/^[0-9a-f]{64}  launcher-androidTest\.apk$/m);assert.match(run.stdout,/test-results\/cli \(developer archive; not a build-archive\.ts archive\)/);
 const record=JSON.parse(fs.readFileSync(path.join(root,'test-results/cli/archive-source.json'),'utf8'));assert.match(record.source.commit,/^[0-9a-f]{40}$/);
});
