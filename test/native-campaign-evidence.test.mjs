import assert from 'node:assert/strict';
import test from 'node:test';
import {exercise} from './fixtures/isolated-native-campaign.mjs';
const run=mode=>exercise(mode,'workflow');
const approvalClass='ai.alphacompute.alphaphone.WorkflowApprovalNoticeInstrumentedTest';
test('workflow campaign runs every exact case of every phase in disposable users and scopes permissions',()=>{
 const r=run('pass');assert.equal(r.code,0,r.stderr);assert.equal(r.record.results.length,24);
 assert.ok(r.record.results.every(row=>row.passed&&row.userLifecycle.removed));
 assert.equal(r.state.user,'0');assert.equal(r.state.created,false);assert.deepEqual(r.state.files,{});
 // 24 case runs and the four owner prepare runs of the two test-mocks cases.
 const calls=r.commands.filter(a=>a.includes('instrument'));assert.equal(calls.length,28);
 assert.equal(new Set(calls.map(a=>a[a.indexOf('class')+1])).size,12);
 const permissions=r.commands.filter(a=>a.includes('grant')||a.includes('revoke')||a.includes('clear-permission-flags'));
 // Ten workflow cases, six approval-notice cases and eight recovery cases scope Calendar (4 commands each); the twelve OS-posting cases also grant notifications (2 commands each).
 assert.equal(permissions.length,120);assert.ok(permissions.every(a=>a[a.indexOf('--user')+1]==='10'));
 approvalNoticePhase(r);approvalNoticeRecoveryPhase(r);
});
// Same full campaign run as above: the approval-notice phase, its gate, grant and report.
function approvalNoticePhase(r){
 const recovery='ownerChangeWithdrawsThePendingApprovalNoticeAndItsTapOpensNothing';
 const calls=r.commands.filter(a=>a.includes('instrument')&&a[a.indexOf('class')+1].startsWith(approvalClass+'#')&&!a[a.indexOf('class')+1].endsWith('#'+recovery));
 assert.deepEqual(calls.map(a=>a[a.indexOf('class')+1].split('#')[1]),['approvalAndStepBuildersAreRedactedAndExpire','approvalNoticeOpensItsRunOnceAndIsWithdrawnOnDecision','approvalNoticeTapAfterAccountChangeIsFencedWithoutAStaleApproval','approvalAndStepBuildersAreRedactedAndExpire','approvalNoticeOpensItsRunOnceAndIsWithdrawnOnDecision','approvalNoticeTapAfterAccountChangeIsFencedWithoutAStaleApproval']);
 assert.ok(calls.every(a=>a[a.indexOf('workflowApprovalNotice')+1]==='1'&&a[a.indexOf('--user')+1]==='10'));
 // Only the two OS-posting tap cases of this phase receive POST_NOTIFICATIONS, once each per distribution, before their instrumentation.
 const phaseMethods=['approvalNoticeOpensItsRunOnceAndIsWithdrawnOnDecision','approvalNoticeTapAfterAccountChangeIsFencedWithoutAStaleApproval'];
 const grants=r.commands.map((a,index)=>({a,index})).filter(({a})=>a.includes('grant')&&a.includes('android.permission.POST_NOTIFICATIONS')).filter(({index})=>{const next=r.commands.slice(index).find(a=>a.includes('instrument'));return next[next.indexOf('class')+1].startsWith(approvalClass+'#')&&phaseMethods.includes(next[next.indexOf('class')+1].split('#')[1]);});
 assert.equal(grants.length,4);assert.ok(!r.commands.some(a=>a.includes('revoke')&&a.includes('android.permission.POST_NOTIFICATIONS')));
 assert.deepEqual(grants.map(({index})=>{const next=r.commands.slice(index).find(a=>a.includes('instrument'));return next[next.indexOf('class')+1].split('#')[1];}),[...phaseMethods,...phaseMethods]);
 // The report names each phase, its coverage on both distributions and the exact archived pair.
 const phase=r.record.phases['approval-notice'];
 assert.deepEqual([phase.expected,phase.passed,phase.complete],[6,6,true]);
 assert.deepEqual([...new Set(phase.cases.map(row=>row.variant))],['standalone','launcher']);assert.ok(phase.cases.every(row=>row.status==='passed'));
 assert.deepEqual([r.record.phases.workflow.expected,r.record.phases.workflow.passed,r.record.phases.workflow.complete],[10,10,true]);
 assert.equal(r.record.passed,true);assert.equal(r.record.failure,undefined);
 for(const row of r.record.results.filter(row=>row.phase==='approval-notice')){assert.match(row.appSha256,/^[0-9a-f]{64}$/);assert.equal(row.appSha256,r.record.apks[row.variant].appSha256);assert.equal(row.testSha256,r.record.apks[row.variant].testSha256);}
}
// Same full campaign run: the recovery phase, its two runners, two archives, owner preparation, gates, grants and report.
const pkg='ai.alphacompute.alphaphone',deathClass=pkg+'.WorkflowApprovalNoticeProcessDeathInstrumentedTest';
const death=deathClass+'#pendingApprovalNoticeSurvivesProcessDeathAndOpensItsExactApprovalOnce',definitive=deathClass+'#definitiveSignedOutColdStartWithdrawsApprovalAndInvalidatesOriginalTap',production=deathClass+'#productionSignedOutColdStartWithdrawsPersistedSyntheticApproval',change=approvalClass+'#ownerChangeWithdrawsThePendingApprovalNoticeAndItsTapOpensNothing';
const recoveryOrder=[death,definitive,production,change],mocksCases=[death,definitive];
const selector=a=>a[a.indexOf('class')+1],short=name=>name.slice(pkg.length+1);
/** Every prepare run is the standard-runner run of the same method, in the same owned user, right before its helper-process run. */
function assertOwnerPreparation(r){
 const indexes=r.commands.map((a,index)=>({a,index})).filter(({a})=>a.includes('instrument')).map(({index})=>index);
 const prepares=indexes.filter(index=>r.commands[index].includes('workflowOwnerPhase'));
 for(const index of prepares){
  const prepare=r.commands[index],runIndex=indexes[indexes.indexOf(index)+1],run=r.commands[runIndex];
  assert.equal(prepare[prepare.indexOf('workflowOwnerPhase')+1],'prepare');assert.equal(prepare[prepare.indexOf('workflowApprovalNoticeProcessDeath')+1],'1');
  assert.equal(prepare.at(-1),pkg+'.test/androidx.test.runner.AndroidJUnitRunner');assert.equal(run.at(-1),pkg+'.test/'+pkg+'.WorkflowNoticeProcessRunner');
  assert.equal(selector(prepare),selector(run));assert.ok(!run.includes('workflowOwnerPhase'));
  assert.equal(prepare[prepare.indexOf('--user')+1],run[run.indexOf('--user')+1]);
  // Same user lifecycle: nothing between the two creates or removes a user, reinstalls or force-stops.
  assert.ok(!r.commands.slice(index+1,runIndex).some(a=>a.includes('create-user')||a.includes('remove-user')||a[0]==='install'||a.includes('force-stop')));
 }
 return prepares.map(index=>selector(r.commands[index]));
}
/** The archive each case installed: the last install before its first instrumentation. */
function installedArchive(r,index){
 const install=r.commands.slice(0,index).findLast(a=>a[0]==='install');return install.at(-1).includes('/mocks-archive/')?'test-mocks':'flag-off';
}
function approvalNoticeRecoveryPhase(r){
 const runs=r.commands.filter(a=>a.includes('instrument')&&!a.includes('workflowOwnerPhase')).map(selector);
 // Each distribution runs the phase last: process death, both signed-out cold starts, then the owner change.
 assert.deepEqual(runs.slice(8,12),recoveryOrder);assert.deepEqual(runs.slice(20,24),recoveryOrder);
 assert.deepEqual(assertOwnerPreparation(r),[...mocksCases,...mocksCases]);
 const calls=r.commands.filter(a=>a.includes('instrument')&&!a.includes('workflowOwnerPhase')&&recoveryOrder.includes(selector(a)));assert.equal(calls.length,8);
 for(const a of calls){
  assert.equal(a[a.indexOf('--user')+1],'10');
  // The process-death class runs under the helper-process runner and only its own gate; every other case under AndroidJUnitRunner.
  if(selector(a).startsWith(deathClass+'#')){assert.equal(a.at(-1),pkg+'.test/'+pkg+'.WorkflowNoticeProcessRunner');assert.equal(a[a.indexOf('workflowApprovalNoticeProcessDeath')+1],'1');assert.ok(!a.includes('workflowApprovalNotice'));}
  else{assert.equal(a.at(-1),pkg+'.test/androidx.test.runner.AndroidJUnitRunner');assert.equal(a[a.indexOf('workflowApprovalNotice')+1],'1');assert.ok(!a.includes('workflowApprovalNoticeProcessDeath'));}
 }
 for(const a of r.commands.filter(a=>a.includes('instrument')&&!selector(a).startsWith(deathClass+'#')))assert.equal(a.at(-1),pkg+'.test/androidx.test.runner.AndroidJUnitRunner');
 // Every recovery case posts to the OS: each is granted POST_NOTIFICATIONS in its owned user before any of its instrumentation,
 // and installs the archive of its build: the owner-fixture cases the test-mocks pair, the rest the flag-off pair.
 for(const selected of recoveryOrder){
  const indexes=r.commands.map((a,index)=>({a,index})).filter(({a})=>a.includes('instrument')&&selector(a)===selected).map(({index})=>index);assert.equal(indexes.length,mocksCases.includes(selected)?4:2);
  for(const index of indexes.filter(index=>!r.commands[index].includes('workflowOwnerPhase'))){
   const before=r.commands.slice(0,index),created=before.findLastIndex(a=>a.includes('create-user')),first=r.commands.slice(created).findIndex(a=>a.includes('instrument'))+created;
   assert.ok(before.slice(created,first).some(a=>a.includes('grant')&&a.at(-1)==='android.permission.POST_NOTIFICATIONS'&&a[a.indexOf('--user')+1]==='10'),selected);
   assert.equal(installedArchive(r,first),mocksCases.includes(selected)?'test-mocks':'flag-off',selected);
  }
 }
 const phase=r.record.phases['approval-notice-recovery'];
 assert.deepEqual([phase.expected,phase.passed,phase.complete],[8,8,true]);
 assert.deepEqual(phase.cases.map(row=>[row.variant,row.method,row.status]),recoveryOrder.map(short).flatMap(method=>[['standalone',method,'passed'],['launcher',method,'passed']]));
 const rows=r.record.results.filter(row=>row.phase==='approval-notice-recovery');assert.equal(rows.length,8);
 assert.notDeepEqual(r.record.testMocksApks,r.record.apks);
 for(const row of rows){
  // Immutable pairing: each case records its build, the admitted app and instrumentation hashes of that build's archive and the runner it ran under.
  const mocks=mocksCases.map(short).includes(row.method),pair=(mocks?r.record.testMocksApks:r.record.apks)[row.variant];
  assert.equal(row.build,mocks?'test-mocks':'flag-off');assert.equal(row.appSha256,pair.appSha256);assert.equal(row.testSha256,pair.testSha256);assert.ok(row.userLifecycle.removed);
  assert.equal(row.runner,row.method.includes('ProcessDeath')?pkg+'.WorkflowNoticeProcessRunner':'androidx.test.runner.AndroidJUnitRunner');
  if(mocks)assert.deepEqual([row.preparation.totalTests,row.preparation.cases],[1,[pkg+'.'+row.method]]);else assert.equal(row.preparation,undefined);
 }
 assert.ok(r.record.results.filter(row=>row.phase!=='approval-notice-recovery').every(row=>row.runner==='androidx.test.runner.AndroidJUnitRunner'&&row.build==='flag-off'));
}
test('the recovery phase runs alone as a selection and never reads as the whole campaign',()=>{
 const r=exercise('pass','workflow',['--phase=approval-notice-recovery']);assert.equal(r.code,0,r.stderr);
 assert.deepEqual(r.record.selection,{variants:['standalone','launcher'],phases:['approval-notice-recovery']});assert.equal(r.record.selectionPassed,true);assert.equal(r.record.passed,false,'the whole campaign did not run');
 assert.equal(r.record.results.length,8);assert.ok(r.record.results.every(row=>row.phase==='approval-notice-recovery'&&row.passed&&row.userLifecycle.removed));
 assert.equal(r.commands.filter(a=>a.includes('instrument')).length,12);assert.deepEqual(assertOwnerPreparation(r),[...mocksCases,...mocksCases]);
 assert.deepEqual([r.record.phases['approval-notice-recovery'].expected,r.record.phases['approval-notice-recovery'].passed,r.record.phases['approval-notice-recovery'].complete],[8,8,true]);
 assert.ok(r.record.phases.workflow.cases.every(row=>row.status==='not-run')&&r.record.phases['approval-notice'].cases.every(row=>row.status==='not-run'));
 assert.equal(r.state.user,'0');assert.equal(r.state.created,false);assert.deepEqual(r.state.files,{});
});
test('a skipped or failed recovery case names itself and fails the selection and the campaign',()=>{
 for(const mode of ['skipped','wrong-method','wrong-terminal','summary-only']){
  const r=exercise(mode,'workflow',['--phase=approval-notice-recovery','--variant=launcher']);assert.notEqual(r.code,0,mode);
  assert.equal(r.record.passed,false,mode);assert.equal(r.record.selectionPassed,false,mode);
  assert.deepEqual([r.record.failure.variant,r.record.failure.phase],['launcher','approval-notice-recovery'],mode);assert.equal(r.record.failure.method,short(death),mode);
  // A failed owner preparation stops the case before its helper-process run.
  const calls=r.commands.filter(a=>a.includes('instrument')&&a.includes('-w'));assert.equal(calls.length,1,mode);assert.equal(calls[0][calls[0].indexOf('workflowOwnerPhase')+1],'prepare',mode);assert.match(calls[0].at(-1),/AndroidJUnitRunner$/,mode);
  // The first failure stops the phase: the later cases are not run and read not-run, never passed.
  assert.equal(r.record.results.length,1,mode);
  assert.deepEqual(r.record.phases['approval-notice-recovery'].cases.filter(row=>row.variant==='launcher').map(row=>row.status),['failed','not-run','not-run','not-run'],mode);
  assert.equal(r.record.phases['approval-notice-recovery'].complete,false,mode);assert.equal(r.state.created,false,mode);assert.equal(r.state.user,'0',mode);
 }
});
test('a failed case names itself, leaves later phases not-run and fails the campaign',()=>{
 const r=run('skipped');assert.notEqual(r.code,0);
 assert.equal(r.record.passed,false);
 assert.deepEqual([r.record.failure.variant,r.record.failure.phase],['standalone','workflow']);assert.match(r.record.failure.method,/WorkflowPhoneNativeInstrumentedTest#/);
 assert.equal(r.record.phases.workflow.complete,false);assert.equal(r.record.phases['approval-notice'].complete,false);
 assert.ok(r.record.phases['approval-notice'].cases.every(row=>row.status==='not-run'));
 assert.equal(r.record.phases['approval-notice-recovery'].complete,false);assert.ok(r.record.phases['approval-notice-recovery'].cases.every(row=>row.status==='not-run'));
 assert.equal(r.record.phases.workflow.cases[0].status,'failed');
});
for(const mode of ['summary-only','missing-start','wrong-method','wrong-class','skipped','wrong-terminal','duplicate'])test(`workflow rejects ${mode} evidence and cleans its fixture`,()=>{
 const r=run(mode);assert.notEqual(r.code,0);assert.equal(r.record.results[0].passed,false);assert.equal(r.state.created,false);assert.equal(r.state.user,'0');assert.match(r.log,/OK \(1 test\)/);
});
test('workflow refuses existing package registrations before mutation',()=>{
 const r=run('existing');assert.notEqual(r.code,0);assert.ok(!r.commands.some(a=>a[0]==='install'||a.includes('create-user')));
});
test('workflow refuses an archive APK replaced after admission before installing it',()=>{
 const r=run('archive-race');assert.notEqual(r.code,0);assert.match(r.stderr,/App changed after archive admission/);
 assert.ok(!r.commands.some(a=>a[0]==='install'||a.includes('instrument')));
 assert.equal(r.record.passed,false);assert.equal(r.record.results.length,1);assert.equal(r.record.results[0].passed,false);
 assert.deepEqual([r.record.failure.variant,r.record.failure.phase],['standalone','workflow']);
 assert.equal(r.state.created,false);assert.equal(r.state.user,'0');
});
test('workflow validates every archived APK before mutation',()=>{
 const r=run('archive-pin');assert.notEqual(r.code,0);assert.equal(r.commands.length,0);
});
test('workflow transport failure stops owned packages before cleanup',()=>{
 const r=run('timeout');assert.notEqual(r.code,0);assert.equal(r.commands.filter(a=>a.includes('force-stop')).length,2);assert.equal(r.state.created,false);
});
test('workflow retains its fixture on uncertain termination',()=>{
 const r=run('stop-failure');assert.notEqual(r.code,0);assert.equal(r.record.results[0].userLifecycle.cleanupDeferred,true);assert.equal(r.state.created,true);assert.equal(r.commands.filter(a=>a[0]==='uninstall').length,0);
});

test('a selected variant and phase run only those cases and never read as the whole campaign',()=>{
 const r=exercise('pass','workflow',['--variant=launcher','--phase=workflow']);assert.equal(r.code,0,r.stderr);
 assert.deepEqual(r.record.selection,{variants:['launcher'],phases:['workflow']});assert.equal(r.record.selectionPassed,true);
 assert.equal(r.record.passed,false,'the whole campaign did not run');
 assert.equal(r.record.results.length,5);assert.ok(r.record.results.every(row=>row.variant==='launcher'&&row.phase==='workflow'&&row.passed&&row.userLifecycle.removed));
 const calls=r.commands.filter(a=>a.includes('instrument')).map(a=>a[a.indexOf('class')+1]);assert.equal(calls.length,5);
 assert.ok(calls.includes('ai.alphacompute.alphaphone.WorkflowPhoneNativeInstrumentedTest#deniedCalendarGrantReturnsNoEvents'));
 // The denied case is the only one whose Calendar permissions are revoked, before it starts.
 const denied=r.commands.findIndex(a=>a.includes('instrument')&&a[a.indexOf('class')+1].endsWith('#deniedCalendarGrantReturnsNoEvents'));
 const before=r.commands.slice(0,denied).filter(a=>a.includes('revoke')||a.includes('grant')).slice(-2);
 assert.deepEqual(before.map(a=>[a.includes('revoke'),a.at(-1)]),[[true,'android.permission.READ_CALENDAR'],[true,'android.permission.WRITE_CALENDAR']]);
 const deniedCall=r.commands[denied];assert.equal(deniedCall[deniedCall.indexOf('workflowPhoneDenied')+1],'1');assert.ok(!deniedCall.includes('workflowPhoneNative'));
 assert.deepEqual([r.record.phases.workflow.expected,r.record.phases.workflow.passed,r.record.phases.workflow.complete],[10,5,false]);
 assert.ok(r.record.phases['approval-notice'].cases.every(row=>row.status==='not-run')&&r.record.phases['approval-notice-recovery'].cases.every(row=>row.status==='not-run'));
 assert.equal(r.state.user,'0');assert.equal(r.state.created,false);assert.deepEqual(r.state.files,{});
});
test('an unknown or repeated selection is refused before the emulator is touched',()=>{
 for(const extra of [['--variant=tablet'],['--phase=notice'],['--phase=workflow','--phase=workflow'],['--all']]){const r=exercise('pass','workflow',extra);assert.notEqual(r.code,0,extra.join(' '));assert.equal(r.commands.length,0,extra.join(' '));assert.equal(r.record,null);}
});
test('a missing or mislabelled archive is refused before the emulator is touched',()=>{
 const expected={'no-mocks-archive':/ALPHA_TEST_MOCKS_ARCHIVE/,'mislabelled-mocks-archive':/is not a test-mocks archive/,'mislabelled-build-archive':/is not a flag-off archive/};
 for(const mode of Object.keys(expected))for(const extra of [[],['--phase=approval-notice-recovery']]){
  const r=exercise(mode,'workflow',extra);assert.notEqual(r.code,0,mode);assert.equal(r.commands.length,0,mode);assert.equal(r.record,null,mode);
  assert.match(r.stderr,expected[mode],mode);
 }
});
test('a selection without owner-fixture cases needs only the flag-off archive',()=>{
 const r=exercise('no-mocks-archive','workflow',['--variant=launcher','--phase=approval-notice']);assert.equal(r.code,0,r.stderr);
 assert.equal(r.record.selectionPassed,true);assert.equal(r.record.testMocksApks,undefined);assert.equal(r.record.results.length,3);assert.ok(r.record.results.every(row=>row.build==='flag-off'));
 assert.ok(!r.commands.some(a=>a.includes('workflowOwnerPhase')));
});
