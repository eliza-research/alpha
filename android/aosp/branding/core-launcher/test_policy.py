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

class CorePolicyTest(unittest.TestCase):
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
  check(AlphaQsDefaultsPolicy.shouldMigrate(list(legacy),defaults));
  check(AlphaQsDefaultsPolicy.shouldMigrate(list(a+","+legacy),defaults));
  check(!AlphaQsDefaultsPolicy.shouldMigrate(list("bt,wifi,flashlight"),defaults));
  check(!AlphaQsDefaultsPolicy.shouldMigrate(list(a+","+legacy+",inversion"),defaults));
  check(!AlphaQsDefaultsPolicy.shouldMigrate(defaults,defaults));
  check(!AlphaQsDefaultsPolicy.shouldMigrate(list(legacy),list("wifi,bt")));
  check(!AlphaQsDefaultsPolicy.shouldMigrate(Collections.emptyList(),defaults));
  System.out.println("PASS core and QS policy "+checks);
 }
}''')
            subprocess.run([str(JDK/'bin/javac'), '-d', str(d), str(ROOT/'AlphaCoreLauncherPolicy.java'),
                str(ROOT/'AlphaQsDefaultsPolicy.java'), str(probe)], check=True, capture_output=True)
            self.assertIn('PASS core and QS policy 23', subprocess.check_output(
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
            permission=(d/'services/core/java/com/android/server/pm/permission/DefaultPermissionGrantPolicy.java').read_text()
            self.assertIn('policy.getDeviceOwnerComponentOnAnyUser() != null',permission)
            self.assertIn('mode == android.app.AppOpsManager.MODE_DEFAULT',permission)
            self.assertIn('Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())',permission)
            self.assertIn('UserHandle.SYSTEM, new android.content.IntentFilter',permission)
            self.assertNotIn('MANAGE_APP_OPS_MODES',permission)
            with self.assertRaises(subprocess.CalledProcessError):
                subprocess.run(['git','apply','--check',str(patch)],cwd=d,check=True,capture_output=True)

if __name__=='__main__':unittest.main()
