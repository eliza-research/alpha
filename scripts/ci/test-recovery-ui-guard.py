"""Read-only supervised command fixture: admission, strict transcript, and refusal flows."""
from recovery_ui_guard import owned,admit_display,terminal
USER='10';NAME='alpha-recovery-'+'a'*32
POLICY='''KeyguardServiceDelegate
 currentUser=10
 secure=false
 showing=false
 inputRestricted=false
 systemIsReady=true
 bootCompleted=true
 screenState=SCREEN_STATE_ON
 KeyguardStateMonitor
 mCurrentUserId=10
 mIsShowing=false
 mInputRestricted=false
'''
class Fixture:
 def __init__(self,policy=POLICY,user='10',name=NAME):self.policy=policy;self.user=user;self.name=name;self.effects=[];self.settings=[];self.idle='60000'
 def run(self,*args):
  key=' '.join(args)
  if key=='shell pm list users':return 'Users:\n UserInfo{0:Owner:13}\n UserInfo{10:'+self.name+':10}'
  if key=='shell am get-current-user':return self.user
  if key=='shell am get-started-user-state 10':return 'RUNNING_UNLOCKED'
  if key=='shell dumpsys power':return 'mWakefulness=Awake\nmUserId=10\nmForegroundProfile=10'
  if key=='shell dumpsys window policy':return self.policy
  if key=='shell settings --user 10 get system screen_off_timeout':return self.idle
  if key=='shell settings --user 10 put system screen_off_timeout 2400000':self.settings.append(key);self.idle='2400000';return ''
  if key in ('shell input keyevent KEYCODE_WAKEUP','shell wm dismiss-keyguard'):self.effects.append(key);return ''
  raise AssertionError('Unexpected fixture command '+key)
def refused(work):
 try:work()
 except AssertionError:return
 raise AssertionError('Unsafe case accepted')
f=Fixture();admit_display(f.run,USER,NAME,sleep=lambda _:None);assert len(f.effects)==2
for policy in [POLICY.replace('secure=false','secure=true'),POLICY.replace('mCurrentUserId=10','mCurrentUserId=0'),POLICY+' secure=false\n',POLICY.replace('mInputRestricted=false','')]:
 f=Fixture(policy=policy);refused(lambda:admit_display(f.run,USER,NAME,sleep=lambda _:None));assert not f.effects
f=Fixture(user='0');refused(lambda:admit_display(f.run,USER,NAME,sleep=lambda _:None));assert not f.effects
f=Fixture(name='other-user');refused(lambda:owned(f.run,USER,NAME));assert not f.effects
f=Fixture(policy=POLICY.replace('showing=false','showing=true'));refused(lambda:admit_display(f.run,USER,NAME,sleep=lambda _:None));assert len(f.effects)==2
cls='ai.elizaresearch.alphaphone.Fixture';method='exactMethod'
block=lambda code:'INSTRUMENTATION_STATUS: class='+cls+'\nINSTRUMENTATION_STATUS: test='+method+'\nINSTRUMENTATION_STATUS: numtests=1\nINSTRUMENTATION_STATUS_CODE: '+str(code)+'\n'
text=block(1)+block(0)+'OK (1 test)\nINSTRUMENTATION_CODE: -1\n';terminal(text,cls,method)
for bad in [text.replace('STATUS_CODE: 0','STATUS_CODE: -3'),text+block(0),text.replace(method,'other'),text.replace('numtests=1','numtests=2'),text.replace('OK (1 test)','OK (0 tests)'),text.replace('INSTRUMENTATION_CODE: -1','INSTRUMENTATION_CODE: 0'),text+'INSTRUMENTATION_FAILED: crash\n']:
 refused(lambda:terminal(bad,cls,method))
print('PASS: owned-secondary ready flow; secure/wrong-user/malformed/timeout refusal; exact transcript acceptance and seven failure classes')

# Actual API35 hosted switch observation: AM is user10, keyguard still user0.
from pathlib import Path
CAPTURED=(Path(__file__).parent/'fixtures/recovery-policy-52ab.txt').read_text()
class Sequence(Fixture):
 def __init__(self,policies,drift=False):
  super().__init__();self.policies=policies;self.reads=0;self.drift=drift
 def run(self,*args):
  if args==('shell','dumpsys','window','policy'):
   value=self.policies[min(self.reads,len(self.policies)-1)];self.reads+=1;return value
  if self.drift and self.reads and args==('shell','am','get-current-user'):return '0'
  return super().run(*args)
f=Sequence([CAPTURED,POLICY,POLICY,POLICY]);admit_display(f.run,USER,NAME,sleep=lambda _:None);assert f.reads==5 and len(f.effects)==2
f=Sequence([CAPTURED]);refused(lambda:admit_display(f.run,USER,NAME,sleep=lambda _:None));assert f.reads==30 and not f.effects
for bad in [CAPTURED.replace('secure=false','secure=true'),CAPTURED.replace('mCurrentUserId=0','mCurrentUserId=11'),CAPTURED.replace('mInputRestricted=false',''),CAPTURED+' currentUser=-10000\n',POLICY.replace('secure=false','secure=true')]:
 f=Sequence([bad]);refused(lambda:admit_display(f.run,USER,NAME,sleep=lambda _:None));assert f.reads==1 and not f.effects
f=Sequence([CAPTURED,POLICY],drift=True);refused(lambda:admit_display(f.run,USER,NAME,sleep=lambda _:None));assert not f.effects
f=Sequence([CAPTURED]*28+[POLICY]);refused(lambda:admit_display(f.run,USER,NAME,sleep=lambda _:None));assert f.reads==30 and len(f.effects)==2
f=Sequence([POLICY,CAPTURED]);refused(lambda:admit_display(f.run,USER,NAME,sleep=lambda _:None));assert f.reads==2 and len(f.effects)==1
print('PASS: captured switch transition; unchanged shared30 budget; secure/malformed/unknown-user/drift and post-admission regression fail closed')

import json
CAPTURED_IDLE=json.loads((Path(__file__).parent/'fixtures/recovery-idle-52ab.json').read_text())
class IdleSequence(Fixture):
 def __init__(self,rows,bad_readback=False):super().__init__();self.rows=rows;self.reads=0;self.bad_readback=bad_readback
 def run(self,*args):
  if args==('shell','dumpsys','power'):return self.rows[min(self.reads,len(self.rows)-1)]['power']
  if args==('shell','dumpsys','window','policy'):
   row=self.rows[min(self.reads,len(self.rows)-1)];self.reads+=1;return row['policy']
  if self.bad_readback and self.settings and args==('shell','settings','--user','10','get','system','screen_off_timeout'):return '60000'
  return super().run(*args)
READY={'power':'mWakefulness=Awake\nmUserId=10\nmForegroundProfile=10','policy':POLICY}
f=IdleSequence(CAPTURED_IDLE+[READY,READY]);admit_display(f.run,USER,NAME,sleep=lambda _:None);assert f.reads==7 and len(f.effects)==3 and len(f.settings)==1
# PowerManager still at prior user is read-only, never enough to wake/configure.
f=IdleSequence([CAPTURED_IDLE[1]]);refused(lambda:admit_display(f.run,USER,NAME,sleep=lambda _:None));assert f.reads==30 and not f.effects and not f.settings
for power in ['mWakefulness=Awake','mWakefulness=Awake\nmUserId=11\nmForegroundProfile=11','mWakefulness=Awake\nmUserId=10\nmUserId=10\nmForegroundProfile=10']:
 f=IdleSequence([dict(READY,power=power)]);refused(lambda:admit_display(f.run,USER,NAME,sleep=lambda _:None));assert not f.effects and not f.settings
f=IdleSequence([READY],bad_readback=True);refused(lambda:admit_display(f.run,USER,NAME,sleep=lambda _:None));assert len(f.settings)==1 and not f.effects
f=IdleSequence([READY,CAPTURED_IDLE[3]]);refused(lambda:admit_display(f.run,USER,NAME,sleep=lambda _:None));assert f.reads==30 and len(f.effects)==2 # maximum two wakes, no timeout extension
f=IdleSequence([READY,dict(CAPTURED_IDLE[3],policy=POLICY.replace('secure=false','secure=true'))]);refused(lambda:admit_display(f.run,USER,NAME,sleep=lambda _:None));assert len(f.effects)==1 # no insecure retry
f=IdleSequence([READY,CAPTURED_IDLE[1]]);refused(lambda:admit_display(f.run,USER,NAME,sleep=lambda _:None));assert len(f.effects)==1 # no prior-user regression
print('PASS: captured power-user/idle transition, owned timeout readback, bounded sleeping re-wake; timeout/malformed/security/drift refuse')

CAPTURED_DISMISS=json.loads((Path(__file__).parent/'fixtures/recovery-dismiss-52ab-v2.json').read_text())
# Captured rows are user11. Normalize only the owned numeric identity for the
# existing fake command transport; retain all actual display/power fields.
rows=[{key:value.replace('mUserId=11','mUserId=10').replace('mForegroundProfile=11','mForegroundProfile=10').replace('currentUser=11','currentUser=10').replace('mCurrentUserId=11','mCurrentUserId=10') for key,value in row.items()} for row in CAPTURED_DISMISS]
class Ordered(IdleSequence):
 def run(self,*args):
  if args==('shell','wm','dismiss-keyguard'):
   assert self.reads>=5,'Dismiss before captured awake observation'
   assert self.effects==['shell input keyevent KEYCODE_WAKEUP'],'Unexpected wake replay'
  return super().run(*args)
f=Ordered(rows+[READY,READY]);admit_display(f.run,USER,NAME,sleep=lambda _:None);assert f.reads==7 and len(f.effects)==2
f=Ordered(rows);refused(lambda:admit_display(f.run,USER,NAME,sleep=lambda _:None));assert f.reads==30 and len(f.effects)==2 # showing never clears; no false acceptance
f=IdleSequence([READY,dict(READY,policy=POLICY.replace('secure=false','secure=true'))]);refused(lambda:admit_display(f.run,USER,NAME,sleep=lambda _:None));assert f.effects==['shell input keyevent KEYCODE_WAKEUP']
print('PASS: actual asleep-to-awake captured sequence dismisses only after later bound awake/ON; persistent keyguard and new secure state refuse')

for power in ['mWakefulness=Awake\nmUserId=10\nmForegroundProfile=0','mWakefulness=Awake\nmUserId=0\nmForegroundProfile=10']:
 f=IdleSequence([dict(READY,power=power),READY,READY,READY,READY]);admit_display(f.run,USER,NAME,sleep=lambda _:None);assert f.reads==5 and len(f.effects)==2
 f=IdleSequence([dict(READY,power=power)]);refused(lambda:admit_display(f.run,USER,NAME,sleep=lambda _:None));assert f.reads==30 and not f.effects and not f.settings
 f=IdleSequence([READY,dict(READY,power=power)]);refused(lambda:admit_display(f.run,USER,NAME,sleep=lambda _:None));assert len(f.effects)==1
print('PASS: independent API35 main-user/profile transition waits read-only; timeout and post-admission regression refuse')

# Unmodified hosted e4d transcript: stream has an unprefixed class-name line.
captured=(Path(__file__).parent/'fixtures/recovery-storage-e4d-pass.txt').read_text()
captured_class='ai.elizaresearch.alphaphone.ReminderDeletionStorageInstrumentedTest'
captured_method='reminderDeletionSlotUsesEncryptedCompareExchange'
terminal(captured,captured_class,captured_method)
terminal(captured.replace('\n','\r\n'),captured_class,captured_method)
for bad in [
 captured.replace('STATUS_CODE: 0','STATUS_CODE: -3'),
 captured.replace('STATUS_CODE: 1','STATUS_CODE: 0'),
 captured.replace(captured_method,'otherMethod',1),
 captured.replace('numtests=1','numtests=2',1),
 captured.replace('INSTRUMENTATION_STATUS: current=1','INSTRUMENTATION_STATUS: class='+captured_class,1),
 captured.replace('INSTRUMENTATION_STATUS: test='+captured_method+'\n','',1),
 captured.replace('INSTRUMENTATION_STATUS_CODE: 0\n',''),
 captured+captured,
 captured+'INSTRUMENTATION_STATUS: test=late\n',
 'INSTRUMENTATION_CODE: -1\n'+captured.replace('INSTRUMENTATION_CODE: -1\n',''),
 captured+'INSTRUMENTATION_STATUS_CODE: 0\n',
 captured.replace('INSTRUMENTATION_CODE: -1','INSTRUMENTATION_CODE: 0'),
 captured.replace('OK (1 test)','OK (0 tests)'),
 captured+'INSTRUMENTATION_ABORTED: failure\n',
 captured+'INSTRUMENTATION_STATUS: stack=failure\n',
 captured+'INSTRUMENTATION_STATUS_CODE: invalid\n',
 captured+'INSTRUMENTATION_STATUS: broken\n',
]:refused(lambda:terminal(bad,captured_class,captured_method))
print('PASS: actual hosted multiline stream and CRLF; 17 malformed/skip/identity/order/count/late/failure cases refused')
