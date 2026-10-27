from pathlib import Path
import hashlib, json, os, shutil, subprocess, tempfile, unittest, xml.etree.ElementTree as ET
from portable_tools import java_binary, android_api_jar

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get('ALPHA_SYSTEM_ENTRY_INPUTS', ROOT / '.cache')).resolve()
REPO = next(path for path in ROOT.parents if (path / 'app.config.json').is_file())
BASE = DATA / 'baseline'
STAGED = DATA / 'staged'
MANIFEST = json.loads((ROOT / 'manifest.json').read_text())
PREFIX = 'packages/SystemUI/'
API = android_api_jar(36)
ANDROID = '{http://schemas.android.com/apk/res/android}'

def read(root, path): return (root / path).read_text()
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def canonical(node):
    return node.tag, tuple(sorted(node.attrib.items())), (node.text or '').strip(), tuple(canonical(c) for c in node)

class NativePlanTest(unittest.TestCase):
    def test_patch_checks_applies_and_matches_every_staged_byte(self):
        self.assertEqual(sha(ROOT / MANIFEST['patch']), MANIFEST['patchSha256'])
        with tempfile.TemporaryDirectory(prefix='alpha-systemui-patch-') as directory:
            target = Path(directory) / 'frameworks-base'
            shutil.copytree(BASE, target)
            patch = str(ROOT / MANIFEST['patch'])
            subprocess.run(['git', 'apply', '--check', patch], cwd=target, check=True)
            subprocess.run(['git', 'apply', patch], cwd=target, check=True)
            for row in MANIFEST['files']:
                self.assertEqual(sha(target / row['path']), row['afterSha256'], row['path'])
                self.assertEqual((target / row['path']).read_bytes(), (STAGED / row['path']).read_bytes())
            with self.assertRaises(subprocess.CalledProcessError):
                subprocess.run(['git', 'apply', '--check', patch], cwd=target, check=True, capture_output=True)
            victim = target / MANIFEST['files'][0]['path']
            victim.write_text('unreviewed drift')
            with self.assertRaises(subprocess.CalledProcessError):
                subprocess.run(['git', 'apply', '--check', '--reverse', patch], cwd=target, check=True, capture_output=True)

    def test_all_unchanged_pinned_files_and_selection_privacy_camera_paths_stay_exact(self):
        inputs = json.loads((ROOT / 'SOURCE-INPUTS.json').read_text())
        changed = {r['path'] for r in MANIFEST['files']}
        preserved = []
        for row in inputs['files']:
            self.assertEqual(sha(BASE / row['path']), row['beforeSha256'])
            if row['path'] not in changed:
                self.assertEqual((BASE / row['path']).read_bytes(), (STAGED / row['path']).read_bytes())
                preserved.append(row['path'])
        for required in ['KeyguardQuickAffordanceInteractor.kt', 'KeyguardQuickAffordanceLocalUserSelectionManager.kt',
                         'KeyguardQuickAffordanceRepository.kt', 'CameraQuickAffordanceConfig.kt',
                         'DefaultIndicationAreaSection.kt', 'ClockSection.kt', 'config.xml', 'keyguard_bottom_area.xml']:
            self.assertTrue(any(p.endswith('/' + required) for p in preserved), required)
        interactor = read(STAGED, PREFIX + 'src/com/android/systemui/keyguard/domain/interactor/KeyguardQuickAffordanceInteractor.kt')
        self.assertIn('!canShowWhileLocked && !keyguardStateController.isUnlocked', interactor)
        self.assertIn('STRONG_AUTH_REQUIRED_AFTER_BOOT', interactor)
        self.assertIn('postStartActivityDismissingKeyguard(', interactor)

    def test_existing_header_controls_and_constraints_unchanged_when_brand_removed(self):
        for path in ['res/layout/combined_qs_header.xml', 'res/xml/qs_header.xml',
                     'res/xml/qqs_header.xml', 'res/xml/large_screen_shade_header.xml']:
            before = ET.fromstring(read(BASE, PREFIX + path))
            after = ET.fromstring(read(STAGED, PREFIX + path))
            additions = [c for c in after if c.attrib.get(ANDROID+'id') in ['@id/alpha_shade_wordmark', '@+id/alpha_shade_wordmark']]
            self.assertEqual(len(additions), 1)
            after.remove(additions[0])
            self.assertEqual(canonical(before), canonical(after), path)
        compose = PREFIX + 'compose/features/src/com/android/systemui/shade/ui/composable/ShadeHeader.kt'
        before, after = read(BASE, compose), read(STAGED, compose)
        start = after.index('        // The reserved privacy band is otherwise empty.')
        end = after.index('        if (viewModel.isPrivacyChipVisible)', start)
        self.assertEqual(before, after[:start] + after[end:])
        addition = after[start:end]
        self.assertIn('!viewModel.isPrivacyChipVisible', addition)
        self.assertNotIn('clickable', addition)
        self.assertIn('Alignment.TopEnd', addition)

    def test_module_registration_adds_one_choice_without_removing_any_config(self):
        # Android's existing picker feature gate is independent from our product entry gate.
        upstream = ET.fromstring(read(BASE, PREFIX + 'res/values/config.xml'))
        self.assertEqual([n.text for n in upstream.findall('bool') if n.attrib.get('name') == 'custom_lockscreen_shortcuts_enabled'], ['false'])
        own = ET.fromstring(read(STAGED, PREFIX + 'res/values/alpha_system_entry.xml'))
        self.assertEqual([n.text for n in own.findall('bool') if n.attrib.get('name') == 'config_alpha_system_entry_enabled'], ['false'])
        overlay = ROOT / MANIFEST['productOverlay']['path']
        expected_flags = {'config_alpha_system_entry_enabled':'true','custom_lockscreen_shortcuts_enabled':'true'}
        self.assertEqual({n.attrib['name']:n.text for n in ET.fromstring(overlay.read_text()).findall('bool')}, expected_flags)
        arrays = ET.fromstring(overlay.read_text()).findall('string-array')
        self.assertEqual(len(arrays), 1)
        self.assertEqual(arrays[0].attrib['name'], 'config_keyguardQuickAffordanceDefaults')
        self.assertEqual([n.text for n in arrays[0]], ['bottom_start:alpha_assistant','bottom_end:camera'])
        # Prove the overlay uses existing fallback semantics, without a duplicate selection writer.
        manager = read(STAGED, PREFIX + 'src/com/android/systemui/keyguard/data/quickaffordance/KeyguardQuickAffordanceLocalUserSelectionManager.kt')
        self.assertEqual(manager, read(BASE, PREFIX + 'src/com/android/systemui/keyguard/data/quickaffordance/KeyguardQuickAffordanceLocalUserSelectionManager.kt'))
        selection_read = manager[manager.index('    override fun getSelections()'):manager.index('    override fun setSelections(')]
        normalized = ' '.join(selection_read.split())
        self.assertIn('val slotKeys = sharedPrefs.all.keys.filter { it.startsWith(KEY_PREFIX_SLOT) }', normalized)
        self.assertIn('if (!value.isNullOrEmpty()) { value.split(AFFORDANCE_DELIMITER) } else { emptyList() }', normalized)
        self.assertIn('if (!result.containsKey(slotId)) { result[slotId] = affordanceIds }', normalized)
        self.assertNotIn('.edit()', selection_read, 'defaults do not write or migrate any saved choice')
        self.assertEqual(sha(overlay), MANIFEST['productOverlay']['sha256'])
        generated_overlay = DATA / MANIFEST['productOverlay']['path']
        self.assertEqual(generated_overlay.read_bytes(), overlay.read_bytes())
        interactor = read(STAGED, PREFIX + 'src/com/android/systemui/keyguard/domain/interactor/KeyguardQuickAffordanceInteractor.kt')
        self.assertIn('!isFeatureDisabledByDevicePolicy() && appContext.resources.getBoolean(R.bool.custom_lockscreen_shortcuts_enabled)', ' '.join(interactor.split()))
        path = PREFIX + 'src/com/android/systemui/keyguard/data/quickaffordance/KeyguardDataQuickAffordanceModule.kt'
        expected = read(STAGED, path).replace('            alpha: AlphaAssistantQuickAffordanceConfig,\n', '').replace('                alpha,\n', '')
        self.assertEqual(read(BASE, path), expected)
        config = read(STAGED, PREFIX + 'src/com/android/systemui/keyguard/data/quickaffordance/AlphaAssistantQuickAffordanceConfig.kt')
        self.assertIn('override val key = "alpha_assistant"', config)
        camera_keys = read(STAGED, PREFIX + 'src/com/android/systemui/keyguard/data/quickaffordance/BuiltInKeyguardQuickAffordanceKeys.kt')
        self.assertIn('const val CAMERA = "camera"', camera_keys)
        for fragment in ['Intent(Intent.ACTION_ASSIST)', 'component = ComponentName(', 'canShowWhileLocked = false',
                         'getBoolean(R.bool.config_alpha_system_entry_enabled)',
                         'getTargetActivityInfo(intent(), user, false)', 'user != userTracker.userId',
                         'FLAG_SYSTEM', 'FLAG_SUSPENDED', 'target.exported', 'finally {', 'removeCallback(users)',
                         'unregisterReceiver(packages)', 'if (!available()) return']:
            self.assertIn(fragment, config)
        for forbidden in ['putExtra(', 'setData(', 'ACTION_VOICE_COMMAND', 'startActivity(', 'startService(',
                          'requestPermissions', 'getUserMedia', 'CloudProtocol', 'Settings.Secure', 'LISTENER']:
            self.assertNotIn(forbidden, config)

    def test_actual_java_policy_preserves_user_gates_and_decoration_yields(self):
        with tempfile.TemporaryDirectory(prefix='alpha-systemui-policy-') as directory:
            tmp = Path(directory)
            harness = tmp / 'Test.java'
            harness.write_text('''
import com.android.systemui.keyguard.data.quickaffordance.AlphaSystemEntryPolicy;
import com.android.systemui.shade.AlphaShadeWordmarkPolicy;
public class Test {
 static void check(boolean ok){if(!ok)throw new AssertionError();}
 public static void main(String[] args){
  String pkg=AlphaSystemEntryPolicy.PACKAGE, cls=AlphaSystemEntryPolicy.ACTIVITY;
  check(AlphaSystemEntryPolicy.available(true,0,false,pkg,cls,true,true,true,true,false));
  check(AlphaSystemEntryPolicy.available(true,10,false,pkg,cls,true,true,true,true,false));
  for(int mask=0;mask<256;mask++){
   boolean enabled=(mask&1)!=0,switching=(mask&2)!=0,activity=(mask&4)!=0,exported=(mask&8)!=0,
    app=(mask&16)!=0,system=(mask&32)!=0,suspended=(mask&64)!=0,correct=(mask&128)!=0;
   boolean expected=enabled&&!switching&&activity&&exported&&app&&system&&!suspended&&correct;
   check(AlphaSystemEntryPolicy.available(enabled,0,switching,correct?pkg:"other.app",cls,activity,exported,app,system,suspended)==expected);
  }
  check(!AlphaSystemEntryPolicy.available(true,-1,false,pkg,cls,true,true,true,true,false));
  check(!AlphaSystemEntryPolicy.available(true,0,false,pkg,"other.Activity",true,true,true,true,false));
  check(AlphaShadeWordmarkPolicy.fits(true,180,28,88,21,false));
  check(!AlphaShadeWordmarkPolicy.fits(true,180,28,88,42,false)); // 200% text cannot fit reserved band
  check(!AlphaShadeWordmarkPolicy.fits(true,70,28,88,21,false));
  check(!AlphaShadeWordmarkPolicy.fits(true,180,28,88,21,true)); // transformed clock/privacy wins
  check(!AlphaShadeWordmarkPolicy.fits(false,180,28,88,21,false));
  check(!AlphaShadeWordmarkPolicy.fits(true,Float.NaN,28,88,21,false));
  System.out.println("PASS current-user admission and decorative fit policies");
 }
}''')
            files = [STAGED / PREFIX / 'src/com/android/systemui/keyguard/data/quickaffordance/AlphaSystemEntryPolicy.java',
                     STAGED / PREFIX / 'src/com/android/systemui/shade/AlphaShadeWordmarkPolicy.java']
            subprocess.run([java_binary('javac'), '--release', '11', '-d', directory, *map(str, files), str(harness)], check=True, capture_output=True)
            result = subprocess.check_output([java_binary('java'), '-cp', directory, 'Test'], text=True)
            self.assertIn('PASS current-user admission', result)

    def test_wordmark_real_android_api36_compile_with_only_sysui_symbol_stubs(self):
        self.assertTrue(API.exists(), 'Android API36 SDK required; no silent skip')
        with tempfile.TemporaryDirectory(prefix='alpha-systemui-api-') as directory:
            tmp = Path(directory)
            stubs = {
                'com/android/systemui/res/R.java': 'package com.android.systemui.res; public final class R { public static final class string { public static final int alpha_system_brand=1; } public static final class bool { public static final int config_alpha_system_entry_enabled=2; } public static final class color { public static final int alpha_system_brand_accent=3; } public static final class drawable { public static final int ic_alpha_system_mark=4; }}',
                'com/android/systemui/statusbar/policy/Clock.java': 'package com.android.systemui.statusbar.policy; public class Clock extends android.view.View { public Clock(android.content.Context c){super(c);} }',
                'com/android/systemui/privacy/AbstractOngoingPrivacyChip.java': 'package com.android.systemui.privacy; public abstract class AbstractOngoingPrivacyChip extends android.view.ViewGroup { public AbstractOngoingPrivacyChip(android.content.Context c){super(c);} }',
            }
            files=[]
            for name, content in stubs.items():
                p=tmp/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(content);files.append(str(p))
            files += [str(STAGED/PREFIX/'src/com/android/systemui/shade'/n) for n in ['AlphaShadeWordmarkView.java','AlphaShadeWordmarkPolicy.java']]
            subprocess.run([java_binary('javac'),'--release','17','-classpath',str(API),'-d',directory,*files],check=True,capture_output=True)

    def test_exact_alpha_vector_and_native_font_preserved(self):
        svg=ET.fromstring((REPO / MANIFEST['identity']['source']).read_text())
        vector=ET.fromstring(read(STAGED,PREFIX+'res/drawable/ic_alpha_system_mark.xml'))
        self.assertEqual(svg.attrib['viewBox'],'0 0 120 120')
        self.assertEqual(vector.attrib[ANDROID+'viewportWidth'],'120')
        self.assertEqual(vector.attrib[ANDROID+'viewportHeight'],'120')
        self.assertEqual(vector.find('path').attrib[ANDROID+'pathData'],next(iter(svg)).attrib['d'])
        view=read(STAGED,PREFIX+'src/com/android/systemui/shade/AlphaShadeWordmarkView.java')
        self.assertIn('Typeface.create("serif", Typeface.NORMAL)',view)
        self.assertIn('COMPLEX_UNIT_SP',view)
        self.assertNotIn('setCompoundDrawablesRelative(',view)
        self.assertNotIn('setCompoundDrawablePadding(',view)
        self.assertIn('LAYOUT_DIRECTION_RTL',view)
        self.assertIn('Rect.intersects(brandBounds, otherBounds)',view)
        self.assertIn('setClickable(false)',view)

if __name__ == '__main__': unittest.main(verbosity=2)
