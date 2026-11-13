#!/usr/bin/env python3
"""Owned CI process-group supervisor; no retries, cache deletion or credential access."""
import argparse,json,os,signal,shutil,subprocess,sys,time
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--name',required=True);p.add_argument('--seconds',type=int,required=True);p.add_argument('command',nargs=argparse.REMAINDER);a=p.parse_args()
assert os.environ.get('GITHUB_ACTIONS')=='true','CI only';assert a.command and 0<a.seconds<=7200
out=Path('test-results/resident-ci');out.mkdir(parents=True,exist_ok=True);free=lambda:shutil.disk_usage(Path.cwd()).free
assert free()>=10*1024**3,'10GiB pre-phase admission failed; do not prune or bypass'
def interrupted(*unused):raise KeyboardInterrupt('CI phase interrupted')
signal.signal(signal.SIGTERM,interrupted);signal.signal(signal.SIGINT,interrupted)
def group_live(pid):
 try:os.killpg(pid,0);return True
 except ProcessLookupError:return False
def owned_process_snapshot(pid):
 # No environment or arguments: retain only bounded identity/progress metadata.
 probe=subprocess.run(['ps','-axo','pid=,ppid=,pgid=,stat=,etime=,time=,comm='],capture_output=True,text=True,timeout=5,check=True)
 rows=[]
 for line in probe.stdout[:1024*1024].splitlines()[:4096]:
  fields=line.split(None,6)
  if len(fields)!=7:continue
  rows.append(dict(zip(('pid','ppid','pgid','state','elapsed','cpu','comm'),[int(value) for value in fields[:3]]+fields[3:])))
 owned={pid};owned.update(row['pid'] for row in rows if row['pgid']==pid)
 while True:
  descendants={row['pid'] for row in rows if row['ppid'] in owned}
  if descendants<=owned:break
  owned.update(descendants)
 snapshot={'rootPid':pid,'scope':'Currently discoverable descendants and original owned process group; no other processes, environment or arguments.',
  'truncated':len(probe.stdout)>1024*1024 or len(probe.stdout.splitlines())>4096,
  'processes':[row for row in rows if row['pid'] in owned]}
 target=out/(a.name+'-owned-processes.json');target.write_text(json.dumps(snapshot,indent=2)+'\n')
 return str(target)
state={'command':a.command,'passed':False,'minimumFreeBytes':free(),'deadlineSeconds':a.seconds};start=time.monotonic();child=None
try:
 with (out/(a.name+'.log')).open('x') as log:
  child=subprocess.Popen(a.command,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
  while child.poll() is None:
   state['minimumFreeBytes']=min(state['minimumFreeBytes'],free())
   if free()<4*1024**3:raise RuntimeError('4GiB floor reached')
   if time.monotonic()-start>a.seconds:raise RuntimeError('Phase deadline')
   time.sleep(1)
  state['exitCode']=child.returncode
  if child.returncode!=0:
   log.flush()
   # Keep the full artifact, but surface a bounded tail in the Actions step.
   with (out/(a.name+'.log')).open('rb') as retained:
    retained.seek(0,os.SEEK_END);size=retained.tell();retained.seek(max(0,size-16384))
    print(retained.read().decode('utf-8',errors='replace'),file=sys.stderr)
   raise RuntimeError(f'Phase {a.name} exited with code {child.returncode}; full log: {out/(a.name+".log")}')
  assert not group_live(child.pid),'Phase exited with owned descendants still running'
  state['passed']=True
finally:
 signal.signal(signal.SIGTERM,signal.SIG_IGN);signal.signal(signal.SIGINT,signal.SIG_IGN)
 if child and not state['passed']:
  try:state['ownedProcessSnapshot']=owned_process_snapshot(child.pid)
  except BaseException as error:state['diagnosticErrorClass']=type(error).__name__
 try:
  if child and group_live(child.pid):
   try:os.killpg(child.pid,signal.SIGTERM)
   except ProcessLookupError:pass
   end=time.monotonic()+180
   while group_live(child.pid) and time.monotonic()<end:child.poll();time.sleep(.1)
   if group_live(child.pid):
    os.killpg(child.pid,signal.SIGKILL);state['ownedGroupCleanup']='forced-native-cleanup-unconfirmed'
   else:state['ownedGroupCleanup']='graceful'
   if child.poll() is None:child.wait(timeout=10)
 except BaseException as error:
  state['passed']=False;state['ownedGroupCleanup']='unconfirmed';state['cleanupErrorClass']=type(error).__name__
 state['elapsedSeconds']=time.monotonic()-start;(out/(a.name+'.json')).write_text(json.dumps(state,indent=2)+'\n')

if not state['passed']:raise SystemExit(1)
