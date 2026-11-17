from pathlib import Path
import importlib.util, hashlib, json, os, subprocess, sys, tempfile, unittest, zipfile, xml.etree.ElementTree as ET
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
  for(boolean accepted:new boolean[]{false,true})for(boolean held:new boolean[]{false,true})check(AlphaFreshSetupPolicy.roleVerified(accepted,held)==(accepted&&held));
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

 def fixture(self,root,vendor=True):
  project='packages/apps/Provision'
  for name in ['src/com/android/provision/DefaultActivity.java','AndroidManifest.xml']:
   source=INPUT/project/name;target=root/project/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(source.read_bytes())
  for row in json.loads((CORE/'SOURCE-INPUTS.json').read_text())['files']:
   target=root/'frameworks/base'/row['path'];target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(core_baseline(row['path']))
  if not vendor:return None
  product=root/'vendor/alphaphone/product.mk';product.parent.mkdir(parents=True);product.write_text('# Existing accepted app product, retained\n')
  return stage.digest(product.read_bytes())

 def plan(self,root):
  before=self.fixture(root)
  return stage.build_plan(root,ASSETS,stage.digest((ASSETS/'branding-assets.json').read_bytes()),INPUT,product_mk_hash=before,core_baseline=core_baseline)

 def test_image_identity_rechecks_canonical_signed_apk_and_all_admission_bindings(self):
  bun=os.environ.get('ALPHA_BUN','bun')
  selected='ai.alphacompute.alphaphone'
  # A real nine-handler canonical launcher manifest runs through the production TS qualifiers.
  tree=lambda *flags:subprocess.check_output([bun,'test/fixtures/telephony-launcher-tree.mjs',selected,*flags],text=True,cwd=REPO)
  manifest={'tree':tree()}
  with tempfile.TemporaryDirectory(prefix='alpha-image-identity-') as d:
   root=Path(d);apk=root/'Launcher.apk';apk.write_bytes(b'isolated signed-tool boundary fixture, not an APK')
   config=json.loads((REPO/'app.config.json').read_text());product=json.loads((REPO/'android/aosp/pixel10a-product.json').read_text())
   signer=json.loads((REPO/product['signer']['apkDescriptor']).read_text())['signerSha256']
   descriptor={'packageName':selected,'moduleName':config['moduleName'],'apkSha256':stage.digest(apk.read_bytes()),'certificateSha256':signer,'development':False}
   descriptor_file=root/'launcher.json';descriptor_file.write_text(json.dumps(descriptor))
   admission={'schema':1,'packageName':selected,'apkSha256':descriptor['apkSha256'],
    'launcherDescriptorSha256':stage.digest(descriptor_file.read_bytes()),'sourceLockSha256':product['sourceLock']['sha256'],
    'platformCertificateSha256':product['signer']['platformCertificateSha256']}
   output=root/'provisioning/alpha-telephony-components.xml';output.parent.mkdir(parents=True,exist_ok=True)
   output.write_text('isolated normal-stage file binding fixture');admission['handlerDefaultsSha256']=stage.digest(output.read_bytes())
   file=root/'image-policy-admission.json';file.write_text(json.dumps(admission))
   generated=b'# Generated Pixel launcher stage product\n';(root/'product.mk').write_bytes(generated)
   aosp=root/'aosp';aosp.mkdir();self.fixture(aosp,vendor=False)
   run=subprocess.check_output
   def tools(args,**kwargs):
    if args[0]=='apksigner-fixture':return 'Signer #1 certificate SHA-256 digest: '+signer+'\n'
    if args[0]==bun:return run(args,**kwargs)
    if args[0]=='git':
     # Pinned Provision objects from the source checkout; only `git show REV:path` is expected.
     self.assertEqual(args[1],'-C');self.assertEqual(args[3],'show')
     project=Path(args[2]).resolve().relative_to(aosp.resolve())
     self.assertIn(str(project),['packages/apps/Provision','packages/modules/Permission'])
     return (INPUT/project/args[4].split(':',1)[1]).read_bytes()
    self.assertEqual(args[0],'aapt-fixture')
    if args[2]=='xmltree':return manifest['tree']
    return "package: name='"+selected+"' versionCode='80'\n"
   with patch.object(stage.subprocess,'check_output',side_effect=tools):
    self.assertEqual(stage.image_identity(root,'aapt-fixture','apksigner-fixture'),admission)
    for broken in [tree('--without-setup-receiver'),manifest['tree'].replace('BIND_INCALL_SERVICE','UNRELATED'),
                   manifest['tree'].replace(selected,'other.package')]:
     with self.subTest(manifest=broken[-80:]):
      manifest['tree']=broken
      with self.assertRaises(subprocess.CalledProcessError):stage.image_identity(root,'aapt-fixture','apksigner-fixture')
    manifest['tree']=tree()
    policy_plan=stage.core_policy_plan
    def policy(root,read_baseline=None):
     return policy_plan(root,core_baseline)
    # The exact production invocation: stage-aosp pins and brands the stage product.mk itself.
    command=json.loads(run([bun,'-e','const [output, source, assets, reportSha256] = process.argv.slice(-4);'
      'console.log(JSON.stringify((await import("./scripts/stage-aosp.ts")).brandingPacketCommand('
      '{output, source, assets, reportSha256, aapt: "aapt-fixture", apksigner: "apksigner-fixture"})));',
      str(root),str(aosp),str(ASSETS),stage.digest((ASSETS/'branding-assets.json').read_bytes())],text=True,cwd=REPO))
    self.assertEqual(command[0],'scripts/stage-alpha-os-branding.py')
    self.assertNotIn('--source-inputs',command)
    self.assertEqual((root/'product.mk').read_bytes(),
                     generated+b'\n# Alpha OS visual identity.\n$(call inherit-product, vendor/alphaphone/branding/branding.mk)\n')
    with patch.object(stage,'check_revision'), patch.object(stage,'core_policy_plan',side_effect=policy), patch.object(sys,'argv',command):
     stage.main()
    packet=json.loads((root/'source-packet.json').read_text())
    self.assertFalse(packet['applied']);self.assertEqual(packet['imageIdentityAdmission'],admission)
    self.assertEqual(packet['packetSha256'],stage.digest((root/'source-packet.zip').read_bytes()))
    self.assertNotIn('vendor/alphaphone/product.mk',[row['path'] for row in packet['files']],'the image stage already carries the include')
    with zipfile.ZipFile(root/'source-packet.zip') as archive:
     for row in packet['files']:self.assertEqual(stage.digest(archive.read(row['path'])),row['sha256'])
    self.assertFalse((aosp/'vendor').exists(),'packet must not apply source')
    # A stage product.mk that differs from its pinned generated preimage is refused.
    (root/'product.mk').write_bytes(b'# other\n'+(root/'product.mk').read_bytes())
    with patch.object(stage,'check_revision'), patch.object(stage,'core_policy_plan',side_effect=policy), patch.object(sys,'argv',command):
     with self.assertRaisesRegex(AssertionError,'pinned preimage'):stage.main()
    # Only the canonical identity is admitted; the former installed identity is not an image identity.
    for key,value in [('packageName','ai.elizaresearch.alphaphone'),('packageName','unknown.package'),('apkSha256','0'*64),
                      ('launcherDescriptorSha256','0'*64),('sourceLockSha256','0'*64),('platformCertificateSha256','0'*64),
                      ('handlerDefaultsSha256','0'*64)]:
     with self.subTest(key=key,value=value):
      file.write_text(json.dumps({**admission,key:value}))
      with self.assertRaises(AssertionError):stage.image_identity(root,'aapt-fixture','apksigner-fixture')
    file.write_text(json.dumps(admission))
    descriptor_file.write_text(json.dumps({**descriptor,'certificateSha256':'0'*64}))
    file.write_text(json.dumps({**admission,'launcherDescriptorSha256':stage.digest(descriptor_file.read_bytes())}))
    with self.assertRaisesRegex(AssertionError,'signer admission'):stage.image_identity(root,'aapt-fixture','apksigner-fixture')
   descriptor_file.write_text(json.dumps(descriptor));file.write_text(json.dumps(admission))
   with patch.object(stage.subprocess,'check_output',return_value='Signer #1 certificate SHA-256 digest: '+'0'*64+'\n'):
    with self.assertRaisesRegex(AssertionError,'Staged APK signer'):stage.image_identity(root,'aapt-fixture','apksigner-fixture')

 def test_staged_boot_animations_reuse_the_admitted_archive(self):
  with tempfile.TemporaryDirectory(prefix='alpha-brand-boot-') as d, patch.object(stage,'check_revision'):
   root=Path(d)/'aosp';root.mkdir();plan,rows=self.plan(root)
   stage.apply_plan(root,plan,rows,Path(d)/'backup')
   makefile=root/'check-boot.mk'
   makefile.write_text('''TARGET_COPY_OUT_PRODUCT := product
include vendor/alphaphone/branding/branding.mk
boot-animation-copies:
	@printf '%s\\n' $(PRODUCT_COPY_FILES)
''')
   copies=subprocess.check_output(['make','-s','-f',str(makefile),'boot-animation-copies'],cwd=root,text=True)
   admitted_hash=json.loads((ASSETS/'branding-assets.json').read_text())['bootAnimationSha256']
   for name in ('bootanimation.zip','bootanimation-dark.zip'):
    destination='product/media/'+name
    sources=[source for source,target in (row.split(':',1) for row in copies.splitlines()) if target==destination]
    self.assertEqual(sources,['vendor/alphaphone/branding/generated/bootanimation.zip'])
    self.assertEqual(stage.digest((root/sources[0]).read_bytes()),admitted_hash)

 def test_guarded_staging_roundtrip_preserves_enterprise_and_completed_paths(self):
  with tempfile.TemporaryDirectory(prefix='alpha-brand-stage-')as d,patch.object(stage,'check_revision')as revision:
   root=Path(d)/'aosp';root.mkdir();plan,rows=self.plan(root)
   self.assertEqual(revision.call_count,3)
   self.assertTrue(all(name.startswith(('vendor/alphaphone/','packages/apps/Provision/','packages/modules/Permission/','frameworks/base/'))for name in plan))
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
   feature='vendor/alphaphone/branding/provision/fresh-telephony.xml'
   welcome='packages/apps/Provision/src/com/android/provision/AlphaWelcome.java'
   self.assertGreater(list(plan).index(feature),list(plan).index(welcome))
   self.assertEqual(ET.parse(root/feature).getroot().find('feature').attrib,
                    {'name':'ai.alphacompute.alphaphone.fresh_telephony_setup'})
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
  self.assertNotIn('accepted -> completed.run()',welcome)
  self.assertIn('Settings.ACTION_HOME_SETTINGS',welcome)
  self.assertIn('palette == null || palette.isEmpty() || palette.equals("{}")',welcome)
  self.assertEqual(welcome.count('completed.run()'),1,'only confirmed completion path calls upstream finisher')

 def test_actual_setup_completion_retries_roles_and_preserves_existing_presets(self):
  source=(BRAND/'provision/AlphaWelcome.java').read_text()
  start=source.index('    private static final class Completion {')
  completion=source[start:source.index('    private static TextView text(',start)]
  strings=ET.parse(BRAND/'provision/strings.xml').getroot()
  ids='\n'.join(f"static final int {row.attrib['name']} = {i};" for i,row in enumerate(strings,1))
  with tempfile.TemporaryDirectory(prefix='alpha-preset-recovery-')as d:
   file=Path(d)/'CompletionTest.java';file.write_text('''package com.android.provision;
import java.util.*;
import java.util.concurrent.Executor;
import java.util.function.Consumer;
public class CompletionTest {
 static final String ALPHA="ai.alphacompute.alphaphone", OTHER="other.app";
 static final String HOME="home", DIALER="dialer", SMS="sms";
 static void check(boolean result,String message){if(!result)throw new AssertionError(message);}
 static class R { static class string {'''+ids+'''} }
 static class Settings {
  static final String ACTION_HOME_SETTINGS="home-settings", ACTION_INPUT_METHOD_SETTINGS="ime-settings",
   ACTION_SETTINGS="settings", ACTION_MANAGE_DEFAULT_APPS_SETTINGS="default-apps-settings";
  static class Secure {
   static final String THEME_CUSTOMIZATION_OVERLAY_PACKAGES="palette";
   static String getString(Activity activity,String key){return activity.palette;}
  }
 }
 static class View {static final int VISIBLE=0, GONE=8;}
 static class Button {
  int text,visibility; boolean enabled=true; Consumer<Object> click;
  void setText(int value){text=value;}
  void setEnabled(boolean value){enabled=value;}
  void setVisibility(int value){visibility=value;}
  void setOnClickListener(Consumer<Object> listener){click=listener;}
 }
 static class TextView {int text; void setText(int value){text=value;}}
 static class Looper {static Looper getMainLooper(){return new Looper();}}
 static class Handler {
  static List<Runnable> clock;
  final List<Runnable> timers=clock;
  Handler(Looper unused){}
  void postDelayed(Runnable task,long delay){check(delay==15000,"setup timeout");timers.add(task);}
 }
 static class Process {static int myUserHandle(){return 0;}}
 static class PackageManager {
  static final String FEATURE_TELEPHONY="android.hardware.telephony";
  final Activity activity;
  PackageManager(Activity activity){this.activity=activity;}
  boolean hasSystemFeature(String feature){
   if(FEATURE_TELEPHONY.equals(feature))return activity.telephony;
   check((ALPHA+".fresh_telephony_setup").equals(feature),"factory telephony feature");
   return activity.factoryTelephony;
  }
 }
 static class Intent {
  static final int FLAG_INCLUDE_STOPPED_PACKAGES=32;
  final String action; String pkg,target; int flags;
  Intent(String action){this.action=action;}
  Intent setClassName(String pkg,String target){this.pkg=pkg;this.target=target;return this;}
  Intent addFlags(int flags){this.flags|=flags;return this;}
 }
 static class Context {}
 static abstract class BroadcastReceiver {
  int code;
  int getResultCode(){return code;}
  abstract void onReceive(Context context,Intent intent);
 }
 static class Activity extends Context {
  static final int RESULT_OK=-1, RESULT_CANCELED=0;
  final List<String> effects=new ArrayList<>();
  final RoleManager roles=new RoleManager(this);
  boolean telephony=true, factoryTelephony=true, primary=true, managed, complete, destroyed, prepared, missingRoles;
  boolean paletteAccepted=true;
  Runnable afterPalette=()->{};
  String opened,palette="owner palette";
  int completions;
  BroadcastReceiver prepareReply;
  Intent prepareRequest;
  AlphaFreshSetupPolicy.ImeResult keyboard=AlphaFreshSetupPolicy.ImeResult.EXISTING_CHOICE;
  boolean isFinishing(){return false;}
  boolean isDestroyed(){return destroyed;}
  <T> T getSystemService(Class<T> type){return missingRoles ? null : type.cast(roles);}
  PackageManager getPackageManager(){return new PackageManager(this);}
  Executor getMainExecutor(){return Runnable::run;}
  Activity getContentResolver(){return this;}
  void sendOrderedBroadcast(Intent intent,String permission,BroadcastReceiver reply,Handler handler,
      int result,String data,Object extras){
   check(intent.action.equals(ALPHA+".action.PREPARE_TELEPHONY_ROLES")
       && intent.pkg.equals(ALPHA) && intent.target.equals(ALPHA+".AlphaTelephonySetupReceiver")
       && intent.flags==Intent.FLAG_INCLUDE_STOPPED_PACKAGES && result==RESULT_CANCELED,"explicit fail-closed preparation");
   effects.add("prepare");prepareReply=reply;prepareRequest=intent;
  }
  void prepared(int result){
   var reply=prepareReply;prepareReply=null;check(reply!=null,"pending preparation");
   prepared=result==RESULT_OK;reply.code=result;reply.onReceive(this,prepareRequest);
  }
  void finishSetup(){effects.add("finish");completions++;complete=true;}
 }
 static class RoleManager {
  static final String ROLE_HOME=HOME, ROLE_DIALER=DIALER, ROLE_SMS=SMS;
  final Activity activity;
  final Map<String,List<String>> holders=new HashMap<>();
  final Set<String> unavailable=new HashSet<>();
  Consumer<Boolean> reply; String pending;
  RoleManager(Activity activity){this.activity=activity;}
  boolean isRoleAvailable(String role){return !unavailable.contains(role);}
  List<String> getRoleHoldersAsUser(String role,int user){
   check(user==0,"read primary user");
   return holders.getOrDefault(role,List.of());
  }
  void addRoleHolderAsUser(String role,String pkg,int flags,int user,Executor executor,Consumer<Boolean> callback){
   check(pkg.equals(ALPHA) && flags==0 && user==0,"role request identity");
   check(!activity.telephony || !activity.factoryTelephony || activity.prepared,"prepare components before assigning roles");
   activity.effects.add(role);pending=role;reply=callback;
  }
  void answer(String expected,boolean accepted,List<String> readback){
   check(expected.equals(pending)&&reply!=null,"unexpected pending role "+pending);
   var callback=reply;reply=null;pending=null;
   if(readback!=null)holders.put(expected,readback);
   callback.accept(accepted);
  }
  void grant(String role){answer(role,true,List.of(ALPHA));}
 }
 static class AlphaFreshPresets {
  static boolean eligible(Activity activity){return AlphaFreshSetupPolicy.eligible(activity.complete,activity.managed,activity.primary);}
  static AlphaFreshSetupPolicy.ImeResult ensureKeyboard(Activity activity){activity.effects.add("keyboard");return activity.keyboard;}
 }
 static class AlphaAppearance {
  static boolean applyPalette(Activity activity){activity.effects.add("palette");activity.afterPalette.run();return activity.paletteAccepted;}
 }
 static void open(Activity activity,String action){activity.opened=action;}
'''+completion+'''
 static class Fixture {
  final Activity activity=new Activity();
  final RoleManager roles=activity.roles;
  final Button next=new Button(),settings=new Button();
  final TextView notice=new TextView();
  final List<Runnable> timers=new ArrayList<>();
  final Completion setup;
  Fixture(){Handler.clock=timers;setup=new Completion(activity,activity::finishSetup,next,settings,notice);}
  void effects(String... expected){check(activity.effects.equals(List.of(expected)),"effects "+activity.effects);}
  void failure(int message,String action){
   check(activity.completions==0 && next.enabled && next.text==R.string.alpha_retry_setup
       && notice.text==message && settings.visibility==View.VISIBLE
       && settings.text==(message==R.string.alpha_home_failed ? R.string.alpha_home_settings
         : message==R.string.alpha_roles_failed ? R.string.alpha_default_apps_settings : R.string.alpha_open_settings),
       "failure remains retryable");
   settings.click.accept(null);check(action.equals(activity.opened),"failure recovery destination");
  }
  void complete(){check(activity.completions==1 && activity.complete,"setup completes once");}
 }
 public static void main(String[] args){
  Fixture retry=new Fixture();
  retry.setup.begin();retry.setup.begin();retry.effects("prepare");
  retry.activity.prepared(Activity.RESULT_OK);
  retry.roles.grant(HOME);retry.roles.grant(DIALER);retry.roles.answer(SMS,false,null);
  retry.failure(R.string.alpha_roles_failed,Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS);
  retry.effects("prepare",HOME,DIALER,SMS);
  retry.setup.begin();retry.activity.prepared(Activity.RESULT_OK);retry.roles.grant(SMS);
  retry.effects("prepare",HOME,DIALER,SMS,"prepare",SMS,"keyboard","finish");retry.complete();
  retry.roles.holders.put(DIALER,List.of(OTHER));retry.setup.begin();
  check(retry.roles.holders.get(DIALER).equals(List.of(OTHER)),"completed setup preserves owner change");
  retry.effects("prepare",HOME,DIALER,SMS,"prepare",SMS,"keyboard","finish");retry.complete();

  Fixture mismatch=new Fixture();
  mismatch.setup.begin();mismatch.activity.prepared(Activity.RESULT_OK);
  mismatch.roles.answer(HOME,true,List.of(ALPHA,OTHER));
  mismatch.failure(R.string.alpha_home_failed,Settings.ACTION_HOME_SETTINGS);mismatch.effects("prepare",HOME);

  Fixture drift=new Fixture();
  drift.setup.begin();drift.activity.prepared(Activity.RESULT_OK);drift.roles.grant(HOME);drift.roles.grant(DIALER);
  drift.roles.holders.put(DIALER,List.of(OTHER));drift.roles.grant(SMS);
  drift.failure(R.string.alpha_roles_failed,Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS);
  drift.effects("prepare",HOME,DIALER,SMS);

  Fixture unavailable=new Fixture();
  unavailable.roles.unavailable.add(SMS);unavailable.setup.begin();
  unavailable.failure(R.string.alpha_roles_failed,Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS);unavailable.effects();
  Fixture missing=new Fixture();
  missing.activity.missingRoles=true;missing.setup.begin();
  missing.failure(R.string.alpha_home_failed,Settings.ACTION_HOME_SETTINGS);missing.effects();
  Fixture refused=new Fixture();
  refused.setup.begin();refused.activity.prepared(Activity.RESULT_CANCELED);
  refused.failure(R.string.alpha_roles_failed,Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS);refused.effects("prepare");

  Fixture timedOut=new Fixture();
  timedOut.setup.begin();timedOut.activity.prepared(Activity.RESULT_OK);
  timedOut.timers.get(0).run();check(!timedOut.next.enabled,"earlier preparation timer cannot fail HOME");
  var lateHome=timedOut.roles.reply;timedOut.timers.get(1).run();
  timedOut.failure(R.string.alpha_home_failed,Settings.ACTION_HOME_SETTINGS);
  timedOut.setup.begin();timedOut.roles.holders.put(HOME,List.of(ALPHA));lateHome.accept(true);
  timedOut.effects("prepare",HOME,"prepare");
  timedOut.activity.prepared(Activity.RESULT_OK);timedOut.roles.grant(DIALER);timedOut.roles.grant(SMS);
  timedOut.effects("prepare",HOME,"prepare",DIALER,SMS,"keyboard","finish");timedOut.complete();

  Fixture stalePrepare=new Fixture();
  stalePrepare.setup.begin();var stale=stalePrepare.activity.prepareReply;
  stalePrepare.timers.get(0).run();stalePrepare.failure(R.string.alpha_roles_failed,Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS);
  stalePrepare.setup.begin();stale.code=Activity.RESULT_OK;stale.onReceive(stalePrepare.activity,stalePrepare.activity.prepareRequest);
  stalePrepare.effects("prepare","prepare");
  stalePrepare.activity.prepared(Activity.RESULT_OK);stalePrepare.roles.grant(HOME);stalePrepare.roles.grant(DIALER);stalePrepare.roles.grant(SMS);
  stalePrepare.complete();

  Fixture destroyed=new Fixture();
  destroyed.setup.begin();destroyed.activity.prepared(Activity.RESULT_OK);destroyed.activity.destroyed=true;
  destroyed.roles.grant(HOME);
  destroyed.effects("prepare",HOME);check(destroyed.activity.completions==0,"dead activity cannot finish or assign another role");

  Fixture nonTelephony=new Fixture();
  nonTelephony.activity.telephony=false;nonTelephony.roles.unavailable.addAll(List.of(DIALER,SMS));
  nonTelephony.setup.begin();nonTelephony.roles.grant(HOME);
  nonTelephony.effects(HOME,"keyboard","finish");nonTelephony.complete();
  Fixture development=new Fixture();
  development.activity.factoryTelephony=false;development.roles.unavailable.addAll(List.of(DIALER,SMS));
  development.setup.begin();development.roles.grant(HOME);
  development.effects(HOME,"keyboard","finish");development.complete();
  for(int condition=0;condition<3;condition++){
   Fixture blocked=new Fixture();blocked.activity.complete=condition==0;
   blocked.activity.managed=condition==1;blocked.activity.primary=condition!=2;blocked.setup.begin();
   blocked.failure(R.string.alpha_setup_state_changed,Settings.ACTION_SETTINGS);blocked.effects();
  }
  Fixture lost=new Fixture();
  lost.setup.begin();lost.activity.prepared(Activity.RESULT_OK);lost.activity.managed=true;lost.roles.grant(HOME);
  lost.failure(R.string.alpha_setup_state_changed,Settings.ACTION_SETTINGS);lost.effects("prepare",HOME);

  Fixture keyboard=new Fixture();keyboard.activity.telephony=false;keyboard.activity.keyboard=AlphaFreshSetupPolicy.ImeResult.FAILED;
  keyboard.setup.begin();keyboard.roles.grant(HOME);keyboard.failure(R.string.alpha_keyboard_failed,Settings.ACTION_INPUT_METHOD_SETTINGS);
  Fixture palette=new Fixture();palette.activity.telephony=false;palette.activity.palette="{}";palette.activity.paletteAccepted=false;
  palette.setup.begin();palette.roles.grant(HOME);palette.failure(R.string.alpha_appearance_preset_failed,Settings.ACTION_SETTINGS);

  Fixture driftAfterPalette=new Fixture();driftAfterPalette.activity.telephony=false;driftAfterPalette.activity.palette="{}";
  driftAfterPalette.activity.afterPalette=()->driftAfterPalette.roles.holders.put(HOME,List.of(OTHER));
  driftAfterPalette.setup.begin();driftAfterPalette.roles.grant(HOME);
  driftAfterPalette.failure(R.string.alpha_home_failed,Settings.ACTION_HOME_SETTINGS);
  driftAfterPalette.effects(HOME,"keyboard","palette");

  Fixture managedAfterPalette=new Fixture();managedAfterPalette.activity.telephony=false;managedAfterPalette.activity.palette="{}";
  managedAfterPalette.activity.afterPalette=()->managedAfterPalette.activity.managed=true;
  managedAfterPalette.setup.begin();managedAfterPalette.roles.grant(HOME);
  managedAfterPalette.failure(R.string.alpha_setup_state_changed,Settings.ACTION_SETTINGS);
  managedAfterPalette.effects(HOME,"keyboard","palette");
  System.out.println("PASS actual setup completion and recovery");
 }
}''')
   compiled=subprocess.run([java_binary('javac'),'--release','11','-d',d,
                            str(BRAND/'provision/AlphaFreshSetupPolicy.java'),str(file)],capture_output=True,text=True)
   self.assertEqual(compiled.returncode,0,compiled.stderr)
   self.assertIn('PASS actual setup completion and recovery',
                 subprocess.check_output([java_binary('java'),'-cp',d,'com.android.provision.CompletionTest'],text=True))

if __name__=='__main__':unittest.main(verbosity=2)
