"""Fixed-schema crash evidence only. Raw logcat, argv and stack contents are never saved.

Writes <variant>-<phase>-native-crash.json: seccomp crashes and audit denials owned by the
app UID, after every lost-rpc failure. resident_crash_diagnostic.py writes the separate
crash-projection record, bound to the recovery proof's pid and timestamps."""
import os,re,selectors,subprocess,time

def project_crashes(text, expected_uid):
    if not isinstance(expected_uid,int) or expected_uid<=0:raise ValueError('Expected owned app UID')
    reports=[];record={}
    def finish():
        if record.get('uid')==expected_uid and record.get('packagedRuntime') and record.get('seccomp'):
            reports.append({key:record[key] for key in ('pid','tid','uid','abi','syscall') if key in record})
    for line in text.splitlines():
        match=re.match(r'^F/DEBUG\s*\(\s*\d+\):\s?(.*)$',line)
        if not match:continue
        value=match[1]
        if value.startswith('*** *** ***'):
            finish();record={};continue
        match=re.fullmatch(r'pid: (\d+), tid: (\d+), name: .{0,256}  >>> .{0,4096} <<<',value)
        if match:record.update(pid=int(match[1]),tid=int(match[2]))
        match=re.fullmatch(r'uid: (\d+)',value)
        if match:record['uid']=int(match[1])
        if value.startswith('Cmdline: '):
            # Match only packaged runtime identity; do not retain the command or inline program.
            record['packagedRuntime']=bool(re.search(r'/data/app/[^\s]+/lib/(?:x86_64|arm64)/libeliza_(?:bun|ld_musl_(?:x86_64|aarch64)(?:_real)?)\.so(?:\s|$)',value))
        if re.fullmatch(r'signal 31 \(SIGSYS\), code 1 \(SYS_SECCOMP\), fault addr .{1,32}',value):record['seccomp']=True
        match=re.fullmatch(r'Cause: seccomp prevented call to disallowed (x86_64|arm64|arm|x86) system call ([0-9]{1,6})',value)
        if match:record.update(abi=match[1],syscall=int(match[2]))
    finish()
    return {'schemaVersion':1,'reports':reports[-16:]}

def project_audit(text,expected_uid):
    reports=[]
    for line in text.splitlines():
        if not re.search(r"\btype=1326\b",line):continue
        tokens=re.findall(r'(?:^|\s)([A-Za-z_]+)=("(?:[^"\\]|\\.)*"|[^\s]+)',line)
        fields={key:value for key,value in tokens}
        if len(fields)!=len(tokens):continue
        if fields.get('uid')!=str(expected_uid) or fields.get('sig')!='31':continue
        if not re.fullmatch(r'"/data/app/[^"\s]+/lib/(?:x86_64|arm64)/libeliza_(?:bun|ld_musl_(?:x86_64|aarch64)(?:_real)?)\.so"',fields.get('exe','')):continue
        abi={'c000003e':'x86_64','c00000b7':'arm64'}.get(fields.get('arch'))
        if not abi or not re.fullmatch(r'[0-9]{1,6}',fields.get('syscall','')) or not re.fullmatch(r'[0-9]{1,10}',fields.get('pid','')):continue
        reports.append({'pid':int(fields['pid']),'uid':expected_uid,'abi':abi,'syscall':int(fields['syscall'])})
    return reports[-16:]

def bounded_read(command,deadline):
    child=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
    data=bytearray();truncated=False;timed_out=False
    try:
        os.set_blocking(child.stdout.fileno(),False)
        with selectors.DefaultSelector() as selector:
            selector.register(child.stdout,selectors.EVENT_READ)
            while True:
                remaining=deadline-time.monotonic()
                if remaining<=0:timed_out=True;break
                events=selector.select(min(remaining,.1))
                if not events and child.poll() is not None:break
                if events:
                    chunk=os.read(child.stdout.fileno(),min(16384,262145-len(data)))
                    if not chunk:break
                    data.extend(chunk)
                    if len(data)>262144:truncated=True;break
    finally:
        if child.poll() is None:child.kill()
        child.wait(timeout=2);child.stdout.close()
    return bytes(data[:262144]).decode(errors='replace'),{'truncated':truncated,'timedOut':timed_out,'exitCode':child.returncode}

def collect_crashes(serial,expected_uid):
    if not re.fullmatch(r'emulator-[0-9]+',serial):raise ValueError('Disposable emulator required')
    if not isinstance(expected_uid,int) or expected_uid<=0:raise ValueError('Expected owned app UID')
    # Five seconds shared across two reads, 256 KiB each; raw bytes stay in memory.
    deadline=time.monotonic()+5
    text,crash=bounded_read(['adb','-s',serial,'logcat','-d','-b','crash','-v','brief','-t','500'],deadline)
    result=project_crashes(text,expected_uid)
    if time.monotonic()<deadline:
        text,audit=bounded_read(['adb','-s',serial,'shell','dmesg | tail -n 500'],deadline)
        result['auditReports']=project_audit(text,expected_uid)
    else:audit={'truncated':False,'timedOut':True,'exitCode':None};result['auditReports']=[]
    result.update(truncated=crash['truncated'] or audit['truncated'],timedOut=crash['timedOut'] or audit['timedOut'],reads={'crash':crash,'audit':audit})
    return result
