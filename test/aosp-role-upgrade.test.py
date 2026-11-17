from pathlib import Path
import importlib.util
import hashlib
import os
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
POLICY = ROOT / 'android/aosp/branding/provision/AlphaRoleUpgrade.java'
INPUTS = Path(os.environ.get('ALPHA_FRESH_PRESET_INPUTS', ROOT / 'android/aosp/branding/provision/.cache'))
CONTROLLER = INPUTS / 'packages/modules/Permission/PermissionController/role-controller/java/com/android/role/controller/service/RoleControllerServiceImpl.java'
SPEC = importlib.util.spec_from_file_location('staging', ROOT / 'scripts/stage-alpha-os-branding.py')
STAGE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(STAGE)


class RoleUpgrade(unittest.TestCase):
    @unittest.skipUnless(CONTROLLER.is_file(), 'Pinned Android role controller input required')
    def test_complete_patched_controller_and_android_adapter(self):
        raw = CONTROLLER.read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(), 'a29db10b18799b3231954b4350b417acd3e6d1c9ac1e83477cae25aa1635ce14')
        files = {
            'android/annotation/UserIdInt.java': 'package android.annotation; public @interface UserIdInt {}',
            'androidx/annotation/NonNull.java': 'package androidx.annotation; public @interface NonNull {}',
            'androidx/annotation/WorkerThread.java': 'package androidx.annotation; public @interface WorkerThread {}',
            'android/os/Process.java': 'package android.os; public class Process { public static UserHandle myUserHandle(){return UserHandle.SYSTEM;} }',
            'android/os/UserHandle.java': 'package android.os; public class UserHandle { public static final UserHandle SYSTEM=new UserHandle(0); private final int id; public UserHandle(int id){this.id=id;} public int getIdentifier(){return id;} }',
            'android/os/UserManager.java': 'package android.os; public class UserManager { public boolean managed; public boolean isManagedProfile(){return managed;} }',
            'android/app/admin/DevicePolicyManager.java': 'package android.app.admin; public class DevicePolicyManager { public Object owner; public Object getDeviceOwnerComponentOnCallingUser(){return owner;} }',
            'android/util/ArrayMap.java': 'package android.util; public class ArrayMap<K,V> extends java.util.LinkedHashMap<K,V>{public V valueAt(int i){return new java.util.ArrayList<>(values()).get(i);} }',
            'android/util/ArraySet.java': 'package android.util; public class ArraySet<T> extends java.util.HashSet<T>{ public T valueAt(int i){return new java.util.ArrayList<>(this).get(i);} }',
            'android/util/Log.java': 'package android.util; public class Log { public static int i(String a,String b){return 0;} public static int e(String a,String b){return 0;} public static int w(String a,String b){return 0;} }',
            'android/content/SharedPreferences.java': '''package android.content; public class SharedPreferences {
             public java.util.Map<String,String> values=new java.util.HashMap<>(); public boolean fail;
             public String getString(String k,String v){return values.getOrDefault(k,v);} public Editor edit(){return new Editor();}
             public class Editor {String k,v; public Editor putString(String k,String v){this.k=k;this.v=v;return this;} public boolean commit(){if(fail)return false;values.put(k,v);return true;} }
            }''',
            'android/content/Context.java': '''package android.content; public class Context {
             public android.app.role.RoleManager roles=new android.app.role.RoleManager();
             public android.os.UserManager users=new android.os.UserManager();
             public android.app.admin.DevicePolicyManager policy=new android.app.admin.DevicePolicyManager();
             public android.content.pm.PackageManager packages=new android.content.pm.PackageManager();
             public SharedPreferences prefs=new SharedPreferences(); public int complete=1; public static final int MODE_PRIVATE=0;
             public <T>T getSystemService(Class<T> c){if(c==android.app.role.RoleManager.class)return c.cast(roles);if(c==android.os.UserManager.class)return c.cast(users);return c.cast(policy);}
             public Context createDeviceProtectedStorageContext(){return this;} public SharedPreferences getSharedPreferences(String n,int m){return prefs;}
             public android.content.pm.PackageManager getPackageManager(){return packages;} public Context getContentResolver(){return this;}
            }''',
            'android/content/pm/ApplicationInfo.java': 'package android.content.pm; public class ApplicationInfo { public static final int FLAG_SYSTEM=1,FLAG_DEBUGGABLE=2,FLAG_SUSPENDED=4; public boolean enabled=true;public int flags=FLAG_SYSTEM; }',
            'android/content/pm/PackageManager.java': 'package android.content.pm; public class PackageManager { public boolean image=true;public ApplicationInfo app=new ApplicationInfo();public boolean hasSystemFeature(String n){return image;}public ApplicationInfo getApplicationInfo(String n,int f)throws NameNotFoundException{return app;}public static class NameNotFoundException extends Exception {} }',
            'android/provider/Settings.java': 'package android.provider; public class Settings {public static class Secure {public static final String USER_SETUP_COMPLETE="done";public static int getInt(android.content.Context c,String n,int d){return c.complete;}}}',
            'android/app/role/RoleManager.java': '''package android.app.role; public class RoleManager {
             public static final int MANAGE_HOLDERS_FLAG_DONT_KILL_APP=1;public static final String ROLE_HOME="android.app.role.HOME",ROLE_DIALER="android.app.role.DIALER",ROLE_SMS="android.app.role.SMS";
             public java.util.Map<String,java.util.List<String>> holders=new java.util.HashMap<>();public String failAdd;public int adds,removes;
             public boolean isRoleAvailable(String n){return holders.containsKey(n);}public void setRoleNamesFromController(java.util.List<String> n){for(String r:n)holders.putIfAbsent(r,new java.util.ArrayList<>());}
             public java.util.List<String> getRoleHolders(String n){return new java.util.ArrayList<>(holders.getOrDefault(n,java.util.List.of()));}
             public boolean addRoleHolderFromController(String r,String p){adds++;if(r.equals(failAdd)){failAdd=null;return false;}holders.computeIfAbsent(r,k->new java.util.ArrayList<>()).add(p);return true;}
             public boolean removeRoleHolderFromController(String r,String p){removes++;return holders.get(r).remove(p);}public android.os.UserHandle getActiveUserForRole(String r){return android.os.UserHandle.SYSTEM;}
            }''',
            'android/app/role/RoleControllerService.java': '''package android.app.role; public abstract class RoleControllerService extends android.content.Context {
             public void onCreate(){} public abstract boolean onGrantDefaultRoles();public abstract boolean onAddRoleHolder(String r,String p,int f);public abstract boolean onRemoveRoleHolder(String r,String p,int f);public abstract boolean onClearRoleHolders(String r,int f);
             public abstract boolean onIsApplicationQualifiedForRole(String r,String p);public abstract boolean onIsApplicationVisibleForRole(String r,String p);public abstract boolean onIsRoleVisible(String r);public abstract java.util.List<String> onGetLegacyFallbackDisabledRoles();
            }''',
            'com/android/role/controller/model/Roles.java': '''package com.android.role.controller.model; public class Roles {
             public static android.util.ArrayMap<String,Role> get(android.content.Context c){android.util.ArrayMap<String,Role> m=new android.util.ArrayMap<>();for(String r:java.util.List.of(android.app.role.RoleManager.ROLE_HOME,android.app.role.RoleManager.ROLE_DIALER,android.app.role.RoleManager.ROLE_SMS))m.put(r,new Role(r));return m;}
            }''',
            'com/android/role/controller/model/Role.java': '''package com.android.role.controller.model; public class Role {
             public static final int EXCLUSIVITY_PROFILE_GROUP=2;private final String name;public Role(String n){name=n;}public String getName(){return name;}
             public boolean isAvailableAsUser(android.os.UserHandle u,android.content.Context c){return true;}public boolean isPackageQualifiedAsUser(String p,android.os.UserHandle u,android.content.Context c){return true;}
             public int getExclusivity(){return 0;}public boolean isExclusive(){return true;}public boolean isStatic(android.content.Context c){return false;}public boolean shouldOnlyGrantWhenAdded(){return false;}public boolean shouldOverrideUserWhenGranting(){return false;}
             public java.util.List<String> getDefaultHoldersAsUser(android.os.UserHandle u,android.content.Context c){return java.util.List.of();}public String getFallbackHolderAsUser(android.os.UserHandle u,android.content.Context c){return null;}
             public void onRoleAddedAsUser(android.os.UserHandle u,android.content.Context c){}public void onHolderAddedAsUser(String p,android.os.UserHandle u,android.content.Context c){}public void onHolderChangedAsUser(android.os.UserHandle u,android.content.Context c){}
             public void grantAsUser(String p,boolean d,boolean o,android.os.UserHandle u,android.content.Context c){}public void revokeAsUser(String p,boolean d,boolean o,android.os.UserHandle u,android.content.Context c){}
             public boolean isApplicationVisibleAsUser(android.content.pm.ApplicationInfo i,android.os.UserHandle u,android.content.Context c){return true;}public boolean isVisibleAsUser(android.os.UserHandle u,android.content.Context c){return true;}
            }''',
            'com/android/role/controller/util/UserUtils.java': 'package com.android.role.controller.util; public class UserUtils {public static android.content.Context getUserContext(android.content.Context c,android.os.UserHandle u){return c;}public static android.os.UserHandle getProfileParentOrSelf(android.os.UserHandle u,android.content.Context c){return u;} }',
            'com/android/role/controller/util/RoleFlags.java': 'package com.android.role.controller.util; public class RoleFlags {public static boolean isProfileGroupExclusivityAvailable(){return false;}}',
            'com/android/role/controller/util/CollectionUtils.java': 'package com.android.role.controller.util; public class CollectionUtils {public static <T>java.util.List<T> singletonOrEmpty(T t){return t==null?java.util.List.of():java.util.List.of(t);}}',
            'com/android/role/controller/util/PackageUtils.java': 'package com.android.role.controller.util; public class PackageUtils {public static android.content.pm.ApplicationInfo getApplicationInfoAsUser(String p,android.os.UserHandle u,android.content.Context c){return c.packages.app;}}',
            'com/android/role/controller/util/LegacyRoleFallbackEnabledUtils.java': 'package com.android.role.controller.util; public class LegacyRoleFallbackEnabledUtils {public static java.util.List<String> getFallbackDisabledRoles(android.os.UserHandle u,android.content.Context c){return java.util.List.of();}}',
            'com/android/role/controller/service/RoleControllerServiceImpl.java': STAGE.project_role_controller(raw.decode()),
            'com/android/role/controller/service/AlphaRoleUpgrade.java': POLICY.read_text(),
            'com/android/role/controller/service/AlphaRoleUpgradeAndroid.java': POLICY.with_name('AlphaRoleUpgradeAndroid.java').read_text(),
            'com/android/role/controller/service/ControllerTest.java': '''package com.android.role.controller.service;
             import android.content.Context;import android.os.UserHandle;import java.util.*;
             public class ControllerTest {
              static void check(boolean b){if(!b)throw new AssertionError();}
              static Context context(){Context c=new Context();for(String r:AlphaRoleUpgrade.ROLES)c.roles.holders.put(r,new ArrayList<>(List.of(AlphaRoleUpgrade.PREVIOUS)));return c;}
              public static void main(String[]args){
               Context c=context();RoleControllerServiceImpl p=new RoleControllerServiceImpl(UserHandle.SYSTEM,c);
               check(p.onGrantDefaultRoles());for(String r:AlphaRoleUpgrade.ROLES)check(c.roles.getRoleHolders(r).equals(List.of(AlphaRoleUpgrade.ALPHA)));
               check(p.onAddRoleHolder(AlphaRoleUpgrade.ROLES.get(0),AlphaRoleUpgrade.PREVIOUS,0));check(p.onGrantDefaultRoles());check(c.roles.getRoleHolders(AlphaRoleUpgrade.ROLES.get(0)).equals(List.of(AlphaRoleUpgrade.PREVIOUS)));
               Context failure=context();failure.roles.failAdd=AlphaRoleUpgrade.ROLES.get(1);p=new RoleControllerServiceImpl(UserHandle.SYSTEM,failure);check(!p.onGrantDefaultRoles());check(failure.roles.getRoleHolders(AlphaRoleUpgrade.ROLES.get(1)).equals(List.of(AlphaRoleUpgrade.PREVIOUS)));check(p.onGrantDefaultRoles());
               Context owner=context();p=new RoleControllerServiceImpl(UserHandle.SYSTEM,owner);check(p.onAddRoleHolder(AlphaRoleUpgrade.ROLES.get(2),"owner.sms",0));check(p.onGrantDefaultRoles());check(owner.roles.getRoleHolders(AlphaRoleUpgrade.ROLES.get(2)).equals(List.of("owner.sms")));
               Context fresh=context();fresh.complete=0;p=new RoleControllerServiceImpl(UserHandle.SYSTEM,fresh);check(p.onGrantDefaultRoles());check(fresh.roles.removes==0);
               Context data=context();data.packages.app.flags=0;p=new RoleControllerServiceImpl(UserHandle.SYSTEM,data);check(p.onGrantDefaultRoles());check(data.roles.removes==0);
               Context managed=context();managed.policy.owner=new Object();p=new RoleControllerServiceImpl(UserHandle.SYSTEM,managed);check(p.onGrantDefaultRoles());check(managed.roles.removes==0);
               Context profile=context();p=new RoleControllerServiceImpl(new UserHandle(10),profile);check(p.onGrantDefaultRoles());check(profile.roles.removes==0);
               System.out.println("PASS complete controller role upgrade, normal owner changes, partial recovery and scope refusals");
              }
             }''',
        }
        with tempfile.TemporaryDirectory(prefix='alpha-controller-') as temporary:
            root = Path(temporary)
            for name, content in files.items():
                file = root / name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text(content)
            sources = [str(file) for file in root.rglob('*.java')]
            subprocess.run(['javac', '--release', '11', '-d', str(root), *sources], check=True)
            result = subprocess.check_output(['java', '-cp', str(root), 'com.android.role.controller.service.ControllerTest'], text=True)
            self.assertIn('PASS complete controller', result)

    def test_preserving_transition_failure_recovery_and_owner_choices(self):
        with tempfile.TemporaryDirectory(prefix='alpha-role-upgrade-') as temporary:
            root = Path(temporary)
            source = root / 'UpgradeTest.java'
            source.write_text('''package com.android.role.controller.service;
import java.util.*;
public class UpgradeTest {
 static final String A=AlphaRoleUpgrade.ALPHA, L=AlphaRoleUpgrade.PREVIOUS;
 static class Port implements AlphaRoleUpgrade.Port {
  Map<String,List<String>> holders=new HashMap<>(); Map<String,String> saved=new HashMap<>();
  String failRole,ownerAfterSave; boolean ready=true,qualified=true,saveFailed,removeThenFail,finishSaveFailed;
  int adopted,restored; boolean throwAfterRemove;
  Port(){for(String r:AlphaRoleUpgrade.ROLES)holders.put(r,List.of(L));}
  public boolean eligible(){return ready;} public boolean qualified(String r){return qualified;}
  public List<String> holders(String r){return holders.get(r);} public String state(String r){return saved.getOrDefault(r,"");}
  public boolean save(String r,String value){
   if(saveFailed || finishSaveFailed && value.equals(AlphaRoleUpgrade.DONE))return false;
   saved.put(r,value);if(ownerAfterSave!=null){holders.put(r,List.of(ownerAfterSave));ownerAfterSave=null;}return true;
  }
  public boolean adopt(String r){adopted++;if(throwAfterRemove){throwAfterRemove=false;holders.put(r,List.of());throw new IllegalStateException("lost grant");}if(r.equals(failRole)){if(removeThenFail)holders.put(r,List.of());return false;}holders.put(r,List.of(A));return true;}
  public boolean restorePrevious(String r){restored++;holders.put(r,List.of(L));return true;}
  void owner(String r,String target){saved.put(r,AlphaRoleUpgrade.DONE);holders.put(r,List.of(target));}
 }
 static void check(boolean v){if(!v)throw new AssertionError();}
 public static void main(String[] args){
  Port ok=new Port();check(AlphaRoleUpgrade.run(ok)&&ok.adopted==3);check(AlphaRoleUpgrade.run(ok)&&ok.adopted==3);
  Port off=new Port();off.ready=false;check(AlphaRoleUpgrade.run(off)&&off.adopted==0&&off.saved.isEmpty());
  Port unqualified=new Port();unqualified.qualified=false;check(!AlphaRoleUpgrade.run(unqualified)&&unqualified.adopted==0);
  Port noWrite=new Port();noWrite.saveFailed=true;check(!AlphaRoleUpgrade.run(noWrite)&&noWrite.adopted==0);
  Port partial=new Port();partial.failRole=AlphaRoleUpgrade.ROLES.get(1);partial.removeThenFail=true;
  check(!AlphaRoleUpgrade.run(partial)&&partial.restored==1);check(partial.holders(partial.failRole).equals(List.of(L)));
  partial.failRole=null;check(AlphaRoleUpgrade.run(partial)&&partial.adopted==4);
  Port exception=new Port();exception.throwAfterRemove=true;try{AlphaRoleUpgrade.run(exception);throw new AssertionError();}catch(IllegalStateException expected){}check(exception.restored==1);check(AlphaRoleUpgrade.run(exception));
  Port owner=new Port();String role=AlphaRoleUpgrade.ROLES.get(0);owner.owner(role,"owner.home");
  check(AlphaRoleUpgrade.run(owner)&&owner.holders(role).equals(List.of("owner.home"))&&owner.adopted==2);
  Port optBack=new Port();check(AlphaRoleUpgrade.run(optBack));optBack.owner(role,L);check(AlphaRoleUpgrade.run(optBack)&&optBack.adopted==3);
  Port race=new Port();race.ownerAfterSave="owner.home";check(!AlphaRoleUpgrade.run(race)&&race.adopted==0);
  check(AlphaRoleUpgrade.run(race)&&race.holders(role).equals(List.of("owner.home")));
  Port missingReadback=new Port();missingReadback.finishSaveFailed=true;check(!AlphaRoleUpgrade.run(missingReadback)&&missingReadback.adopted==1);
  missingReadback.finishSaveFailed=false;check(AlphaRoleUpgrade.run(missingReadback)&&missingReadback.adopted==3);
  Port killed=new Port();killed.saved.put(role,AlphaRoleUpgrade.PENDING);killed.holders.put(role,List.of());
  check(AlphaRoleUpgrade.run(killed)&&killed.adopted==3);
  Port empty=new Port();empty.holders.put(role,List.of());check(AlphaRoleUpgrade.run(empty)&&empty.adopted==2&&empty.holders(role).isEmpty());
  System.out.println("PASS role transition, partial failure, restart, owner choice and refusal");
 }
}''')
            subprocess.run(['javac', '--release', '11', '-d', str(root), str(POLICY), str(source)], check=True)
            self.assertIn('PASS role transition', subprocess.check_output(
                ['java', '-cp', str(root), 'com.android.role.controller.service.UpgradeTest'], text=True))


if __name__ == '__main__':
    unittest.main(verbosity=2)
