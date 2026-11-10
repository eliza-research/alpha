/** Alpha Calendar scenarios; upstream owns leased APK and disposable-user lifecycles.
 * Each case is one class, or one exact method of it, run in a fresh secondary user that is granted
 * READ_CALENDAR and WRITE_CALENDAR, except a case marked `revoked`, whose user has both revoked
 * before the process starts (revoking a runtime permission kills the app process, so a test cannot
 * revoke its own). `--case=` takes a class name (every case of that class) or
 * `Class#method`; `--variant=` takes standalone or launcher. A class listed with two methods keeps
 * the class-named result folder for its first case and adds `-<method>` for the others.
 * The cases drive the views, which P-43's required sign-in covers on a flag-off build in a fresh user,
 * so the runner installs the verified test-mocks pair (artifacts/test-mocks, checked against its
 * apk-manifest.json before the device is leased). The device time zone and automatic time zone
 * setting are read before each case and put back after it, also when the test process died.
 * Emulator-class evidence only: no synced account, no live calendar and no device acceptance. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {verifyPinnedUpstream} from './pinned-upstream-source.mjs';
const repository=path.resolve(import.meta.dirname,'..');
verifyPinnedUpstream(repository);
const {runIsolatedAndroidTest}=await import('../vendor/eliza/packages/app/scripts/lib/isolated-android-test.mjs');
const {withIsolatedAndroidUser}=await import('../vendor/eliza/packages/app/scripts/lib/isolated-android-user.mjs');
const {acquireDeviceLease}=await import('../vendor/eliza/packages/app/scripts/lib/device-lease.ts');
const {admitApks}=await import('./android-instrumentation.mjs');
const root=process.env.ALPHA_CALENDAR_TEST_ROOT??repository,serial=process.env.ALPHA_CALENDAR_TEST_SERIAL,avd=process.env.ALPHA_CALENDAR_TEST_AVD,abi=process.env.ALPHA_CALENDAR_TEST_ABI;
assert.match(serial??'',/^emulator-\d+$/);assert.match(avd??'',/^[A-Za-z0-9_.-]+$/);assert.ok(['x86_64','arm64-v8a'].includes(abi),'Explicit owned fixture ABI required');
const sdk=process.env.ANDROID_HOME??process.env.ANDROID_SDK_ROOT;assert.ok(sdk&&path.isAbsolute(sdk),'Provide an absolute Android SDK path');
const adb=path.join(sdk,'platform-tools/adb'),aapt=path.join(sdk,'build-tools/36.0.0/aapt');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'app.config.json'),'utf8')).appId;assert.equal(pkg,'ai.elizaresearch.alphaphone');
const args=process.argv.slice(2),external=args.includes('--external');
assert.ok(args.every(arg=>arg==='--external'||/^--(?:case|variant)=.+$/.test(arg)),'Unknown Calendar option');
assert.equal(new Set(args.map(arg=>arg.split('=')[0])).size,args.length,'Duplicate Calendar option');
const companion={packageName:'ws.xsoh.etar',apk:path.join(root,'artifacts/calendar-external/ws.xsoh.etar_57.apk'),sha256:'dae01d93c8920aa63845868db2190bcc4aa6ff8410b1289de1ce27b1bb89c599'};
const cases=external?[['CalendarExternalEditorInstrumentedTest','externalCalendar',1,'complexExistingEventOpensEtarCancelsAndSavesSameProviderRow']]:[['CalendarCreationRecoveryInstrumentedTest','calendarCreationRecovery',1],['CalendarFlowInstrumentedTest','calendarFlow',5],['CalendarCrudInstrumentedTest','calendarCrud',2],['CalendarAgentCrudInstrumentedTest','calendarAgent',1,'reviewedNativeCreateReadUpdateDeleteAndStaleRevision'],
 // J01-6: an all-day, a chosen-zone and a repeating direct save, each read back from the provider.
 ['CalendarAgentCrudInstrumentedTest','calendarOptions',1,'directSaveReadsBackAllDayChosenZoneAndRrule'],
 // The free/busy reader beneath the reviewed availability check. It has no opt-in argument: it skips
 // unless both calendar permissions are granted, which this runner does before every case.
 ['CalendarAvailabilityInstrumentedTest','calendarAvailability',4],
 ['CalendarRangeInstrumentedTest','calendarRange',1,'distantDatesLoadRealRowsAndNewestNavigationWins'],['CalendarTruncationInstrumentedTest','calendarRange',1,'realInstanceLimitCannotClaimAnUnreturnedDateIsFree'],
 // AP-07: the Home calendar card over the provider, then its access-off state with access revoked.
 ['HomeCalendarCardInstrumentedTest','homeCalendar',1,'nextProviderEventShowsTitleCalendarNameAndReadTime'],
 ['HomeCalendarCardInstrumentedTest','homeCalendar',1,'revokedAccessShowsTheAccessOffState',{value:'revoked',revoked:true}]];
const requestedCase=args.find(arg=>arg.startsWith('--case='))?.slice(7),requestedVariant=args.find(arg=>arg.startsWith('--variant='))?.slice(10);
const selects=([name,,,method])=>!requestedCase||name===requestedCase||`${name}#${method}`===requestedCase;
const folder=([name,,,method])=>cases.find(([first])=>first===name)[3]===method?name:`${name}-${method}`;
const optionsOf=([,,,,options])=>options??{};
assert.ok(!requestedCase||cases.some(selects),'Unknown Calendar case');assert.ok(!requestedVariant||['standalone','launcher'].includes(requestedVariant),'Unknown variant');
const output=path.join(root,'test-results',`calendar-regression-${Date.now()}-${process.pid}`),cancellation=new AbortController(),cancel=()=>cancellation.abort();
const call=(...args)=>execFileSync(adb,['-s',serial,...args],{encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024}).trim();
// Shared Gradle outputs are not used: a later build can overwrite them, and only verify-apks binds a test APK to its app.
const admitted=Object.fromEntries(['standalone','launcher'].filter(v=>!requestedVariant||v===requestedVariant).map(variant=>[variant,admitApks(path.join(root,'artifacts/test-mocks'),variant,{testMocks:true})]));
/** The time zone and automatic setting every user shares; CalendarFlow changes both. */
const readClock=()=>({timeZone:call('shell','getprop','persist.sys.timezone'),autoTimeZone:call('shell','settings','get','global','auto_time_zone')});
const restoreClock=saved=>{
 if(JSON.stringify(readClock())===JSON.stringify(saved))return false;
 call('shell','settings','put','global','auto_time_zone','0');call('shell','cmd','alarm','set-timezone',saved.timeZone);call('shell','settings','put','global','auto_time_zone',saved.autoTimeZone);
 assert.deepEqual(readClock(),saved,'Device time zone was not restored');return true;
};
const lease=await acquireDeviceLease(`android:${serial}`,{waitMs:0,ttlMs:Number.MAX_SAFE_INTEGER});
process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
try{
 fs.mkdirSync(output,{recursive:true});
 for(const variant of ['standalone','launcher'].filter(v=>!requestedVariant||v===requestedVariant))for(const selected of cases.filter(selects)){const [testClass,flag,count,testMethod]=selected,{value='1',revoked=false}=optionsOf(selected);
  cancellation.signal.throwIfAborted();
  const directory=path.join(output,`${variant}-${folder([testClass,flag,count,testMethod])}`);fs.mkdirSync(directory);
  const [app,pair]=admitted[variant];
  const record={serial,avd,abi,variant,build:'test-mocks',apks:[app,pair].map(({role,sha256})=>({role,sha256})),testClass,...(testMethod?{testMethod}:{}),gate:flag,...(value==='1'?{}:{gateValue:value}),...(revoked?{calendarPermissions:'revoked'}:{}),expectedTests:count,passed:false};let failure;
  const persist=()=>fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(record,null,2)+'\n');
  let clock;
  try{
   record.deviceClock=clock=readClock();persist();
   const installed=call('shell','pm','list','packages','-u','--user','all').split(/\r?\n/);
   assert.ok(![pkg,`${pkg}.test`,...(external?[companion.packageName]:[])].some(name=>installed.includes(`package:${name}`)),'Existing package registration; refusing replacement');
   await withIsolatedAndroidUser({serial,deviceLease:lease,expectedAvdName:avd,homePackage:process.env.ALPHA_TEST_HOME_PACKAGE??'com.android.launcher3',name:`calendar-${variant}-${Date.now()}`,signal:cancellation.signal,execute:args=>call(...args),record:state=>{record.userLifecycle=state;persist();},run:async({user})=>{
    record.user=user;
    try{
     record.result=await runIsolatedAndroidTest({serial,adb,aapt,packageName:pkg,additionalInstrumentationRunners:[pkg+'.WorkflowNoticeProcessRunner'],testClass:`${pkg}.${testClass}`,testMethod,expectedTests:count,requiredAbi:abi,expectedAvdName:avd,androidUser:user,deviceLease:lease,directory,signal:cancellation.signal,commandTimeoutMs:120000,instrumentationTimeoutMs:external?300000:['calendarRange','calendarCrud','calendarAgent','calendarOptions','calendarAvailability','homeCalendar'].includes(flag)?240000:120000,cleanupTimeoutMs:120000,
      variants:[{name:variant,apk:app.file,testApk:pair.file}],companionApks:external?[companion]:[],runnerArgs:['-e',flag,external?'true':value],
      evidence:'Alpha Calendar regression on the test-mocks pair in an owned secondary emulator user. No live account acceptance.',
      collectVariant:external?()=>{
       const receipt=JSON.parse(call('shell','run-as',pkg,'--user',String(user),'cat','files/external-calendar-result.json'));
       for(const field of ['implicitHandoff','cancelUnchanged','saveSameRowAndEpochs','returnedToAlpha','fixtureCleaned','timezoneUnchanged'])assert.equal(receipt[field],true,field);
       assert.equal(receipt.etarVersion,57);assert.equal(receipt.signerSha256,'3f3176c3ce189c98054ff9e1d32daecf00a41572f4c7bd2b2f80607252ddb06e');
       record.externalEditorReceipt=receipt;persist();
      }:undefined,
      prepareVariant:()=>{for(const name of [pkg,...(external?[companion.packageName]:[])])for(const permission of ['READ_CALENDAR','WRITE_CALENDAR']){
       call('shell','pm',revoked?'revoke':'grant','--user',String(user),name,`android.permission.${permission}`);
       // A revoked case must still see Android's own prompt: no user-fixed denial is left behind.
       if(revoked)call('shell','pm','clear-permission-flags','--user',String(user),name,`android.permission.${permission}`,'user-set','user-fixed');
      }},
     });
    }catch(error){failure=error;record.error=error.message;}
    let proof;try{proof=JSON.parse(fs.readFileSync(path.join(directory,'verification.json'),'utf8'));}catch{/* Missing cleanup evidence preserves the owned user. */}
    return {cleaned:proof?.cleaned===true,cleanupDeferred:proof?.cleanupDeferred===true};
   }});
  }catch(error){failure??=error;record.error=failure.message;}
  finally{
   if(clock)try{record.deviceClockRestored=restoreClock(clock);}catch(error){failure??=error;record.error??=error.message;record.deviceClockRestored=false;}
   record.passed=!failure;persist();
  }
  if(failure)throw failure;
 }
 console.log(output);
}finally{process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);lease.release();}
