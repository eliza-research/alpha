#!/usr/bin/env python3
"""Fresh disposable GitHub emulator only. Synthetic native fixtures; no live provider."""
import hashlib,json,os,re,signal,subprocess,sys,uuid,zipfile
from pathlib import Path
from resident_absence import assert_no_resident
from resident_native_source import verify_generated_native
from recovery_ui_guard import owned,admit_display,terminal
import time
assert os.environ.get('GITHUB_ACTIONS')=='true' and os.environ.get('RUNNER_ENVIRONMENT')=='github-hosted' and os.environ.get('ALPHA_RESIDENT_DISPOSABLE_CI')=='1'
assert subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()==os.environ['ALPHA_RECOVERY_SOURCE_SHA']
serial=os.environ['ANDROID_SERIAL'];assert serial=='emulator-5554'
archive=Path('test-results/resident-ci-archive');out=Path('test-results/pending-recovery-ui-native');out.mkdir(exist_ok=False)
def interrupted(*unused):raise KeyboardInterrupt('Owned CI interrupted')
signal.signal(signal.SIGTERM,interrupted);signal.signal(signal.SIGINT,interrupted)
APP='ai.elizaresearch.alphaphone';TEST=APP+'.test';HELPER=APP+'.peerfixture';h=lambda b:hashlib.sha256(b).hexdigest()
def run(*args,input=None,timeout=60):
 return subprocess.run(['adb','-s',serial,*args],input=input,text=True,capture_output=True,timeout=timeout,check=True).stdout
assert run('shell','getprop','ro.kernel.qemu').strip()=='1';assert run('shell','getprop','ro.product.cpu.abi').strip()=='x86_64'
assert run('shell','am','get-current-user').strip()=='0'
assert set(re.findall(r'UserInfo\{(\d+):',run('shell','pm','list','users')))=={'0'}
assert not any(p in run('shell','pm','list','packages') for p in [APP,TEST,HELPER]),'Fresh emulator required; never replace original packages'
assert h((archive/'apk-manifest.json').read_bytes())==os.environ['ALPHA_RESIDENT_MANIFEST_SHA256']
manifest=json.loads((archive/'apk-manifest.json').read_text());expected={v+'-'+k+'.apk' for v in ['standalone','launcher'] for k in ['debug','release-unsigned','androidTest']};expected|={'private-peer-debug.apk','private-peer-manifest.json'};assert set(manifest)==expected
for n,digest in manifest.items():assert h((archive/n).read_bytes())==digest
helper=json.loads((archive/'private-peer-manifest.json').read_text());assert helper['package']==HELPER and helper['schemaVersion']==1
assert helper['apkSha256']==manifest['private-peer-debug.apk']
expected_helper_sources={str(p) for p in Path('android/private-peer-fixture/src').rglob('*') if p.is_file()}|{'android/private-peer-fixture/build.gradle','scripts/ci/build-private-peer.py'}
assert set(helper['sources'])==expected_helper_sources
for relative,digest in helper['sources'].items():
 assert relative.startswith('android/private-peer-fixture/') or relative=='scripts/ci/build-private-peer.py'
 assert '..' not in Path(relative).parts and Path(relative).is_file() and h(Path(relative).read_bytes())==digest
signer=Path(os.environ['ANDROID_HOME'])/'build-tools/36.0.0/apksigner'
badging=subprocess.check_output([str(signer.parent/'aapt'),'dump','badging',str(archive/'private-peer-debug.apk')],text=True)
assert re.search(r"^package: name='ai.elizaresearch.alphaphone.peerfixture' ",badging,re.M)
assert 'application-debuggable' in badging and 'launchable-activity:' not in badging and 'android.permission.INTERNET' not in badging
for name in ['private-peer-debug.apk']+[v+'-'+k+'.apk' for v in ['standalone','launcher'] for k in ['debug','androidTest']]:
 certs=re.findall(r'^Signer #\d+ certificate SHA-256 digest: ([a-f0-9]{64})$',subprocess.check_output([str(signer),'verify','--print-certs',str(archive/name)],text=True),re.M)
 assert certs==[helper['signerSha256']]
assert (archive/'inputs-before.json').read_bytes()==(archive/'inputs-after.json').read_bytes()
frozen=json.loads((archive/'inputs-before.json').read_text())['files']
lock=json.loads(Path('upstream.lock.json').read_text())
assert frozen['upstream.lock.json']==h(Path('upstream.lock.json').read_bytes())
assert subprocess.check_output(['git','-C','vendor/eliza','rev-parse','HEAD'],text=True).strip()==lock['commit']
generated=json.loads((archive/'native-generated-source-manifest.json').read_text())
assert h((archive/'native-generated-source-manifest.json').read_bytes())==frozen['android/app/build/generated/local-agent/source-manifest.json']
verify_generated_native(generated,frozen)
for relative,digest in frozen.items():
 if relative.startswith(('android/app/src/androidTest/','android/app/src/testMocks/','android/app/src/main/java/')):
  assert Path(relative).is_file() and h(Path(relative).read_bytes())==digest

PHASES=[('reminder-no-alert','ReminderTimingInstrumentedTest','noAlertBridgeWithoutPermissionRestoresAndCompletesWithoutDelivery','reminderTiming','none'),('reminder-alert-timing','ReminderTimingInstrumentedTest','numericLeadDueTimeStaleTargetsAndLegacyReceiptsRemainBound','reminderTiming','numeric'),('pending-storage','ReminderDeletionStorageInstrumentedTest','reminderDeletionSlotUsesEncryptedCompareExchange','pendingActionStorageFixture','1'),('calendar-recovery','CalendarCreationRecoveryInstrumentedTest','committedMarkerRecoveryAndMissingMarkerNeverReplay','calendarCreationRecovery','1'),('audio-fence','NoteAudioInstrumentedTest','optInRetiredDeletionCannotArriveAfterReloadAndRestore','audioFence','true'),('reminder-edit','ReminderAgentInstrumentedTest','selectedCrudPersistsExactReceiptsAndRejectsChangedBindings','reminderAgent','1'),('reminder-v2-transport','ConnectionInstrumentedTest','encryptedCredentialsAndHttpSurviveRecreationWithCancellationAndRedirectRejection',None,None),('cloud-callback-cold','CloudDelegationCallbackInstrumentedTest','coldCallbackSurvivesRecreationAndOnlyMatchingClear','cloudDelegationNative','1'),('cloud-callback-warm','CloudDelegationCallbackInstrumentedTest','warmCallbackRejectsMalformedLinksAndRetainsLatestOnRecreation','cloudDelegationNative','1'),('workflow-notice-tap','WorkflowNoticeTapInstrumentedTest','twoOpaqueNoticesRetainColdWarmAndFailedCaptureRoutes','workflowNoticeTap','1'),('workflow-notice-ask','WorkflowNoticeTapInstrumentedTest','askActionRetainsPurposeAndRequiresExactVisibleRevision','workflowNoticeTap','1'),('workflow-notice-process-death','WorkflowNoticeProcessDeathInstrumentedTest','originalNoticeLaunchesAbsentMainAfterOrdinaryProcessDeath','workflowNoticeProcessDeath','1'),('workflow-approval-process-death','WorkflowNoticeProcessDeathInstrumentedTest','approvalNoticeOpensOnlyItsApprovalAfterProcessDeath','workflowNoticeProcessDeath','approval'),('enabled-view-transport','ConnectionInstrumentedTest','enabledViewProfileHttpPreservesAuthenticationAndConditionalRevision',None,None),('reminder-tap-lifecycle','ReminderTapLifecycleInstrumentedTest','staleDismissDuplicateCaptureAndConsumedCapacityRemainExact','reminderTapLifecycle','1'),('reminder-tap-process-death','ReminderTapProcessDeathInstrumentedTest','capturedReminderTapSurvivesMainDeathWithoutAnotherNotificationIntent','reminderTapProcessDeath','1'),('native-slot-isolation','ConnectionInstrumentedTest','reservedNativeSlotsRejectEveryPublicStorageOperation','nativeSlotIsolation','1'),('clock-agent-review','ClockAgentReviewInstrumentedTest','journalBoundOwnerReviewManualSelectionCancellationAndRecreation','clockAgentReview','1')]
# These run under WorkflowNoticeOwnerFixture: a prepare run in the same user restores its owner first.
OWNER_PREPARED=('workflow-notice-process-death','workflow-approval-process-death')
for _,cls,_,_,_ in PHASES:
 relative='android/app/src/androidTest/java/ai/elizaresearch/alphaphone/'+cls+'.java'
 assert relative in frozen and h(Path(relative).read_bytes())==frozen[relative]

def approval_receipt(text):
 """Receipt of the approval process-death phase: two distinct main processes, one opened approval, one untouched."""
 rows=re.findall(r'^INSTRUMENTATION_RESULT: workflowApprovalProcessDeath=(\{.*\})\s*$',text.replace('\r\n','\n'),re.M)
 assert len(rows)==1,'Exactly one approval process-death receipt required'
 receipt=json.loads(rows[0])
 assert set(receipt)=={'beforePid','beforeStart','afterPid','afterStart','uid','postTime','openedApprovals','untouchedApprovals'},'Unexpected receipt fields'
 for key in ['beforePid','afterPid','uid','postTime']:assert isinstance(receipt[key],int) and receipt[key]>0,key
 assert receipt['beforePid']!=receipt['afterPid'] or receipt['beforeStart']!=receipt['afterStart'],'Process death not proven'
 assert receipt['openedApprovals']==1 and receipt['untouchedApprovals']==1,'Exactly the tapped approval opens'
 return receipt

def guard():
 assert run('shell','am','get-current-user').strip()=='0';assert_no_resident(run)
 assert not re.search(r'/data/(?:user|user_de)/\d+/ai\.(?:alphacompute|alphacompute)\.alphaphone/.*/(?:ipc|ipc-recovery-[^/]+)/',run('shell','cat','/proc/net/unix'))
def installed(package,user,digest):
 paths=run('shell','pm','path','--user',user,package).strip().splitlines();assert len(paths)==1 and paths[0].startswith('package:')
 assert run('shell','sha256sum',paths[0][8:]).split()[0]==digest

def switch(target,owner,name):
 owned(run,owner,name)
 assert run('shell','am','get-current-user').strip() in ('0',owner)
 if target==owner:assert run('shell','am','get-started-user-state',owner).strip()=='RUNNING_UNLOCKED'
 run('shell','am','switch-user',target)
 for _ in range(30):
  owned(run,owner,name)
  current=run('shell','am','get-current-user').strip();assert current in ('0',owner)
  controller=run('shell','dumpsys','activity')
  settled=re.findall(r'^\s*mCurrentUserId:(-?\d+)\s*$',controller,re.M)==[target] and re.findall(r'^\s*mTargetUserId:(-?\d+)\s*$',controller,re.M)==['-10000']
  if current==target and settled:return
  time.sleep(.5)
 raise AssertionError('Owned foreground switch timed out')

for variant in ['standalone','launcher']:
 guard();attempted=[]
 try:
  for pkg,kind in [(APP,'debug'),(TEST,'androidTest')]:
   attempted.append((pkg,kind));run('install','--user','0',str(archive/(variant+'-'+kind+'.apk')),timeout=180);installed(pkg,'0',manifest[variant+'-'+kind+'.apk'])
  for phase,cls,method,opt,value in PHASES:
   guard();assert set(re.findall(r'UserInfo\{(\d+):',run('shell','pm','list','users')))=={'0'}
   name='alpha-recovery-'+uuid.uuid4().hex;user=None;ownership={'variant':variant,'phase':phase,'name':name,'user':None,'state':'create-unknown'}
   record=out/(variant+'-'+phase+'-ownership.json');record.write_text(json.dumps(ownership)+'\n')
   try:
    created=run('shell','pm','create-user',name);match=re.fullmatch(r'\s*Success: created user id (\d+)\s*',created);assert match
    user=match[1];owned(run,user,name,'0');ownership.update(user=user,state='owned');record.write_text(json.dumps(ownership)+'\n')
    run('shell','am','start-user','-w',user);assert run('shell','am','get-started-user-state',user).strip()=='RUNNING_UNLOCKED'
    for pkg,kind in [(APP,'debug'),(TEST,'androidTest')]:
     run('shell','cmd','package','install-existing','--user',user,pkg);installed(pkg,user,manifest[variant+'-'+kind+'.apk'])
    if phase=='calendar-recovery':
     for permission in ['android.permission.READ_CALENDAR','android.permission.WRITE_CALENDAR']:run('shell','pm','grant','--user',user,APP,permission)
    if phase in ('reminder-edit','reminder-alert-timing','workflow-notice-tap','workflow-notice-ask','workflow-notice-process-death','workflow-approval-process-death','reminder-tap-lifecycle','reminder-tap-process-death'):run('shell','pm','grant','--user',user,APP,'android.permission.POST_NOTIFICATIONS')
    switch(user,user,name)
    # A switched but not yet bound policy is a retained diagnostic failure, never user0 fallback.
    def display_record(value):
     with (out/(variant+'-'+phase+'-display.jsonl')).open('a') as stream:stream.write(json.dumps(value)+'\n')
    admit_display(run,user,name,record=display_record)
    for pkg,kind in [(APP,'debug'),(TEST,'androidTest')]:installed(pkg,user,manifest[variant+'-'+kind+'.apk'])
    owned(run,user,name,user);assert_no_resident(run)
    if phase in OWNER_PREPARED:
     # The same method under the standard runner in this user restores the synthetic owner (test-mocks
     # archive) and posts one approval through main first; no force-stop, which would clear that notice.
     try:prepared=run('shell','am','instrument','--user',user,'-w','-r','-e','class',APP+'.'+cls+'#'+method,'-e',opt,value,'-e','workflowOwnerPhase','prepare',TEST+'/androidx.test.runner.AndroidJUnitRunner',timeout=300)
     except (subprocess.CalledProcessError,subprocess.TimeoutExpired) as error:
      safe=lambda v:(v.decode(errors='replace') if isinstance(v,bytes) else v or '')[:1024*1024]
      (out/(variant+'-'+phase+'-prepare-failure.txt')).write_text(safe(error.stdout)+'\nSTDERR\n'+safe(error.stderr));raise
     (out/(variant+'-'+phase+'-prepare.txt')).write_text(prepared);terminal(prepared,APP+'.'+cls,method)
    runner=APP+'.WorkflowNoticeProcessRunner' if phase in ('workflow-notice-process-death','workflow-approval-process-death','reminder-tap-process-death') else 'androidx.test.runner.AndroidJUnitRunner'
    try:text=run('shell','am','instrument','--user',user,'-w','-r','-e','class',APP+'.'+cls+'#'+method,*(('-e',opt,value) if opt else ()),TEST+'/'+runner,timeout=300)
    except (subprocess.CalledProcessError,subprocess.TimeoutExpired) as error:
     safe=lambda v:(v.decode(errors='replace') if isinstance(v,bytes) else v or '')[:1024*1024]
     (out/(variant+'-'+phase+'-failure.txt')).write_text(safe(error.stdout)+'\nSTDERR\n'+safe(error.stderr));raise
    (out/(variant+'-'+phase+'.txt')).write_text(text);terminal(text,APP+'.'+cls,method)
    if phase=='workflow-approval-process-death':(out/(variant+'-'+phase+'-receipt.json')).write_text(json.dumps(approval_receipt(text))+'\n')
    owned(run,user,name,user)
   finally:
    primary=sys.exc_info()[1]
    signal.signal(signal.SIGINT,signal.SIG_IGN);signal.signal(signal.SIGTERM,signal.SIG_IGN)
    try:
     assert user is not None and ownership['state']=='owned','Ambiguous user creation; preserve'
     owned(run,user,name);switch('0',user,name);owned(run,user,name,'0');guard()
     run('shell','am','stop-user','-w','-f',user);owned(run,user,name,'0');guard()
     run('shell','pm','remove-user',user)
     assert set(re.findall(r'UserInfo\{(\d+):',run('shell','pm','list','users')))=={'0'};guard()
     ownership['state']='removed';record.write_text(json.dumps(ownership)+'\n')
    except BaseException as error:
     ownership['cleanupComplete']=False;ownership['errorType']=type(error).__name__;record.write_text(json.dumps(ownership)+'\n')
     if primary is None:raise
     primary.add_note('Owned user cleanup unconfirmed; preserve packages')
    finally:signal.signal(signal.SIGINT,interrupted);signal.signal(signal.SIGTERM,interrupted)
 finally:
  primary=sys.exc_info()[1]
  try:
   guard();assert set(re.findall(r'UserInfo\{(\d+):',run('shell','pm','list','users')))=={'0'}
   for pkg,kind in reversed(attempted):
    if 'package:'+pkg in run('shell','pm','list','packages').splitlines():
     installed(pkg,'0',manifest[variant+'-'+kind+'.apk']);guard()
     assert set(re.findall(r'UserInfo\{(\d+):',run('shell','pm','list','users')))=={'0'}
     run('uninstall',pkg)
   guard()
  except BaseException as error:
   (out/(variant+'-cleanup-incomplete.json')).write_text(json.dumps({'cleanupComplete':False,'errorType':type(error).__name__})+'\n')
   if primary is None:raise
   primary.add_note('Package cleanup unconfirmed; preserve')
(out/'result.json').write_text(json.dumps({'passed':True,'variants':['standalone','launcher'],'methods':len(PHASES),'nativeRecoveryUI':True,'liveProvider':False,'physicalAcceptance':False})+'\n')
