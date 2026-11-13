#!/usr/bin/env bun
/** Disposable emulator probe of the actual PackageInstaller callback and receipt across a process kill. */
import assert from 'node:assert/strict';
import {execFileSync, type SpawnSyncReturns} from 'node:child_process';
import {sha256File as sha} from './sha256.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const option=(key:string)=>process.argv.slice(2).find(argument=>argument.startsWith(`--${key}=`))?.slice(key.length+3);
const serial=option('serial'),api=option('api')??'36',output=option('output');
assert(process.argv.includes('--owned-emulator')&&serial&&/^emulator-\d+$/.test(serial)&&output&&(api==='36'||api==='37'),
 'Use --owned-emulator --serial=emulator-PORT --api=36|37 --output=NEW_DIRECTORY');
assert(!fs.existsSync(output),'Output must be a new directory.');fs.mkdirSync(output,{recursive:true});
const sdk=process.env.ANDROID_HOME??path.join(os.homedir(),'Library/Android/sdk');
const tools=path.join(sdk,'build-tools/36.0.0'),jar=path.join(sdk,'platforms/android-36/android.jar');
const java=process.env.JAVA_HOME??'/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home';
const env={...process.env,JAVA_HOME:java,PATH:`${java}/bin:${process.env.PATH}`};
const run=(command:string,args:string[])=>execFileSync(command,args,{encoding:'utf8',env,timeout:scaledTimeout(120000),stdio:['ignore','pipe','pipe']}).trim();
const adb=(...args:string[])=>run(path.join(sdk,'platform-tools/adb'),['-s',serial,...args]);
const pkg='ai.alphacompute.alphaphone.pendingotafixture',host='ai.alphacompute.alphaphone',activity=`${pkg}/${host}.ContinuationActivity`;
const pathOrEmpty=()=>{try{return adb('shell','pm','path','--user','0',pkg);}catch(error){const failure=error as Partial<SpawnSyncReturns<string>>;if(failure.status===1&&!String(failure.stdout??'').trim()&&!String(failure.stderr??'').trim())return '';throw error;}};
const wait=async<T>(check:()=>T|null|undefined|false,label:string)=>{for(let i=0;i<60;i++){let value;try{value=check();}catch{}if(value)return value;await new Promise(resolve=>setTimeout(resolve,500));}throw Error(`Timed out waiting for ${label}`);};
const read=(name:string)=>JSON.parse(adb('exec-out','run-as',pkg,'cat',`files/${name}.json`));
const start=(phase:string)=>adb('shell','am','start','--user','0','-W','-n',activity,'--es','phase',phase);
const work=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-ota-confirmation-'));
const main='android/app/src/main/java/ai/alphacompute/alphaphone/';
const sources=[main+'AlphaUpdateStatusReceiver.java',main+'UpdateConfirmationReceipt.java','test/fixtures/update-confirmation-android/ContinuationActivity.java','vendor/eliza/plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/updater/RuntimeUpdatePause.java'];
const record:Record<string,unknown>={scope:'API platform fixture with production callback receiver, confirmation receipt and pause journal',outcome:'failed',serial,api,sources:Object.fromEntries(sources.map(file=>[file,sha(path.join(root,file))]))};
let installed=false;
try{
 assert.equal(adb('shell','getprop','ro.kernel.qemu'),'1','Refuse physical hardware');
 assert.equal(adb('shell','am','get-current-user'),'0','Use the owned emulator in Android user 0');
 record.user=0;
 assert.equal(adb('shell','getprop','ro.build.version.sdk'),api);assert.equal(adb('shell','getprop','sys.boot_completed'),'1');
 record.fingerprint=adb('shell','getprop','ro.build.fingerprint');assert.equal(pathOrEmpty(),'','Refuse a preexisting fixture package');
 const compat=path.join(work,'IntentCompat.java');fs.writeFileSync(compat,'package androidx.core.content; public final class IntentCompat {public static <T> T getParcelableExtra(android.content.Intent intent,String key,Class<T> type){return intent.getParcelableExtra(key,type);}}');
 const classes=path.join(work,'classes'),dex=path.join(work,'dex');fs.mkdirSync(classes);fs.mkdirSync(dex);
 run(path.join(java,'bin/javac'),['--release','11','-classpath',jar,'-d',classes,compat,...sources.map(file=>path.join(root,file))]);
 const classFiles=fs.readdirSync(classes,{recursive:true,encoding:'utf8'}).filter(file=>file.endsWith('.class')).map(file=>path.join(classes,file));
 run(path.join(tools,'d8'),['--min-api','33','--lib',jar,'--output',dex,...classFiles]);
 const keystore=path.join(work,'fixture.p12');
 run(path.join(java,'bin/keytool'),['-genkeypair','-noprompt','-keystore',keystore,'-storetype','PKCS12','-storepass','android','-keypass','android','-alias','fixture','-keyalg','RSA','-keysize','2048','-validity','2','-dname','CN=Disposable OTA Continuation Fixture']);
 const apks=[1,2].map(version=>{
  const manifestDir=path.join(work,String(version));fs.mkdirSync(manifestDir);
  const manifest=path.join(manifestDir,'AndroidManifest.xml'),apk=path.join(output,`fixture-${version}.apk`);
  fs.writeFileSync(manifest,`<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="${pkg}" android:versionCode="${version}" android:versionName="${version}"><uses-sdk android:minSdkVersion="33" android:targetSdkVersion="36"/><uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES"/><queries><intent><action android:name="android.content.pm.action.CONFIRM_INSTALL"/></intent></queries><application android:name="${host}.ContinuationActivity$FixtureApplication" android:label="Disposable OTA Continuation Fixture" android:debuggable="true" android:allowBackup="false"><activity android:name="${host}.ContinuationActivity" android:exported="true" android:launchMode="singleTop"/><receiver android:name="${host}.AlphaUpdateStatusReceiver" android:exported="false"/></application></manifest>`);
  run(path.join(tools,'aapt'),['package','-f','-M',manifest,'-I',jar,'-F',apk]);run('zip',['-q','-j',apk,path.join(dex,'classes.dex')]);
  run(path.join(tools,'apksigner'),['sign','--ks',keystore,'--ks-pass','pass:android','--key-pass','pass:android','--ks-key-alias','fixture',apk]);return apk;
 });
 record.apks=apks.map(file=>({file:path.basename(file),sha256:sha(file)}));
 installed=true;adb('install','--user','0','--no-incremental',apks[0]);adb('shell','cmd','appops','set','--user','0',pkg,'REQUEST_INSTALL_PACKAGES','allow');
 const remote=`/data/local/tmp/alpha-ota-continuation-${process.pid}.apk`;adb('push',apks[1],remote);
 try{adb('shell',`run-as ${pkg} sh -c 'mkdir -p files; cat ${remote} > files/candidate.apk'`);}finally{adb('shell','rm',remote);}
 start('install');const attempt=await wait(()=>read('attempt'),'committing fixture');record.attempt=attempt;
 await wait(()=>adb('shell','run-as',pkg,'ls','no_backup/app-update-confirmation'),'delivered pending status receipt');
 // The durable callback can finish just after its receipt becomes visible.
 // Retry the background kill and allow only this exact disposable process.
 let killAttempts=0;
 await wait(()=>{
  let running:string;
  try{running=adb('shell','pidof',pkg);}catch(error){if((error as Partial<SpawnSyncReturns<string>>).status===1)return 'absent';throw error;}
  if(running==='')return 'absent';
  if(running!==String(attempt.pid))throw Error('Unexpected fixture process identity');
  killAttempts++;
  adb('shell','am','kill','--user','0',pkg);
  return null;
 },'original fixture process to die');
 record.killAttempts=killAttempts;
 start('readback');const recovered=await wait(()=>read('readback'),'new process readback');record.recovered=recovered;
 assert.notEqual(recovered.pid,attempt.pid);assert.equal(recovered.session,attempt.session);assert.equal(recovered.canContinue,true);assert.equal(recovered.version,1);
 start('continue');const continuation=await wait(()=>read('continued'),'explicit confirmation launch');record.continuation=continuation;
 assert.equal(continuation.session,attempt.session);assert.equal(continuation.action,'android.content.pm.action.CONFIRM_INSTALL');
 await wait(()=>adb('shell','dumpsys','activity','activities').split('\n').some(line=>line.includes('topResumedActivity')&&line.includes(continuation.systemPackage)),'Android installer UI to take foreground');
 record.systemConfirmationOpened=true;
 // This fixture only exercises the handoff. Dismiss the system UI without approving a replacement.
 adb('shell','input','keyevent','KEYCODE_BACK');
 record.outcome='passed';
}catch(error){record.error=error instanceof Error?error.message:String(error);try{record.fixtureError=read('error');}catch{}throw error;}
finally{
 if(installed){try{record.cleanup=adb('uninstall','--user','0',pkg);assert.equal(pathOrEmpty(),'');}catch(error){record.outcome='failed';record.cleanupFailure=String(error);}}
 fs.rmSync(work,{recursive:true,force:true});fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(record,null,2)+'\n');
 console.log(JSON.stringify({outcome:record.outcome,output}));if(record.outcome!=='passed')process.exitCode=1;
}
