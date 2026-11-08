import test from 'node:test';
import assert from 'node:assert/strict';
import {exercise} from './fixtures/isolated-native-campaign.mjs';
const run=mode=>exercise(mode,'camera');
test('camera campaign owns its APKs and user and scopes permission changes to that user',()=>{
 const r=run('pass');assert.equal(r.code,0,r.stderr);assert.equal(r.record.passed,true);assert.equal(r.record.userLifecycle.removed,true);assert.equal(r.state.created,false);assert.equal(r.state.user,'0');
 assert.deepEqual(r.record.result.variants[0].instrumentation.cases,['ai.elizaresearch.alphaphone.CameraFlowInstrumentedTest#denyingCameraAllowsExplicitRetryWithoutFakePreview']);
 assert.equal(r.commands.filter(a=>a[0]==='uninstall').length,2);
 const permissions=r.commands.filter(a=>a.includes('revoke')||a.includes('clear-permission-flags'));assert.equal(permissions.length,2);assert.ok(permissions.every(a=>a[a.indexOf('--user')+1]==='10'));
});
for(const mode of ['summary-only','missing-start','wrong-class','wrong-method','wrong-terminal','duplicate','skipped'])test(`camera campaign rejects ${mode} and removes its completed fixture`,()=>{
 const r=run(mode);assert.notEqual(r.code,0);assert.equal(r.record.passed,false);assert.equal(r.state.created,false);assert.equal(r.state.user,'0');assert.match(r.log,/OK \(1 test\)/);
});
test('camera transport failure stops owned packages before cleanup',()=>{
 const r=run('timeout');assert.notEqual(r.code,0);assert.equal(r.commands.filter(a=>a.includes('force-stop')).length,2);assert.equal(r.commands.filter(a=>a[0]==='uninstall').length,2);assert.equal(r.state.created,false);
});
test('camera uncertain termination retains the fixture user and packages',()=>{
 const r=run('stop-failure');assert.notEqual(r.code,0);assert.equal(r.record.userLifecycle.cleanupDeferred,true);assert.equal(r.state.created,true);assert.equal(r.state.user,'0');assert.equal(r.commands.filter(a=>a[0]==='uninstall').length,0);
});
test('camera refuses unowned package registration before installing or creating a user',()=>{
 const r=run('existing');assert.notEqual(r.code,0);assert.equal(r.record.passed,false);assert.ok(!r.commands.some(a=>a[0]==='install'||a.includes('create-user')));
});
test('camera admits only the exact archived app and instrumentation bytes',()=>{
 const r=run('archive-pin');assert.notEqual(r.code,0);assert.equal(r.record,null);assert.match(r.stderr,/Exact matching archived distribution/);assert.equal(r.commands.length,0);
});

for(const [scenario,method,permissions]of [
 ['settings','accountsHandoffAndLocationAccuracyReadback',[['revoke','ACCESS_FINE_LOCATION'],['grant','ACCESS_COARSE_LOCATION']]],
 ['channels','blockedChannelReadbackUserRecoveryAndRealNotification',[['grant','POST_NOTIFICATIONS']]],
]){
 test(`${scenario} scopes its permission preconditions and exact native method`,()=>{
  const r=exercise('pass',scenario);assert.equal(r.code,0,r.stderr);assert.equal(r.record.scenario,scenario);assert.equal(r.record.userLifecycle.removed,true);
  const invocation=r.commands.find(a=>a.includes('instrument'));assert.ok(invocation[invocation.indexOf('class')+1].endsWith('#'+method));
  const changes=r.commands.filter(a=>a.includes('grant')||a.includes('revoke'));
  assert.deepEqual(changes.map(a=>[a[2],a.at(-1).replace('android.permission.','')]),permissions);assert.ok(changes.every(a=>a[a.indexOf('--user')+1]==='10'));
  assert.equal(r.state.created,false);assert.deepEqual(r.state.files,{});
 });
 test(`${scenario} rejects a different method and removes its fixture`,()=>{
  const r=exercise('wrong-method',scenario);assert.notEqual(r.code,0);assert.equal(r.record.passed,false);assert.equal(r.state.created,false);
 });
}

test('permission campaign uses the explicitly selected stock HOME package',()=>{
 const r=exercise('google-home','camera');assert.equal(r.code,0,r.stderr);assert.equal(r.record.userLifecycle.removed,true);
 const resolve=r.commands.find(a=>a.includes('resolve-activity'));assert.equal(resolve.at(-1),'com.google.android.apps.nexuslauncher');
 const assign=r.commands.find(a=>a.includes('set-home-activity'));assert.equal(assign.at(-1),'com.google.android.apps.nexuslauncher/.Launcher');
});

for(const [scenario,method,gate,permissions]of [
 ['voice','deniedMicrophoneShowsSettingsRecoveryAndKeyboard',['voicePermissionDenied','1'],[['revoke','RECORD_AUDIO']]],
 ['voice-limit','nativeLocalDeadlineStopsBeforeAsrMaximum',['localVoiceRecording','1'],[['grant','RECORD_AUDIO']]],
 ['notice','redactedNoticeTapSurvivesRecreationWithoutReplay',['hostedNotice','1'],[['grant','POST_NOTIFICATIONS']]],
 ['notice-denied','deniedNotificationRetainsEncryptedHistory',['hostedNoticeDenied','1'],[['revoke','POST_NOTIFICATIONS']]],
 ['camera-capture','photoCapturePublishesReadableImageAndShowsRealViewer',['cameraCapture','1'],[['grant','CAMERA']]],
]){
 test(`${scenario} sets its permission before the app starts and passes its gate to the exact method`,()=>{
  const r=exercise('pass',scenario);assert.equal(r.code,0,r.stderr);assert.equal(r.record.scenario,scenario);assert.equal(r.record.passed,true);assert.equal(r.record.userLifecycle.removed,true);
  const invocations=r.commands.filter(a=>a.includes('instrument'));assert.equal(invocations.length,1);
  const invocation=invocations[0];assert.ok(invocation[invocation.indexOf('class')+1].endsWith('#'+method));
  assert.deepEqual(invocation.slice(invocation.indexOf(gate[0]),invocation.indexOf(gate[0])+2),gate);
  const changes=r.commands.filter(a=>a.includes('grant')||a.includes('revoke'));
  assert.deepEqual(changes.map(a=>[a[2],a.at(-1).replace('android.permission.','')]),permissions);assert.ok(changes.every(a=>a[a.indexOf('--user')+1]==='10'));
  assert.ok(r.commands.indexOf(changes[0])<r.commands.indexOf(invocation),'permission state precedes instrumentation');
  assert.equal(r.state.created,false);assert.deepEqual(r.state.files,{});
 });
 test(`${scenario} rejects a skipped gate and removes its fixture`,()=>{
  const r=exercise('skipped',scenario);assert.notEqual(r.code,0);assert.equal(r.record.passed,false);assert.equal(r.state.created,false);
 });
}

test('every permission-campaign kind routes to the native-permissions runner, not the calendar fallback', async () => {
 const fs = await import('node:fs');
 const source = fs.readFileSync(new URL('./fixtures/isolated-native-campaign.mjs', import.meta.url), 'utf8');
 const scriptsBlock = source.match(/const scripts=\{([\s\S]*?)\};/)?.[1];
 assert.ok(scriptsBlock, 'isolated-native-campaign declares its scripts map');
 const permissionKinds = [...(source.match(/const permissionCampaign=\[([^\]]*)\]/)?.[1].matchAll(/'([^']+)'/g) ?? [])].map(match => match[1]);
 assert.ok(permissionKinds.includes('camera-capture'), 'camera-capture stays in the permission campaign');
 for (const kind of permissionKinds) {
  const entry = new RegExp(`(?:^|,)\\s*(?:'${kind}'|${kind}):path\\.resolve\\('([^']+)'\\)`).exec(scriptsBlock);
  assert.ok(entry, `${kind} must be listed in the scripts map`);
  assert.equal(entry[1], 'scripts/test-native-permissions.mjs', `${kind} must resolve to the native-permissions runner`);
 }
});

test('voice-revoke grants, revokes while the recording phase runs, verifies in a new process and grants again',()=>{
 const r=exercise('pass','voice-revoke');assert.equal(r.code,0,r.stderr);assert.equal(r.record.passed,true);assert.equal(r.record.userLifecycle.removed,true);assert.equal(r.state.created,false);assert.deepEqual(r.state.files,{});
 const steps=r.commands.filter(a=>a.includes('instrument')||(a[1]==='pm'&&['grant','revoke'].includes(a[2]))).map(a=>a.includes('instrument')?'instrument:'+a[a.indexOf('voiceRevokePhase')+1]:a[2]);
 assert.deepEqual(steps,['grant','instrument:baseline','instrument:record','revoke','instrument:verify','grant','instrument:regrant']);
 const runIds=new Set(r.commands.filter(a=>a.includes('instrument')).map(a=>a[a.indexOf('voiceRevokeRunId')+1]));assert.equal(runIds.size,1);assert.match([...runIds][0],/^[a-f0-9]{32}$/);
 const changes=r.commands.filter(a=>a[1]==='pm'&&['grant','revoke','clear-permission-flags'].includes(a[2]));assert.equal(changes.length,5);
 assert.ok(changes.every(a=>a[a.indexOf('--user')+1]==='10'&&a.includes('ai.elizaresearch.alphaphone')&&a.includes('android.permission.RECORD_AUDIO')),'only the temporary user\'s microphone permission changes');
 // The recording process is ended by the revoke itself; the runner never force-stops it to imitate that.
 const revoke=r.commands.findIndex(a=>a[2]==='revoke'),verify=r.commands.findIndex(a=>a.includes('instrument')&&a.includes('verify'));
 assert.ok(!r.commands.slice(revoke,verify).some(a=>a.includes('force-stop')));
 assert.deepEqual(r.record.revocation,{mechanism:'pm-revoke',permission:'android.permission.RECORD_AUDIO',recordingPid:4242,bytesBeforeRevoke:4096,instrumentation:{interrupted:true,started:1,completed:0,case:'ai.elizaresearch.alphaphone.VoicePermissionRevokeInstrumentedTest#microphoneRevokedWhileRecordingPhase'}});
 assert.deepEqual(r.record.result.variants[0].phases.map(p=>[p.name,p.passed]),[['verify',true],['regrant',true]]);
});

test('voice-revoke refuses a process that survives revocation, a stale marker and a phase that ended early',async()=>{
 const {revokeWhileRecording,cases}=await import('../scripts/test-native-permissions.mjs');
 const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-voice-revoke-'));
 const interrupted='INSTRUMENTATION_STATUS: class=ai.elizaresearch.alphaphone.VoicePermissionRevokeInstrumentedTest\nINSTRUMENTATION_STATUS: numtests=1\nINSTRUMENTATION_STATUS: test=microphoneRevokedWhileRecordingPhase\nINSTRUMENTATION_STATUS_CODE: 1\nINSTRUMENTATION_RESULT: shortMsg=Process crashed.\nINSTRUMENTATION_CODE: 0\n';
 const attempt=async({survives=false,markerRunId='a'.repeat(32),early=false,completed=false}={})=>{
  let alive=true,release;const ended=new Promise(resolve=>release=resolve),commands=[],phases=[];
  const run=async(...args)=>{commands.push(args);
   if(args.includes('instrument')){if(early)return 'OK (1 test)\nINSTRUMENTATION_CODE: -1\n';await Promise.race([ended,new Promise(resolve=>setTimeout(resolve,1500))]);/* a real phase ends by itself when it is never interrupted */return completed?interrupted.replace('INSTRUMENTATION_RESULT: shortMsg=Process crashed.\nINSTRUMENTATION_CODE: 0','INSTRUMENTATION_STATUS_CODE: 0\nOK (1 test)\nINSTRUMENTATION_CODE: -1'):interrupted;}
   if(args.includes('run-as'))return JSON.stringify({runId:markerRunId,pid:77,recordingId:'r',bytes:10});
   if(args.includes('pidof')){if(alive)return '77\n';throw Object.assign(Error('exit 1'),{code:1,stdout:''});}
   if(args[2]==='revoke'){if(!survives)alive=false;release();return '';}
   return '';};
  const context={run,androidUser:10,packageName:'ai.elizaresearch.alphaphone',directory,variant:'standalone',instrumentPhase:async name=>{phases.push(name);}};
  const details={};let error;
  try{await revokeWhileRecording(context,cases['voice-revoke'],{runId:'a'.repeat(32),details,timeoutMs:300,pollMs:10});}catch(failure){error=failure;}
  return {error,commands,phases,details};
 };
 try{
  const passed=await attempt();assert.ifError(passed.error);assert.deepEqual(passed.phases,['verify','regrant']);assert.equal(passed.details.revocation.recordingPid,77);
  const survived=await attempt({survives:true});assert.match(survived.error.message,/did not end the recording process/);assert.deepEqual(survived.phases,[]);assert.ok(!survived.commands.some(a=>a.includes('force-stop')));
  const stale=await attempt({markerRunId:'b'.repeat(32)});assert.match(stale.error.message,/Stale recording marker/);assert.ok(!stale.commands.some(a=>a[2]==='revoke'));
  const early=await attempt({early:true});assert.match(early.error.message,/ended before the permission was revoked/);assert.ok(!early.commands.some(a=>a[2]==='revoke'));
  // A test that ran to completion was not interrupted by the revoke: no later phase may run.
  const completed=await attempt({completed:true});assert.ok(completed.error);assert.deepEqual(completed.phases,[]);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
