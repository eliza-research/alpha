from pathlib import Path
import importlib.util, hashlib, json, os, subprocess, sys, tempfile, unittest, xml.etree.ElementTree as ET
from unittest.mock import patch

REPO=Path(__file__).resolve().parents[1]
BRAND=REPO/'android/aosp/branding'
sys.path.insert(0,str(BRAND/'system-entry'))
from portable_tools import java_binary
spec=importlib.util.spec_from_file_location('alpha_branding_stage',REPO/'scripts/stage-alpha-os-branding.py')
stage=importlib.util.module_from_spec(spec);spec.loader.exec_module(stage)
INPUT=Path(os.environ.get('ALPHA_FRESH_PRESET_INPUTS',BRAND/'provision/.cache'))
ASSETS=Path(os.environ.get('ALPHA_BRANDING_ASSETS',BRAND/'generated'))
CORE=BRAND/'core-launcher'
core_baseline=lambda relative:(CORE/'.cache/baseline'/relative).read_bytes()

class FreshPresets(unittest.TestCase):
 def test_alpha_runtime_defaults_cover_phone_contacts_sms_and_setup(self):
  root=ET.parse(BRAND/'default-permissions-alpha-phone.xml').getroot()
  package=root.find("exception[@package='ai.elizaresearch.alphaphone']")
  expected={'POST_NOTIFICATIONS','RECORD_AUDIO','CAMERA','ACCESS_COARSE_LOCATION','ACCESS_FINE_LOCATION',
   'READ_CALENDAR','WRITE_CALENDAR','READ_MEDIA_IMAGES','READ_MEDIA_VIDEO','READ_CONTACTS',
   'READ_PHONE_STATE','READ_CALL_LOG','CALL_PHONE','READ_SMS','SEND_SMS','RECEIVE_SMS',
   'RECEIVE_MMS','RECEIVE_WAP_PUSH','ACCESS_LOCAL_NETWORK','READ_MEDIA_VISUAL_USER_SELECTED'}
  permissions=package.findall('permission')
  self.assertEqual({row.attrib['name'] for row in permissions},{'android.permission.'+name for name in expected})
  self.assertEqual(len(permissions),len(expected))
  self.assertTrue(all(row.attrib.get('fixed')=='false' for row in permissions))

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
  for row in json.loads((CORE/'SOURCE-INPUTS.json').read_text())['files']:
   target=root/'frameworks/base'/row['path'];target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(core_baseline(row['path']))
  product=root/'vendor/alphaphone/product.mk';product.parent.mkdir(parents=True);product.write_text('# Existing accepted app product, retained\n')
  return stage.digest(product.read_bytes())

 def plan(self,root):
  before=self.fixture(root)
  return stage.build_plan(root,ASSETS,stage.digest((ASSETS/'branding-assets.json').read_bytes()),INPUT,product_mk_hash=before,core_baseline=core_baseline)

 def test_guarded_staging_roundtrip_preserves_enterprise_and_completed_paths(self):
  with tempfile.TemporaryDirectory(prefix='alpha-brand-stage-')as d,patch.object(stage,'check_revision')as revision:
   root=Path(d)/'aosp';root.mkdir();plan,rows=self.plan(root)
   self.assertEqual(revision.call_count,2)
   self.assertTrue(all(name.startswith(('vendor/alphaphone/','packages/apps/Provision/','frameworks/base/'))for name in plan))
   core=json.loads((CORE/'manifest.json').read_text())
   for row in core['files']:self.assertEqual(stage.digest(plan['frameworks/base/'+row['path']]),row['afterSha256'])
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

 def test_dictation_overlay_is_staged_and_matches_the_reviewed_launcher_service(self):
  with tempfile.TemporaryDirectory(prefix='alpha-dictation-stage-')as d,patch.object(stage,'check_revision'):
   root=Path(d)/'aosp';root.mkdir();plan,_=self.plan(root)
   key='vendor/alphaphone/branding/overlay/frameworks/base/core/res/res/values/alpha-keyboard-dictation.xml'
   source=BRAND/'overlay/frameworks/base/core/res/res/values/alpha-keyboard-dictation.xml'
   self.assertEqual(plan[key],source.read_bytes(),'normal image staging must carry the dictation binding')
   target=ET.fromstring(plan[key]).find("string[@name='config_systemSpeechRecognizer']").text
   app=Path(os.environ.get('ALPHA_DICTATION_APP_ROOT',REPO))
   self.assertEqual(target,json.loads((app/'app.config.json').read_text())['appId'])
   manifest=ET.parse(app/'android/app/src/launcher/AndroidManifest.xml').getroot()
   a='{http://schemas.android.com/apk/res/android}'
   service=manifest.find("application/service[@"+a+"name='.AlphaKeyboardDictationService']")
   self.assertIsNotNone(service,'staged app source must include the matching auxiliary voice IME')
   self.assertEqual(service.attrib[a+'permission'],'android.permission.BIND_INPUT_METHOD')
   metadata=service.find('meta-data');self.assertEqual(metadata.attrib[a+'resource'],'@xml/alpha_keyboard_dictation')
   subtype=ET.parse(app/'android/app/src/launcher/res/xml/alpha_keyboard_dictation.xml').getroot().find('subtype')
   self.assertEqual(subtype.attrib[a+'imeSubtypeMode'],'voice')
   self.assertEqual(subtype.attrib[a+'isAuxiliary'],'true')

 def test_setup_icon_reuses_reviewed_product_bytes_geometry_and_clip(self):
  pin=stage.LOCK['productIcon'];icon=(REPO/pin['path']).read_bytes()
  self.assertEqual(stage.digest(icon),pin['sha256'])
  xml=ET.fromstring(icon);a='{http://schemas.android.com/apk/res/android}'
  self.assertEqual({k.rsplit('}',1)[-1]:v for k,v in xml.attrib.items()},pin['geometry']['vector'])
  group=xml.find('group');self.assertIsNotNone(group)
  self.assertEqual({k.rsplit('}',1)[-1]:v for k,v in group.attrib.items()},pin['geometry']['group'])
  self.assertEqual(xml.find('path').attrib[a+'fillColor'],'#0000FF')
  self.assertEqual(stage.digest(group.find('clip-path').attrib[a+'pathData'].encode()),pin['geometry']['clipPathSHA256'])
  svg=ET.fromstring((REPO/pin['logoSource']).read_bytes())
  self.assertEqual(group.find('path').attrib[a+'pathData'],next(iter(svg)).attrib['d'])
  with tempfile.TemporaryDirectory(prefix='alpha-existing-icon-')as d,patch.object(stage,'check_revision'):
   root=Path(d)/'aosp';root.mkdir();plan,_=self.plan(root)
   self.assertEqual(plan['packages/apps/Provision/res/drawable/alpha_mark.xml'],icon)
  source=(REPO/'scripts/stage-alpha-os-branding.py').read_text()
  self.assertNotIn('android:viewportWidth="120"',source,'staging never invents replacement icon markup')

 def test_unreviewed_existing_source_and_late_drift_refuse_before_any_write(self):
  with tempfile.TemporaryDirectory(prefix='alpha-brand-drift-')as d,patch.object(stage,'check_revision'):
   root=Path(d)/'aosp';root.mkdir();before=self.fixture(root)
   target=root/'packages/apps/Provision/src/com/android/provision/DefaultActivity.java';target.write_text('unreviewed change')
   with self.assertRaises(AssertionError):stage.build_plan(root,ASSETS,stage.digest((ASSETS/'branding-assets.json').read_bytes()),INPUT,product_mk_hash=before,core_baseline=core_baseline)
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

 def test_actual_failure_button_opens_settings_for_its_current_failure(self):
  source=(BRAND/'provision/AlphaWelcome.java').read_text()
  start=source.index('        private void fail(int message) {');opened=source.index('{',start);level=1;end=opened+1
  while level:
   level += (source[end]=='{')-(source[end]=='}');end+=1
  method=source[start:end]
  with tempfile.TemporaryDirectory(prefix='alpha-preset-recovery-')as d:
   file=Path(d)/'RecoveryTest.java';file.write_text('''
import java.util.function.Consumer;
public class RecoveryTest {
 static class R { static class string {static final int alpha_home_failed=1,alpha_keyboard_failed=2,alpha_appearance_preset_failed=3,alpha_setup_state_changed=4,alpha_retry_setup=5,alpha_home_settings=6,alpha_open_settings=7;} }
 static class Settings {static final String ACTION_HOME_SETTINGS="android.settings.HOME_SETTINGS",ACTION_INPUT_METHOD_SETTINGS="android.settings.INPUT_METHOD_SETTINGS",ACTION_SETTINGS="android.settings.SETTINGS";}
 static class View {static final int VISIBLE=0;}
 static class Button {int text,visibility;boolean enabled;Consumer<Object> click;void setText(int t){text=t;}void setEnabled(boolean e){enabled=e;}void setVisibility(int v){visibility=v;}void setOnClickListener(Consumer<Object> c){click=c;}}
 static class Text {int text;void setText(int t){text=t;}}
 final Button next=new Button(),settings=new Button();final Text notice=new Text();final Object activity=new Object();String opened;
 void open(Object activity,String action){opened=action;}
'''+method+'''
 public static void main(String[] args){
  RecoveryTest test=new RecoveryTest();int[] messages={1,2,3,4,1};
  String[] expected={Settings.ACTION_HOME_SETTINGS,Settings.ACTION_INPUT_METHOD_SETTINGS,Settings.ACTION_SETTINGS,Settings.ACTION_SETTINGS,Settings.ACTION_HOME_SETTINGS};
  for(int i=0;i<messages.length;i++){
   test.fail(messages[i]);test.settings.click.accept(null);
   if(!expected[i].equals(test.opened)||test.settings.text!=(messages[i]==1?6:7)||!test.next.enabled||test.next.text!=5||test.notice.text!=messages[i]||test.settings.visibility!=0)throw new AssertionError("recovery target or label mismatch");
  }
  System.out.println("PASS actual failure recovery target and label: 5 cases");
 }
}''')
   subprocess.run([java_binary('javac'),'--release','11','-d',d,str(file)],check=True,capture_output=True)
   self.assertIn('PASS actual failure recovery target and label: 5 cases',subprocess.check_output([java_binary('java'),'-cp',d,'RecoveryTest'],text=True))

if __name__=='__main__':unittest.main(verbosity=2)
