package android.provider;
public final class Settings {
 public static final String ACTION_MANAGE_UNKNOWN_APP_SOURCES="android.settings.MANAGE_UNKNOWN_APP_SOURCES";
 public static class SettingNotFoundException extends Exception {SettingNotFoundException(String name){super(name);}}
 public static final class Global {
  public static final String BOOT_COUNT="boot_count";
  /** Android's count of system_server starts, negative where Android has none. */
  public static volatile int bootCount=1;
  public static int getInt(android.content.ContentResolver resolver,String name)throws SettingNotFoundException{if(bootCount<0)throw new SettingNotFoundException(name);return bootCount;}
 }
}
