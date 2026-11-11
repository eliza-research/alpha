import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
export function listenerStorePlatform(){
 const directory=mkdtempSync(join(tmpdir(),'quint-listener-store-'));
 const files={
  'android/annotation/SuppressLint.java':'package android.annotation;public @interface SuppressLint {String[] value();}',
  'android/content/SharedPreferences.java':`package android.content;public interface SharedPreferences {
   int getInt(String key,int fallback);long getLong(String key,long fallback);boolean getBoolean(String key,boolean fallback);String getString(String key,String fallback);Editor edit();
   interface Editor {Editor putInt(String key,int value);Editor putLong(String key,long value);Editor putBoolean(String key,boolean value);Editor putString(String key,String value);Editor remove(String key);Editor clear();boolean commit();}
  }`,
  'android/content/Context.java':`package android.content;public class Context {
   public static final int MODE_PRIVATE=0;public Context createDeviceProtectedStorageContext(){return this;}
   public SharedPreferences getSharedPreferences(String name,int mode){return ai.eliza.sense.StorePorts.preferences;}
   public boolean stopService(Intent intent){if(intent.component==null||!intent.component.packageName().equals(getPackageName())||!intent.component.className().equals(getPackageName()+".ListeningService"))throw new AssertionError("Wrong listener stop component");ai.eliza.sense.StorePorts.stops++;return true;}
   public Object getContentResolver(){return this;}public String getPackageName(){return "ai.elizaresearch.alphaphone.sense";}
   public android.content.pm.PackageManager getPackageManager(){return new android.content.pm.PackageManager();}
  }`,
  'android/content/Intent.java':'package android.content;public class Intent {public ComponentName component;public Intent(){}public Intent setComponent(ComponentName component){this.component=component;return this;}}',
  'android/content/ComponentName.java':'package android.content;public record ComponentName(String packageName,String className){}',
  'android/content/pm/PackageManager.java':`package android.content.pm;public class PackageManager {
   public static class NameNotFoundException extends Exception {} public static class PackageInfo {public long lastUpdateTime;}
   public PackageInfo getPackageInfo(String name,int flags)throws NameNotFoundException {PackageInfo info=new PackageInfo();info.lastUpdateTime=ai.eliza.sense.StorePorts.install;return info;}
  }`,
  'android/provider/Settings.java':'package android.provider;public class Settings {public static class Global {public static final String BOOT_COUNT="boot";public static int getInt(Object resolver,String key,int fallback){return ai.eliza.sense.StorePorts.boot;}}}',
  'ai/eliza/sense/BuildConfig.java':'package ai.eliza.sense;public class BuildConfig {public static final String SENSE_STORAGE_NAME="listener-settings";}',
  'ai/eliza/sense/ListeningService.java':'package ai.eliza.sense;public class ListeningService {}',
  'ai/eliza/sense/SenseConfig.java':'package ai.eliza.sense;public class SenseConfig {static android.content.ComponentName component(android.content.Context context,String name){if(!name.equals("ListeningService"))throw new AssertionError("Unexpected listener stop target");return new android.content.ComponentName(context.getPackageName(),context.getPackageName()+"."+name);}}',
  'ai/eliza/sense/Listener.java':'package ai.eliza.sense;public class Listener {static final ListeningEpoch epoch=new ListeningEpoch();static boolean speechUnavailable,indicatorLost;}',
 };
 for(const [name,text]of Object.entries(files)){const path=join(directory,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,text);}
 return {directory,paths:Object.keys(files).map(name=>join(directory,name)),close:()=>rmSync(directory,{recursive:true,force:true})};
}
