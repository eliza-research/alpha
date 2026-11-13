from pathlib import Path
import ast, datetime, hashlib, json, os, re, shutil, signal, subprocess, time

root=Path.cwd(); out=root/'test-results/quint/initial-seed-cover'; out.mkdir(parents=True,exist_ok=True)
digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
now=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
model=root/'specs/quint/native/NativeCrashJournal.qnt'; original=subprocess.check_output(['git','show','33397b9f538bafb7af22b79f5359e761bf5a5100:specs/quint/native/NativeCrashJournal.qnt']).decode()
assert hashlib.sha256(original.encode()).hexdigest()=='a9b4d16dcc78ac324c081dc7ae7617d532d516611db7d90b1b25738eb3788b7e'
seeds=ast.literal_eval('['+re.search(r'val seeds=Set\(([^\n]+)\)',original)[1]+']')
assert len(seeds)==7 and len(set(seeds))==7
aliases={f'proofInit{s.title()}':s for s in seeds}
insert='  // Exhaustive aliases of the original init seed choice; actions and safety are unchanged.\n'+''.join(f'  action {alias} = initWith("{seed}")\n' for alias,seed in aliases.items())+'\n'
assert model.read_text()==original.replace('  action init = {\n',insert+'  action init = {\n')
tracked=subprocess.check_output(['git','ls-files','-z']).split(b'\0')
inputs={p.decode():digest(root/p.decode()) for p in tracked if p and (root/p.decode()).is_file()}
pin=json.loads((root/'upstream.lock.json').read_text())['commit']
assert subprocess.check_output(['git','-C','vendor/eliza','rev-parse','HEAD'],text=True).strip()==pin
record={'head':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'startedAt':now(),'passed':False,
        'status':'running','sourceSha256':digest(model),'originalSha256':hashlib.sha256(original.encode()).hexdigest(),
        'aliases':aliases,'exhaustiveOriginalInitialSeedCover':True,'inputHashes':inputs,'upstreamPin':pin,
        'totalBudgetSeconds':1800,'maxSteps':6,'defaultHeapMiB':4096,'results':[]}
report=out/'cover.json'; report.write_text(json.dumps(record,indent=2)+'\n')
start=time.monotonic(); deadline=start+1800
for alias, seed in aliases.items():
    case=out/seed; case.mkdir(exist_ok=True);tmp=case/'tmp';tmp.mkdir(exist_ok=True)
    command=['bun','node_modules/@informalsystems/quint/dist/src/cli.js','verify',str(model),'--main=NativeCrashJournal',
             '--backend=apalache','--max-steps=6',f'--init={alias}','--step=step','--invariant=safety','--verbosity=5',
             '--server-endpoint=127.0.0.1:8845','--apalache-version=0.62.4','--tlc-config=specs/quint/tlc.json',
             '--apalache-config=scripts/ci/native-crash-seed-debug.json']
    env={**os.environ,'TMPDIR':str(tmp.resolve())}
    for key in ['JVM_ARGS','JVM_GC_ARGS','JAVA_TOOL_OPTIONS','_JAVA_OPTIONS','SMT_ENCODING','SMT_SOLVER','CONFIG_FILE','OUT_DIR','RUN_DIR','WRITE_INTERMEDIATE']:env.pop(key,None)
    r={'alias':alias,'seed':seed,'command':command,'startedAt':now(),'remainingAggregateSeconds':max(0,deadline-time.monotonic()),'passed':False}
    owned=None;child=None
    try:
        if time.monotonic()>=deadline:raise TimeoutError('Original aggregate 1800 second budget expired')
        assert not subprocess.run(['lsof','-t','-nP','-iTCP:8845','-sTCP:LISTEN'],capture_output=True,text=True).stdout
        with (case/'output.log').open('wb') as log:
            child=subprocess.Popen(command,stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,env=env,start_new_session=True)
            r['pid']=child.pid
            while child.poll() is None:
                if time.monotonic()>=deadline:raise TimeoutError('Original aggregate 1800 second budget expired')
                if owned is None:
                    listing=subprocess.check_output(['ps','-axo','pid=,ppid=,args='],text=True).splitlines();rows={}
                    for line in listing:
                        fields=line.split(None,2)
                        if len(fields)==3:rows[int(fields[0])]=(int(fields[1]),fields[2])
                    for pid,(parent,args) in rows.items():
                        if 'apalache.jar' not in args or '--port=8845' not in args or '-jar' not in args:continue
                        chain=[pid];cursor=parent
                        for _ in range(16):
                            chain.append(cursor)
                            if cursor==child.pid:break
                            if cursor not in rows:break
                            cursor=rows[cursor][0]
                        if child.pid in chain:owned={'pid':pid,'actualProcess':args,'ancestorChain':chain,'capturedWhileOwned':True};break
                time.sleep(.25)
            r['exitCode']=child.wait()
    except BaseException as error:
        r['error']=str(error)
    finally:
        if child and child.poll() is None:
            os.killpg(child.pid,signal.SIGTERM)
            try:child.wait(timeout=5)
            except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);child.wait(timeout=5)
            r['exitCode']=child.returncode
    output=(case/'output.log').read_text(errors='replace') if (case/'output.log').exists() else ''
    holds={(int(s),int(i)) for s,i in re.findall(r'State ([0-9]+): state invariant ([0-9]+) holds\.',output)}
    vc=[int(v) for v in re.findall(r'VCGen produced ([0-9]+) verification condition',output)]
    jar=Path.home()/'.quint/apalache-dist-0.62.4/apalache/lib/apalache.jar'
    r.update({'actualJvm':owned,'VCCounts':vc,'completedStateInvariantPairs':sorted(holds),'finishedAt':now(),
              'outputSha256':digest(case/'output.log') if (case/'output.log').exists() else None,'jarSha256':digest(jar) if jar.exists() else None})
    r['passed']=r.get('exitCode')==0 and not r.get('error') and 'The outcome is: NoError' in output and '[ok] No violation found' in output and vc==[7] and holds=={(s,i) for s in range(7) for i in range(7)} and owned is not None and '-Xmx4096m' in owned['actualProcess'] and r['jarSha256']=='e5223915507b65cc5f1638bd037ede60f8a4fc1644aff46355779f9b05df9262' and not re.search(r'=> TIMEOUT|Assuming it holds|Found a deadlock|invariant [0-9]+.* violated',output)
    record['results'].append(r); report.write_text(json.dumps(record,indent=2)+'\n')
    print(json.dumps({k:r.get(k) for k in ['seed','passed','exitCode','error','remainingAggregateSeconds']}),flush=True)
    # The CLI must retire its own owned listener before the next full proof.
    stop=time.monotonic()+10
    while subprocess.run(['lsof','-t','-nP','-iTCP:8845','-sTCP:LISTEN'],capture_output=True,text=True).stdout and time.monotonic()<stop:time.sleep(.1)
    if not r['passed']:break
record['elapsedSeconds']=time.monotonic()-start;record['finishedAt']=now()
record['finalInputErrors']=[p for p,h in inputs.items() if not (root/p).is_file() or digest(root/p)!=h]
record['passed']=len(record['results'])==7 and all(r['passed'] for r in record['results']) and record['elapsedSeconds']<=1800 and not record['finalInputErrors']
record['status']='passed' if record['passed'] else 'failed';report.write_text(json.dumps(record,indent=2)+'\n')
raise SystemExit(0 if record['passed'] else 1)
