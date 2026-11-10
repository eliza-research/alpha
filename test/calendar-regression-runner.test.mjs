import test from 'node:test';
import assert from 'node:assert/strict';
import {exercise} from './fixtures/isolated-native-campaign.mjs';
test('Calendar runner records complete raw evidence and cleans only its fixture installation',()=>{
 const r=exercise('pass');assert.equal(r.code,0,r.stderr);assert.equal(r.record.passed,true);
 // The admitted test-mocks pair is installed, never the mutable Gradle outputs; an unchanged clock is left alone.
 const installs=r.commands.filter(a=>a[0]==='install').map(a=>a.at(-1));
 assert.equal(installs.length,2);assert.ok(installs.every(file=>file.includes('/artifacts/test-mocks/')),installs.join(' '));
 assert.equal(r.record.build,'test-mocks');assert.deepEqual(r.record.apks.map(row=>row.role),['app','test']);
 assert.deepEqual(r.record.deviceClock,{timeZone:'UTC',autoTimeZone:'1'});assert.equal(r.record.deviceClockRestored,false);
 assert.ok(!r.commands.some(a=>a.includes('set-timezone')||a.includes('put')));assert.equal(r.record.result.variants[0].instrumentation.totalTests,1);assert.ok(r.commands.find(a=>a.includes('instrument')).includes('-r'));assert.equal(r.commands.filter(a=>a[0]==='uninstall').length,2);assert.equal(r.state.created,false);assert.equal(r.state.user,'0');
});
for(const mode of ['summary-only','missing-start','wrong-class','wrong-terminal','duplicate','skipped'])test(`Calendar runner rejects ${mode} evidence`,()=>{const r=exercise(mode);assert.notEqual(r.code,0);assert.equal(r.record.passed,false);assert.ok(r.log.includes('OK (1 test)'));});
test('Calendar transport failure requires stopping both owned packages before cleanup',()=>{
 const r=exercise('timeout');assert.notEqual(r.code,0);assert.match(r.log,/fixture transport/);assert.equal(r.commands.filter(a=>a.includes('force-stop')).length,2);assert.equal(r.commands.filter(a=>a[0]==='uninstall').length,2);assert.equal(r.state.created,false);
});
test('Calendar runner retains packages and user when termination is uncertain',()=>{
 const r=exercise('stop-failure');assert.notEqual(r.code,0);assert.equal(r.commands.filter(a=>a[0]==='uninstall').length,0);assert.equal(r.record.userLifecycle.cleanupDeferred,true);assert.equal(r.state.created,true);assert.equal(r.state.user,'0');
});
test('Calendar runner refuses existing packages before creating a user',()=>{const r=exercise('existing');assert.notEqual(r.code,0);assert.ok(!r.commands.some(a=>a.includes('create-user')||a[0]==='install'));});

test('Calendar external editor rejects an APK that differs from the product pin',()=>{const r=exercise('companion-pin');assert.notEqual(r.code,0);assert.match(r.record.error,/Companion APK differs from its pin/);assert.ok(!r.commands.some(a=>a[0]==='install'));});

for(const [kind,method] of [['agent','reviewedNativeCreateReadUpdateDeleteAndStaleRevision'],['range','distantDatesLoadRealRowsAndNewestNavigationWins'],['truncation','realInstanceLimitCannotClaimAnUnreturnedDateIsFree']]){
 test(`Calendar ${kind} selects its exact native method in an isolated user`,()=>{
  const r=exercise('pass',kind);assert.equal(r.code,0,r.stderr);assert.equal(r.record.passed,true);
  const instrument=r.commands.find(a=>a.includes('instrument'));
  assert.equal(instrument[instrument.indexOf('class')+1],`ai.elizaresearch.alphaphone.${r.record.testClass}#${method}`);
  assert.ok(instrument.includes(kind==='agent'?'calendarAgent':'calendarRange'));assert.equal(r.state.created,false);assert.equal(r.state.user,'0');
  const grants=r.commands.filter(a=>a.includes('grant'));assert.equal(grants.length,2);assert.ok(grants.every(a=>a[a.indexOf('--user')+1]==='10'));
 });
 test(`Calendar ${kind} rejects a different method in the requested class`,()=>{
  const r=exercise('wrong-method',kind);assert.notEqual(r.code,0);assert.equal(r.record.passed,false);assert.equal(r.state.created,false);assert.match(r.log,/unrequestedMethod/);
 });
}

test('Calendar options case passes calendarOptions=1 to exactly directSaveReadsBackAllDayChosenZoneAndRrule and keeps its own result folder',()=>{
 const r=exercise('pass','options');assert.equal(r.code,0,r.stderr);assert.equal(r.record.passed,true);
 assert.equal(r.record.testMethod,'directSaveReadsBackAllDayChosenZoneAndRrule');assert.equal(r.record.gate,'calendarOptions');
 assert.deepEqual(Object.keys(r.records),['standalone-CalendarAgentCrudInstrumentedTest-directSaveReadsBackAllDayChosenZoneAndRrule']);
 const instruments=r.commands.filter(a=>a.includes('instrument'));assert.equal(instruments.length,1);const instrument=instruments[0];
 assert.equal(instrument[instrument.indexOf('class')+1],'ai.elizaresearch.alphaphone.CalendarAgentCrudInstrumentedTest#directSaveReadsBackAllDayChosenZoneAndRrule');
 assert.equal(instrument[instrument.indexOf('calendarOptions')+1],'1');assert.ok(!instrument.includes('calendarAgent'),'the reviewed-CRUD gate belongs to the other method');
 const grants=r.commands.filter(a=>a.includes('grant'));assert.equal(grants.length,2);assert.ok(grants.every(a=>a[a.indexOf('--user')+1]==='10'));
 assert.equal(r.state.created,false);assert.equal(r.state.user,'0');
});
test('Calendar options case rejects a different method and a skipped one',()=>{
 for(const mode of ['wrong-method','skipped']){const r=exercise(mode,'options');assert.notEqual(r.code,0,mode);assert.equal(r.record.passed,false,mode);assert.equal(r.state.created,false,mode);}
});
test('Selecting CalendarAgentCrud by class runs the reviewed method and then the options method, each with its own gate and folder',()=>{
 const r=exercise('pass','agent-class');assert.equal(r.code,0,r.stderr);
 assert.deepEqual(Object.keys(r.records),['standalone-CalendarAgentCrudInstrumentedTest','standalone-CalendarAgentCrudInstrumentedTest-directSaveReadsBackAllDayChosenZoneAndRrule']);
 assert.ok(Object.values(r.records).every(record=>record?.passed===true));
 const selected=r.commands.filter(a=>a.includes('instrument')).map(a=>[a[a.indexOf('class')+1].split('#')[1],a.includes('calendarAgent'),a.includes('calendarOptions')]);
 assert.deepEqual(selected,[['reviewedNativeCreateReadUpdateDeleteAndStaleRevision',true,false],['directSaveReadsBackAllDayChosenZoneAndRrule',false,true]]);
 assert.equal(r.state.created,false);assert.equal(r.state.user,'0');
});
test('Calendar availability runs the whole class with both calendar permissions granted in its own user',()=>{
 const r=exercise('pass','availability');assert.equal(r.code,0,r.stderr);assert.equal(r.record.passed,true);assert.equal(r.record.expectedTests,4);
 assert.equal(r.record.result.variants[0].instrumentation.totalTests,4);
 const instrument=r.commands.find(a=>a.includes('instrument'));
 assert.equal(instrument[instrument.indexOf('class')+1],'ai.elizaresearch.alphaphone.CalendarAvailabilityInstrumentedTest','no method is selected: every test of the class must run');
 const grants=r.commands.filter(a=>a.includes('grant'));
 assert.deepEqual(grants.map(a=>a.at(-1)).sort(),['android.permission.READ_CALENDAR','android.permission.WRITE_CALENDAR']);
 assert.ok(grants.every(a=>a[a.indexOf('--user')+1]==='10'&&a.includes('ai.elizaresearch.alphaphone')));
 assert.ok(r.commands.findIndex(a=>a.includes('grant'))<r.commands.findIndex(a=>a.includes('instrument')),'granted before the class starts, or it skips');
 assert.equal(r.state.created,false);assert.equal(r.state.user,'0');
});
test('Calendar availability rejects a run in which a method is missing or the class was skipped',()=>{
 for(const mode of ['missing-method','skipped']){const r=exercise(mode,'availability');assert.notEqual(r.code,0,mode);assert.equal(r.record.passed,false,mode);}
});
test('Home calendar card runs its granted case, then its access-off case with both calendar permissions revoked before it starts',()=>{
 const granted=exercise('pass','home-card');assert.equal(granted.code,0,granted.stderr);assert.equal(granted.record.passed,true);
 const run=granted.commands.find(a=>a.includes('instrument'));
 assert.equal(run[run.indexOf('class')+1],'ai.elizaresearch.alphaphone.HomeCalendarCardInstrumentedTest#nextProviderEventShowsTitleCalendarNameAndReadTime');
 assert.equal(run[run.indexOf('homeCalendar')+1],'1');
 assert.deepEqual(granted.commands.filter(a=>a.includes('grant')||a.includes('revoke')).map(a=>a[2]),['grant','grant']);
 const revoked=exercise('pass','home-card-revoked');assert.equal(revoked.code,0,revoked.stderr);assert.equal(revoked.record.passed,true);
 assert.equal(revoked.record.gateValue,'revoked');assert.equal(revoked.record.calendarPermissions,'revoked');
 const denied=revoked.commands.find(a=>a.includes('instrument'));
 assert.equal(denied[denied.indexOf('class')+1],'ai.elizaresearch.alphaphone.HomeCalendarCardInstrumentedTest#revokedAccessShowsTheAccessOffState');
 assert.equal(denied[denied.indexOf('homeCalendar')+1],'revoked');
 const permissions=revoked.commands.filter(a=>a.includes('grant')||a.includes('revoke')||a.includes('clear-permission-flags'));
 assert.ok(permissions.length===4&&!permissions.some(a=>a[2]==='grant'),'no grant reaches the revoked case');
 assert.ok(revoked.commands.findIndex(a=>a.includes('revoke'))<revoked.commands.indexOf(denied),'revoked before the process starts');
 assert.ok(permissions.every(a=>a[a.indexOf('--user')+1]==='10'));
});

test('Calendar runner refuses a test APK that verify-apks did not record for the app before leasing the device',()=>{
 const r=exercise('pair-mismatch');assert.notEqual(r.code,0);assert.match(r.stderr,/does not match the instrumentation APK recorded/);
 assert.equal(r.evidence,false);assert.deepEqual(r.commands,[],'no device command runs');
});
test('Calendar runner puts the device time zone back after CalendarFlow dies before its own restore',()=>{
 const r=exercise('timezone-killed','calendar-flow');assert.notEqual(r.code,0);assert.equal(r.record.passed,false);
 assert.equal(r.record.testClass,'CalendarFlowInstrumentedTest');assert.deepEqual(r.record.deviceClock,{timeZone:'UTC',autoTimeZone:'1'});
 assert.equal(r.record.deviceClockRestored,true);assert.equal(r.state.timeZone,'UTC');assert.equal(r.state.autoTimeZone,'1');
 const instrument=r.commands.findIndex(a=>a.includes('instrument')),zone=r.commands.findIndex(a=>a.includes('set-timezone'));
 assert.ok(instrument>=0&&zone>instrument,'restored after the class');assert.deepEqual(r.commands[zone].slice(-1),['UTC']);
 assert.ok(r.commands[instrument].includes('calendarFlow'));
});
