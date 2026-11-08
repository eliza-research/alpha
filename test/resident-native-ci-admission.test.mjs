import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
test('real CI source verifier rejects overlays, missing sources and forged source or generated hashes',()=>{
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-upstream-native-ci-'));
 try{
  fs.mkdirSync(path.join(temporary,'vendor'));
  // Existing immutable Git objects suffice; this test never checks out or edits SDK source.
  fs.symlinkSync(fs.realpathSync(process.env.ALPHA_RUNTIME_GIT_CACHE||path.join(root,'vendor/eliza')),path.join(temporary,'vendor/eliza'),'dir');
  fs.mkdirSync(path.join(temporary,'scripts'),{recursive:true});
  for(const relative of ['upstream.lock.json','scripts/stage-local-agent-sources.mjs','scripts/local-agent-source.mjs'])fs.copyFileSync(path.join(root,relative),path.join(temporary,relative));
  const result=execFileSync('python3',['-c',String.raw`
import sys,copy,json,hashlib,subprocess
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from resident_native_source import verify_generated_native
h=lambda value:hashlib.sha256(value).hexdigest()
lock=json.loads(Path('upstream.lock.json').read_text())
generated={'runtimeSource':{'commit':lock['commit']},'patches':[],'files':[]}
frozen={p:h(Path(p).read_bytes()) for p in ['scripts/stage-local-agent-sources.mjs','scripts/local-agent-source.mjs']}
for index,name in enumerate(['ElizaAgentService','IpcStartupRecovery','SecureStoreFrameInput']):
 origin='packages/app/platforms/android/app/src/main/java/ai/elizaos/app/'+name+'.java'
 committed=subprocess.check_output(['git','-C','vendor/eliza','show',lock['commit']+':'+origin])
 target='android/app/build/generated/local-agent/java/fixture'+str(index)+'.java'
 output=h(('synthetic identity-specific output '+str(index)).encode());frozen[target]=output
 generated['files'].append({'path':origin,'sourceSha256':h(committed),'sha256':h(committed),'generatedPath':target,'generatedSha256':output})
verify_generated_native(generated,frozen)
mutations=[lambda g:g.update(runtimeSource={'commit':'0'*40}),lambda g:g.update(patches=[{'files':{}}]),lambda g:g['files'][0].update(sourceSha256='0'*64),lambda g:g['files'][2].update(sha256='0'*64),lambda g:g['files'][0].update(generatedSha256='0'*64),lambda g:g['files'].pop(0),lambda g:g['files'].append(copy.deepcopy(g['files'][0])),lambda g:g['files'][0].update(generatedPath='../outside.java')]
for mutate in mutations:
 changed=copy.deepcopy(generated);mutate(changed)
 try:verify_generated_native(changed,frozen)
 except (AssertionError,KeyError):pass
 else:raise AssertionError('Tampered native source was accepted')
for script in ['scripts/stage-local-agent-sources.mjs','scripts/local-agent-source.mjs']:
 changed=copy.deepcopy(frozen);changed[script]='0'*64
 try:verify_generated_native(generated,changed)
 except AssertionError:pass
 else:raise AssertionError('Changed source producer was accepted')
print('PASS: real upstream blobs and ten tamper cases; generated output is a synthetic frozen fixture, no staging/device proof')
`,path.join(root,'scripts/ci')],{cwd:temporary,encoding:'utf8',timeout:30000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',PATH:path.dirname(process.execPath)+path.delimiter+process.env.PATH}});
  assert.match(result,/PASS: real upstream blobs and ten tamper cases/);
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
});
