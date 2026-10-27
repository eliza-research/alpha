from pathlib import Path
import importlib.util, hashlib, json, os, subprocess, sys, tempfile, unittest
from unittest.mock import patch

REPO=Path(__file__).resolve().parents[1]
BRAND=REPO/'android/aosp/branding'
sys.path.insert(0,str(BRAND/'system-entry'))
from portable_tools import java_binary
spec=importlib.util.spec_from_file_location('alpha_branding_stage',REPO/'scripts/stage-alpha-os-branding.py')
stage=importlib.util.module_from_spec(spec);spec.loader.exec_module(stage)
INPUT=Path(os.environ.get('ALPHA_FRESH_PRESET_INPUTS',BRAND/'provision/.cache'))
ASSETS=Path(os.environ.get('ALPHA_BRANDING_ASSETS',BRAND/'generated'))

class FreshPresets(unittest.TestCase):
 def test_actual_policy_completed_managed_home_failure_and_existing_ime_choices(self):
  with tempfile.TemporaryDirectory(prefix='alpha-fresh-policy-')as d:
   p=Path(d)/'FreshTest.java';p.write_text('''package com.android.provision;
public class FreshTest {
 static int checks;static void check(boolean result){checks++;if(!result)throw new AssertionError();}
 static class Port implements AlphaFreshSetupPolicy.ImePort {
  boolean fresh=true,failEnable,failSelect,changedAfterEnable;String selected,enabled,target="com.android.inputmethod.latin/.LatinIME";int writes;
  public boolean eligible(){return fresh;}public String selected(){return selected;}public String enabled(){return enabled;}public String target(){return target;}
  public boolean enableIfUnchanged(String expected,String value){if(failEnable)return false;enabled=value;writes++;if(changedAfterEnable)selected="owner.keyboard/.IME";return true;}
  public boolean selectIfEmpty(String value){if(failSelect||selected!=null&&!selected.isEmpty())return false;selected=value;writes++;return true;}
 }
 public static void main(String[] args){
  for(boolean done:new boolean[]{false,true})for(boolean managed:new boolean[]{false,true})for(boolean primary:new boolean[]{false,true})
   check(AlphaFreshSetupPolicy.eligible(done,managed,primary)==(!done&&!managed&&primary));
  for(boolean accepted:new boolean[]{false,true})for(boolean held:new boolean[]{false,true})check(AlphaFreshSetupPolicy.homeVerified(accepted,held)==(accepted&&held));
  Port fresh=new Port();check(AlphaFreshSetupPolicy.ensureKeyboard(fresh)==AlphaFreshSetupPolicy.ImeResult.READY);check(fresh.target.equals(fresh.selected)&&fresh.target.equals(fresh.enabled)&&fresh.writes==2);
  Port previous=new Port();previous.fresh=false;check(AlphaFreshSetupPolicy.ensureKeyboard(previous)==AlphaFreshSetupPolicy.ImeResult.SKIPPED&&previous.writes==0);
  Port managed=new Port();managed.fresh=false;managed.selected="enterprise/.IME";check(AlphaFreshSetupPolicy.ensureKeyboard(managed)==AlphaFreshSetupPolicy.ImeResult.SKIPPED&&managed.writes==0);
  Port chosen=new Port();chosen.selected="owner.keyboard/.IME";check(AlphaFreshSetupPolicy.ensureKeyboard(chosen)==AlphaFreshSetupPolicy.ImeResult.EXISTING_CHOICE&&chosen.writes==0);
  Port enabled=new Port();enabled.enabled=enabled.target+";1234:other/.IME;99";check(AlphaFreshSetupPolicy.ensureKeyboard(enabled)==AlphaFreshSetupPolicy.ImeResult.READY);check(enabled.enabled.equals(enabled.target+";1234:other/.IME;99")&&enabled.writes==1);
  Port keep=new Port();keep.enabled="other/.IME;99";check(AlphaFreshSetupPolicy.ensureKeyboard(keep)==AlphaFreshSetupPolicy.ImeResult.READY);check(keep.enabled.equals("other/.IME;99:"+keep.target));
  Port absent=new Port();absent.target=null;check(AlphaFreshSetupPolicy.ensureKeyboard(absent)==AlphaFreshSetupPolicy.ImeResult.FAILED&&absent.writes==0);
  Port failure=new Port();failure.failEnable=true;check(AlphaFreshSetupPolicy.ensureKeyboard(failure)==AlphaFreshSetupPolicy.ImeResult.FAILED&&failure.writes==0);
  Port selection=new Port();selection.failSelect=true;check(AlphaFreshSetupPolicy.ensureKeyboard(selection)==AlphaFreshSetupPolicy.ImeResult.FAILED&&selection.selected==null);
  Port race=new Port();race.changedAfterEnable=true;check(AlphaFreshSetupPolicy.ensureKeyboard(race)==AlphaFreshSetupPolicy.ImeResult.EXISTING_CHOICE);check(race.selected.equals("owner.keyboard/.IME")&&race.writes==1);
  System.out.println("PASS fresh preset policy "+checks+" checks");
 }
}''')
   subprocess.run([java_binary('javac'),'--release','11','-d',d,str(BRAND/'provision/AlphaFreshSetupPolicy.java'),str(p)],check=True,capture_output=True)
   self.assertIn('PASS fresh preset policy',subprocess.check_output([java_binary('java'),'-cp',d,'com.android.provision.FreshTest'],text=True))

 def fixture(self,root):
  project='packages/apps/Provision'
  for name in ['src/com/android/provision/DefaultActivity.java','AndroidManifest.xml']:
   source=INPUT/project/name;target=root/project/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(source.read_bytes())
  product=root/'vendor/alphaphone/product.mk';product.parent.mkdir(parents=True);product.write_text('# Existing accepted app product, retained\n')
  return stage.digest(product.read_bytes())

 def plan(self,root):
  before=self.fixture(root)
  return stage.build_plan(root,ASSETS,stage.digest((ASSETS/'branding-assets.json').read_bytes()),INPUT,product_mk_hash=before)

 def test_guarded_staging_roundtrip_preserves_enterprise_and_completed_paths(self):
  with tempfile.TemporaryDirectory(prefix='alpha-brand-stage-')as d,patch.object(stage,'check_revision')as revision:
   root=Path(d)/'aosp';root.mkdir();plan,rows=self.plan(root)
   self.assertEqual(revision.call_count,2)
   self.assertTrue(all(name.startswith('vendor/alphaphone/')or name.startswith('packages/apps/Provision/')for name in plan))
   before=(INPUT/'packages/apps/Provision/src/com/android/provision/DefaultActivity.java').read_text()
   after=plan['packages/apps/Provision/src/com/android/provision/DefaultActivity.java'].decode()
   suffix='    private void finishSetup()'
   self.assertEqual(before[before.index(suffix):],after[after.index(suffix):],'completion, device-owner workflow and callbacks byte-exact')
   self.assertEqual(before[:before.index('        finishSetup();\n    }')],after[:after.index('        if (!AlphaFreshPresets.shouldRunWelcome')],'enterprise early branch byte-exact')
   self.assertIn('AlphaFreshPresets.shouldRunWelcome(this)',after)
   stage.apply_plan(root,plan,rows,Path(d)/'backup')
   for row in rows:self.assertEqual(stage.digest((root/row['path']).read_bytes()),row['sha256'])
   # Every existing hardware/power overlay is copied exactly, not recreated or filtered out.
   for file in (BRAND/'overlay').rglob('*'):
    if file.is_file():self.assertEqual((root/'vendor/alphaphone/branding'/file.relative_to(BRAND)).read_bytes(),file.read_bytes())
   overlay=root/'vendor/alphaphone/branding/overlay/frameworks/base/packages/SystemUI/res/values/alpha-system-entry.xml'
   self.assertEqual(overlay.read_bytes(),(BRAND/'system-entry/product-overlay/values/alpha-system-entry.xml').read_bytes())

 def test_unreviewed_existing_source_and_late_drift_refuse_before_any_write(self):
  with tempfile.TemporaryDirectory(prefix='alpha-brand-drift-')as d,patch.object(stage,'check_revision'):
   root=Path(d)/'aosp';root.mkdir();before=self.fixture(root)
   target=root/'packages/apps/Provision/src/com/android/provision/DefaultActivity.java';target.write_text('unreviewed change')
   with self.assertRaises(AssertionError):stage.build_plan(root,ASSETS,stage.digest((ASSETS/'branding-assets.json').read_bytes()),INPUT,product_mk_hash=before)
   self.assertEqual(target.read_text(),'unreviewed change')
  with tempfile.TemporaryDirectory(prefix='alpha-brand-late-')as d,patch.object(stage,'check_revision'):
   root=Path(d)/'aosp';root.mkdir();plan,rows=self.plan(root);product=root/'vendor/alphaphone/product.mk';product.write_text('other writer')
   with self.assertRaises(AssertionError):stage.apply_plan(root,plan,rows,Path(d)/'backup')
   self.assertFalse((root/'vendor/alphaphone/branding').exists())

 def test_real_api_sources_and_home_failure_ui_retain_authority(self):
  imm=(INPUT/'frameworks/base/core/java/android/view/inputmethod/InputMethodManager.java').read_text()
  self.assertIn('Update secure settings directly',imm)
  settings=(INPUT/'frameworks/base/core/java/android/provider/Settings.java').read_text()
  for text in ['DEFAULT_INPUT_METHOD = "default_input_method"','ENABLED_INPUT_METHODS = "enabled_input_methods"']:self.assertIn(text,settings)
  java=(BRAND/'provision/AlphaFreshPresets.java').read_text()
  self.assertIn('if (!eligible() || nonempty(selected())) return false;',java)
  self.assertIn('policy.getDeviceOwnerComponentOnCallingUser() != null || users.isManagedProfile()',java)
  self.assertNotIn('policy.isDeviceManaged()',java,'do not introduce a MANAGE_USERS permission requirement')
  welcome=(BRAND/'provision/AlphaWelcome.java').read_text()
  self.assertIn('homeVerified(Boolean.TRUE.equals(accepted), held(roles))',welcome)
  self.assertIn('getRoleHoldersAsUser(RoleManager.ROLE_HOME, Process.myUserHandle())',welcome)
  self.assertIn('if (!waiting || generation != attempt || activity.isFinishing() || activity.isDestroyed()) return;',welcome)
  self.assertIn('if (waiting && generation == attempt)',welcome)
  self.assertNotIn('accepted -> completed.run()',welcome)
  self.assertIn('Settings.ACTION_HOME_SETTINGS',welcome)
  self.assertIn('palette == null || palette.isEmpty() || palette.equals("{}")',welcome)
  self.assertEqual(welcome.count('completed.run()'),1,'only confirmed completion path calls upstream finisher')

if __name__=='__main__':unittest.main(verbosity=2)
