"""Execute the actual owned phase loop with synthetic command responses; no adb."""
import ast,json,signal,sys,tempfile,uuid,re,subprocess
from pathlib import Path
from recovery_ui_guard import terminal
source=Path(__file__).parent/'pending-recovery-ui.py'
tree=ast.parse(source.read_text());phases=next(n for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='PHASES' for t in n.targets));helpers=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='approval_receipt' or isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='OWNER_PREPARED' for t in n.targets)];outer=next(n for n in tree.body if isinstance(n,ast.For) and isinstance(n.target,ast.Name) and n.target.id=='variant');loop=next(n for n in ast.walk(outer) if isinstance(n,ast.For) and isinstance(n.target,ast.Tuple) and n.target.elts[0].id=='phase');code=compile(ast.fix_missing_locations(ast.Module(body=[phases,*helpers,loop],type_ignores=[])),str(source),'exec')
APP='ai.elizaresearch.alphaphone';TEST=APP+'.test';expected=APP+'.ReminderAgentInstrumentedTest#selectedCrudPersistsExactReceiptsAndRejectsChangedBindings'
for variant in ['standalone','launcher']:
 for fault in ['none','skip','wrong-method','permission-denied','none-skip','none-wrong','numeric-skip','numeric-wrong','transport-skip','transport-wrong','cloud-cold-skip','cloud-cold-wrong','cloud-warm-skip','cloud-warm-wrong','tap-skip','tap-wrong','tap-permission-denied','cleanup-unsettled','process-skip','process-wrong','process-permission-denied','approval-skip','approval-wrong','approval-receipt','view-skip','view-wrong','reminder-tap-skip','reminder-tap-wrong','reminder-death-skip','reminder-death-wrong','slot-skip','slot-wrong','clock-skip','clock-wrong','clock-cleanup-unsettled','prepare-skip','prepare-wrong']:
  state={'user':None,'current':'0','name':None,'notifications':False,'prepared':None};calls=[];methods=[];prepares=[]
  def run(*args,**kwargs):
   calls.append(args)
   if args==('shell','pm','list','users'):return 'UserInfo{0:Owner:13}'
   if args[:3]==('shell','pm','create-user'):assert state['user'] is None;state.update(user='10',name=args[3],notifications=False,prepared=None);return 'Success: created user id 10'
   if args[:3]==('shell','am','get-started-user-state'):return 'RUNNING_UNLOCKED'
   if args[:3]==('shell','pm','grant'):
    assert args[3:6]==('--user','10',APP)
    if args[-1]=='android.permission.POST_NOTIFICATIONS':
     if fault=='permission-denied' or fault=='tap-permission-denied' and state['name'] and len(methods)==9 or fault=='process-permission-denied' and len(methods)==10:raise RuntimeError('Grant denied')
     state['notifications']=True
   if args[:3]==('shell','am','instrument'):
    assert state['current']=='10' and kwargs['timeout']==300
    selector=args[args.index('class')+1]
    cls,method=selector.split('#')
    if 'workflowOwnerPhase' in args:
     # The owner prepare run: same method, standard runner, same owned user, before the helper-process run.
     assert args[args.index('workflowOwnerPhase')+1]=='prepare' and args[args.index('--user')+1]=='10' and state['notifications']
     assert args[-1]==TEST+'/androidx.test.runner.AndroidJUnitRunner' and cls==APP+'.WorkflowNoticeProcessDeathInstrumentedTest'
     assert args[args.index('class')+2]=='-e' and args[args.index('class')+3]=='workflowNoticeProcessDeath'
     prepares.append(selector);state['prepared']=selector
     if fault=='prepare-wrong':method='other'
     start=f'INSTRUMENTATION_STATUS: class={cls}\nINSTRUMENTATION_STATUS: test={method}\nINSTRUMENTATION_STATUS: numtests=1\nINSTRUMENTATION_STATUS_CODE: '
     return start+'1\n'+start+('-3' if fault=='prepare-skip' else '0')+'\nINSTRUMENTATION_RESULT: stream=\nOK (1 test)\nINSTRUMENTATION_CODE: -1\n'
    methods.append(selector)
    # Only the owner-fixture phases are prepared, each in its own user right before its helper run.
    assert state['prepared']==(selector if cls==APP+'.WorkflowNoticeProcessDeathInstrumentedTest' else None),(selector,state['prepared'])
    timingCase='none' if 'noAlertBridgeWithoutPermission' in method else 'numeric' if 'numericLeadDueTime' in method else None
    if timingCase:
     assert state['notifications']==(timingCase=='numeric')
     assert args[args.index('class')+2:args.index('class')+5]==('-e','reminderTiming',timingCase)
     if fault==timingCase+'-wrong':method='other'
    if selector==expected:
     assert ('shell','pm','grant','--user','10',APP,'android.permission.POST_NOTIFICATIONS') in calls
     assert args[args.index('class')+2:args.index('class')+5]==('-e','reminderAgent','1')
     if fault=='wrong-method':method='other'
    transport='encryptedCredentialsAndHttp' in method
    if transport:
     assert not state['notifications']
     assert args[args.index('class')+2:args.index('class')+5]==('-e','reminderTransport','v2')
     if fault=='transport-wrong':method='other'
    cloud='cold' if method=='coldCallbackSurvivesRecreationAndOnlyMatchingClear' else 'warm' if method=='warmCallbackRejectsMalformedLinksAndRetainsLatestOnRecreation' else None
    if cloud:
     assert cls==APP+'.CloudDelegationCallbackInstrumentedTest' and not state['notifications']
     assert args[args.index('class')+2:args.index('class')+5]==('-e','cloudDelegationNative','1')
     if fault=='cloud-'+cloud+'-wrong':method='other'
    tap=method=='twoOpaqueNoticesRetainColdWarmAndFailedCaptureRoutes'
    if tap:
     assert cls==APP+'.WorkflowNoticeTapInstrumentedTest' and state['notifications']
     assert args[args.index('class')+2:args.index('class')+5]==('-e','workflowNoticeTap','1')
     if fault=='tap-wrong':method='other'
    process=method=='originalNoticeLaunchesAbsentMainAfterOrdinaryProcessDeath'
    reminderDeath=method=='capturedReminderTapSurvivesMainDeathWithoutAnotherNotificationIntent'
    reminderTap=method=='staleDismissDuplicateCaptureAndConsumedCapacityRemainExact'
    if reminderTap or reminderDeath:
     assert state['notifications']
     opt='reminderTapProcessDeath' if reminderDeath else 'reminderTapLifecycle'
     assert args[args.index('class')+2:args.index('class')+5]==('-e',opt,'1')
     if fault==('reminder-death-wrong' if reminderDeath else 'reminder-tap-wrong'):method='other'
    approval=method=='approvalNoticeOpensOnlyItsApprovalAfterProcessDeath'
    assert args[-1]==TEST+'/'+(APP+'.WorkflowNoticeProcessRunner' if process or reminderDeath or approval else 'androidx.test.runner.AndroidJUnitRunner')
    receipt=''
    if approval:
     assert cls==APP+'.WorkflowNoticeProcessDeathInstrumentedTest' and state['notifications']
     assert args[args.index('class')+2:args.index('class')+5]==('-e','workflowNoticeProcessDeath','approval')
     if fault=='approval-wrong':method='other'
     after=100 if fault=='approval-receipt' else 200
     receipt='INSTRUMENTATION_RESULT: workflowApprovalProcessDeath='+json.dumps({'beforePid':100,'beforeStart':'1','afterPid':after,'afterStart':'1','uid':1010000,'postTime':1,'openedApprovals':1,'untouchedApprovals':1},separators=(',',':'))+'\n'
    if process:
     assert cls==APP+'.WorkflowNoticeProcessDeathInstrumentedTest' and state['notifications']
     assert args[args.index('class')+2:args.index('class')+5]==('-e','workflowNoticeProcessDeath','1')
     if fault=='process-wrong':method='other'
    clock=method=='journalBoundOwnerReviewManualSelectionCancellationAndRecreation'
    if clock:
     assert cls==APP+'.ClockAgentReviewInstrumentedTest' and not state['notifications']
     assert args[args.index('class')+2:args.index('class')+5]==('-e','clockAgentReview','1')
     if fault=='clock-wrong':method='other'
    slots=method=='reservedNativeSlotsRejectEveryPublicStorageOperation'
    if slots:
     assert cls==APP+'.ConnectionInstrumentedTest' and not state['notifications']
     assert args[args.index('class')+2:args.index('class')+5]==('-e','nativeSlotIsolation','1')
     if fault=='slot-wrong':method='other'
    view=method=='enabledViewProfileHttpPreservesAuthenticationAndConditionalRevision'
    if view:
     assert cls==APP+'.ConnectionInstrumentedTest' and not state['notifications']
     assert args[args.index('class')+2:args.index('class')+5]==('-e','enabledViewTransport','1')
     if fault=='view-wrong':method='other'
    start=f'INSTRUMENTATION_STATUS: class={cls}\nINSTRUMENTATION_STATUS: test={method}\nINSTRUMENTATION_STATUS: numtests=1\nINSTRUMENTATION_STATUS_CODE: '
    return start+'1\n'+start+('-3' if selector==expected and fault=='skip' or timingCase and fault==timingCase+'-skip' or transport and fault=='transport-skip' or cloud and fault=='cloud-'+cloud+'-skip' or tap and fault=='tap-skip' or process and fault=='process-skip' or approval and fault=='approval-skip' or view and fault=='view-skip' or reminderTap and fault=='reminder-tap-skip' or reminderDeath and fault=='reminder-death-skip' or slots and fault=='slot-skip' or clock and fault=='clock-skip' else '0')+'\nINSTRUMENTATION_RESULT: stream=\nOK (1 test)\n'+receipt+'INSTRUMENTATION_CODE: -1\n'
   if args[:3]==('shell','pm','remove-user'):assert state['current']=='0';state.update(user=None,name=None)
   return ''
  def owned(run,user,name,current=None):assert user==state['user'] and name==state['name'];assert current is None or state['current']==current
  def switch(target,user,name):
   owned(run,user,name);state['current']=target
   if (fault=='cleanup-unsettled' or fault=='clock-cleanup-unsettled' and len(methods)==17) and target=='0':raise AssertionError('Owned foreground switch timed out')
  def guard():assert state['current']=='0'
  def installed(pkg,user,digest):assert user=='10' and digest==variant
  def admit_display(run,user,name,record):owned(run,user,name,user);record({'admitted':True})
  with tempfile.TemporaryDirectory() as directory:
   env=dict(globals(),out=Path(directory),manifest={variant+'-'+k+'.apk':variant for k in ['debug','androidTest']},assert_no_resident=lambda run:None,interrupted=lambda *args:None)
   failed=False
   try:exec(code,env)
   except (AssertionError,RuntimeError):failed=True
   assert failed==(fault!='none'),(variant,fault,failed)
   if fault=='none':
    assert prepares==[APP+'.WorkflowNoticeProcessDeathInstrumentedTest#originalNoticeLaunchesAbsentMainAfterOrdinaryProcessDeath',APP+'.WorkflowNoticeProcessDeathInstrumentedTest#approvalNoticeOpensOnlyItsApprovalAfterProcessDeath']
    # The approval process-death phase keeps its receipt beside the instrumentation output.
    receipt=json.loads((Path(directory)/(variant+'-workflow-approval-process-death-receipt.json')).read_text())
    assert receipt['openedApprovals']==1 and receipt['untouchedApprovals']==1 and receipt['beforePid']!=receipt['afterPid']
   if fault in ['cleanup-unsettled','clock-cleanup-unsettled']:
    assert state['user']=='10' and state['current']=='0'
    remainingCalls=calls if fault=='cleanup-unsettled' else calls[next(i for i in range(len(calls)-1,-1,-1) if calls[i][:3]==('shell','pm','create-user')):]
    assert not any('stop-user' in c or 'remove-user' in c for c in remainingCalls)
    rows=[json.loads(p.read_text()) for p in Path(directory).glob('*ownership.json')]
    retained=[row for row in rows if row['state']=='owned'];assert len(retained)==1 and retained[0]['cleanupComplete'] is False
    assert len(rows)==(1 if fault=='cleanup-unsettled' else 17)
    print('PASS',variant,fault)
    continue
   assert state['user'] is None and state['current']=='0'
   early=fault in ['permission-denied','none-skip','none-wrong','numeric-skip','numeric-wrong']
   if early:assert expected not in methods
   else:assert methods.count(expected)==1
   count=10 if fault in ['prepare-skip','prepare-wrong'] else 1 if fault in ['permission-denied','none-skip','none-wrong'] else 2 if fault in ['numeric-skip','numeric-wrong'] else 6 if fault in ['skip','wrong-method'] else 7 if fault in ['transport-skip','transport-wrong'] else 8 if fault in ['cloud-cold-skip','cloud-cold-wrong'] else 9 if fault in ['cloud-warm-skip','cloud-warm-wrong','tap-permission-denied'] else 10 if fault in ['tap-skip','tap-wrong','process-permission-denied'] else 11 if fault in ['process-skip','process-wrong'] else 12 if fault in ['approval-skip','approval-wrong','approval-receipt'] else 13 if fault in ['view-skip','view-wrong'] else 14 if fault in ['reminder-tap-skip','reminder-tap-wrong'] else 15 if fault in ['reminder-death-skip','reminder-death-wrong'] else 16 if fault in ['slot-skip','slot-wrong'] else 17
   assert len(methods)==count,(fault,methods)
   assert all(json.loads(p.read_text())['state']=='removed' for p in Path(directory).glob('*ownership.json'))
  print('PASS',variant,fault)

# Execute the production switch helper: am may expose target before UserController settles.
switch_node=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='switch')
switch_code=compile(ast.fix_missing_locations(ast.Module(body=[switch_node],type_ignores=[])),str(source),'exec')
for target,previous in [('0','10'),('10','0')]:
 for fault in ['none','transition','missing','duplicate','unknown','never-settled']:
  observations=[];calls=[]
  def switch_run(*args):
   calls.append(args)
   if args==('shell','am','get-started-user-state','10'):return 'RUNNING_UNLOCKED'
   if args==('shell','am','get-current-user'):return target
   if args==('shell','dumpsys','activity'):
    observations.append(True)
    if fault=='missing':return ''
    if fault=='duplicate':return f'mCurrentUserId:{target}\nmCurrentUserId:{target}\nmTargetUserId:-10000'
    if fault=='unknown':return 'mCurrentUserId:99\nmTargetUserId:-10000'
    if fault=='never-settled' or fault=='transition' and len(observations)<3:return f'mCurrentUserId:{previous}\nmTargetUserId:{target}'
    return f'mCurrentUserId:{target}\nmTargetUserId:-10000'
   assert args==('shell','am','switch-user',target),args
   return ''
  class NoSleep:
   @staticmethod
   def sleep(seconds):assert seconds==.5
  env={'run':switch_run,'owned':lambda run,user,name:None,'re':re,'time':NoSleep}
  exec(switch_code,env)
  failed=False
  try:env['switch'](target,'10','fixture')
  except AssertionError:failed=True
  assert failed==(fault not in ['none','transition']),(target,fault)
  assert len(observations)==(1 if fault=='none' else 3 if fault=='transition' else 30)
  assert sum(c==('shell','am','switch-user',target) for c in calls)==1
  assert not any('stop-user' in c or 'remove-user' in c for c in calls)
  print('PASS settled switch',target,fault)
