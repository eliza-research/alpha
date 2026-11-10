import importlib.util,json,os,pathlib,sys,tempfile,time,unittest
from unittest.mock import patch
source=pathlib.Path(__file__).resolve().parents[1]/'scripts/ci/resident_crash_diagnostic.py'
spec=importlib.util.spec_from_file_location('diagnostic',source);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
PID=321;UID=1010123;START=1700000000000;NOW=START+2000

def lines(pid=PID,uid=UID,epoch='1700000001.000',writer='123 124'):
 return '\n'.join(f'{epoch} {UID} {writer} F DEBUG : {s}' for s in ['*** *** ***',f'pid: {pid}, tid: {pid}, name: private-name  >>> PRIVATE_COMMAND <<<',f'uid: {uid}','signal 31 (SIGSYS), code 1 (SYS_SECCOMP), fault addr --------','Cause: seccomp prevented call to disallowed x86_64 system call 435','PRIVATE_LOG_CONTENT'])

def proof():
 return {'runId':'run','case':'lost-rpc','missingModelRequest':{'httpStatus':200,'executionReadAvailable':True,'execution':{'executionMatches':True,'workflowMatches':True,'versionMatches':True,'workerTermination':{'signal':'SIGSYS','identity':{'pid':PID,'uid':UID,'startedAt':START}}}}}

class Flow(unittest.TestCase):
 def test_exact_projection(self):
  got=m.project(lines(),PID,UID,START,NOW)
  self.assertEqual({k:v for k,v in got.items() if k not in ('stage','reason','counts')},{'available':True,'source':'debuggerd-crash-buffer','pid':PID,'uid':UID,'signal':31,'code':1,'syscall':435,'timestamp':START+1000})
  self.assertNotIn('PRIVATE',json.dumps(got))
  self.assertEqual(got['counts'],{'lines':6,'debugLines':6,'headers':1,'pidHeaders':1,'timedPidHeaders':1,'uidMatches':1,'signalMatches':1,'causeMatches':1,'completeMatches':1})
  self.assertEqual((got['stage'],got['reason']),('parse','matched'))
 def test_attribution_refusals(self):
  for raw in [lines(pid=322),lines(uid=UID+1),lines(epoch='1699999999.000'),lines(epoch='1700000003.000'),lines().replace('signal 31','signal 11'),lines().replace('123 124 F DEBUG : Cause','222 223 F DEBUG : Cause'),lines()+'\n'+lines(),lines().replace('system call 435','system call 99999')]:
   with self.subTest(raw=raw[:20]):self.assertFalse(m.project(raw,PID,UID,START,NOW)['available'])
 def test_output_and_deadline_bounds(self):
  for command,seconds in [([sys.executable,'-c',"print('x'*600000)"],2),([sys.executable,'-c','import time;time.sleep(5)'],.15),([sys.executable,'-c',"import sys;sys.stderr.write('x'*600000)"],2)]:
   began=time.monotonic()
   with self.assertRaises((ValueError,TimeoutError)):m.bounded_read(command,began+seconds)
   self.assertLess(time.monotonic()-began,seconds+1.2)
 def test_actual_command_flow_and_refusals(self):
  with tempfile.TemporaryDirectory(prefix='alpha-crash-projection-test-') as td:
   root=pathlib.Path(td);record=root/'commands';fake=root/'adb'
   answers={'emu avd name':'test\nOK\n','shell getprop ro.kernel.qemu':'1','shell am get-current-user':'0','shell pm list users':'Users:\nUserInfo{0:Owner:13}\nUserInfo{10:alpha-ci-'+('a'*32)+':10}','shell run-as ai.elizaresearch.alphaphone --user 10 id -u':str(UID),'shell date +%s':'1700000002','logcat -b crash -d -v threadtime -v epoch -v uid -t 512':lines()}
   def install(values):
    fake.write_text('#!'+sys.executable+'\nimport json,sys\nfrom pathlib import Path\na=" ".join(sys.argv[3:])\nwith open('+repr(str(record))+',"a") as f:f.write(a+"\\n")\nd='+repr(values)+'\nif a not in d:sys.exit(91)\nprint(d[a])\n');fake.chmod(0o700)
   install(answers)
   env={'PATH':td+os.pathsep+os.environ['PATH'],'GITHUB_ACTIONS':'true','ALPHA_RESIDENT_DISPOSABLE_CI':'1'}
   with patch.dict(os.environ,env):
    self.assertTrue(m.capture('emulator-5554','10','alpha-ci-'+'a'*32,'run',proof())['available'])
    self.assertEqual(len(record.read_text().splitlines()),7)
    for key,value in [('shell am get-current-user','10'),('shell pm list users',answers['shell pm list users']+'\nUserInfo{11:Other:10}'),('shell run-as ai.elizaresearch.alphaphone --user 10 id -u',str(UID+1))]:
     record.write_text('');install({**answers,key:value})
     self.assertFalse(m.capture('emulator-5554','10','alpha-ci-'+'a'*32,'run',proof())['available'])
     self.assertNotIn('logcat',record.read_text())
    record.write_text('');install(answers)
    with patch.dict(os.environ,{'GITHUB_ACTIONS':'false'}):self.assertFalse(m.capture('emulator-5554','10','alpha-ci-'+'a'*32,'run',proof())['available'])
    self.assertEqual(record.read_text(),'')
 def test_fixed_unavailable_classification(self):
  for raw,reason in [('', 'no-exact-match'),(lines()+'\n'+lines(),'multiple-exact-matches'),(lines().replace('system call 435','system call 99999'),'syscall-out-of-range'),(lines()+'\n'+lines().splitlines()[2],'duplicate-field')]:
   value=m.project(raw,PID,UID,START,NOW);self.assertFalse(value['available']);self.assertEqual(value['reason'],reason)
   self.assertNotIn('PRIVATE',json.dumps(value));self.assertTrue(all(type(v) is int and 0<=v<=m.LIMIT for v in value['counts'].values()))
  env={'GITHUB_ACTIONS':'true','ALPHA_RESIDENT_DISPOSABLE_CI':'1'}
  with patch.dict(os.environ,env):
   for error,reason in [(m.OutputBound('PRIVATE'),'output-bound'),(m.CommandFailed('PRIVATE'),'command-failed'),(TimeoutError('PRIVATE'),'deadline'),(RuntimeError('PRIVATE'),'observation-unavailable')]:
    with patch.object(m,'bounded_read',side_effect=error):self.assertEqual(m.capture('emulator-5554','10','alpha-ci-'+'a'*32,'run',proof()),{'available':False,'stage':'avd','reason':reason})
  with patch.dict(os.environ,{'GITHUB_ACTIONS':'false'}):self.assertEqual(m.capture('emulator-5554','10','alpha-ci-'+'a'*32,'run',proof()),{'available':False,'stage':'host-admission','reason':'admission-refused'})
 def test_sigterm_optional_capture_preserves_primary_and_cleanup(self):
  import subprocess,signal
  with tempfile.TemporaryDirectory(prefix='alpha-crash-cancel-') as td:
   root=pathlib.Path(td);ready=root/'ready';cleaned=root/'cleaned';fake=root/'adb'
   answers={'emu avd name':'test\nOK\n','shell getprop ro.kernel.qemu':'1','shell am get-current-user':'0','shell pm list users':'Users:\nUserInfo{0:Owner:13}\nUserInfo{10:alpha-ci-'+('a'*32)+':10}','shell run-as ai.elizaresearch.alphaphone --user 10 id -u':str(UID),'shell date +%s':'1700000002'}
   fake.write_text('#!'+sys.executable+'\nimport os,sys,time\nfrom pathlib import Path\na=" ".join(sys.argv[3:])\nif a.startswith("logcat "):\n Path('+repr(str(ready))+').write_text(str(os.getpid()))\n time.sleep(30)\nelse: print('+repr(answers)+'[a])\n');fake.chmod(0o700)
   # Execute the actual optional finally branch, not a copied cancellation implementation.
   supervisor=source.parent/'resident-native.py'
   harness="""import ast,json,pathlib,signal,sys
sys.path.insert(0,sys.argv[1])
def interrupt(*unused):raise KeyboardInterrupt('owned cancellation')
signal.signal(signal.SIGTERM,interrupt)
tree=ast.parse(pathlib.Path(sys.argv[2]).read_text())
blocks=[n for n in ast.walk(tree) if isinstance(n,ast.If) and 'primary is not None' in ast.unparse(n.test) and "phase == 'lost-rpc'" in ast.unparse(n.test) and "filename == 'resident-recovery-complete.json'" in ast.unparse(n.test)]
assert len(blocks)==1
code=compile(ast.fix_missing_locations(ast.Module(body=[blocks[0]],type_ignores=[])),str(sys.argv[2]),'exec')
namespace={'primary':RuntimeError,'phase':'lost-rpc','filename':'resident-recovery-complete.json','serial':'emulator-5554','user':'10','name':'alpha-ci-'+'a'*32,'runid':'run','value':sys.argv[4],'out':pathlib.Path(sys.argv[3]),'variant':'standalone','json':json}
try:
 try:raise RuntimeError('primary-native-failure')
 finally:
  exec(code,namespace)
  pathlib.Path(sys.argv[3],'cleaned').write_text('owned cleanup reached')
except BaseException as error:
 print(type(error).__name__+':'+str(error),flush=True)
 sys.exit(0 if type(error) is RuntimeError and str(error)=='primary-native-failure' else 9)
"""
   env={**os.environ,'PATH':td+os.pathsep+os.environ['PATH'],'GITHUB_ACTIONS':'true','ALPHA_RESIDENT_DISPOSABLE_CI':'1'}
   child=subprocess.Popen([sys.executable,'-c',harness,str(source.parent),str(supervisor),td,json.dumps(proof())],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
   try:
    end=time.monotonic()+5
    while not ready.exists() and child.poll() is None and time.monotonic()<end:time.sleep(.01)
    self.assertTrue(ready.exists(),'Actual optional crash read was not reached')
    diagnostic_pid=int(ready.read_text());child.send_signal(signal.SIGTERM);stdout,stderr=child.communicate(timeout=5)
    self.assertEqual(child.returncode,0,stdout+stderr);self.assertEqual(stdout.strip(),'RuntimeError:primary-native-failure');self.assertEqual(cleaned.read_text(),'owned cleanup reached')
    with self.assertRaises(ProcessLookupError):os.kill(diagnostic_pid,0)
   finally:
    if child.poll() is None:child.kill()
    child.communicate(timeout=2)
if __name__=='__main__':unittest.main()
