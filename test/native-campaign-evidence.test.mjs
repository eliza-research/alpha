import assert from 'node:assert/strict';
import test from 'node:test';
import {exercise} from './fixtures/isolated-native-campaign.mjs';
const run=mode=>exercise(mode,'workflow');
const approvalClass='ai.elizaresearch.alphaphone.WorkflowApprovalNoticeInstrumentedTest';
test('workflow campaign runs every exact case of every phase in disposable users and scopes permissions',()=>{
 const r=run('pass');assert.equal(r.code,0,r.stderr);assert.equal(r.record.results.length,20);
 assert.ok(r.record.results.every(row=>row.passed&&row.userLifecycle.removed));
 assert.equal(r.state.user,'0');assert.equal(r.state.created,false);assert.deepEqual(r.state.files,{});
 const calls=r.commands.filter(a=>a.includes('instrument'));assert.equal(calls.length,20);
 assert.equal(new Set(calls.map(a=>a[a.indexOf('class')+1])).size,10);
 const permissions=r.commands.filter(a=>a.includes('grant')||a.includes('revoke')||a.includes('clear-permission-flags'));
 // Ten workflow cases, six approval-notice cases and four recovery cases scope Calendar (4 commands each); the eight OS-posting cases also grant notifications (2 commands each).
 assert.equal(permissions.length,96);assert.ok(permissions.every(a=>a[a.indexOf('--user')+1]==='10'));
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
// Same full campaign run: the recovery phase, its two runners, gates, grants and report.
function approvalNoticeRecoveryPhase(r){
 const pkg='ai.elizaresearch.alphaphone',death=pkg+'.WorkflowApprovalNoticeProcessDeathInstrumentedTest#pendingApprovalNoticeSurvivesProcessDeathAndOpensItsExactApprovalOnce',change=approvalClass+'#ownerChangeWithdrawsThePendingApprovalNoticeAndItsTapOpensNothing';
 const all=r.commands.filter(a=>a.includes('instrument')).map(a=>a[a.indexOf('class')+1]);
 // Each distribution runs the phase last, process death before the owner change.
 assert.deepEqual(all.slice(8,10),[death,change]);assert.deepEqual(all.slice(18,20),[death,change]);
 const calls=r.commands.filter(a=>a.includes('instrument')&&[death,change].includes(a[a.indexOf('class')+1]));assert.equal(calls.length,4);
 for(const a of calls){
  const selected=a[a.indexOf('class')+1];assert.equal(a[a.indexOf('--user')+1],'10');
  // The process-death case runs under the helper-process runner and only its own gate; every other case under AndroidJUnitRunner.
  if(selected===death){assert.equal(a.at(-1),pkg+'.test/'+pkg+'.WorkflowNoticeProcessRunner');assert.equal(a[a.indexOf('workflowApprovalNoticeProcessDeath')+1],'1');assert.ok(!a.includes('workflowApprovalNotice'));}
  else{assert.equal(a.at(-1),pkg+'.test/androidx.test.runner.AndroidJUnitRunner');assert.equal(a[a.indexOf('workflowApprovalNotice')+1],'1');assert.ok(!a.includes('workflowApprovalNoticeProcessDeath'));}
 }
 for(const a of r.commands.filter(a=>a.includes('instrument')&&![death].includes(a[a.indexOf('class')+1])))assert.equal(a.at(-1),pkg+'.test/androidx.test.runner.AndroidJUnitRunner');
 // Both cases post to the OS: each is granted POST_NOTIFICATIONS in its owned user before its instrumentation.
 for(const selected of [death,change]){
  const indexes=r.commands.map((a,index)=>({a,index})).filter(({a})=>a.includes('instrument')&&a[a.indexOf('class')+1]===selected).map(({index})=>index);assert.equal(indexes.length,2);
  for(const index of indexes){const before=r.commands.slice(0,index),lastRun=before.findLastIndex(a=>a.includes('instrument'));assert.ok(before.slice(lastRun+1).some(a=>a.includes('grant')&&a.at(-1)==='android.permission.POST_NOTIFICATIONS'&&a[a.indexOf('--user')+1]==='10'),selected);}
 }
 const phase=r.record.phases['approval-notice-recovery'];
 assert.deepEqual([phase.expected,phase.passed,phase.complete],[4,4,true]);
 assert.deepEqual(phase.cases.map(row=>[row.variant,row.method.split('#')[1],row.status]),[['standalone',death.split('#')[1],'passed'],['launcher',death.split('#')[1],'passed'],['standalone',change.split('#')[1],'passed'],['launcher',change.split('#')[1],'passed']]);
 const rows=r.record.results.filter(row=>row.phase==='approval-notice-recovery');assert.equal(rows.length,4);
 for(const row of rows){
  // Immutable pairing: each case records the admitted app and instrumentation hashes and the runner it ran under.
  assert.equal(row.appSha256,r.record.apks[row.variant].appSha256);assert.equal(row.testSha256,r.record.apks[row.variant].testSha256);assert.ok(row.userLifecycle.removed);
  assert.equal(row.runner,row.method.includes('ProcessDeath')?pkg+'.WorkflowNoticeProcessRunner':'androidx.test.runner.AndroidJUnitRunner');
 }
 assert.ok(r.record.results.filter(row=>row.phase!=='approval-notice-recovery').every(row=>row.runner==='androidx.test.runner.AndroidJUnitRunner'));
}
test('the recovery phase runs alone as a selection and never reads as the whole campaign',()=>{
 const r=exercise('pass','workflow',['--phase=approval-notice-recovery']);assert.equal(r.code,0,r.stderr);
 assert.deepEqual(r.record.selection,{variants:['standalone','launcher'],phases:['approval-notice-recovery']});assert.equal(r.record.selectionPassed,true);assert.equal(r.record.passed,false,'the whole campaign did not run');
 assert.equal(r.record.results.length,4);assert.ok(r.record.results.every(row=>row.phase==='approval-notice-recovery'&&row.passed&&row.userLifecycle.removed));
 assert.equal(r.commands.filter(a=>a.includes('instrument')).length,4);
 assert.deepEqual([r.record.phases['approval-notice-recovery'].expected,r.record.phases['approval-notice-recovery'].passed,r.record.phases['approval-notice-recovery'].complete],[4,4,true]);
 assert.ok(r.record.phases.workflow.cases.every(row=>row.status==='not-run')&&r.record.phases['approval-notice'].cases.every(row=>row.status==='not-run'));
 assert.equal(r.state.user,'0');assert.equal(r.state.created,false);assert.deepEqual(r.state.files,{});
});
test('a skipped recovery case fails the selection and leaves its successor unrun',()=>{
 const r=exercise('skipped','workflow',['--phase=approval-notice-recovery','--variant=launcher']);
 assert.notEqual(r.code,0);
 assert.equal(r.record.passed,false);
 assert.equal(r.record.selectionPassed,false);
 assert.deepEqual([r.record.failure.variant,r.record.failure.phase],['launcher','approval-notice-recovery']);
 assert.match(r.record.failure.method,/WorkflowApprovalNoticeProcessDeathInstrumentedTest#pendingApprovalNoticeSurvivesProcessDeathAndOpensItsExactApprovalOnce$/);
 assert.equal(r.record.results.length,1);
 const phase=r.record.phases['approval-notice-recovery'];
 assert.deepEqual(phase.cases.filter(row=>row.variant==='launcher').map(row=>row.status),['failed','not-run']);
 assert.equal(phase.complete,false);
 assert.equal(r.state.created,false);
 assert.equal(r.state.user,'0');
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
 assert.ok(calls.includes('ai.elizaresearch.alphaphone.WorkflowPhoneNativeInstrumentedTest#deniedCalendarGrantReturnsNoEvents'));
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
