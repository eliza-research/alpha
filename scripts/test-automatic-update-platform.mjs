#!/usr/bin/env node
/** Explicit owned-emulator OS self-update probe. No product APK, network, account or physical-device qualification. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),value=name=>args.find(arg=>arg.startsWith(`--${name}=`))?.slice(name.length+3);
assert(args.includes('--owned-emulator'),'Pass --owned-emulator for a disposable emulator owned by this campaign.');
const serial=value('serial');assert(/^emulator-\d+$/.test(serial??''),'An explicit emulator serial is required.');
const output=path.resolve(value('output')??path.join(root,'test-results/automatic-update-platform',new Date().toISOString().replace(/[:.]/g,'-')));
assert(!fs.existsSync(output),'Output must be a new directory.');fs.mkdirSync(output,{recursive:true});
const sdk=process.env.ANDROID_HOME??path.join(os.homedir(),'Library/Android/sdk'),tools=path.join(sdk,'build-tools/36.0.0'),jar=path.join(sdk,'platforms/android-36/android.jar');
const java=process.env.JAVA_HOME??'/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home';
const env={...process.env,JAVA_HOME:java,PATH:`${java}/bin:${process.env.PATH}`};
const command=(file,args,options={})=>execFileSync(file,args,{encoding:'utf8',env,timeout:60000,stdio:['ignore','pipe','pipe'],...options});
const adb=(...args)=>command(path.join(sdk,'platform-tools/adb'),['-s',serial,...args]);
const pkg='ai.alphacompute.alphaphone.otafixture',activity=`${pkg}/${pkg}.OtaActivity`;
const packagePath=()=>{try{return adb('shell','pm','path',pkg).trim();}catch(error){if(error.status===1&&!String(error.stdout??'').trim()&&!String(error.stderr??'').trim())return '';throw error;}};
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const work=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-ota-platform-'));let installed=false;
const record={schema:'alpha-automatic-update-platform-v1',scope:'Android PackageInstaller self-update API only; not Alpha APK, renderer, HTTPS, AOSP image, physical-device or user acceptance',serial,sourceCommit:command('git',['rev-parse','HEAD'],{cwd:root}).trim(),outcome:'failed'};
record.sources=Object.fromEntries(['scripts/test-automatic-update-platform.mjs','test/fixtures/automatic-update-android/OtaActivity.java','android/app/src/main/java/ai/alphacompute/alphaphone/AlphaDevicePlugin.java'].map(file=>[file,sha(path.join(root,file))]));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const read=name=>JSON.parse(adb('exec-out','run-as',pkg,'cat',`files/${name}`));
async function waitRead(name,predicate=()=>true){for(let i=0;i<60;i++){try{const value=read(name);if(predicate(value))return value;}catch{}await pause(1000);}throw new Error(`Timed out waiting for ${name}`);}
try{
 assert.equal(adb('shell','getprop','ro.kernel.qemu').trim(),'1','Refuse physical devices.');
 record.sdkInt=Number(adb('shell','getprop','ro.build.version.sdk').trim());assert.equal(record.sdkInt,36,'This fixture campaign qualifies only API 36.');
 for(let i=0;i<120&&adb('shell','getprop','sys.boot_completed').trim()!=='1';i++)await pause(1000);
 assert.equal(adb('shell','getprop','sys.boot_completed').trim(),'1','The disposable emulator must finish booting.');
 record.fingerprint=adb('shell','getprop','ro.build.fingerprint').trim();
 assert.equal(packagePath(),'','Refuse an existing fixture package.');
 const source=fs.readFileSync(path.join(root,'android/app/src/main/java/ai/alphacompute/alphaphone/AlphaDevicePlugin.java'),'utf8');
 const capability=source.match(/ static String automaticUpdateStatus\(Context context\)\{[\s\S]*?\n \}/)?.[0];
 const configuration=source.match(/      if\(automatic&&Build\.VERSION\.SDK_INT>=31\)params\.setRequireUserAction\(PackageInstaller\.SessionParams\.USER_ACTION_NOT_REQUIRED\);/)?.[0];
 assert(capability&&configuration,'Production automatic admission and session policy must exist.');
 const policy=`package ${pkg};\nimport android.content.Context;\nimport android.content.pm.PackageInstaller;\nimport android.os.Build;\nfinal class SourcePolicy {\n${capability}\nstatic void configure(PackageInstaller.SessionParams params,boolean automatic){${configuration.trim()}}\n}\n`;
 fs.writeFileSync(path.join(work,'SourcePolicy.java'),policy);record.productionPolicySha256=createHash('sha256').update(policy).digest('hex');
 command(path.join(java,'bin/keytool'),['-genkeypair','-noprompt','-keystore',path.join(work,'fixture.p12'),'-storetype','PKCS12','-storepass','android','-keypass','android','-alias','fixture','-keyalg','RSA','-keysize','2048','-validity','2','-dname','CN=Disposable OTA Platform Fixture']);
 fs.mkdirSync(path.join(work,'classes'));fs.mkdirSync(path.join(work,'dex'));
 command(path.join(java,'bin/javac'),['-source','17','-target','17','-classpath',jar,'-d',path.join(work,'classes'),path.join(work,'SourcePolicy.java'),path.join(root,'test/fixtures/automatic-update-android/OtaActivity.java')]);
 const classFiles=fs.readdirSync(path.join(work,'classes'),{recursive:true}).filter(file=>file.endsWith('.class')).map(file=>path.join(work,'classes',file));
 command(path.join(tools,'d8'),['--min-api','31','--lib',jar,'--output',path.join(work,'dex'),...classFiles]);
 const apks=[];
 for(const version of [1,2]){
  const apk=path.join(output,`fixture-${version}.apk`),manifestDirectory=path.join(work,`version-${version}`);fs.mkdirSync(manifestDirectory);
  const manifest=path.join(manifestDirectory,'AndroidManifest.xml');
  fs.writeFileSync(manifest,`<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="${pkg}" android:versionCode="${version}" android:versionName="${version}"><uses-sdk android:minSdkVersion="31" android:targetSdkVersion="36"/><uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES"/><uses-permission android:name="android.permission.UPDATE_PACKAGES_WITHOUT_USER_ACTION"/><application android:label="Disposable OTA API fixture" android:debuggable="true" android:allowBackup="false"><activity android:name="${pkg}.OtaActivity" android:exported="true" android:launchMode="singleTop"/><receiver android:name="${pkg}.OtaActivity$ResultReceiver" android:exported="false"/></application></manifest>`);
  command(path.join(tools,'aapt'),['package','-f','-M',manifest,'-I',jar,'-F',apk]);command('zip',['-q','-j',apk,path.join(work,'dex/classes.dex')]);
  command(path.join(tools,'apksigner'),['sign','--ks',path.join(work,'fixture.p12'),'--ks-pass','pass:android','--key-pass','pass:android','--ks-key-alias','fixture',apk]);
  apks.push(apk);
 }
 record.apks=apks.map(file=>({file:path.basename(file),sha256:sha(file)}));
 record.signer=command(path.join(tools,'apksigner'),['verify','--print-certs',apks[0]]).match(/Signer #1 certificate SHA-256 digest: ([0-9a-f]+)/)?.[1];assert(record.signer);
 // Own cleanup before crossing the install call: a timeout can lose Android's successful reply.
 installed=true;command(path.join(sdk,'platform-tools/adb'),['-s',serial,'install','--no-incremental',apks[0]],{timeout:180000});
 adb('shell','am','start','-W','-n',activity,'--es','phase','prepare');record.baseline=await waitRead('baseline.json');
 assert.equal(record.baseline.versionCode,1);assert.equal(record.baseline.keystoreValueRetained,true);
 const remote=`/data/local/tmp/alpha-ota-${process.pid}.apk`;adb('push',apks[1],remote);
 try{adb('shell',`run-as ${pkg} sh -c 'cat ${remote} > files/candidate.apk'`);}finally{adb('shell','rm',remote);}
 adb('shell','am','start','-W','-n',activity,'--es','phase','install','--es','sha256',record.apks[1].sha256);
 record.withoutConsent=await waitRead('attempt.json');assert.equal(record.withoutConsent.status,'permission-required');
 adb('shell','am','start','-W','-n',activity,'--es','phase','readback');record.afterDenied=await waitRead('readback.json');
 assert.equal(record.afterDenied.versionCode,1);assert.equal(record.afterDenied.sessionCount,0);assert.equal(record.afterDenied.ciphertextSha256,record.baseline.ciphertextSha256);
 // Synthetic consent on this disposable fixture only; production requires the owner's Android choice.
 adb('shell','cmd','appops','set',pkg,'REQUEST_INSTALL_PACKAGES','allow');
 adb('shell','am','start','-W','-n',activity,'--es','phase','install','--es','sha256',record.apks[1].sha256);
 record.earlyAutomatic=await waitRead('attempt.json',value=>value.status==='starting'||value.status==='committing');
 if(record.earlyAutomatic.status==='starting'){
  // A proven admission refusal has no session to retry. Observe the real native
  // capability until it is ready; never replay a request that reached commit.
  record.readinessObservations=[];let observedAt=record.earlyAutomatic.uptimeMillis,supported=false;
  for(let i=0;i<60;i++){
   adb('shell','am','start','-W','-n',activity,'--es','phase','readback');
   const state=await waitRead('readback.json',value=>value.uptimeMillis>observedAt);observedAt=state.uptimeMillis;
   assert.equal(state.versionCode,1);assert.equal(state.sessionCount,0,'A starting attempt must not create an installer session.');
   for(const key of ['uid','firstInstallTime','preference','signerSha256','ciphertextSha256'])assert.equal(state[key],record.baseline[key],`${key} stays unchanged while starting`);
   assert.equal(state.keystoreValueRetained,true);record.readinessObservations.push(state);
   if(state.automaticCapability==='supported'){supported=true;break;}
   assert.equal(state.automaticCapability,'starting');await pause(1000);
  }
  assert(supported,'Native automatic update capability must become supported within the bounded readiness poll.');
  adb('shell','am','start','-W','-n',activity,'--es','phase','install','--es','sha256',record.apks[1].sha256);
  record.attempt=await waitRead('attempt.json',value=>value.status==='committing');
 }else record.attempt=record.earlyAutomatic;
 // Android may defer a background manifest broadcast until this package is active. Observe the
 // installed successor independently, then launch only readback (never Android's confirmation).
 let replaced=false;
 for(let i=0;i<120;i++){
  const facts=adb('shell','dumpsys','package',pkg);
  if(/\bversionCode=2\b/.test(facts)){replaced=true;break;}
  try{const status=read('status.json');assert.notEqual(status.status,-1,'Automatic replacement must not need user action.');}catch(error){if(error.code==='ERR_ASSERTION')throw error;}
  await pause(1000);
 }
 assert(replaced,'Android must install version 2 without a confirmation handoff.');record.installedSuccessorObserved=true;
 adb('shell','am','start','-W','-n',activity,'--es','phase','readback');record.successor=await waitRead('readback.json',value=>value.versionCode===2);
 record.status=await waitRead('status.json');assert.equal(record.status.status,0,'The committed session must report successful installation.');assert.equal(record.status.session,record.attempt.session);
 for(const key of ['uid','firstInstallTime','preference','signerSha256','ciphertextSha256'])assert.equal(record.successor[key],record.baseline[key],`${key} survives self-update`);
 assert.equal(record.successor.keystoreValueRetained,true);assert.notEqual(record.successor.pid,record.attempt.pid,'Self-update replaces the process.');
 assert.equal(record.successor.signerSha256,record.signer);assert(record.successor.lastUpdateTime>=record.baseline.lastUpdateTime);
 const installedPath=packagePath().replace(/^package:/,'');const pulled=path.join(output,'installed-successor.apk');adb('pull',installedPath,pulled);assert.equal(sha(pulled),record.apks[1].sha256);record.installedApkSha256=sha(pulled);
 record.outcome='passed';
}catch(error){
 record.failure=error.message;
 if(installed){
  try{record.fixtureError=read('error.json');}catch{}
  try{record.lastReadback=read('readback.json');}catch{}
  try{record.lastStatus=read('status.json');}catch{}
  record.failureDiagnostics={};
  for(const [name,args] of [['package-dump',['shell','dumpsys','package',pkg]],['appops',['shell','cmd','appops','get',pkg]],['uptime',['shell','cat','/proc/uptime']]]){
   const file=`failure-${name}.txt`,destination=path.join(output,file);
   try{fs.writeFileSync(destination,adb(...args));record.failureDiagnostics[name]={file,sha256:sha(destination)};}
   catch(diagnostic){
    record.failureDiagnostics[name]={file,error:diagnostic.message};
    try{fs.writeFileSync(destination,String(diagnostic.stdout??'')+String(diagnostic.stderr??''));record.failureDiagnostics[name].sha256=sha(destination);}
    catch(writeError){record.failureDiagnostics[name].writeError=writeError.message;}
   }
  }
 }
 throw error;
}finally{
 if(installed){try{record.cleanup=adb('uninstall',pkg).trim();assert.equal(packagePath(),'');}catch(error){record.outcome='failed';record.cleanupFailure=error.message;}}
 fs.rmSync(work,{recursive:true,force:true});fs.writeFileSync(path.join(output,'results.json'),`${JSON.stringify(record,null,2)}\n`);
 console.log(JSON.stringify({outcome:record.outcome,output,scope:record.scope}));
 if(record.outcome!=='passed')process.exitCode=1;
}
