// The always-on listener's own qualification row (android/sense/qualified-listener.json). Record and
// row checks only: no listener APK is built, installed or run here, and nothing here qualifies it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LISTENER_RECORD,listenerApkRow,listenerManifestSection,listenerRecordProblems,readListenerRecord} from '../scripts/listener-qualification.ts';

const root=path.resolve(import.meta.dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const record=readListenerRecord(root);

test('the committed listener record is well formed and honestly not device-qualified',()=>{
 assert.deepEqual(listenerRecordProblems(record),[]);
 assert.equal(record.packageName,'ai.elizaresearch.alphaphone.sense');
 assert.equal(record.qualified,false);assert.equal(record.distributable,false);
 for(const gate of ['G1','G2','G3','G4','G5','G6'])assert.equal(record.gates[gate],'open',gate);
 assert.equal(record.evidence.apkBuild.current,false,'the historical sense build predates the indicator lease');
 assert.ok(fs.existsSync(path.join(root,record.evidence.apkBuild.record)));
 const hostTests=record.evidence.hostTests.scope.match(/(?:vendor\/eliza\/[\w./-]+|test)\/[\w./-]+\.test\.mjs/g)??[];
 assert.ok(hostTests.includes('test/always-on-listener.test.mjs'),'the record names the tests that run');
 for(const file of hostTests)assert.ok(fs.existsSync(path.join(root,file)),`host test named in the record exists: ${file}`);
 assert.deepEqual([record.evidence.emulator.recorded,record.evidence.aospImage.recorded,record.evidence.deviceAcceptance.recorded],[false,false,false]);
 assert.deepEqual([record.indicatorLease.implemented,record.indicatorLease.systemUiCompiled,record.indicatorLease.qualified],['source',false,false]);
 const chip=JSON.parse(read('vendor/eliza/packages/os/android/sense/systemui/chip/manifest.json'));
 assert.equal(chip.indicatorHealthLease.systemUiCompiled,record.indicatorLease.systemUiCompiled,'chip manifest and listener record agree');
 assert.equal(chip.indicatorHealthLease.qualified,record.indicatorLease.qualified);
});

test('the schema refuses unearned qualification and distribution',()=>{
 const claim=change=>listenerRecordProblems({...record,...change});
 assert.match(claim({qualified:true}).join('\n'),/qualified needs every gate/);
 assert.match(claim({distributable:true}).join('\n'),/unqualified listener cannot be distributable/);
 const allGates=Object.fromEntries(['G1','G2','G3','G4','G5','G6'].map(gate=>[gate,'passed']));
 assert.match(claim({qualified:true,gates:allGates}).join('\n'),/qualified needs/,'passed gates without image and device evidence');
 assert.match(claim({indicatorLease:{...record.indicatorLease,qualified:true}}).join('\n'),/before SystemUI compiles it/);
 assert.match(claim({packageName:'ai.elizaresearch.alphaphone'}).join('\n'),/packageName/);
 assert.match(claim({gates:{...record.gates,G3:'skipped'}}).join('\n'),/gate G3/);
 assert.match(claim({evidence:{...record.evidence,apkBuild:{...record.evidence.apkBuild,record:'docs/evidence/missing.json'}}}).join('\n'),/committed evidence file/);
});

test('the APK build record must be a regular file inside the given root',t=>{
 const apkRecord=file=>listenerRecordProblems({...record,evidence:{...record.evidence,apkBuild:{...record.evidence.apkBuild,record:file}}},undefined,root).join('\n');
 for(const file of [undefined,'',' ','docs/evidence','../alphaphone/'+record.evidence.apkBuild.record,'docs/../'+record.evidence.apkBuild.record,path.join(root,record.evidence.apkBuild.record)])
  assert.match(apkRecord(file),/committed evidence file/,String(file));
 assert.equal(apkRecord(record.evidence.apkBuild.record),'');
 const other=fs.mkdtempSync(path.join(os.tmpdir(),'listener-root-'));
 t.after(()=>fs.rmSync(other,{recursive:true,force:true}));
 assert.match(listenerRecordProblems(record,undefined,other).join('\n'),/committed evidence file/,'resolved under the root passed in, not the module root');
});

test('image or device evidence captured from fixtures is refused',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'listener-root-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const write=(file,value)=>{fs.mkdirSync(path.dirname(path.join(dir,file)),{recursive:true});fs.writeFileSync(path.join(dir,file),JSON.stringify(value));};
 write(record.evidence.apkBuild.record,{});
 write('docs/evidence/listener/fixture.json',{schema:'alpha-listener-evidence-v1',captureSource:'fixtures'});
 write('docs/evidence/listener/device.json',{schema:'alpha-listener-evidence-v1',captureSource:'adb'});
 assert.deepEqual(listenerRecordProblems(record,undefined,dir),[]);
 const claim=(name,file)=>listenerRecordProblems({...record,evidence:{...record.evidence,[name]:{recorded:true,record:file}}},undefined,dir).join('\n');
 assert.match(claim('deviceAcceptance','docs/evidence/listener/fixture.json'),/deviceAcceptance\.record is fixture evidence/);
 assert.match(claim('aospImage','docs/evidence/listener/fixture.json'),/aospImage\.record is fixture evidence/);
 assert.equal(claim('deviceAcceptance','docs/evidence/listener/device.json'),'');
});

test('listener APK rows are APK-build evidence only and never distributable while unqualified',()=>{
 const facts={file:'artifacts/sense-release.apk',mode:'release',signed:true,signerSha256:'a'.repeat(64),sha256:'b'.repeat(64),packageName:record.packageName,
  requested:['android.permission.RECORD_AUDIO','android.permission.CAPTURE_AUDIO_HOTWORD'],voiceBundle:{packaged:true,abis:['arm64-v8a']}};
 const row=listenerApkRow(record,facts);
 assert.deepEqual(row.problems,[]);
 assert.equal(row.evidence,'apk-build');assert.equal(row.qualified,false);assert.equal(row.indicatorLeaseQualified,false);assert.equal(row.distributable,false);
 assert.equal(row.networkPermission,false);assert.equal(row.record,LISTENER_RECORD);
 const earned={...record,qualified:true,distributable:true};
 assert.equal(listenerApkRow(earned,facts).distributable,true,'only a qualified record could ever admit one');
 assert.equal(listenerApkRow(earned,{...facts,mode:'debug'}).distributable,false);
 assert.equal(listenerApkRow(earned,{...facts,signed:false,signerSha256:null}).distributable,false);
 assert.match(listenerApkRow(record,{...facts,requested:[...facts.requested,'android.permission.INTERNET']}).problems.join(),/network permission/);
 assert.match(listenerApkRow(record,{...facts,packageName:'ai.elizaresearch.alphaphone'}).problems.join(),/expected ai\.elizaresearch\.alphaphone\.sense/);
 assert.match(listenerApkRow(record,{...facts,permissionProblem:'outside the reviewed set'}).problems.join(),/reviewed set/);
 const section=listenerManifestSection(record,[]);
 assert.equal(section.qualified,false);
 assert.deepEqual(section.blockers.length,3);
 assert.match(section.blockers.join(),/no listener APK/);assert.match(section.blockers.join(),/not device-qualified/);assert.match(section.blockers.join(),/indicator lease/);
});

test('verify-apks writes the listener section into apk-manifest.json and fails on an unsafe listener APK',()=>{
 const source=read('scripts/verify-apks.ts');
 assert.match(source,/const listenerRecord = readListenerRecord\(\);/);
 assert.match(source,/\["sense-debug\.apk", "debug", true\], \["sense-release\.apk", "release", true\], \["sense-release-unsigned\.apk", "release", false\]/);
 assert.match(source,/checkListenerPermissions\(dump,/);
 assert.match(source,/throw new Error\(`Listener APK verification failed/);
 assert.match(source,/runtimePackaging,\n      listener,\n/);
 assert.doesNotMatch(read('docs/adr/0001-privileged-listener.md'),/no apk-manifest\/qualification row of its own yet/);
 assert.match(read('docs/adr/0001-privileged-listener.md'),/android\/sense\/qualified-listener\.json/);
 assert.match(read('docs/verification.md'),/android\/sense\/qualified-listener\.json/);
});
