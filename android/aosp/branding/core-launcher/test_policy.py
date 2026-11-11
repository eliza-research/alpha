from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import tempfile
import unittest
import os

ROOT = Path(__file__).resolve().parent
JDK = Path(os.environ.get('JAVA_HOME', '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home'))

def kotlin_compiler():
    """Use an installed compiler only; no Gradle build or dependency downloads."""
    installed = shutil.which('kotlinc')
    if installed:
        library = Path(installed).resolve().parent.parent / 'lib/kotlin-stdlib.jar'
        return [installed], str(library)
    cache = Path(os.environ.get('GRADLE_USER_HOME', Path.home() / '.gradle')) / 'caches/modules-2/files-2.1'
    jars = []
    for group, artifact in [
        ('org.jetbrains.kotlin', 'kotlin-compiler-embeddable'),
        ('org.jetbrains.kotlin', 'kotlin-stdlib'),
        ('org.jetbrains.kotlin', 'kotlin-script-runtime'),
        ('org.jetbrains.kotlin', 'kotlin-reflect'),
        ('org.jetbrains.kotlin', 'kotlin-daemon-embeddable'),
        ('org.jetbrains.kotlinx', 'kotlinx-coroutines-core-jvm'),
        ('org.jetbrains', 'annotations'),
    ]:
        candidates = sorted((cache / group / artifact).glob('*/*/*.jar'))
        if not candidates:
            raise RuntimeError('Install kotlinc or populate the Gradle cache: missing ' + artifact)
        jars.append(str(candidates[-1]))
    classpath = os.pathsep.join(jars)
    return [str(JDK/'bin/java'), '-cp', classpath, 'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler'], classpath

class CorePolicyTest(unittest.TestCase):
    def test_actual_fgs_cache_update_hides_and_restores_core_launcher(self):
        """Compile the generated update method with small Android boundary doubles."""
        path = 'packages/SystemUI/src/com/android/systemui/qs/FgsManagerController.kt'
        with tempfile.TemporaryDirectory(prefix='alpha-fgs-transition-') as directory:
            d = Path(directory)
            shutil.copytree(ROOT/'.cache/baseline', d/'source')
            subprocess.run(['git', 'apply', str(ROOT/'alpha-core-launcher.patch')],
                cwd=d/'source', check=True, capture_output=True)
            compiler, libraries = kotlin_compiler()
            for candidate, should_pass in [(d/'source'/path, True), (ROOT/'.cache/baseline'/path, False)]:
                source = candidate.read_text()
                start = source.index('    private fun updateAppItems(\n')
                end = source.index('    /** Must be called on the background thread. */', start)
                method = source[start:end]
                probe = d/'Transition.kt'
                probe.write_text('''
import java.util.concurrent.Executor
enum class UIControl { NORMAL, HIDE_BUTTON, HIDE_ENTRY }
object AlphaCoreLauncherPolicy { const val PACKAGE = "ai.alphacompute.alphaphone" }
data class UserPackage(val userId: Int, val packageName: String) {
    var uiControl = UIControl.NORMAL
    fun updateUiControl() {}
}
data class RunningApp(val userId: Int, val packageName: String, val timeStarted: Long,
    val uiControl: UIControl, var appLabel: String, var icon: String, var stopped: Boolean = false)
object UserHandle { fun of(userId: Int) = userId }
class PackageManager {
    fun getApplicationInfoAsUser(name: String, flags: Int, userId: Int) = name
    fun getApplicationLabel(info: String) = info
    fun getApplicationIcon(info: String) = info
    fun getUserBadgedIcon(icon: String, userId: Int) = icon
}
class Adapter {
    var rows = emptyList<RunningApp>()
    fun setData(value: List<RunningApp>) { rows = value }
}
class Probe {
    val runningApps = mutableMapOf<UserPackage, RunningApp>()
    val packageManager = PackageManager()
    val mainExecutor = Executor { it.run() }
    val appListAdapter = Adapter()
    val stopEvents = mutableListOf<String>()
    fun logEvent(stopped: Boolean, packageName: String, userId: Int, timeStarted: Long) {
        if (stopped) stopEvents.add(packageName)
    }
''' + method + '''
    fun run() {
        val alpha = UserPackage(0, AlphaCoreLauncherPolicy.PACKAGE)
        val other = UserPackage(0, "owner.other.app")
        val noStop = UserPackage(0, "system.other.app").apply { uiControl = UIControl.HIDE_BUTTON }
        val packages = mapOf(alpha to 10L, other to 20L, noStop to 30L)
        updateAppItems(packages, setOf(0))
        check(appListAdapter.rows.size == 3)
        val previous = runningApps.getValue(alpha)
        check(previous.uiControl == UIControl.NORMAL && !previous.stopped)
        alpha.uiControl = UIControl.HIDE_ENTRY
        updateAppItems(packages, setOf(0), false)
        check(runningApps[alpha] == null) { "newly protected Alpha remains in the live cache" }
        check(appListAdapter.rows.none { it.packageName == alpha.packageName })
        check(!previous.stopped && stopEvents.isEmpty()) { "hiding must not stop Alpha" }
        check(runningApps.getValue(other).uiControl == UIControl.NORMAL)
        check(runningApps.getValue(noStop).uiControl == UIControl.HIDE_BUTTON)
        alpha.uiControl = UIControl.NORMAL
        updateAppItems(packages, setOf(0), false)
        check(appListAdapter.rows.size == 3)
        check(runningApps.getValue(alpha).uiControl == UIControl.NORMAL)
        check(!runningApps.getValue(alpha).stopped)
        check(runningApps.getValue(alpha).timeStarted == 10L)
        updateAppItems(packages - other, setOf(0), false)
        check(runningApps.getValue(other).stopped) { "normal stopped-row recovery changed" }
        check(!runningApps.getValue(alpha).stopped && stopEvents.isEmpty())
        println("PASS actual FGS visible-protected-visible transition and unrelated controls")
    }
}
fun main() { Probe().run() }
''')
                compiled = subprocess.run(compiler + ['-no-stdlib', '-no-reflect', '-classpath', libraries,
                    '-d', str(d/'classes'), str(probe)], capture_output=True, text=True)
                self.assertEqual(compiled.returncode, 0, compiled.stdout + compiled.stderr)
                executed = subprocess.run([str(JDK/'bin/java'), '-cp', str(d/'classes')+os.pathsep+libraries,
                    'TransitionKt'], capture_output=True, text=True)
                if should_pass:
                    self.assertEqual(executed.returncode, 0, executed.stdout + executed.stderr)
                    self.assertIn('PASS actual FGS visible-protected-visible transition', executed.stdout)
                else:
                    self.assertNotEqual(executed.returncode, 0, 'unpatched cache must reproduce the defect')
                    self.assertIn('newly protected Alpha remains in the live cache', executed.stderr)

    def test_core_identity_and_known_stock_migration_execute_on_jvm(self):
        with tempfile.TemporaryDirectory(prefix='alpha-core-policy-') as directory:
            d = Path(directory)
            probe = d / 'CoreProbe.java'
            probe.write_text('''import java.util.*;
import com.android.systemui.qs.AlphaCoreLauncherPolicy;
import com.android.systemui.qs.pipeline.data.repository.AlphaQsDefaultsPolicy;
public class CoreProbe {
 static int checks; static void check(boolean v){checks++;if(!v)throw new AssertionError();}
 static List<String> list(String v){return Arrays.asList(v.split(","));}
 public static void main(String[] args){
  for(String pkg:new String[]{AlphaCoreLauncherPolicy.PACKAGE,"owner.other.home"})
   for(boolean enabled:new boolean[]{false,true})for(boolean system:new boolean[]{false,true})
    for(boolean home:new boolean[]{false,true})check(AlphaCoreLauncherPolicy.protects(pkg,enabled,system,home)==(pkg.equals(AlphaCoreLauncherPolicy.PACKAGE)&&enabled&&system&&home));
  String a=AlphaQsDefaultsPolicy.ALPHA;
  List<String> defaults=list(a+",wifi,bt,dnd,airplane,rotation,flashlight,battery,alarm,screenrecord");
  String legacy="wifi,bt,cell,cast,dnd,wallet,airplane,rotation,flashlight,battery,alarm,controls,screenrecord";
  check(AlphaQsDefaultsPolicy.shouldMigrate(list(legacy),defaults,0));
  check(AlphaQsDefaultsPolicy.shouldMigrate(list(a+","+legacy),defaults,0));
  check(AlphaQsDefaultsPolicy.shouldMigrate(list("custom(ai.alphacompute.alphaphone/.AlphaQuickSettingsTile),"+legacy),defaults,1));
  check(!AlphaQsDefaultsPolicy.shouldMigrate(list("bt,wifi,flashlight"),defaults,0));
  check(!AlphaQsDefaultsPolicy.shouldMigrate(list(a+","+legacy+",inversion"),defaults,0));
  check(!AlphaQsDefaultsPolicy.shouldMigrate(defaults,defaults,0));
  check(!AlphaQsDefaultsPolicy.shouldMigrate(list(legacy),list("wifi,bt"),0));
  check(!AlphaQsDefaultsPolicy.shouldMigrate(Collections.emptyList(),defaults,0));
  check(!AlphaQsDefaultsPolicy.shouldMigrate(list(legacy),defaults,3));
  check(!AlphaQsDefaultsPolicy.shouldMigrate(list(a+","+legacy),defaults,3));
  String oldTile="custom(ai.elizaresearch.alphaphone/.AlphaQuickSettingsTile)";
  check(AlphaQsDefaultsPolicy.migrate(list(legacy),defaults,2).equals(list(legacy)));
  check(AlphaQsDefaultsPolicy.migrate(list(a+","+legacy),defaults,2).equals(list(a+","+legacy)));
  check(AlphaQsDefaultsPolicy.migrate(list(oldTile+","+legacy),defaults,2).equals(list(a+","+legacy)));
  check(AlphaQsDefaultsPolicy.migrate(list("bt,"+oldTile+",inversion"),defaults,2).equals(list("bt,"+a+",inversion")));
  check(AlphaQsDefaultsPolicy.migrate(list("bt,"+oldTile+","+a),defaults,2).equals(list("bt,"+a)));
  check(AlphaQsDefaultsPolicy.migrate(list("bt,"+oldTile),defaults,3).equals(list("bt,"+oldTile)));
  System.out.println("PASS core and QS policy "+checks);
 }
}''')
            subprocess.run([str(JDK/'bin/javac'), '-d', str(d), str(ROOT/'AlphaCoreLauncherPolicy.java'),
                str(ROOT/'AlphaQsDefaultsPolicy.java'), str(probe)], check=True, capture_output=True)
            self.assertIn('PASS core and QS policy 32', subprocess.check_output(
                [str(JDK/'bin/java'), '-cp', str(d), 'CoreProbe'], text=True))

    def test_storage_default_refuses_non_owner_sideloaded_and_existing_modes(self):
        with tempfile.TemporaryDirectory(prefix='alpha-files-policy-') as directory:
            d=Path(directory); probe=d/'StorageProbe.java'
            probe.write_text('''package com.android.server.pm.permission;
public class StorageProbe {
 public static void main(String[] args){int checks=0;
  for(int user:new int[]{0,10})for(String pkg:new String[]{AlphaSharedStoragePolicy.PACKAGE,"other.app"})
   for(boolean installed:new boolean[]{false,true})for(boolean system:new boolean[]{false,true})
    for(boolean requested:new boolean[]{false,true})for(boolean unset:new boolean[]{false,true}){
     boolean expected=user==0&&pkg.equals(AlphaSharedStoragePolicy.PACKAGE)&&installed&&system&&requested&&unset;
     if(AlphaSharedStoragePolicy.shouldGrant(user,pkg,installed,system,requested,unset)!=expected)throw new AssertionError();checks++;
    }
  System.out.println("PASS storage policy "+checks);
 }
}''')
            subprocess.run([str(JDK/'bin/javac'), '-d', str(d), str(ROOT/'AlphaSharedStoragePolicy.java'), str(probe)], check=True, capture_output=True)
            self.assertIn('PASS storage policy 64', subprocess.check_output([str(JDK/'bin/java'), '-cp', str(d), 'com.android.server.pm.permission.StorageProbe'], text=True))

    def test_patch_inventory_and_unrelated_caller_controls_are_preserved(self):
        manifest=json.loads((ROOT/'manifest.json').read_text());patch=ROOT/manifest['patch']
        self.assertEqual(hashlib.sha256(patch.read_bytes()).hexdigest(),manifest['patchSha256'])
        with tempfile.TemporaryDirectory(prefix='alpha-core-patch-') as directory:
            d=Path(directory);shutil.copytree(ROOT/'.cache/baseline',d,dirs_exist_ok=True)
            subprocess.run(['git','apply','--check',str(patch)],cwd=d,check=True,capture_output=True)
            subprocess.run(['git','apply',str(patch)],cwd=d,check=True,capture_output=True)
            for row in manifest['files']:
                self.assertEqual(hashlib.sha256((d/row['path']).read_bytes()).hexdigest(),row['afterSha256'])
            fgs=(d/'packages/SystemUI/src/com/android/systemui/qs/FgsManagerController.kt').read_text()
            self.assertIn('if (!coreLauncher && isStoppableApp(packageName))',fgs)
            self.assertIn('else when (backgroundRestrictionExemptionReason)',fgs)
            self.assertIn('ACTION_PREFERRED_ACTIVITY_CHANGED',fgs)
            repo=(d/'packages/SystemUI/src/com/android/systemui/qs/pipeline/data/repository/UserTileSpecRepository.kt').read_text()
            self.assertLess(repo.index('val written = secureSettings.putStringForUser'),repo.index('secureSettings.putIntForUser('))
            permission=(d/'services/core/java/com/android/server/pm/permission/DefaultPermissionGrantPolicy.java').read_text()
            self.assertIn('policy.getDeviceOwnerComponentOnAnyUser() != null',permission)
            self.assertIn('mode == android.app.AppOpsManager.MODE_DEFAULT',permission)
            self.assertIn('Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())',permission)
            self.assertIn('UserHandle.SYSTEM, new android.content.IntentFilter',permission)
            self.assertNotIn('MANAGE_APP_OPS_MODES',permission)
            with self.assertRaises(subprocess.CalledProcessError):
                subprocess.run(['git','apply','--check',str(patch)],cwd=d,check=True,capture_output=True)

if __name__=='__main__':unittest.main()
