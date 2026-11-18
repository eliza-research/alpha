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

# Android boundary doubles shared by the pinned-controller and the hermetic controller tests.
ANDROID_DOUBLES = {
    'android/annotation/UserIdInt.java': 'package android.annotation; public @interface UserIdInt {}',
    'androidx/annotation/NonNull.java': 'package androidx.annotation; public @interface NonNull {}',
    'androidx/annotation/WorkerThread.java': 'package androidx.annotation; public @interface WorkerThread {}',
    'android/os/Process.java': 'package android.os; public class Process { public static UserHandle myUserHandle(){return UserHandle.SYSTEM;} }',
    'android/os/UserHandle.java': 'package android.os; public class UserHandle { public static final UserHandle SYSTEM=new UserHandle(0); private final int id; public UserHandle(int id){this.id=id;} public int getIdentifier(){return id;} }',
    'android/os/UserManager.java': 'package android.os; public class UserManager { public boolean managed; public boolean isManagedProfile(){return managed;} }',
    'android/app/admin/DevicePolicyManager.java': 'package android.app.admin; public class DevicePolicyManager { public Object owner; public Object getDeviceOwnerComponentOnAnyUser(){return owner;} }',
    'android/util/ArrayMap.java': 'package android.util; public class ArrayMap<K,V> extends java.util.LinkedHashMap<K,V>{public V valueAt(int i){return new java.util.ArrayList<>(values()).get(i);} }',
    'android/util/ArraySet.java': 'package android.util; public class ArraySet<T> extends java.util.HashSet<T>{ public T valueAt(int i){return new java.util.ArrayList<>(this).get(i);} }',
    'android/util/Log.java': 'package android.util; public class Log { public static int i(String a,String b){return 0;} public static int e(String a,String b){return 0;} public static int e(String a,String b,Throwable t){return 0;} public static int w(String a,String b){return 0;} }',
    'android/content/ApexEnvironment.java': '''package android.content; import java.io.*;
     public class ApexEnvironment {
      public static File directory;
      public static ApexEnvironment getApexEnvironment(String module){if(!module.equals("com.android.permission"))throw new AssertionError(module);return new ApexEnvironment();}
      public File getDeviceProtectedDataDirForUser(android.os.UserHandle user){if(user!=android.os.UserHandle.SYSTEM)throw new AssertionError();return directory;}
     }
    ''',
    'android/util/AtomicFile.java': '''package android.util; import java.io.*; import java.nio.file.*;
     public class AtomicFile {
      public static boolean denyWrites, denyReads; private final File file, pending;
      public AtomicFile(File path){file=path;pending=new File(path+".new");}
      public File getBaseFile(){return file;}
      public byte[] readFully()throws IOException{if(denyReads)throw new FileNotFoundException("read denied");try(FileInputStream in=new FileInputStream(file)){return in.readAllBytes();}}
      public FileOutputStream startWrite()throws IOException{if(denyWrites)throw new IOException("write denied");return new FileOutputStream(pending);}
      public void finishWrite(FileOutputStream out){try{out.close();Files.move(pending.toPath(),file.toPath(),StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);}catch(IOException e){throw new UncheckedIOException(e);}}
      public void failWrite(FileOutputStream out){try{out.close();Files.deleteIfExists(pending.toPath());}catch(IOException e){throw new UncheckedIOException(e);}}
     }
    ''',
    'android/content/Context.java': '''package android.content; public class Context {
     public android.app.role.RoleManager roles=new android.app.role.RoleManager();
     public android.os.UserManager users=new android.os.UserManager();
     public android.app.admin.DevicePolicyManager policy=new android.app.admin.DevicePolicyManager();
     public android.content.pm.PackageManager packages=new android.content.pm.PackageManager();
     public int complete=1; public String packageName="android";
     public <T>T getSystemService(Class<T> c){if(c==android.app.role.RoleManager.class)return c.cast(roles);if(c==android.os.UserManager.class)return c.cast(users);return c.cast(policy);}
     public String getPackageName(){return packageName;}
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
}

# A synthetic RoleControllerServiceImpl with exactly the anchors and request shape that
# project_role_controller patches. It lets CI compile the projected controller, the real policy and
# the real Android adapter together and drive owner requests through the injected hook. It is not
# the pinned AOSP source: test_complete_patched_controller_and_android_adapter covers that locally.
SYNTHETIC_CONTROLLER = '''package com.android.role.controller.service;

import android.app.role.RoleControllerService;
import android.app.role.RoleManager;
import android.content.Context;
import android.os.UserHandle;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.annotation.WorkerThread;
import com.android.role.controller.model.Roles;
import java.util.ArrayList;
import java.util.List;

public class RoleControllerServiceImpl extends RoleControllerService {
    private static final String LOG_TAG = "RoleControllerServiceImpl";
    private UserHandle mUser;
    private Context mContext;
    private RoleManager mUserRoleManager;

    public RoleControllerServiceImpl(UserHandle user, Context context) {
        mUser = user;
        mContext = context;
        mUserRoleManager = context.getSystemService(RoleManager.class);
    }

    @Override
    @WorkerThread
    public boolean onGrantDefaultRoles() {
        List<String> roleNames = new ArrayList<>(Roles.get(mContext).keySet());
        mUserRoleManager.setRoleNamesFromController(roleNames);
        return true;
    }

    @Override
    @WorkerThread
    public boolean onAddRoleHolder(@NonNull String roleName, @NonNull String packageName, int flags) {
        boolean dontKillApp = hasFlag(flags, RoleManager.MANAGE_HOLDERS_FLAG_DONT_KILL_APP);
        boolean added = false;
        for (String holder : mUserRoleManager.getRoleHolders(roleName)) {
            mUserRoleManager.removeRoleHolderFromController(roleName, holder);
        }
        added = mUserRoleManager.addRoleHolderFromController(roleName, packageName);
        return added;
    }

    @Override
    @WorkerThread
    public boolean onRemoveRoleHolder(@NonNull String roleName, @NonNull String packageName, int flags) {
        boolean dontKillApp = hasFlag(flags, RoleManager.MANAGE_HOLDERS_FLAG_DONT_KILL_APP);
        return mUserRoleManager.removeRoleHolderFromController(roleName, packageName);
    }

    @Override
    @WorkerThread
    public boolean onClearRoleHolders(@NonNull String roleName, int flags) {
        boolean dontKillApp = hasFlag(flags, RoleManager.MANAGE_HOLDERS_FLAG_DONT_KILL_APP);
        for (String holder : mUserRoleManager.getRoleHolders(roleName)) {
            mUserRoleManager.removeRoleHolderFromController(roleName, holder);
        }
        return true;
    }

    @Override public boolean onIsApplicationQualifiedForRole(String roleName, String packageName) { return true; }
    @Override public boolean onIsApplicationVisibleForRole(String roleName, String packageName) { return true; }
    @Override public boolean onIsRoleVisible(String roleName) { return true; }
    @Override public List<String> onGetLegacyFallbackDisabledRoles() { return List.of(); }

    private static boolean hasFlag(int flags, int flag) { return (flags & flag) == flag; }
}
'''

# Owner requests that only the injected keepAlphaOwnerChoice hook can protect: each one happens while
# the role's migration is still unfinished ("" or "pending"), so without the hook the next
# default-role pass would move the role to the Alpha package over the owner's explicit choice.
OWNER_CHOICE_TEST = '''package com.android.role.controller.service;
import android.content.ApexEnvironment;import android.content.Context;import android.content.pm.ApplicationInfo;import android.os.UserHandle;import android.util.AtomicFile;import java.io.*;import java.nio.file.*;import java.util.*;
public class OwnerChoiceTest {
 static final String HOME=AlphaRoleUpgrade.ROLES.get(0),DIALER=AlphaRoleUpgrade.ROLES.get(1),SMS=AlphaRoleUpgrade.ROLES.get(2),A=AlphaRoleUpgrade.ALPHA,L=AlphaRoleUpgrade.PREVIOUS;
 static void check(boolean b,String what){if(!b)throw new AssertionError(what);}
 static Context context()throws IOException{AtomicFile.denyWrites=false;AtomicFile.denyReads=false;ApexEnvironment.directory=Files.createTempDirectory(Path.of("."),"permission-data").toFile();Context c=new Context();for(String r:AlphaRoleUpgrade.ROLES)c.roles.holders.put(r,new ArrayList<>(List.of(L)));return c;}
 static RoleControllerServiceImpl failedDialer(Context c){
  c.roles.failAdd=DIALER;RoleControllerServiceImpl p=new RoleControllerServiceImpl(UserHandle.SYSTEM,c);
  check(p.onGrantDefaultRoles(),"default pass continues after a failed grant");
  check(c.roles.getRoleHolders(DIALER).equals(List.of(L)),"failed grant restores the previous holder");
  check(AlphaRoleUpgrade.PENDING.equals(new AlphaRoleUpgradeAndroid(c,UserHandle.SYSTEM,c.roles,p).state(DIALER)),"failed grant leaves the migration pending");
  return p;
 }
 public static void main(String[] args)throws IOException{
  // Pending after a failed grant, the owner explicitly re-selects the previous package.
  Context add=context();RoleControllerServiceImpl p=failedDialer(add);
  check(p.onAddRoleHolder(DIALER,L,0),"owner add accepted");check(AlphaRoleUpgrade.DONE.equals(new AlphaRoleUpgradeAndroid(add,UserHandle.SYSTEM,add.roles,p).state(DIALER)),"owner add retires the migration");
  p=new RoleControllerServiceImpl(UserHandle.SYSTEM,add);check(p.onGrantDefaultRoles(),"next default pass");check(add.roles.getRoleHolders(DIALER).equals(List.of(L)),"owner add survives the next default pass");
  check(add.roles.getRoleHolders(HOME).equals(List.of(A))&&add.roles.getRoleHolders(SMS).equals(List.of(A)),"other roles still migrate");
  // Pending after a failed grant, the owner clears the role: an empty pending role must not be recovered.
  Context clear=context();p=failedDialer(clear);
  check(p.onClearRoleHolders(DIALER,0),"owner clear accepted");check(p.onGrantDefaultRoles(),"next default pass");
  check(clear.roles.getRoleHolders(DIALER).isEmpty(),"owner clear survives the next default pass");
  // The same for an explicit removal of the previous holder.
  Context remove=context();p=failedDialer(remove);
  check(p.onRemoveRoleHolder(DIALER,L,0),"owner remove accepted");check(p.onGrantDefaultRoles(),"next default pass");
  check(remove.roles.getRoleHolders(DIALER).isEmpty(),"owner remove survives the next default pass");
  // While the Alpha package is suspended the migration is ineligible; the owner's choice made then
  // must still hold once the package is unsuspended.
  Context suspended=context();suspended.packages.app.flags|=ApplicationInfo.FLAG_SUSPENDED;p=new RoleControllerServiceImpl(UserHandle.SYSTEM,suspended);
  check(p.onGrantDefaultRoles(),"ineligible default pass");check(suspended.roles.adds==0,"ineligible pass changes nothing");
  check(p.onAddRoleHolder(HOME,L,0),"owner add while ineligible accepted");
  suspended.packages.app.flags&=~ApplicationInfo.FLAG_SUSPENDED;check(p.onGrantDefaultRoles(),"eligible default pass");
  check(suspended.roles.getRoleHolders(HOME).equals(List.of(L)),"choice made while ineligible survives eligibility returning");
  check(suspended.roles.getRoleHolders(DIALER).equals(List.of(A)),"unchosen roles migrate once eligible");
  // An eligible device refuses the request when it cannot record the choice, and changes nothing.
  Context unwritable=failedContextAfterFailure();p=new RoleControllerServiceImpl(UserHandle.SYSTEM,unwritable);AtomicFile.denyWrites=true;
  check(!p.onAddRoleHolder(DIALER,"owner.dialer",0),"unrecorded owner choice refused");check(unwritable.roles.getRoleHolders(DIALER).equals(List.of(L)),"refused request changes nothing");
  // An unreadable marker refuses the eligible owner request instead of throwing on the role worker.
  Context unreadable=failedContextAfterFailure();p=new RoleControllerServiceImpl(UserHandle.SYSTEM,unreadable);AtomicFile.denyReads=true;
  check(!p.onAddRoleHolder(DIALER,"owner.dialer",0),"unreadable owner choice refused");check(unreadable.roles.getRoleHolders(DIALER).equals(List.of(L)),"unreadable refusal changes nothing");
  AtomicFile.denyReads=false;
  // An ineligible device never refuses an owner request over the marker.
  Context ineligibleUnwritable=context();ineligibleUnwritable.complete=0;AtomicFile.denyWrites=true;p=new RoleControllerServiceImpl(UserHandle.SYSTEM,ineligibleUnwritable);
  check(p.onAddRoleHolder(SMS,"owner.sms",0)&&ineligibleUnwritable.roles.getRoleHolders(SMS).equals(List.of("owner.sms")),"ineligible owner request proceeds");
  Context remote=context();remote.packageName="com.android.permissioncontroller";AtomicFile.denyWrites=true;p=new RoleControllerServiceImpl(UserHandle.SYSTEM,remote);
  check(p.onGrantDefaultRoles()&&remote.roles.removes==0,"remote controller never migrates roles");
  check(p.onAddRoleHolder(SMS,"owner.sms",0)&&remote.roles.getRoleHolders(SMS).equals(List.of("owner.sms")),"remote owner request does not depend on marker access");
  System.out.println("PASS owner requests retire unfinished migrations");
 }
 static Context failedContextAfterFailure()throws IOException{Context c=context();failedDialer(c);c.roles.failAdd=null;return c;}
}
'''


def compile_and_run(files, main):
    with tempfile.TemporaryDirectory(prefix='alpha-controller-') as temporary:
        root = Path(temporary)
        for name, content in files.items():
            file = root / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text(content)
        sources = [str(file) for file in root.rglob('*.java')]
        subprocess.run(['javac', '--release', '11', '-d', str(root), *sources], check=True)
        return subprocess.check_output(['java', '-cp', str(root), main], cwd=root, text=True)


class RoleUpgrade(unittest.TestCase):
    def test_android_adapter_uses_only_system_device_owner_api(self):
        # role-controller builds against system_current, where getDeviceOwnerComponentOnCallingUser is @hide.
        source = (ROOT / 'android/aosp/branding/provision/AlphaRoleUpgradeAndroid.java').read_text()
        self.assertNotIn('getDeviceOwnerComponentOnCallingUser', source)
        self.assertIn('getDeviceOwnerComponentOnAnyUser', source)

    def test_role_upgrade_never_aborts_the_default_role_pass(self):
        stage = (ROOT / 'scripts/stage-alpha-os-branding.py').read_text()
        injected = stage[stage.index('mAlphaRoleUpgradeRunning = true;'):stage.index('mAlphaRoleUpgradeRunning = false;')]
        self.assertNotIn('return false', injected)
        self.assertIn('catch (RuntimeException e)', injected)

    @unittest.skipUnless(CONTROLLER.is_file(), 'Pinned Android role controller input required')
    def test_complete_patched_controller_and_android_adapter(self):
        raw = CONTROLLER.read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(), 'a29db10b18799b3231954b4350b417acd3e6d1c9ac1e83477cae25aa1635ce14')
        files = {
            **ANDROID_DOUBLES,
            'com/android/role/controller/service/RoleControllerServiceImpl.java': STAGE.project_role_controller(raw.decode()),
            'com/android/role/controller/service/AlphaRoleUpgrade.java': POLICY.read_text(),
            'com/android/role/controller/service/AlphaRoleUpgradeAndroid.java': POLICY.with_name('AlphaRoleUpgradeAndroid.java').read_text(),
            'com/android/role/controller/service/ControllerTest.java': '''package com.android.role.controller.service;
             import android.content.ApexEnvironment;import android.content.Context;import android.os.UserHandle;import android.util.AtomicFile;import java.io.*;import java.nio.file.*;import java.util.*;
             public class ControllerTest {
              static void check(boolean b){if(!b)throw new AssertionError();}
              static Context context()throws IOException{AtomicFile.denyWrites=false;AtomicFile.denyReads=false;ApexEnvironment.directory=Files.createTempDirectory(Path.of("."),"permission-data").toFile();Context c=new Context();for(String r:AlphaRoleUpgrade.ROLES)c.roles.holders.put(r,new ArrayList<>(List.of(AlphaRoleUpgrade.PREVIOUS)));return c;}
              public static void main(String[]args)throws IOException{
               Context c=context();RoleControllerServiceImpl p=new RoleControllerServiceImpl(UserHandle.SYSTEM,c);
               check(p.onGrantDefaultRoles());for(String r:AlphaRoleUpgrade.ROLES)check(c.roles.getRoleHolders(r).equals(List.of(AlphaRoleUpgrade.ALPHA)));
               check(p.onAddRoleHolder(AlphaRoleUpgrade.ROLES.get(0),AlphaRoleUpgrade.PREVIOUS,0));check(p.onGrantDefaultRoles());check(c.roles.getRoleHolders(AlphaRoleUpgrade.ROLES.get(0)).equals(List.of(AlphaRoleUpgrade.PREVIOUS)));
               Context failure=context();failure.roles.failAdd=AlphaRoleUpgrade.ROLES.get(1);p=new RoleControllerServiceImpl(UserHandle.SYSTEM,failure);check(p.onGrantDefaultRoles());check(failure.roles.getRoleHolders(AlphaRoleUpgrade.ROLES.get(1)).equals(List.of(AlphaRoleUpgrade.PREVIOUS)));check(p.onGrantDefaultRoles());
               Context owner=context();p=new RoleControllerServiceImpl(UserHandle.SYSTEM,owner);check(p.onAddRoleHolder(AlphaRoleUpgrade.ROLES.get(2),"owner.sms",0));check(p.onGrantDefaultRoles());check(owner.roles.getRoleHolders(AlphaRoleUpgrade.ROLES.get(2)).equals(List.of("owner.sms")));
               Context fresh=context();fresh.complete=0;p=new RoleControllerServiceImpl(UserHandle.SYSTEM,fresh);check(p.onGrantDefaultRoles());check(fresh.roles.removes==0);
               Context data=context();data.packages.app.flags=0;p=new RoleControllerServiceImpl(UserHandle.SYSTEM,data);check(p.onGrantDefaultRoles());check(data.roles.removes==0);
               Context managed=context();managed.policy.owner=new Object();p=new RoleControllerServiceImpl(UserHandle.SYSTEM,managed);check(p.onGrantDefaultRoles());check(managed.roles.removes==0);
               Context profile=context();p=new RoleControllerServiceImpl(new UserHandle(10),profile);check(p.onGrantDefaultRoles());check(profile.roles.removes==0);
               System.out.println("PASS complete controller role upgrade, normal owner changes, partial recovery and scope refusals");
              }
             }''',
        }
        self.assertIn('PASS complete controller', compile_and_run(files, 'com.android.role.controller.service.ControllerTest'))

    def test_projected_owner_hook_retires_unfinished_migrations(self):
        # Hermetic, so it runs in CI: the real projection, policy and adapter over a synthetic controller.
        projected = STAGE.project_role_controller(SYNTHETIC_CONTROLLER)
        self.assertEqual(projected.count('if (!keepAlphaOwnerChoice(roleName)) return false;'), 3)
        files = {
            **ANDROID_DOUBLES,
            'com/android/role/controller/service/RoleControllerServiceImpl.java': projected,
            'com/android/role/controller/service/AlphaRoleUpgrade.java': POLICY.read_text(),
            'com/android/role/controller/service/AlphaRoleUpgradeAndroid.java': POLICY.with_name('AlphaRoleUpgradeAndroid.java').read_text(),
            'com/android/role/controller/service/OwnerChoiceTest.java': OWNER_CHOICE_TEST,
        }
        self.assertIn('PASS owner requests retire unfinished migrations',
                      compile_and_run(files, 'com.android.role.controller.service.OwnerChoiceTest'))

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
