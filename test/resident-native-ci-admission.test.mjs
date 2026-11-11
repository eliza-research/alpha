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
  for(const relative of ['upstream.lock.json','scripts/stage-local-agent-sources.ts','scripts/local-agent-source.ts'])fs.copyFileSync(path.join(root,relative),path.join(temporary,relative));
  const result=execFileSync('python3',['-c',String.raw`
import sys,copy,json,hashlib,subprocess
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,sys.argv[1])
from resident_native_source import verify_generated_native
from resident_fixture import verify_resident_fixture
h=lambda value:hashlib.sha256(value).hexdigest()
lock=json.loads(Path('upstream.lock.json').read_text())
generated={'runtimeSource':{'commit':lock['commit']},'patches':[],'files':[]}
frozen={p:h(Path(p).read_bytes()) for p in ['scripts/stage-local-agent-sources.ts','scripts/local-agent-source.ts']}
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
for script in ['scripts/stage-local-agent-sources.ts','scripts/local-agent-source.ts']:
 changed=copy.deepcopy(frozen);changed[script]='0'*64
 try:verify_generated_native(generated,changed)
 except AssertionError:pass
 else:raise AssertionError('Changed source producer was accepted')
archive=Path('archive');archive.mkdir()
for relative in ['android/private-peer-fixture/build.gradle','android/private-peer-fixture/src/Peer.java','scripts/ci/build-private-peer.py','android/app/src/main/java/Fixture.java']:
 target=Path(relative);target.parent.mkdir(parents=True,exist_ok=True);target.write_text('synthetic fixture '+relative)
names=[variant+'-'+kind+'.apk' for variant in ['standalone','launcher'] for kind in ['debug','release-unsigned','androidTest']]+['private-peer-debug.apk']
for name in names:(archive/name).write_text('synthetic archive '+name)
sources={relative:h(Path(relative).read_bytes()) for relative in ['android/private-peer-fixture/build.gradle','android/private-peer-fixture/src/Peer.java','scripts/ci/build-private-peer.py']}
helper={'schemaVersion':1,'package':'ai.alphacompute.alphaphone.peerfixture','apkSha256':h((archive/'private-peer-debug.apk').read_bytes()),'signerSha256':'a'*64,'sources':sources}
(archive/'private-peer-manifest.json').write_text(json.dumps(helper))
manifest={name:h((archive/name).read_bytes()) for name in names+['private-peer-manifest.json']}
(archive/'apk-manifest.json').write_text(json.dumps(manifest));manifest_hash=h((archive/'apk-manifest.json').read_bytes())
(archive/'native-generated-source-manifest.json').write_text(json.dumps(generated))
frozen.update({'upstream.lock.json':h(Path('upstream.lock.json').read_bytes()),'android/app/build/generated/local-agent/source-manifest.json':h((archive/'native-generated-source-manifest.json').read_bytes()),'android/app/src/main/java/Fixture.java':h(Path('android/app/src/main/java/Fixture.java').read_bytes())})
for name in ['inputs-before.json','inputs-after.json']:(archive/name).write_text(json.dumps({'files':frozen}))
sdk={'badging':"package: name='ai.alphacompute.alphaphone.peerfixture' versionCode='1'\napplication-debuggable",'certificates':'Signer #1 certificate SHA-256 digest: '+'a'*64+'\n'}
check_output=subprocess.check_output
def inspected(args,**kwargs):
 if Path(args[0]).name=='aapt':return sdk['badging']
 if Path(args[0]).name=='apksigner':return sdk['certificates']
 return check_output(args,**kwargs)
def admit(expected=manifest_hash):return verify_resident_fixture(archive,expected,'synthetic-sdk')
def refused():
 try:admit()
 except AssertionError:pass
 else:raise AssertionError('Tampered resident fixture was accepted')
with patch('subprocess.check_output',side_effect=inspected):
 assert admit()==(manifest,frozen,lock)
 try:admit('0'*64)
 except AssertionError:pass
 else:raise AssertionError('Unanchored archive manifest was accepted')
 for relative in ['archive/launcher-release-unsigned.apk','android/private-peer-fixture/src/Peer.java','archive/inputs-after.json','archive/native-generated-source-manifest.json','android/app/src/main/java/Fixture.java']:
  target=Path(relative);original=target.read_bytes();target.write_bytes(original+b'\n')
  try:refused()
  finally:target.write_bytes(original)
 extra=Path('android/private-peer-fixture/src/Unrecorded.java');extra.write_text('unrecorded')
 try:refused()
 finally:extra.unlink()
 for key,value in [('certificates','Signer #1 certificate SHA-256 digest: '+'b'*64+'\n'),('certificates',sdk['certificates']+'Signer #2 certificate SHA-256 digest: '+'a'*64+'\n'),('badging',sdk['badging']+'\nuses-permission: android.permission.INTERNET')]:
  original=sdk[key];sdk[key]=value
  try:refused()
  finally:sdk[key]=original
print('PASS: real upstream blobs and ten tamper cases; generated output is a synthetic frozen fixture, no staging/device proof')
print('PASS: shared resident archive admission and ten synthetic fixture refusals; no APK/device proof')
`,path.join(root,'scripts/ci')],{cwd:temporary,encoding:'utf8',timeout:30000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',PATH:path.dirname(process.execPath)+path.delimiter+process.env.PATH}});
  assert.match(result,/PASS: real upstream blobs and ten tamper cases/);
  assert.match(result,/PASS: shared resident archive admission and ten synthetic fixture refusals/);
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
});


test('Calendar bridge CI admits the current reviewed pin, Node declaration and exact owning fixture bytes',()=>{
 const result=execFileSync('python3',['-c',String.raw`
import hashlib,json,runpy
from pathlib import Path
root=Path.cwd()
bridge=runpy.run_path(str(root/'scripts/ci/calendar-bridge.py'))
assert bridge['SDK']==json.loads((root/'upstream.lock.json').read_text())['commit'], 'Calendar CI source pin is stale'
assert bridge['NODE']==(root/'.nvmrc').read_text().strip(), 'Calendar CI Node declaration is stale'
h=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
assert h(root/'android/app/src/main/java/ai/alphacompute/alphaphone/AlphaCalendarPlugin.java')==bridge['HOST'], 'Calendar host source changed'
for relative,expected in bridge['OWNING_SHA256'].items():
 assert h(root/'vendor/eliza'/relative)==expected, 'Calendar owning fixture changed: '+relative
print('PASS: current Calendar CI pin and exact host/owning fixture bytes')
`],{cwd:root,encoding:'utf8',timeout:10000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
 assert.match(result,/PASS: current Calendar CI pin and exact host\/owning fixture bytes/);
});

test('Calendar bridge hash budget includes the pinned Node 26 input and final drift checks',()=>{
 const source=fs.readFileSync(path.join(root,'scripts/ci/calendar-bridge.init.gradle'),'utf8');
 const declaration=source.match(/final long maxHashBytes = (\d+)L \* 1024 \* 1024/);
 assert.ok(declaration,'the complete streamed read has an explicit finite budget');
 const budget=Number(declaration[1])*1024*1024;
 // CI run 42418923481 retained all three real compile inputs and output inventories.
 // Six compile snapshots, eight fixed-input reads and final classpath/output rereads
 // require this volume at the reviewed Node 26.13.0 input, including the 150 MB binary.
 const measuredCompleteRead=1610673552;
 assert.ok(budget>measuredCompleteRead,'the final drift comparison must fit in the budget');
 assert.ok(budget<=2*1024*1024*1024,'streaming remains bounded to at most 2 GiB');
 assert.match(source,/count > 160L \* 1024 \* 1024 \|\| readBytes > maxHashBytes/);
 assert.match(source,/if \(current != before\[task\.path\]\)/);
 assert.match(source,/walk\(task\.destinationDirectory\.get\(\)\.asFile\) != row\.classes/);
});

test('disposable admission refuses either installed Alpha identity before fixture effects', async () => {
 const {admitResidentEmulator}=await import('../scripts/resident-emulator-admission.ts');
 const environment={ALPHA_RESIDENT_DISPOSABLE_EMULATOR:'1',ANDROID_SERIAL:'emulator-5594'};
 const inventory=packages=>args=>{
  if(args.join(' ')==='shell getprop ro.kernel.qemu')return '1';
  if(args.join(' ')==='shell getprop ro.product.cpu.abi')return 'arm64-v8a';
  if(args.join(' ')==='shell pm list packages -u')return packages;
  throw Error('Unexpected device effect before admission');
 };
 const currentIdentity='ai.alphacompute.alphaphone';
 for(const identity of [currentIdentity].flatMap(id=>[id,`${id}.test`]))
  assert.throws(()=>admitResidentEmulator(environment,inventory('package:com.android.settings\npackage:'+identity)),/fresh emulator/);
 assert.doesNotThrow(()=>admitResidentEmulator(environment,inventory('package:com.android.settings')));
 assert.throws(()=>admitResidentEmulator({...environment,ANDROID_SERIAL:'physical-device'},inventory('package:com.android.settings')),/Explicit disposable/);
});
