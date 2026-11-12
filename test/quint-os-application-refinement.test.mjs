import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {checkOSProvisioning} from '../specs/quint/refinement/application/os-provisioning.mjs';
import {verifyRefinementReceiptInputs, captureInputs, checkTraces} from '../specs/quint/refinement/check-traces.mjs';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {materialize, root} from '../specs/quint/refinement/application/os-host-support.mjs';
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';

const driver=fileURLToPath(import.meta.url),stage='scripts/stage-alpha-os-branding.py';
const runner=`import json,sys,tempfile,types
from pathlib import Path
original,observed=sys.argv[1:]
module=types.ModuleType('alpha_stage_source');module.__file__=original
events=[]
module.observe=lambda event:events.append(event)
exec(compile(Path(observed).read_text(),original,'exec'),module.__dict__)
real_replace=module.os.replace
traces=[]
def action(name,*args):return {'name':name,'args':list(args)}
def trace(name):
 t={'name':name,'init':action('init'),'expect':{'s.phase':'idle','s.backedUp':False,'s.writes':0,'s.accepted':False},'steps':[]}
 traces.append(t);return t
def mark(t,label,call,**observed):t['steps'].append({'label':label,'action':call,'expect':{'s.'+key:value for key,value in observed.items()}})
class AssetsAdmitted(Exception):pass
def admission(directory,bad=None):
 assets=directory/'assets';assets.mkdir();(assets/'bootanimation.zip').write_bytes(b'finite boot payload');(assets/'default_wallpaper.png').write_bytes(b'finite wallpaper payload')
 report={'sourceLogoSha256':module.digest((module.REPO/'apps/app/public/logo-mark.svg').read_bytes()),'width':1080,'height':2424,'accent':'#0000FF','wallpaperBackground':'#050505','bootAnimationSha256':module.digest((assets/'bootanimation.zip').read_bytes()),'wallpaperSha256':module.digest((assets/'default_wallpaper.png').read_bytes())}
 path=assets/'branding-assets.json';path.write_text(json.dumps(report));pin=module.digest(path.read_bytes())
 if bad=='payload':(assets/'bootanimation.zip').write_bytes(b'drifted payload')
 if bad=='report':pin='0'*64
 if bad=='geometry':report['width']=1;path.write_text(json.dumps(report));pin=module.digest(path.read_bytes())
 checked=[];real_check=module.subprocess.check_output;real_core=module.core_policy_plan
 def revision(command,**kwargs):
  assert command[:2]==['git','-C'] and command[-2:]==['rev-parse','HEAD']
  project=str(Path(command[2]).relative_to(directory));checked.append(project)
  return next(row['revision'] for row in module.LOCK['files'] if row['project']==project)+'\\n'
 def boundary(*args,**kwargs):raise AssetsAdmitted()
 module.subprocess.check_output=revision;module.core_policy_plan=boundary
 try:
  try:module.build_plan(directory,assets,pin,directory/'unused-inputs')
  except AssetsAdmitted:
   assert bad is None;return True
  except AssertionError:
   assert bad is not None;return False
  raise AssertionError('Admission never reached the core policy boundary')
 finally:
  module.subprocess.check_output=real_check;module.core_policy_plan=real_core
  assert checked==['packages/apps/Provision','frameworks/base']
for bad in ['payload','report','geometry']:
 with tempfile.TemporaryDirectory() as name:
  t=trace('asset-'+bad);assert not admission(Path(name),bad)
  mark(t,'Actual build_plan rejected asset input',action('badAssets'),assets=False)
  mark(t,'No filesystem staging followed admission failure',action('admit'),phase='refused',writes=0,backedUp=False,accepted=False)
for kind in ['complete','preimage-drift','second-replace-failure','readback-corruption']:
 with tempfile.TemporaryDirectory() as name:
  directory=Path(name);assert admission(directory)
  target=directory/'source';target.mkdir();backup=directory/'retained';names=['one/source.txt','two/source.txt'];plan={name:('after-'+name).encode() for name in names};before={name:('before-'+name).encode() for name in names}
  rows=[]
  for name in names:
   path=target/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(before[name]);rows.append({'path':name,'beforeSha256':module.digest(before[name]),'sha256':module.digest(plan[name]),'changed':True})
  t=trace(kind);events.clear();written=[];admitted=False;backed=False
  if kind=='preimage-drift':
   (target/names[1]).write_bytes(b'unreviewed owner bytes');mark(t,'A later source preimage changed',action('drift'),preimages=False)
  def observed_event(event):
   global admitted
   assert event=='all-preimages-admitted';admitted=True
   mark(t,'Real apply_plan checked every preimage before mutation',action('admit'),phase='admitted',assets=True,preimages=True,writes=0,backedUp=False,accepted=False)
  module.observe=observed_event
  def replace(temporary,destination):
   global backed
   name=str(Path(destination).relative_to(target));retained=backup/name
   assert retained.read_bytes()==before[name], 'A source replacement lacked its exact preimage'
   assert all((backup/old).read_bytes()==before[old] for old in written)
   backed=True;mark(t,'Real preimage bytes exist before replacement',action('backup'),backedUp=True,writes=len(written),accepted=False)
   if kind=='second-replace-failure' and len(written)==1:raise OSError('Injected atomic replacement failure')
   real_replace(temporary,destination);written.append(name)
   assert Path(destination).read_bytes()==plan[name]
   mark(t,'Real atomic replacement completed',action('write'),writes=len(written),backedUp=True,accepted=False)
   if kind=='readback-corruption' and len(written)==2:Path(destination).write_bytes(b'post-write corruption')
  module.os.replace=replace
  try:
   try:
    module.apply_plan(target,plan,rows,backup)
   except (AssertionError,OSError):
    if kind=='preimage-drift':
     assert not admitted and not written and not backup.exists();assert (target/names[0]).read_bytes()==before[names[0]]
     mark(t,'First admission loop refused before any mutation',action('admit'),phase='refused',writes=0,backedUp=False,accepted=False)
    else:
     assert kind in ['second-replace-failure','readback-corruption'];assert len(written)==(1 if kind=='second-replace-failure' else 2)
     assert all((backup/name).read_bytes()==before[name] for name in names)
     mark(t,'Actual I/O or final readback failure cannot return success',action('failure'),phase='failed',writes=len(written),backedUp=backed,accepted=False)
   else:
    assert kind=='complete' and len(written)==2
    assert all((target/name).read_bytes()==plan[name] and (backup/name).read_bytes()==before[name] for name in names)
    mark(t,'Real apply_plan returned only after hash readback',action('verify'),phase='complete',writes=2,backedUp=True,accepted=True)
  finally:module.os.replace=real_replace
print(json.dumps(traces))
`;

async function checkOSSourceStaging(extraSources=[]){
 const sources=[driver,stage,'specs/quint/refinement/application/os-host-support.mjs','android/aosp/branding/provision/source-inputs.json',
  'android/aosp/branding/core-launcher/manifest.json','apps/app/public/logo-mark.svg',...extraSources];
 sources.push('test/fixtures/jvm-tools.mjs','scripts/prepare-patched-native.ts','scripts/upstream-native-source.ts','test/quint-application-refinement.test.mjs');
 const before=captureInputs(sources),temporary=mkdtempSync(join(tmpdir(),'alpha-os-stage-'));
 try{
  const source=readFileSync(resolve(root,stage),'utf8'),anchor="    for row in rows:\n        if not row['changed']: continue";
  assert.equal(source.split(anchor).length,2,'Unique preimage admission observer');
  const generated=materialize(temporary,{'stage-observed.py':source.replace(anchor,"    observe('all-preimages-admitted')\n"+anchor),'probe.py':runner});
  const driverHashes={...before,...captureInputs(generated)};
  const traces=JSON.parse(execFileSync('python3',[generated[1],resolve(root,stage),generated[0]],{encoding:'utf8',timeout:scaledTimeout(120000)}));assert.equal(traces.length,7);
  return await checkTraces({model:'OSSourceStaging',sources:[...sources,...generated],driverHashes,generatedSources:generated,traces,scope:'bounded-orchestration',assumptions:[
   'The actual Python build_plan asset-report/payload/geometry/package admission prefix and apply_plan filesystem implementation execute. One read-only observer marks completion of its all-preimage loop; real temporary files, backup writes, atomic replacements and final hash readback are used.',
   'Source admission identity (s.source) is deliberately unobserved: Git revision responses are a declared trusted port and build_plan stops at core_policy_plan. Source fetching, generated PNG/ZIP validity, core-patch materialization, whole-plan construction and AOSP source identity are separate existing staging-test obligations; these traces establish no image build or device qualification.',
   'Two changed existing files represent the finite write bound. backedUp means exact recovery bytes for each write in the completed prefix; the source backs up per file immediately before replacement, rather than backing up every future file before its first write. Write failure and post-write corruption preserve backups and cannot return success; rollback, receipt publication and power-loss durability are outside this adapter.',
  ]});
 }finally{rmSync(temporary,{recursive:true,force:true});}
}

for(const [model,check,count,actions] of [
 ['OSProvisioning',checkOSProvisioning,12,['begin','callback','timeout','destroy','authorityLost','ownerKeyboard','keyboardDefault','finish','requestAppearance','applyAppearance']],
 ['OSSourceStaging',checkOSSourceStaging,7,['badAssets','drift','admit','backup','write','failure','verify']],
])test(model+' executes OS source with independently retained harness inputs',{timeout:240000},async()=>{
 const receipt=await check([fileURLToPath(import.meta.url)]);
 assert.equal(receipt.model,model);assert.ok(receipt.passed&&receipt.driverInputsBound&&receipt.inputsUnchanged);
 assert.equal(receipt.traces,count);assert.ok(Object.keys(receipt.generatedSourceSnapshots).length>0);
 assert.ok(verifyRefinementReceiptInputs(receipt),'Consumed and generated inputs revalidate after temporary cleanup');
 for(const name of actions)assert.ok(receipt.actions[name]>0,'Actual-source action '+name);
 assert.ok(Object.keys(receipt.sourceHashesBefore).some(path=>path.endsWith('/test/quint-application-refinement.test.mjs')));
});
