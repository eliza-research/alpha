import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const scripts={'recovery':path.resolve('scripts/test-reminder-recovery.mjs'),'recurrence-recovery':path.resolve('scripts/test-reminder-recurrence-recovery.mjs'),'one-off':path.resolve('scripts/test-reminder-one-off.mjs'),recurrence:path.resolve('scripts/test-reminder-recurrence.mjs'),workflow:path.resolve('scripts/android-workflow-native.mjs'),calendar:path.resolve('scripts/test-calendar-regression.mjs'),camera:path.resolve('scripts/test-native-permissions.mjs'),'camera-capture':path.resolve('scripts/test-native-permissions.mjs'),settings:path.resolve('scripts/test-native-permissions.mjs'),channels:path.resolve('scripts/test-native-permissions.mjs'),voice:path.resolve('scripts/test-native-permissions.mjs'),'voice-revoke':path.resolve('scripts/test-native-permissions.mjs'),'voice-limit':path.resolve('scripts/test-native-permissions.mjs'),notice:path.resolve('scripts/test-native-permissions.mjs'),'notice-denied':path.resolve('scripts/test-native-permissions.mjs')};
export function exercise(mode,kind='calendar',extraArguments=[]){
 const homePackage=mode==='google-home'?'com.google.android.apps.nexuslauncher':'com.android.launcher3';
 const restartCampaign=['inbox','notes','document','text-scale','tree','bookmark','notes-secure-migration','crash-log','theme','source-reference'].includes(kind);
 const reminderCampaign=['one-off','recurrence','recovery','recurrence-recovery'].includes(kind);
 const permissionCampaign=['camera','camera-capture','settings','channels','voice','voice-revoke','voice-limit','notice','notice-denied'].includes(kind);
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'alpha-calendar-runner-')));
 try{
  const selectedClass={'home-card':'HomeCalendarCardInstrumentedTest','home-card-revoked':'HomeCalendarCardInstrumentedTest','notes-secure-migration':'NotesSecureStorageInstrumentedTest','crash-log':'SettingsCrashLogInstrumentedTest',theme:'SettingsFlowInstrumentedTest','source-reference':'SelectedDocumentInstrumentedTest','text-scale':'TextScaleInstrumentedTest',tree:'FilesTreeRestartInstrumentedTest',bookmark:'BrowserContinuityInstrumentedTest','recovery':'ReminderRecoveryInstrumentedTest','recurrence-recovery':'ReminderRecurrenceRecoveryInstrumentedTest','one-off':'ReminderOneOffInstrumentedTest',recurrence:'ReminderRecurrenceInstrumentedTest',inbox:'InboxDraftInstrumentedTest',notes:'NotesDocumentInstrumentedTest',document:'SelectedDocumentInstrumentedTest','camera-capture':'CameraFlowInstrumentedTest',settings:'SettingsNativeInstrumentedTest',channels:'NotificationChannelsInstrumentedTest',voice:'VoicePermissionDeniedInstrumentedTest','voice-revoke':'VoicePermissionRevokeInstrumentedTest','voice-limit':'LocalVoiceRecordingLimitInstrumentedTest',notice:'HostedResultNoticeInstrumentedTest','notice-denied':'HostedResultNoticeInstrumentedTest',agent:'CalendarAgentCrudInstrumentedTest',options:'CalendarAgentCrudInstrumentedTest','agent-class':'CalendarAgentCrudInstrumentedTest',availability:'CalendarAvailabilityInstrumentedTest',range:'CalendarRangeInstrumentedTest',truncation:'CalendarTruncationInstrumentedTest'}[kind]??'CalendarCreationRecoveryInstrumentedTest';
  const selectedMethod={'home-card':'nextProviderEventShowsTitleCalendarNameAndReadTime','home-card-revoked':'revokedAccessShowsTheAccessOffState','notes-secure-migration':'secureMigrationProcessRestartPhase','crash-log':'realCrashSurvivesRestartAndShowsInSettings',theme:'themeProcessRestartPhase','source-reference':'sourceReferenceProcessRestartPhase','text-scale':'textScaleProcessRestartPhase',tree:'processPhase',bookmark:'bookmarkProcessRestartPhase','recovery':'permissionAndRebootPhase','recurrence-recovery':'permissionAndActualRebootPhase','one-off':'actualOneOffAlarmSnoozeVisibleDoneHistoryAndReplaySafety',recurrence:'actualAlarmSnoozeAndVisibleDoneAdvanceOnceAndRejectOldOccurrence',inbox:'processPhase',notes:'documentProcessRestartPhase',document:'documentProcessRestartPhase',settings:'accountsHandoffAndLocationAccuracyReadback',channels:'blockedChannelReadbackUserRecoveryAndRealNotification',voice:'deniedMicrophoneShowsSettingsRecoveryAndKeyboard','voice-revoke':'microphoneRevokedWhileRecordingPhase','voice-limit':'nativeLocalDeadlineStopsBeforeAsrMaximum',notice:'redactedNoticeTapSurvivesRecreationWithoutReplay','notice-denied':'deniedNotificationRetainsEncryptedHistory',agent:'reviewedNativeCreateReadUpdateDeleteAndStaleRevision','agent-class':'reviewedNativeCreateReadUpdateDeleteAndStaleRevision',options:'directSaveReadsBackAllDayChosenZoneAndRrule',availability:'readsOnlyChosenCalendarsAndCarriesProviderAvailability',camera:'denyingCameraAllowsExplicitRetryWithoutFakePreview','camera-capture':'photoCapturePublishesReadableImageAndShowsRealViewer',range:'distantDatesLoadRealRowsAndNewestNavigationWins',truncation:'realInstanceLimitCannotClaimAnUnreturnedDateIsFree'}[kind]??'creationRecovery';
  const pkg='ai.elizaresearch.alphaphone',apk=path.join(root,'artifacts/standalone-debug.apk'),testApk=path.join(root,'android/app/build/outputs/apk/androidTest/standalone/debug/app-standalone-debug-androidTest.apk');
  for(const [file,bytes] of [[apk,'app'],[testApk,'test']]){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);}
  const cameraTest=path.join(root,'artifacts/standalone-androidTest.apk');
  fs.copyFileSync(testApk,cameraTest);
  const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const manifest={'standalone-debug.apk':hash(apk),'standalone-androidTest.apk':hash(cameraTest)};
  for(const kind of ['debug','androidTest']){const name='launcher-'+kind+'.apk';fs.copyFileSync(kind==='debug'?apk:cameraTest,path.join(root,'artifacts',name));manifest[name]=hash(path.join(root,'artifacts',name));}
  fs.writeFileSync(path.join(root,'artifacts/apk-manifest.json'),JSON.stringify(manifest));
  const jdk=path.join(root,'jdk');fs.mkdirSync(jdk);fs.writeFileSync(path.join(jdk,'release'),'JAVA_VERSION="21.0.1"');
  if(mode==='archive-pin')fs.writeFileSync(cameraTest,'changed');
  if(mode==='companion-pin'){const file=path.join(root,'artifacts/calendar-external/ws.xsoh.etar_57.apk');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'unreviewed APK');}
  fs.writeFileSync(path.join(root,'app.config.json'),JSON.stringify({appId:pkg}));
  const adb=path.join(root,'platform-tools/adb'),aapt=path.join(root,'build-tools/36.0.0/aapt'),state=path.join(root,'state.json'),log=path.join(root,'commands.jsonl');
  fs.mkdirSync(path.dirname(adb),{recursive:true});fs.mkdirSync(path.dirname(aapt),{recursive:true});fs.writeFileSync(log,'');fs.writeFileSync(state,JSON.stringify({user:'0',created:false,files:mode==='existing'?{[pkg]:'unowned'}:{}}));
  fs.writeFileSync(aapt,`#!/usr/bin/env node
const args=process.argv.slice(2);if(args[1]==='badging')console.log("package: name='${pkg}"+(args[2].includes('androidTest')?'.test':'')+"'");else console.log('E: manifest\\n  E: instrumentation\\n    A: android:name="androidx.test.runner.AndroidJUnitRunner"\\n    A: android:targetPackage="${pkg}"\\n  E: instrumentation\\n    A: android:name="${pkg}.WorkflowNoticeProcessRunner"\\n    A: android:targetPackage="${pkg}"');
`,{mode:0o700});
  fs.writeFileSync(adb,`#!/usr/bin/env node
const fs=require('node:fs'),a=process.argv.slice(4),file=${JSON.stringify(state)},s=JSON.parse(fs.readFileSync(file)),pkg=${JSON.stringify(pkg)},mode=${JSON.stringify(mode)};const save=()=>{const next=file+'.'+process.pid+'.tmp';fs.writeFileSync(next,JSON.stringify(s));fs.renameSync(next,file);};fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(a)+'\\n');
if(a[0]==='emu')console.log('calendar-fixture\\nOK');
else if(a.includes('ro.build.version.sdk'))console.log('35');
else if(a.includes('ro.kernel.qemu'))console.log('1');
else if(a.includes('ro.product.cpu.abi'))console.log('x86_64');
else if(a.includes('getenforce'))console.log('Enforcing');
else if(a[0]==='reboot'){s.boot=true;s.user='0';s.reminderStatus='posted';save();}
else if(a[0]==='wait-for-device'){}
else if(a.includes('/proc/sys/kernel/random/boot_id'))console.log((s.boot?'22222222':'11111111')+'-1111-4111-8111-111111111111');
else if(a.includes('sys.boot_completed'))console.log('1');
else if(a.includes('get-started-user-state'))console.log('RUNNING_UNLOCKED');
else if(a.includes('run-as')&&a.at(-1)==='files/voice-revoke/recording.json'){
 // Microphone-revoke campaign: the marker exists only while the fake recording phase runs.
 if(!s.recording){console.error('cat: files/voice-revoke/recording.json: No such file or directory');process.exit(1);}
 console.log(JSON.stringify({runId:s.recording.runId,pid:s.recording.pid,recordingId:'fixture-recording',bytes:4096}));
}
else if(a.includes('pidof')){if(s.recording?.alive)console.log(String(s.recording.pid));else if(mode==='crash-survives'&&s.crashed)console.log('4343');else process.exit(1);}
else if(a.includes('run-as')){
 const id=${JSON.stringify(kind==='recurrence-recovery'?'recurring_recovery_fixture':'recovery_fixture')};
 const row={id,status:s.reminderStatus??'scheduled',at:1,postedAt:s.boot?2:null,occurrenceId:mode==='changed-occurrence'&&s.denied?'changed':'occurrence',revision:'revision',history:[]};
 const envelope={version:1,records:{[id]:JSON.stringify(row),[id+'_damaged']:'invalid-json'}};
 const isEnvelope=a.at(-1)==='shared_prefs/alpha-reminder-envelope-v1.xml';
 if(!isEnvelope&&!a.at(-1).includes('recovery-test'))throw Error('Retired/unexpected preference file');
 const text=isEnvelope?JSON.stringify(envelope):id;
 console.log('<map><string name="'+(isEnvelope?'envelope':'id')+'">'+text.replaceAll('&','&amp;').replaceAll('"','&quot;')+'</string></map>');
}
else if(a.slice(0,3).join(' ')==='shell dumpsys webviewupdate'){
 if(mode==='webview-service-failure'){console.error('WebView service unavailable');process.exit(1);}
 if(s.user!=='10'){console.error('WebView queried outside the owned user');process.exit(1);}
 console.log(['Current WebView package (name, version): (com.android.webview, 131.0)', 'WebView package dirty: false', 'Any WebView package installed: true', 'Valid package com.android.webview (versionName: 131.0) is installed/enabled for all users', 'Number of relros started: 1', 'Number of relros finished: 1'].join(String.fromCharCode(10)));
}
else if(a.slice(0,3).join(' ')==='shell dumpsys package')console.log('Packages:'+String.fromCharCode(10)+'  Package ['+pkg+'] (abc):'+String.fromCharCode(10)+'    User 0: stopped=true'+String.fromCharCode(10)+'    User 10: stopped=false'+String.fromCharCode(10)+'Queries:'+String.fromCharCode(10)+'    User 10:');
else if(a.includes('notification')&&a.includes('list'))console.log(s.boot?'10|'+pkg+'|0|'+${JSON.stringify(kind==='recurrence-recovery'?'recurring_recovery_fixture':'recovery_fixture')}+'|1010000':'');
else if(a.includes('revoke')){s.denied=true;s.reminderStatus='permission-denied';if(s.recording)s.recording.alive=false;save();}
else if(a.includes('grant')){if(s.denied&&mode==='grant-resumes')s.reminderStatus='scheduled';save();}
else if(a.includes('get-current-user'))console.log(s.user);
else if(a.includes('create-user')){s.created=true;save();console.log('Success: created user id 10');}
else if(a.includes('switch-user')){s.user=a.at(-1);save();}
else if(a.includes('remove-user')){s.created=false;save();console.log('Success');}
else if(a.includes('is-user-stopped'))console.log('true');
else if(a.includes('users'))console.log('UserInfo{0:Owner:13}'+(s.created?'\\nUserInfo{10:Fixture:10}':''));
else if(a.includes('packages')){if(mode==='archive-race')fs.writeFileSync(${JSON.stringify(apk)},'replaced after archive admission');console.log(Object.keys(s.files).map(p=>'package:'+p).join('\\n'));}
else if(a.includes('resolve-activity'))console.log('${homePackage}/.Launcher');
else if(a.includes('set-home-activity'))console.log('Success');
else if(a.includes('activities'))console.log('topResumedActivity=ActivityRecord u'+s.user+' ${homePackage}/.Launcher');
else if(a[0]==='install'){const source=a.at(-1),id=source.includes('androidTest')?pkg+'.test':pkg,dest=file+'.'+id+'.apk';fs.copyFileSync(source,dest);s.files[id]=dest;save();console.log('Success');}
else if(a.slice(0,3).join(' ')==='shell pm path')console.log('package:/data/'+a.at(-1)+'.apk');
else if(a[0]==='pull')fs.copyFileSync(s.files[a[1].slice(6,-4)],a[2]);
else if(a[0]==='uninstall'){delete s.files[a[1]];save();console.log('Success');}
else if(a.includes('force-stop')){if(mode==='stop-failure')process.exit(1);}
else if(a.includes('instrument')){
 const recoveryPhase=a.includes('reminderPhase')?a[a.indexOf('reminderPhase')+1]:a.includes('recurrencePhase')?a[a.indexOf('recurrencePhase')+1]:null;
 if(recoveryPhase==='prepare'||recoveryPhase==='prepare-reboot'){s.reminderStatus='scheduled';s.denied=false;save();}
 const selector=a[a.indexOf('class')+1],cls=${kind==='workflow'?"selector.split('#')[0]":"pkg+"+JSON.stringify(kind==='camera'?'.CameraFlowInstrumentedTest':'.'+selectedClass)},method=${kind==='workflow'?"selector.split('#')[1]":kind==='agent-class'?"selector.split('#')[1]??'noMethodSelected'":JSON.stringify(selectedMethod)},block=code=>'INSTRUMENTATION_STATUS: class='+cls+'\\nINSTRUMENTATION_STATUS: test='+method+'\\nINSTRUMENTATION_STATUS: numtests=${kind==='recurrence'?2:kind==='availability'?4:1}\\nINSTRUMENTATION_STATUS_CODE: '+code+'\\n';
 if(mode==='timeout'||mode==='stop-failure'){console.log(block(1));console.error('fixture transport');process.exit(1);}
 if(a.includes('voiceRevokePhase')&&a[a.indexOf('voiceRevokePhase')+1]==='record'){
  s.recording={runId:a[a.indexOf('voiceRevokeRunId')+1],pid:4242,alive:true};save();
  const wait=new Int32Array(new SharedArrayBuffer(4));
  for(let i=0;i<400&&JSON.parse(fs.readFileSync(file)).recording?.alive;i++)Atomics.wait(wait,0,0,50);
  if(JSON.parse(fs.readFileSync(file)).recording?.alive){console.log(block(1)+block(-2)+'FAILURES!!!\\nINSTRUMENTATION_CODE: -1\\n');process.exit(0);}
  console.log(block(1)+'INSTRUMENTATION_RESULT: shortMsg=Process crashed.\\nINSTRUMENTATION_CODE: 0\\n');process.exit(0);
 }
 const gate=['inboxPhase','notesDocumentPhase','documentPhase','textScalePhase','treePhase','bookmarkPhase','notesSecureMigrationPhase','crashLogPhase','themePhase','sourceReferencePhase'].find(g=>a.includes(g)),phase=gate?a[a.indexOf(gate)+1]:null;
 // The crash-log phase ends its own process through the default handler.
 if(gate==='crashLogPhase'&&phase==='crash'){s.crashed=true;save();console.log(mode==='crash-completes'?block(1)+block(0)+'OK (1 test)\\nINSTRUMENTATION_CODE: -1\\n':block(1)+'INSTRUMENTATION_RESULT: shortMsg=Process crashed.\\nINSTRUMENTATION_CODE: 0\\n');process.exit(0);}
 let output=block(1)+block(0)+'OK (1 test)\\nINSTRUMENTATION_CODE: -1\\n';
 if(${kind==='recurrence'})output=block(1)+block(0)+(block(1)+block(0)).replaceAll('test='+method,'test=civilScheduleSkipsWeekendHandlesGapAndEditInvalidatesOldDecisions')+'OK (2 tests)\\nINSTRUMENTATION_CODE: -1\\n';
 // The whole availability class: four methods, none selected by name.
 if(${kind==='availability'})output=['readsOnlyChosenCalendarsAndCarriesProviderAvailability','allDayEventsFollowTheOwnersCivilDate','changedSourcesBoundsAndSourceListing','timeZoneMatchesByRulesNotSpelling'].slice(0,mode==='missing-method'?3:4).map(name=>(block(1)+block(0)).replaceAll('test='+method,'test='+name)).join('')+'OK (4 tests)\\nINSTRUMENTATION_CODE: -1\\n';
 if(phase){output+='INSTRUMENTATION_RESULT: inboxFixturePid='+(mode==='same-pid'||phase==='prepare'?100:200)+'\\nINSTRUMENTATION_RESULT: notesDocumentPid='+(mode==='same-pid'||phase==='prepare'?100:200)+'\\n';if(mode==='missing-pid')output=output.replace(/(?:inboxFixturePid|notesDocumentPid)=.*\\n/g,'');if(mode==='duplicate-pid')output+='INSTRUMENTATION_RESULT: inboxFixturePid=300\\nINSTRUMENTATION_RESULT: notesDocumentPid=300\\n';}
 if(mode==='prepare-failure'&&phase==='prepare')output='OK (1 test)\\n';
 if(mode==='summary-only')output='OK (1 test)\\n';
 if(mode==='missing-start')output=block(0)+'OK (1 test)\\nINSTRUMENTATION_CODE: -1\\n';
 if(mode==='wrong-count')output=output.replaceAll('numtests=1','numtests=2');
 if(mode==='wrong-method')output=output.replaceAll('test='+method,'test=unrequestedMethod');
 if(mode==='wrong-class')output=output.replaceAll(cls,pkg+'.WrongTest');
 if(mode==='wrong-terminal')output=output.replace('INSTRUMENTATION_CODE: -1','INSTRUMENTATION_CODE: 0');
 if(mode==='duplicate')output=block(1)+block(0)+output;
 if(mode==='skipped')output=block(1)+block(-4)+'OK (1 test)\\nINSTRUMENTATION_CODE: -1\\n';console.log(output);
}else if(a.includes('start-user')||a.includes('stop-user')||a.includes('grant')||a.includes('revoke')||a.includes('clear-permission-flags')||a[1]==='input'||a[1]==='wm'){}
else{console.error('Unexpected command '+JSON.stringify(a));process.exit(1);}
`,{mode:0o700});
  const testClass=mode==='companion-pin'?'CalendarExternalEditorInstrumentedTest':selectedClass;
  const run=spawnSync(process.execPath,[restartCampaign?path.resolve('scripts/test-native-restart.mjs'):scripts[kind]??scripts.calendar,...(kind==='workflow'?extraArguments:permissionCampaign||restartCampaign?[kind,apk,cameraTest,path.join(root,'output')]:reminderCampaign?[apk,cameraTest,path.join(root,'output')]:[`--case=${['agent','options','home-card','home-card-revoked'].includes(kind)?testClass+'#'+selectedMethod:testClass}`,'--variant=standalone',...(mode==='companion-pin'?['--external']:[])])],{cwd:root,env:{...process.env,ALPHA_CALENDAR_TEST_ROOT:root,ALPHA_CALENDAR_TEST_SERIAL:'emulator-5580',ALPHA_CALENDAR_TEST_AVD:'calendar-fixture',ALPHA_CALENDAR_TEST_ABI:'x86_64',ANDROID_HOME:root,ANDROID_SDK_ROOT:root,JAVA_HOME:jdk,ANDROID_SERIAL:'emulator-5580',ALPHA_TEST_HOME_PACKAGE:homePackage,ALPHA_NATIVE_TEST_AVD:'calendar-fixture',ALPHA_NATIVE_TEST_ABI:'x86_64',ALPHA_BUILD_ARCHIVE:path.join(root,'artifacts'),ALPHA_CAMPAIGN_OUTPUT:path.join(root,'test-results/workflow'),ALPHA_WORKFLOW_TEST_AVD:'calendar-fixture',ALPHA_WORKFLOW_TEST_ABI:'x86_64',ELIZA_DEVICE_LEASE_DIR:path.join(root,'leases')},encoding:'utf8',timeout:kind==='workflow'?360000:120000});
  // Source authentication alone can exceed the old whole-fixture deadline.
  // Surface process failures before reading output that may never have been created.
  assert.ifError(run.error);
  if(!permissionCampaign&&!restartCampaign&&!reminderCampaign&&kind!=='workflow')assert.ok(fs.existsSync(path.join(root,'test-results')),`Native fixture exited before writing evidence (status ${run.status}):\n${run.stdout}\n${run.stderr}`);
  const directory=kind==='workflow'?path.join(root,'test-results/workflow'):permissionCampaign||restartCampaign||reminderCampaign?path.join(root,'output'):path.join(root,'test-results',fs.readdirSync(path.join(root,'test-results'))[0],`standalone-${testClass}${['options','home-card-revoked'].includes(kind)?'-'+selectedMethod:''}`);
  // Every result folder a Calendar run wrote, by name: a class selected with two methods writes two.
  const calendarOutput=kind!=='workflow'&&!permissionCampaign&&!restartCampaign&&!reminderCampaign?path.dirname(directory):null;
  const records=calendarOutput&&fs.existsSync(calendarOutput)?Object.fromEntries(fs.readdirSync(calendarOutput).sort().map(name=>[name,fs.existsSync(path.join(calendarOutput,name,'result.json'))?JSON.parse(fs.readFileSync(path.join(calendarOutput,name,'result.json'),'utf8')):null])):{};
  return {code:run.status,stderr:run.stderr,records,record:fs.existsSync(path.join(directory,'result.json'))?JSON.parse(fs.readFileSync(path.join(directory,'result.json'),'utf8')):null,state:JSON.parse(fs.readFileSync(state)),commands:fs.readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse),log:kind==='workflow'&&fs.existsSync(path.join(directory,'standalone-privateReadResultSurvivesRecreationButNeverExpandsPassiveHistory/standalone.log'))?fs.readFileSync(path.join(directory,'standalone-privateReadResultSurvivesRecreationButNeverExpandsPassiveHistory/standalone.log'),'utf8'):fs.existsSync(path.join(directory,'standalone.log'))?fs.readFileSync(path.join(directory,'standalone.log'),'utf8'):''};
 }finally{fs.rmSync(root,{recursive:true,force:true});}
}
