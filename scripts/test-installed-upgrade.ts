import type {FixtureEvidence} from './host-fixture-types.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {verifyPinnedUpstream} from './pinned-upstream-source.ts';

/** Usage: node scripts/test-installed-upgrade.ts <calendar|reminder> [--bridge | --baseline-process-runner]
 * Alpha's fixture policy and scenarios; shared upstream code owns APK lifecycle.
 * The candidate app and instrumentation APK are admitted as one verified pair
 * (artifacts/apk-manifest.json from `npm run android:build`), and every companion class runs
 * only against that exact installed pair. Reminder upgrades also run
 * WorkflowLegacyReminderUpgradeInstrumentedTest after the candidate verify phase. Any failed,
 * skipped or missing phase is recorded with its name and fails the process.
 * Emulator-class evidence only: no live account, real integration or device acceptance. */
export async function testInstalledUpgrade(kind: any,options: any=process.argv.slice(3)){
 assert.ok(['calendar','reminder'].includes(kind));
 const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 verifyPinnedUpstream(repository);
 const {runIsolatedAndroidTest:sharedIsolatedAndroidTest}=await import(new URL('../vendor/eliza/packages/app/scripts/lib/isolated-android-test.mjs',import.meta.url).href);
 const runIsolatedAndroidTest=sharedIsolatedAndroidTest as unknown as import('./android-fixture-ports.ts').IsolatedAndroidTest;
 const {withIsolatedAndroidUser}=await import(new URL('../vendor/eliza/packages/app/scripts/lib/isolated-android-user.mjs',import.meta.url).href);
 const {acquireDeviceLease}=await import(new URL('../vendor/eliza/packages/app/scripts/lib/device-lease.ts',import.meta.url).href);
 const {requireInstrumentationSuccess}=await import('./instrumentation-result.ts');
 const {admitApks}=await import('./android-instrumentation.ts');
 const sha=(file: any)=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 const prefix=`ALPHA_${kind.toUpperCase()}`,root=process.env[`${prefix}_TEST_ROOT`]??repository;
 const baseline=process.env[`${prefix}_BASELINE_DIR`],serial=process.env[`${prefix}_TEST_SERIAL`],avd=process.env[`${prefix}_TEST_AVD`],abi=process.env[`${prefix}_TEST_ABI`];
 assert.ok(baseline&&path.isAbsolute(baseline),'Provide an absolute baseline directory');
 assert.match(serial??'',/^emulator-\d+$/);assert.match(avd??'',/^[A-Za-z0-9_.-]+$/);
 assert.ok(['arm64-v8a','x86_64'].includes(abi??''),'Explicit owned fixture ABI required');
 const sdk=process.env.ANDROID_HOME??process.env.ANDROID_SDK_ROOT;
 assert.ok(sdk&&path.isAbsolute(sdk),'Provide absolute ANDROID_HOME or ANDROID_SDK_ROOT');
 const adb=path.join(sdk,'platform-tools/adb'),aapt=path.join(sdk,'build-tools/36.0.0/aapt');
 const pkg=JSON.parse(fs.readFileSync(path.join(root,'app.config.json'),'utf8')).appId,testPkg=`${pkg}.test`;
 assert.equal(pkg,'ai.alphacompute.alphaphone');
 const bridge=options.includes('--bridge'),baselineProcessRunner=options.includes('--baseline-process-runner');
 assert.ok(options.every((arg: any)=>(kind==='calendar'&&arg==='--bridge')||(kind==='reminder'&&arg==='--baseline-process-runner')),'Unknown upgrade option');
 const currentRunners=[pkg+'.WorkflowNoticeProcessRunner'];
 const cancellation=new AbortController(),cancel=()=>cancellation.abort();
 const call=(...args: any[])=>execFileSync(adb,['-s',serial,...args],{encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024}).trim();
 const host=process.env.ALPHA_TEST_HOME_PACKAGE??(kind==='calendar'?'com.android.launcher3':'com.google.android.apps.nexuslauncher');
 const testClass=kind==='calendar'?'CalendarUpgradeInstrumentedTest':'ReminderUpgradeInstrumentedTest';
 const testMethod=kind==='calendar'?'baselineToCandidatePreservesCalendarIdentity':'installedUpgradePreservesIdentityAndReceipts';
 const flag=kind==='calendar'?'calendarUpgradePhase':'reminderUpgrade';
 const output=path.join(root,'test-results',`${kind}-upgrade-${Date.now()}-${process.pid}`);
 // Immutable pairing, admitted for both distributions before the device is leased or touched: the
 // candidate app and its instrumentation APK come from one verified distribution build. Shared
 // Gradle outputs are not used; a later build can overwrite them.
 const candidates=Object.fromEntries(['standalone','launcher'].map((variant: any)=>[variant,admitApks(path.join(root,'artifacts'),variant,{testMocks:false})]));
 const lease=await acquireDeviceLease(`android:${serial}`,{waitMs:0,ttlMs:Number.MAX_SAFE_INTEGER});
 process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
 try{
  fs.mkdirSync(output,{recursive:true});
  for(const variant of ['standalone','launcher']){
   cancellation.signal.throwIfAborted();
   const installed=call('shell','pm','list','packages','-u','--user','all').split(/\r?\n/);
   assert.ok(![pkg,testPkg].some((name: any)=>installed.includes(`package:${name}`)),'Existing package registration; refusing replacement');
   const directory=path.join(output,variant);fs.mkdirSync(directory);
   const [candidateApp,candidatePair]=candidates[variant];
   const candidateTest=candidatePair.file;
   const receipt: FixtureEvidence={variant,serial,avd,abi,candidate:{appSha256:candidateApp.sha256,testSha256:candidatePair.sha256,manifest:'artifacts/apk-manifest.json'},companions:[],passed:false};let failure,before:any,phase='admission';
   const log=(name: any,value: any)=>fs.writeFileSync(path.join(directory,name),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');
   const routes=()=>call('shell','dumpsys','activity','intents').split(/\r?\n/).map((line: any)=>line.trim()).filter((line: any)=>line.startsWith('requestIntent=')&&line.includes('cmp='+pkg+'/')&&/dat=alpha-reminder-tap:|dat=alpha-reminder:[^ /]+\//.test(line)).sort();
   // Companion classes run against the installed candidate pair only, one exact method each.
   const installedSha=(name: any,user: any)=>{const lines=call('shell','pm','path','--user',String(user),name).split(/\r?\n/);assert.equal(lines.length,1,'Expected one installed APK');assert.match(lines[0],/^package:\/[^\r\n]+\.apk$/);const local=path.join(directory,`${name}-companion.apk`);try{call('pull',lines[0].slice(8),local);return sha(local);}finally{fs.rmSync(local,{force:true});}};
   const companion=(label: any,user: any,cls: any,method: any,args: any)=>{
    phase=`companion:${label}`;
    assert.equal(sha(candidateApp.file),candidateApp.sha256,'Candidate app changed after admission');assert.equal(sha(candidateTest),candidatePair.sha256,'Candidate test APK changed after admission');
    assert.equal(installedSha(pkg,user),candidateApp.sha256,'Installed app is not the admitted candidate');assert.equal(installedSha(testPkg,user),candidatePair.sha256,'Installed test APK is not the admitted candidate pair');
    let raw;try{raw=call('shell','am','instrument','-r','--user',String(user),'-w',...args,'-e','class',`${cls}#${method}`,`${testPkg}/androidx.test.runner.AndroidJUnitRunner`);}catch(error: any){log(`${label}.log`,`${error.stdout??''}\n${error.stderr??''}`);throw error;}
    log(`${label}.log`,raw);const result=requireInstrumentationSuccess(raw,[cls]);assert.deepEqual(result.cases,[`${cls}#${method}`],'Requested companion method missing');assert.equal(result.totalTests,1);
    receipt.companions.push({label,class:cls,method,totalTests:result.totalTests,appSha256:candidateApp.sha256,testSha256:candidatePair.sha256});return result;
   };
   try{
    await withIsolatedAndroidUser({serial,deviceLease:lease,expectedAvdName:avd,homePackage:host,name:`${kind}-upgrade-${variant}-${Date.now()}`,signal:cancellation.signal,
     execute:(args: any)=>call(...args),record:(state: any)=>{receipt.userLifecycle=state;receipt.ownerRestored=state.ownerRestored;receipt.cleanupDeferred=state.cleanupDeferred;log('result.json',receipt);},
     run:async({user}: any)=>{
      receipt.user=user;
      try{
    receipt.result=await runIsolatedAndroidTest({serial,adb,aapt,packageName:pkg,testClass:`${pkg}.${testClass}`,testMethod,requiredAbi:abi,expectedAvdName:avd,androidUser:user,deviceLease:lease,directory,signal:cancellation.signal,commandTimeoutMs:120000,instrumentationTimeoutMs:120000,cleanupTimeoutMs:120000,
     evidence:`Alpha ${kind} installed upgrade in a fresh owned secondary user. No live account acceptance.`,
     variants:[{name:variant,apk:path.join(baseline,`${variant}-debug.apk`),testApk:kind==='reminder'?path.join(baseline,`${variant}-test.apk`):candidateTest,additionalInstrumentationRunners:kind==='calendar'||baselineProcessRunner?currentRunners:[],upgrade:{apk:candidateApp.file,testApk:candidateTest,additionalInstrumentationRunners:currentRunners}}],runnerArgs:['-e',flag,'seed'],upgradeRunnerArgs:['-e',flag,'verify'],
     // The candidate pair upstream pins for the upgrade is the admitted pair, checked before any install.
     preflightVariant:({record:pinned}: any)=>{assert.equal(pinned.upgrade?.appSha256,candidateApp.sha256,'Candidate app changed after admission');assert.equal(pinned.upgrade?.testSha256,candidatePair.sha256,'Candidate test APK changed after admission');},
     prepareVariant:()=>{phase='baseline';for(const permission of kind==='calendar'?['READ_CALENDAR','WRITE_CALENDAR']:['POST_NOTIFICATIONS'])call('shell','pm','grant','--user',String(user),pkg,`android.permission.${permission}`);},
     beforeUpgrade:()=>{phase='upgrade';if(kind==='calendar')call('shell','am','force-stop','--user',String(user),pkg);else {before=routes();log('baseline-intents.json',before);assert.ok(before.some((line: any)=>line.includes('dat=alpha-reminder:upgrade_future/'))&&before.some((line: any)=>line.includes('dat=alpha-reminder:upgrade_repeat/'))&&before.some((line: any)=>line.includes('dat=alpha-reminder-tap:')),'Baseline native intent inventory missing');}},
     afterUpgrade:()=>{if(kind==='reminder'){const after=routes();log('candidate-intents.json',after);assert.deepEqual(after,before,'Installed update changed native reminder intent routes');receipt.intentPreservation={passed:true,routes:before.length};}phase='candidate';},
     collectVariant:()=>{
      // The upgraded store's pre-revision one-off reminder must reach a reviewed native digest. Read-only,
      // after the reminder verify phase, in a new process against the same upgraded data.
      if(kind==='reminder')receipt.legacyDigest=companion('legacy-digest',user,`${pkg}.WorkflowLegacyReminderUpgradeInstrumentedTest`,'upgradedLegacyOneOffReminderIsIncludedInNativeDigest',['-e','reminderUpgrade','verify']);
      if(bridge)receipt.bridge=companion('bridge',user,`${pkg}.CalendarAgentCrudInstrumentedTest`,'reviewedNativeCreateReadUpdateDeleteAndStaleRevision',['-e','calendarAgent','1']);
      phase='cleanup';
     },
    });
      }catch(error: any){failure=error;receipt.error=error.message;receipt.failedPhase=phase;}
      const proofFile=path.join(directory,'verification.json');let proof;
      try{if(fs.existsSync(proofFile))proof=JSON.parse(fs.readFileSync(proofFile,'utf8'));}catch(error: any){failure??=error;}
      return {cleaned:proof?.cleaned===true,cleanupDeferred:proof?.cleanupDeferred===true};
     },
    });
   }catch(error: any){failure??=error;receipt.error=failure.message;receipt.failedPhase??=phase;}
   finally{receipt.passed=!failure;log('result.json',receipt);}
   // Explicit propagation: one failed variant stops the campaign and fails the process.
   if(failure){process.exitCode=1;throw failure;}
  }
  console.log(output);
 }finally{process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);lease.release();}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const kind=process.argv[2];
 if(!['calendar','reminder'].includes(kind)){console.error('Usage: node scripts/test-installed-upgrade.ts <calendar|reminder> [--bridge | --baseline-process-runner]');process.exit(2);}
 await testInstalledUpgrade(kind);
}
