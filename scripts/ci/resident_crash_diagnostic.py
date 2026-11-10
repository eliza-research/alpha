"""Optional hosted-only crash projection. Raw crash data never leaves memory.

Writes <variant>-<phase>-crash-projection.json, bound to the recovery proof's pid, uid and
timestamps. resident_uid_crash_audit.py writes the broader native-crash record for the owned
app UID; both exist because this one needs a recovery proof and that one does not."""
import os,re,selectors,subprocess,time
from decimal import Decimal

LIMIT=512*1024
class OutputBound(ValueError):pass
class CommandFailed(ValueError):pass

def bounded_read(argv,deadline):
    remaining=deadline-time.monotonic()
    if remaining<=0:raise TimeoutError()
    child=subprocess.Popen(argv,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    streams=selectors.DefaultSelector();streams.register(child.stdout,selectors.EVENT_READ);streams.register(child.stderr,selectors.EVENT_READ)
    data=bytearray();total=0
    try:
        while streams.get_map():
            remaining=deadline-time.monotonic()
            if remaining<=0:raise TimeoutError()
            for key,_ in streams.select(min(remaining,.1)):
                block=key.fileobj.read1(8192)
                if not block:streams.unregister(key.fileobj);continue
                total+=len(block)
                if total>LIMIT:raise OutputBound()
                if key.fileobj is child.stdout:data.extend(block)
        if child.wait(timeout=max(.001,deadline-time.monotonic()))!=0:raise CommandFailed()
        return data.decode('utf-8','strict')
    finally:
        streams.close()
        if child.poll() is None:child.kill();child.wait(timeout=1)
        child.stdout.close();child.stderr.close()

def project(raw,pid,uid,started,now):
    if len(raw.encode())>LIMIT:raise OutputBound()
    # Android15 liblog threadtime + epoch + uid: epoch writerUid writerPid writerTid priority tag: body.
    line_re=re.compile(r'^\s*(\d+\.\d+)\s+(\S+)\s+(\d+)\s+(\d+)\s+F\s+DEBUG\s*:\s?(.*)$')
    block=None;matches=[]
    counts={key:0 for key in ("lines","debugLines","headers","pidHeaders","timedPidHeaders","uidMatches","signalMatches","causeMatches","completeMatches")}
    def unavailable(reason):return {"available":False,"stage":"parse","reason":reason,"counts":counts}
    def finish():
        if block and block.get('pid')==pid and block.get('uid')==uid and block.get('signal')==31 and block.get('code')==1 and 'syscall' in block:
            matches.append({k:block[k] for k in ('pid','uid','signal','code','syscall','timestamp')})
    for line in raw.splitlines():
        counts["lines"]+=1
        m=line_re.fullmatch(line)
        if not m:continue
        counts["debugLines"]+=1
        timestamp=int(Decimal(m[1])*1000);writer=(m[2],m[3],m[4]);body=m[5]
        if body.startswith('*** ***') or body.startswith('pid: '):
            finish();block=None
        header=re.fullmatch(r'pid: (\d+), tid: \d+, name: .{0,1024}  >>> .{0,1024} <<<',body)
        if header:
            counts["headers"]+=1
            if int(header[1])==pid:counts["pidHeaders"]+=1
            if int(header[1])==pid and started<=timestamp<=now:counts["timedPidHeaders"]+=1
        if header and started<=timestamp<=now:
            block={'pid':int(header[1]),'timestamp':timestamp,'writer':writer};continue
        if not block or block['writer']!=writer or not started<=timestamp<=now:continue
        fields=[('uid',r'uid: (\d+)'),('signal',r'signal (31) \(SIGSYS\), code (1) \(SYS_SECCOMP\), fault addr .{0,128}'),('syscall',r'Cause: seccomp prevented call to disallowed (?:x86_64|x86|arm64|arm|riscv64) system call ([0-9]{1,5})')]
        for key,pattern in fields:
            found=re.fullmatch(pattern,body)
            if found:
                if key in block:return unavailable("duplicate-field")
                block[key]=int(found[1])
                if key=='signal':block['code']=int(found[2])
                if block['pid']==pid:
                    if key=='uid' and block[key]==uid:counts['uidMatches']+=1
                    if key=='signal':counts['signalMatches']+=1
                    if key=='syscall':counts['causeMatches']+=1
    finish()
    counts['completeMatches']=len(matches)
    if not matches:return unavailable('no-exact-match')
    if len(matches)!=1:return unavailable('multiple-exact-matches')
    if matches[0]['syscall']>65535:return unavailable('syscall-out-of-range')
    return {'available':True,'stage':'parse','reason':'matched','counts':counts,'source':'debuggerd-crash-buffer',**matches[0]}

def capture(serial,user,name,runid,proof):
    stage='host-admission'
    try:
        assert os.environ.get('GITHUB_ACTIONS')=='true' and os.environ.get('ALPHA_RESIDENT_DISPOSABLE_CI')=='1'
        assert re.fullmatch(r'emulator-[0-9]+',serial) and re.fullmatch(r'[1-9][0-9]*',user) and re.fullmatch(r'alpha-ci-[a-f0-9]{32}',name)
        stage='proof'
        assert proof['runId']==runid and proof['case']=='lost-rpc'
        diagnostic=proof['missingModelRequest'];execution=diagnostic['execution']
        assert diagnostic['httpStatus']==200 and diagnostic['executionReadAvailable'] is True
        assert all(execution[k] is True for k in ('executionMatches','workflowMatches','versionMatches'))
        termination=execution['workerTermination'];assert termination['signal']=='SIGSYS';identity=termination['identity']
        assert all(type(identity[k]) is int for k in ('pid','uid','startedAt'))
        pid,uid,started=(identity[k] for k in ('pid','uid','startedAt'));assert 0<pid<=2147483647 and 0<uid<=2147483647 and 0<started<=8640000000000000
        deadline=time.monotonic()+10
        def read(*args):return bounded_read(['adb','-s',serial,*args],min(deadline,time.monotonic()+3))
        # Fresh read-only admission; never requires or stops a resident worker for observation.
        stage='avd'
        assert read('emu','avd','name').splitlines()[0]=='test'
        stage='qemu'
        assert read('shell','getprop','ro.kernel.qemu').strip()=='1'
        stage='foreground-user'
        assert read('shell','am','get-current-user').strip()=='0'
        stage='user-inventory'
        inventory=re.findall(r'UserInfo\{(\d+):([^:}]+):',read('shell','pm','list','users'))
        assert len(inventory)==2 and dict(inventory).get(user)==name and set(dict(inventory))=={'0',user}
        stage='package-uid'
        actual=read('shell','run-as','ai.elizaresearch.alphaphone','--user',user,'id','-u').strip();assert actual==str(uid) and uid//100000==int(user)
        stage='guest-clock'
        now=int(read('shell','date','+%s').strip())*1000+999;assert started<=now
        stage='crash-read'
        raw=read('logcat','-b','crash','-d','-v','threadtime','-v','epoch','-v','uid','-t','512')
        stage='parse'
        return project(raw,pid,uid,started,now)
    except Exception as error:
        # Fixed classification only: never serialize exception messages or command text.
        reason=('output-bound' if isinstance(error,OutputBound) else 'command-failed' if isinstance(error,CommandFailed) else 'deadline' if isinstance(error,(TimeoutError,subprocess.TimeoutExpired)) else 'admission-refused' if isinstance(error,AssertionError) else 'malformed-data' if isinstance(error,(ValueError,TypeError,KeyError,IndexError)) else 'observation-unavailable')
        return {'available':False,'stage':stage,'reason':reason}
