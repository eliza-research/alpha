import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

function exercise(kind,mode='pass',bridge=false){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-upgrade-'));
 try{
  const pkg='ai.alphacompute.alphaphone',host=kind==='calendar'?'com.android.launcher3':'com.google.android.apps.nexuslauncher';
  fs.writeFileSync(path.join(root,'app.config.json'),JSON.stringify({appId:pkg}));
  for(const variant of ['standalone','launcher'])for(const [file,bytes] of [
   [`baseline/${variant}-debug.apk`,'baseline'],[`baseline/${variant}-test.apk`,'baseline-test'],[`artifacts/${variant}-debug.apk`,'candidate'],[`artifacts/instrumentation/${variant}-androidTest.apk`,'candidate-test'],
   // Shared Gradle outputs are overwritten by later builds; the runner must never install them.
   [`android/app/build/outputs/apk/androidTest/${variant}/debug/app-${variant}-debug-androidTest.apk`,'stale-gradle-output']
  ]){const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);}
  // The verified build record that pairs each candidate app with its instrumentation APK.
  const digest=text=>createHash('sha256').update(text).digest('hex');
  if(mode!=='candidate-unverified')fs.writeFileSync(path.join(root,'artifacts/apk-manifest.json'),JSON.stringify({testMocks:mode==='candidate-test-mocks',results:['standalone','launcher'].map(variant=>({variant,mode:'debug',sha256:digest('candidate'),versionCode:1})),instrumentation:Object.fromEntries(['standalone','launcher'].map(variant=>[variant,{sha256:digest(mode==='candidate-unpaired'&&variant==='launcher'?'another-build':'candidate-test')}]))}));
  if(mode==='candidate-app-replaced')fs.writeFileSync(path.join(root,'artifacts/launcher-debug.apk'),'rebuilt after verification');
  const adb=path.join(root,'platform-tools/adb'),aapt=path.join(root,'build-tools/36.0.0/aapt'),state=path.join(root,'state.json'),log=path.join(root,'commands.jsonl');
  fs.mkdirSync(path.dirname(adb),{recursive:true});fs.mkdirSync(path.dirname(aapt),{recursive:true});
  fs.writeFileSync(state,JSON.stringify({user:'0',exists:false,files:mode==='existing'?{[pkg]:'unowned'}:{}}));fs.writeFileSync(log,'');
  // Canned aapt output: a shell script, so each call does not start Node.
  const extraTest=mode!=='candidate-missing-runner',extraBaseline=['baseline-process','baseline-undeclared'].includes(mode);
  fs.writeFileSync(aapt,`#!/bin/sh
case "$3" in *androidTest*|*test?apk*) suffix=.test;; *) suffix=;; esac
case "$3" in *androidTest*) extra=${extraTest};; *) extra=${extraBaseline};; esac
if [ "$2" = badging ]; then
 echo "package: name='${pkg}$suffix'"
else
 printf '%s\\n' 'E: manifest' '  E: instrumentation' '    A: android:name="androidx.test.runner.AndroidJUnitRunner"' '    A: android:targetPackage="${pkg}"'
 if [ "$extra" = true ]; then printf '%s\\n' '  E: instrumentation' '    A: android:name="${pkg}.WorkflowNoticeProcessRunner"' '    A: android:targetPackage="${pkg}"'; fi
fi
`,{mode:0o700});
  fs.writeFileSync(adb,`#!/usr/bin/env bun
const fs=require('node:fs'),a=process.argv.slice(4),stateFile=${JSON.stringify(state)},s=JSON.parse(fs.readFileSync(stateFile)),pkg=${JSON.stringify(pkg)},mode=${JSON.stringify(mode)},host=${JSON.stringify(host)};
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(a)+'\\n');const save=()=>fs.writeFileSync(stateFile,JSON.stringify(s));
if(a[0]==='emu')console.log('owned-fixture\\nOK');
else if(a.includes('ro.kernel.qemu'))console.log('1');
else if(a.includes('ro.product.cpu.abi'))console.log('x86_64');
else if(a.includes('getenforce'))console.log('Enforcing');
else if(a.includes('get-current-user'))console.log(s.user);
else if(a.includes('create-user')){s.exists=true;save();console.log('Success: created user id 10');}
else if(a.includes('switch-user')){if(mode==='restore-failure'&&a.at(-1)==='0')process.exit(1);s.user=a.at(-1);save();}
else if(a.includes('remove-user')){s.exists=false;save();console.log('Success');}
else if(a.includes('is-user-stopped'))console.log('true');
else if(a.includes('users'))console.log('UserInfo{0:Owner:13}'+(s.exists?'\\nUserInfo{10:Fixture:10}':''));
else if(a.includes('packages')){if(mode==='candidate-rebuilt')fs.writeFileSync(${JSON.stringify(path.join(root,'artifacts/standalone-debug.apk'))},'rebuilt during the run');console.log(Object.keys(s.files).map(p=>'package:'+p).join('\\n'));}
else if(a.includes('resolve-activity'))console.log(host+'/.Launcher');
else if(a.includes('set-home-activity'))console.log('Success');
else if(a.includes('activities'))console.log('topResumedActivity=ActivityRecord u'+s.user+' '+host+'/.Launcher');
else if(a.includes('intents'))for(const route of ['alpha-reminder:upgrade_future/a','alpha-reminder:upgrade_repeat/b','alpha-reminder-tap:c'])console.log('requestIntent=Intent dat='+route+(mode==='changed-intents'&&s.candidate?'changed':'')+' cmp='+pkg+'/.Receiver');
else if(a[0]==='install'){const file=a.at(-1),id=/androidTest|test.apk/.test(file)?pkg+'.test':pkg,dest=stateFile+'.'+id+'.apk';fs.copyFileSync(file,dest);s.files[id]=dest;if(id===pkg)s.candidate=file.includes('/artifacts/');save();console.log('Success');}
else if(a.slice(0,3).join(' ')==='shell pm path')console.log('package:/data/'+a.at(-1)+'.apk');
else if(a[0]==='pull')fs.copyFileSync(s.files[a[1].slice(6,-4)],a[2]);
else if(a[0]==='uninstall'){delete s.files[a[1]];save();console.log('Success');}
else if(a.includes('force-stop')){if(mode==='stop-failure')process.exit(1);}
else if(a.includes('instrument')){const selector=a[a.indexOf('class')+1],parts=selector.split('#'),cls=parts[0],method=parts[1]||'reviewedNativeCreateReadUpdateDeleteAndStaleRevision',legacy=cls.endsWith('.WorkflowLegacyReminderUpgradeInstrumentedTest');
 if(legacy&&mode==='legacy-transport'){console.error('fixture transport');process.exit(1);}
 // The installed test APK is replaced on the device after the candidate verify phase.
 if(mode==='legacy-swapped'&&cls.endsWith('.ReminderUpgradeInstrumentedTest')&&a.includes('verify'))fs.writeFileSync(s.files[pkg+'.test'],'replaced on device');
 for(const code of mode==='stop-failure'?[1]:legacy&&mode==='legacy-skipped'?[1,-4]:legacy&&mode==='legacy-failed'?[1,-2]:[1,0])console.log('INSTRUMENTATION_STATUS: class='+cls+'\\nINSTRUMENTATION_STATUS: test='+method+'\\nINSTRUMENTATION_STATUS: numtests=1\\nINSTRUMENTATION_STATUS_CODE: '+code);console.log('OK (1 test)\\nINSTRUMENTATION_CODE: -1');}
else if(a.includes('start-user')||a.includes('stop-user')||a.includes('grant')||a[1]==='input'||a[1]==='wm'){}
else {console.error('Unexpected command '+JSON.stringify(a));process.exit(1);}
`,{mode:0o700});
  const prefix=`ALPHA_${kind.toUpperCase()}`,run=spawnSync(process.execPath,[path.resolve('scripts/test-installed-upgrade.ts'),kind,...(bridge?['--bridge']:[]),...(mode==='baseline-process'?['--baseline-process-runner']:[])],{encoding:'utf8',timeout:300000,env:{...process.env,ANDROID_HOME:root,ELIZA_DEVICE_LEASE_DIR:path.join(root,'leases'),[`${prefix}_TEST_ROOT`]:root,[`${prefix}_BASELINE_DIR`]:path.join(root,'baseline'),[`${prefix}_TEST_SERIAL`]:'emulator-5596',[`${prefix}_TEST_AVD`]:'owned-fixture',[`${prefix}_TEST_ABI`]:'x86_64'}});
  // Source authentication alone can exceed the old whole-fixture deadline.
  // Surface process failures before reading output that may never have been created.
  assert.ifError(run.error);
  const reports=fs.existsSync(path.join(root,'test-results'))?fs.readdirSync(path.join(root,'test-results')).flatMap(dir=>fs.readdirSync(path.join(root,'test-results',dir)).flatMap(variant=>{const file=path.join(root,'test-results',dir,variant,'result.json');return fs.existsSync(file)?[JSON.parse(fs.readFileSync(file,'utf8'))]:[];})):[];
  return {status:run.status,stderr:run.stderr,commands:fs.readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse),state:JSON.parse(fs.readFileSync(state,'utf8')),reports};
 }finally{fs.rmSync(root,{recursive:true,force:true});}
}
const legacyClass='ai.alphacompute.alphaphone.WorkflowLegacyReminderUpgradeInstrumentedTest',legacySelector=legacyClass+'#upgradedLegacyOneOffReminderIsIncludedInNativeDigest';
const instruments=r=>r.commands.filter(a=>a.includes('instrument'));
const installs=r=>r.commands.filter(a=>a[0]==='install').map(a=>a.at(-1));
// The plain reminder pass is identical for two tests below; run it once.
let reminderPass;const passRun=kind=>kind==='reminder'?reminderPass??=exercise('reminder'):exercise(kind,'pass',true);
for(const kind of ['calendar','reminder'])test(`${kind} upgrade delegates both variants and restores its owned fixture`,()=>{
 const r=passRun(kind);assert.equal(r.status,0,r.stderr);assert.equal(r.reports.length,2);assert.ok(r.reports.every(p=>p.passed&&p.ownerRestored&&!p.cleanupDeferred));assert.deepEqual(r.state.files,{});assert.equal(r.state.exists,false);assert.equal(r.state.user,'0');
 // Baseline seed, candidate verify and one companion class per distribution.
 assert.equal(instruments(r).length,6);
 if(kind==='reminder')assert.ok(r.reports.every(p=>p.intentPreservation.passed&&p.intentPreservation.routes===3));else assert.ok(r.reports.every(p=>p.bridge.totalTests===1));
 // The candidate pair is the verified artifacts pair, never the shared Gradle output.
 assert.ok(installs(r).some(file=>file.endsWith('artifacts/instrumentation/standalone-androidTest.apk'))&&installs(r).some(file=>file.endsWith('artifacts/instrumentation/launcher-androidTest.apk')));
 assert.ok(!installs(r).some(file=>file.includes('build/outputs')));
 assert.ok(r.reports.every(p=>/^[0-9a-f]{64}$/.test(p.candidate.appSha256)&&/^[0-9a-f]{64}$/.test(p.candidate.testSha256)&&p.failedPhase===undefined));
});
test('changed reminder intent routes fail without running candidate acceptance',()=>{
 const r=exercise('reminder','changed-intents');assert.notEqual(r.status,0);assert.match(r.stderr,/intent routes/);assert.equal(r.commands.filter(a=>a.includes('instrument')).length,1);assert.equal(r.state.exists,false);assert.deepEqual(r.state.files,{});
});
test('uncertain process termination preserves both APKs and the owned secondary user',()=>{
 const r=exercise('calendar','stop-failure');assert.notEqual(r.status,0);assert.equal(r.state.exists,true);assert.equal(Object.keys(r.state.files).length,2);assert.equal(r.state.user,'0');assert.equal(r.reports[0].cleanupDeferred,true);assert.ok(!r.commands.some(a=>a[0]==='uninstall'||a.includes('remove-user')));
});
test('existing product registration is rejected before a user or installation is created',()=>{
 const r=exercise('calendar','existing');assert.notEqual(r.status,0);assert.match(r.stderr,/Existing package registration/);assert.ok(!r.commands.some(a=>a[0]==='install'||a.includes('create-user')||a[0]==='uninstall'));
});

test('failed owner restoration retains the secondary user for recovery',()=>{
 const r=exercise('calendar','restore-failure');assert.notEqual(r.status,0);assert.equal(r.state.exists,true);assert.equal(r.reports[0].cleanupDeferred,true);assert.ok(!r.commands.some(a=>a.includes('remove-user')));
});

test('reminder can explicitly admit the known process runner in a newer baseline',()=>{
 const r=exercise('reminder','baseline-process');assert.equal(r.status,0,r.stderr);assert.equal(r.reports.length,2);
});
for(const mode of ['baseline-undeclared','candidate-missing-runner'])test(`reminder rejects ${mode} before installing any APK`,()=>{
 const r=exercise('reminder',mode);assert.notEqual(r.status,0);assert.ok(!r.commands.some(a=>a[0]==='install'));assert.deepEqual(r.state.files,{});assert.equal(r.reports[0].cleanupDeferred,true);
});

test('reminder upgrade runs the legacy workflow digest class on both distributions against the upgraded pair',()=>{
 const r=passRun('reminder');assert.equal(r.status,0,r.stderr);
 const calls=instruments(r),selectors=calls.map(a=>a[a.indexOf('class')+1]);
 assert.equal(selectors.filter(selector=>selector===legacySelector).length,2);
 for(const variant of [0,1]){
  const run=calls.slice(variant*3,variant*3+3);
  // Order per distribution: baseline seed, candidate verify, then the legacy digest in the verify phase.
  assert.deepEqual(run.map(a=>a[a.indexOf('reminderUpgrade')+1]),['seed','verify','verify']);
  assert.equal(run[2][run[2].indexOf('class')+1],legacySelector);
  assert.equal(run[2][run[2].indexOf('--user')+1],'10','runs in the owned secondary user');
 }
 // The companion runs only after both candidate APKs replaced the baseline pair, and before cleanup.
 for(const report of r.reports){
  assert.equal(report.legacyDigest.totalTests,1);assert.deepEqual(report.legacyDigest.cases,[legacySelector]);
  assert.deepEqual(report.companions.map(row=>[row.label,row.class,row.totalTests]),[['legacy-digest',legacyClass,1]]);
  assert.equal(report.companions[0].appSha256,report.candidate.appSha256);assert.equal(report.companions[0].testSha256,report.candidate.testSha256);
 }
 const firstLegacy=r.commands.findIndex(a=>a.includes('instrument')&&a.includes(legacySelector));
 assert.equal(r.commands.slice(0,firstLegacy).filter(a=>a[0]==='install').length,4,'baseline pair then candidate pair');
 assert.ok(r.commands.slice(0,firstLegacy).filter(a=>a[0]==='pull').length>=2,'installed bytes are re-read before the companion runs');
 assert.ok(!r.commands.slice(0,firstLegacy).some(a=>a[0]==='uninstall'));
});
for(const [mode,pattern] of [['legacy-skipped',/Skipped, failed or unsupported status|Failed or skipped/],['legacy-failed',/Skipped, failed or unsupported status|Failed or skipped/],['legacy-transport',/Command failed|fixture transport/]])test(`reminder upgrade propagates a ${mode} legacy digest phase and stops before the next distribution`,()=>{
 const r=exercise('reminder',mode);assert.notEqual(r.status,0);assert.match(r.stderr,pattern);
 assert.equal(r.reports.length,1,'the launcher distribution never runs after a failed phase');
 assert.equal(r.reports[0].passed,false);assert.equal(r.reports[0].failedPhase,'companion:legacy-digest');assert.equal(r.reports[0].legacyDigest,undefined);
 assert.equal(instruments(r).length,3);
 // The failed phase is not a cleanup failure: the owned fixture is still removed.
 assert.deepEqual(r.state.files,{});assert.equal(r.state.exists,false);assert.equal(r.state.user,'0');
});
test('a replaced installed test APK is refused before the legacy digest class is instrumented',()=>{
 const r=exercise('reminder','legacy-swapped');assert.notEqual(r.status,0);assert.match(r.stderr,/Installed test APK is not the admitted candidate pair/);
 assert.equal(r.reports[0].failedPhase,'companion:legacy-digest');
 assert.ok(!instruments(r).some(a=>a.includes(legacySelector)));
});
// One admission path serves both kinds: the full matrix runs for calendar, the pairing case for both.
for(const [mode,pattern,kinds] of [['candidate-unverified',/apk-manifest\.json is missing/,['calendar']],['candidate-unpaired',/does not match the instrumentation APK recorded/,['calendar','reminder']],['candidate-app-replaced',/does not match the verified/,['calendar']],['candidate-test-mocks',/records testMocks=true/,['calendar']]])for(const kind of kinds)test(`${kind} upgrade rejects a ${mode} candidate pair before touching the device`,()=>{
 const r=exercise(kind,mode);assert.notEqual(r.status,0);assert.match(r.stderr,pattern);
 assert.deepEqual(r.commands,[]);assert.deepEqual(r.reports,[]);assert.deepEqual(r.state.files,{});assert.equal(r.state.exists,false);
});
// A build that overwrites artifacts/ after admission must not be installed under the admitted hashes.
// Calendar without --bridge has no companion class, so only the preflight binding can refuse it.
test('calendar upgrade refuses a candidate rebuilt after admission before installing anything',()=>{
 const r=exercise('calendar','candidate-rebuilt');assert.notEqual(r.status,0);assert.match(r.stderr,/Candidate app changed after admission/);
 assert.ok(!r.commands.some(a=>a[0]==='install'||a.includes('instrument')));
 assert.equal(r.reports.length,1);assert.equal(r.reports[0].passed,false);assert.equal(r.reports[0].failedPhase,'admission');
 assert.deepEqual(r.state.files,{});assert.equal(r.state.exists,false);assert.equal(r.state.user,'0');
});
test('the upgrade runner refuses a missing or unknown kind with usage before touching a device',()=>{
 for(const args of [[],['photos']]){
  const run=spawnSync(process.execPath,[path.resolve('scripts/test-installed-upgrade.ts'),...args],{encoding:'utf8',timeout:30000,env:{...process.env,ANDROID_HOME:'/nonexistent'}});
  assert.equal(run.status,2,run.stderr);assert.match(run.stderr,/Usage: bun scripts\/test-installed-upgrade\.ts <calendar\|reminder>/);
 }
});
