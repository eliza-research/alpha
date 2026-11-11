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
 def test_actual_policy_completed_managed_and_existing_ime_choices(self):
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

 def test_pinned_api_sources_and_existing_presets_retain_authority(self):
  imm=(INPUT/'frameworks/base/core/java/android/view/inputmethod/InputMethodManager.java').read_text()
  self.assertIn('Update secure settings directly',imm)
  settings=(INPUT/'frameworks/base/core/java/android/provider/Settings.java').read_text()
  for text in ['DEFAULT_INPUT_METHOD = "default_input_method"','ENABLED_INPUT_METHODS = "enabled_input_methods"']:self.assertIn(text,settings)
  role_manager=(INPUT/'packages/modules/Permission/framework-s/java/android/app/role/RoleManager.java').read_text()
  for role in ('HOME','DIALER','SMS'):
   self.assertIn(f'ROLE_{role} = "android.app.role.{role}"',role_manager)
  self.assertIn('public List<String> getRoleHoldersAsUser(',role_manager)
  self.assertIn('public void addRoleHolderAsUser(',role_manager)
  java=(BRAND/'provision/AlphaFreshPresets.java').read_text()
  self.assertIn('if (!eligible() || nonempty(selected())) return false;',java)
  self.assertIn('policy.getDeviceOwnerComponentOnCallingUser() != null || users.isManagedProfile()',java)
  self.assertNotIn('policy.isDeviceManaged()',java,'do not introduce a MANAGE_USERS permission requirement')
  welcome=(BRAND/'provision/AlphaWelcome.java').read_text()
  self.assertIn('palette == null || palette.isEmpty() || palette.equals("{}")',welcome)
  self.assertEqual(welcome.count('completed.run()'),1,'only confirmed completion path calls upstream finisher')

 def test_actual_role_sequence_retries_only_missing_grants_and_verifies_final_holders(self):
  source=(BRAND/'provision/AlphaWelcome.java').read_text()
  start=source.index('    private static final class Completion {')
  end=source.index('    private static TextView text(', start)
  completion=source[start:end]
  strings=ET.parse(BRAND/'provision/strings.xml').getroot()
  resources={node.attrib['name']:i for i,node in enumerate(strings,1)}
  constants=';'.join(f'static final int {name}={i}' for name,i in resources.items())
  with tempfile.TemporaryDirectory(prefix='alpha-preset-role-sequence-')as d:
   file=Path(d)/'RoleSequenceTest.java'
   file.write_text('''
package com.android.provision;

import java.util.*;
import java.util.concurrent.Executor;
import java.util.function.Consumer;

public class RoleSequenceTest {
 static class R { static class string {''' + constants + ''';} }
 static class Settings {
  static final String ACTION_HOME_SETTINGS="home settings", ACTION_MANAGE_DEFAULT_APPS_SETTINGS="default apps",
    ACTION_INPUT_METHOD_SETTINGS="input settings", ACTION_SETTINGS="settings";
  static class Secure {
   static final String THEME_CUSTOMIZATION_OVERLAY_PACKAGES="palette";
   static String getString(Object resolver,String key){return "existing";}
  }
 }
 static class View {static final int VISIBLE=0,GONE=8;}
 static class Text {int text;void setText(int value){text=value;}}
 static class TextView extends Text {}
 static class Button extends Text {
  int visibility;boolean enabled=true;Consumer<Object> click;
  void setEnabled(boolean value){enabled=value;}
  void setVisibility(int value){visibility=value;}
  void setOnClickListener(Consumer<Object> value){click=value;}
 }
 static final Object USER=new Object();
 static class Process {static Object myUserHandle(){return USER;}}
 static class Looper {static Looper getMainLooper(){return new Looper();}}
 static class Handler {
  static final List<Runnable> timers=new ArrayList<>();
  Handler(Looper looper){}
  void postDelayed(Runnable timer,long delay){check(delay==15000,"bounded request timeout");timers.add(timer);}
 }
 static final String ALPHA="ai.alphacompute.alphaphone";
 static final String HOME="home",DIALER="dialer",SMS="sms";
 static class RoleManager {
  static final String ROLE_HOME=HOME,ROLE_DIALER=DIALER,ROLE_SMS=SMS;
  final Map<String,List<String>> holders=new HashMap<>();
  final List<String> requests=new ArrayList<>(),checked=new ArrayList<>();
  final List<Consumer<Boolean>> callbacks=new ArrayList<>();
  String unavailable,deniedRead,deniedWrite;
  boolean isRoleAvailable(String role){checked.add(role);return !role.equals(unavailable);}
  List<String> getRoleHoldersAsUser(String role,Object user){
   check(user==USER,"read current user");
   if(role.equals(deniedRead))throw new SecurityException();
   return holders.get(role);
  }
  void addRoleHolderAsUser(String role,String holder,int flags,Object user,Executor executor,Consumer<Boolean> reply){
   check(ALPHA.equals(holder)&&flags==0&&user==USER,"write exact target and current user");
   if(role.equals(deniedWrite))throw new SecurityException();
   requests.add(role);callbacks.add(reply);
  }
  void set(String role,String... values){holders.put(role,List.of(values));}
  void reply(int index,Boolean accepted,String... values){
   set(requests.get(index),values);callbacks.get(index).accept(accepted);
  }
 }
 static class PackageManager {
  final int version;
  PackageManager(int version){this.version=version;}
  boolean hasSystemFeature(String feature,int minimum){
   check(feature.equals(ALPHA+".feature.INITIAL_TELEPHONY_ROLES")&&minimum==1,"image feature name and version");
   return version>=minimum;
  }
 }
 static class Activity {
  final RoleManager service;
  final PackageManager packages;
  boolean fresh=true,destroyed,finishing;
  AlphaFreshSetupPolicy.ImeResult keyboard=AlphaFreshSetupPolicy.ImeResult.READY;
  Activity(RoleManager roles,int featureVersion){service=roles;packages=new PackageManager(featureVersion);}
  PackageManager getPackageManager(){return packages;}
  boolean isFinishing(){return finishing;}
  boolean isDestroyed(){return destroyed;}
  <T> T getSystemService(Class<T> type){return type.cast(service);}
  Object getContentResolver(){return new Object();}
  Executor getMainExecutor(){return Runnable::run;}
 }
 static class AlphaFreshPresets {
  static boolean eligible(Activity activity){return activity.fresh;}
  static AlphaFreshSetupPolicy.ImeResult ensureKeyboard(Activity activity){return activity.keyboard;}
 }
 static class AlphaAppearance {static boolean applyPalette(Activity activity){throw new AssertionError("saved palette");}}
 static String opened;
 static void open(Activity activity,String action){opened=action;}
''' + completion + '''
 static int cases;
 static void check(boolean result,String detail){if(!result)throw new AssertionError(detail);}
 static class Setup {
  final Activity activity;
  final RoleManager roles;
  final Button next=new Button(),settings=new Button();
  final TextView notice=new TextView();
  final Completion completion;
  int completed;
  Setup(RoleManager roles){this(roles,1);}
  Setup(RoleManager roles,int featureVersion){
   this.roles=roles;activity=new Activity(roles,featureVersion);
   completion=new Completion(activity,()->{completed++;activity.fresh=false;},next,settings,notice,
     Completion.hasInitialTelephonyRoles(activity));
  }
  void begin(){completion.begin();}
  void requests(String... rolesRequested){check(roles.requests.equals(List.of(rolesRequested)),"unexpected writes: "+roles.requests);}
  void failed(int message,int label,String target){
   check(completed==0&&notice.text==message&&next.enabled&&next.text==R.string.alpha_retry_setup,"failure permits retry");
   check(settings.text==label&&settings.visibility==View.VISIBLE,"failure offers relevant settings");
   settings.click.accept(null);check(target.equals(opened),"failure opens "+target);
   cases++;
  }
 }
 static RoleManager factory(){
  RoleManager roles=new RoleManager();
  roles.set(HOME,"stock.home");roles.set(DIALER,"stock.phone");roles.set(SMS,"stock.messages");
  return roles;
 }
 static Setup startWithHome(){
  RoleManager roles=factory();roles.set(HOME,ALPHA);
  Setup setup=new Setup(roles);setup.begin();setup.requests(DIALER);return setup;
 }
 public static void main(String[] args){
  for(int featureVersion:new int[]{-1,0}){
   RoleManager homeOnly=factory();homeOnly.unavailable=DIALER;
   Setup ordinary=new Setup(homeOnly,featureVersion);ordinary.begin();ordinary.requests(HOME);
   ordinary.roles.reply(0,true,ALPHA);ordinary.requests(HOME);
   check(ordinary.completed==1&&homeOnly.checked.equals(List.of(HOME,HOME)),
     "ordinary branded setup uses only HOME");cases++;
  }
  RoleManager noDialer=factory();noDialer.set(HOME,ALPHA);noDialer.unavailable=DIALER;
  Setup required=new Setup(noDialer);required.begin();required.requests();
  required.failed(R.string.alpha_dialer_failed,R.string.alpha_default_apps_settings,Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS);

  Setup fresh=new Setup(factory());fresh.begin();fresh.begin();fresh.requests(HOME);
  fresh.roles.reply(0,true,ALPHA);fresh.requests(HOME,DIALER);
  fresh.roles.reply(1,true,ALPHA);fresh.requests(HOME,DIALER,SMS);
  fresh.roles.reply(2,true,ALPHA);
  check(fresh.completed==1,"only all confirmed holders finish setup");cases++;
  fresh.roles.set(DIALER,"owner.phone");fresh.roles.set(SMS,"owner.messages");fresh.begin();
  fresh.requests(HOME,DIALER,SMS);
  check(fresh.completed==1&&fresh.roles.holders.get(DIALER).equals(List.of("owner.phone"))
    &&fresh.roles.holders.get(SMS).equals(List.of("owner.messages")),"completed setup preserves owner holders");cases++;

  Setup interrupted=startWithHome();interrupted.activity.destroyed=true;
  interrupted.roles.reply(0,true,ALPHA);interrupted.requests(DIALER);
  check(interrupted.completed==0,"destroyed activity cannot finish");
  Setup restarted=new Setup(interrupted.roles);restarted.begin();restarted.requests(DIALER,SMS);
  restarted.roles.reply(1,true,ALPHA);
  check(restarted.completed==1,"new activity resumes only the missing role");cases++;

  int firstTimer=Handler.timers.size();
  Setup timeout=startWithHome();Handler.timers.get(firstTimer).run();
  timeout.failed(R.string.alpha_dialer_failed,R.string.alpha_default_apps_settings,Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS);
  timeout.begin();timeout.roles.reply(0,true,ALPHA);timeout.requests(DIALER,DIALER);
  Handler.timers.get(firstTimer).run();
  check(!timeout.next.enabled,"old timer cannot end a newer request");
  timeout.roles.reply(1,true,ALPHA);timeout.requests(DIALER,DIALER,SMS);
  timeout.roles.reply(2,true,ALPHA);check(timeout.completed==1,"active callback completes retry");cases++;

  Setup absent=new Setup(null);absent.begin();
  absent.failed(R.string.alpha_home_failed,R.string.alpha_home_settings,Settings.ACTION_HOME_SETTINGS);
  Setup unavailable=startWithHome();unavailable.roles.unavailable=SMS;
  unavailable.roles.reply(0,true,ALPHA);unavailable.requests(DIALER);
  unavailable.failed(R.string.alpha_sms_failed,R.string.alpha_default_apps_settings,Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS);

  for(Boolean rejected:new Boolean[]{false,null}){
   Setup denied=startWithHome();denied.roles.reply(0,rejected,ALPHA);denied.requests(DIALER);
   denied.failed(R.string.alpha_dialer_failed,R.string.alpha_default_apps_settings,Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS);
  }
  for(String[] held:new String[][]{{},{"stock.phone"},{ALPHA,"stock.phone"},{ALPHA,ALPHA}}){
   Setup unchecked=startWithHome();unchecked.roles.reply(0,true,held);unchecked.requests(DIALER);
   unchecked.failed(R.string.alpha_dialer_failed,R.string.alpha_default_apps_settings,Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS);
  }
  Setup missingReadback=startWithHome();missingReadback.roles.holders.remove(DIALER);
  missingReadback.roles.callbacks.get(0).accept(true);missingReadback.requests(DIALER);
  missingReadback.failed(R.string.alpha_dialer_failed,R.string.alpha_default_apps_settings,Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS);

  Setup deniedRead=startWithHome();deniedRead.roles.deniedRead=DIALER;
  deniedRead.roles.reply(0,true,ALPHA);deniedRead.requests(DIALER);
  deniedRead.failed(R.string.alpha_dialer_failed,R.string.alpha_default_apps_settings,Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS);
  RoleManager deniedWriter=factory();deniedWriter.deniedWrite=HOME;
  Setup deniedWrite=new Setup(deniedWriter);deniedWrite.begin();deniedWrite.requests();
  deniedWrite.failed(R.string.alpha_home_failed,R.string.alpha_home_settings,Settings.ACTION_HOME_SETTINGS);

  Setup changed=startWithHome();changed.activity.fresh=false;changed.roles.reply(0,true,ALPHA);changed.requests(DIALER);
  changed.failed(R.string.alpha_setup_state_changed,R.string.alpha_open_settings,Settings.ACTION_SETTINGS);
  Setup replaced=startWithHome();replaced.roles.reply(0,true,ALPHA);replaced.roles.set(HOME,"other.home");
  replaced.roles.reply(1,true,ALPHA);
  replaced.failed(R.string.alpha_home_failed,R.string.alpha_home_settings,Settings.ACTION_HOME_SETTINGS);
  Setup keyboard=startWithHome();keyboard.roles.reply(0,true,ALPHA);keyboard.activity.keyboard=AlphaFreshSetupPolicy.ImeResult.FAILED;
  keyboard.roles.reply(1,true,ALPHA);
  keyboard.failed(R.string.alpha_keyboard_failed,R.string.alpha_open_settings,Settings.ACTION_INPUT_METHOD_SETTINGS);

  System.out.println("PASS actual role sequence: "+cases+" cases");
 }
}
''')
   subprocess.run([java_binary('javac'),'--release','11','-d',d,str(BRAND/'provision/AlphaFreshSetupPolicy.java'),str(file)],check=True)
   self.assertIn('PASS actual role sequence: 22 cases',subprocess.check_output([java_binary('java'),'-cp',d,'com.android.provision.RoleSequenceTest'],text=True))

if __name__=='__main__':unittest.main(verbosity=2)
