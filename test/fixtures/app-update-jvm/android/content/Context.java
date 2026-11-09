package android.content;
/** One process: every bridge's receiver hears every broadcast. */
public class Context {
 public final java.io.File cache;
 public final android.content.pm.PackageManager packages=new android.content.pm.PackageManager();
 public final java.util.List<BroadcastReceiver> receivers=new java.util.ArrayList<>();
 public final java.io.File data;
 public Context(java.io.File cache){this.cache=cache;try{data=java.nio.file.Files.createTempDirectory("alpha-update-native-").toFile();java.nio.file.Files.write(new java.io.File(data,"base.apk").toPath(),new byte[]{1,2,3});}catch(Exception failure){throw new RuntimeException(failure);}}
 public boolean applicationPublished=true;
 public Context getApplicationContext(){return applicationPublished?this:null;}
 public java.io.File getNoBackupFilesDir(){return data;}
 public android.content.pm.ApplicationInfo getApplicationInfo(){android.content.pm.ApplicationInfo info=new android.content.pm.ApplicationInfo();info.sourceDir=new java.io.File(data,"base.apk").getPath();return info;}
 public java.io.File getCacheDir(){return cache;}
 public android.content.pm.PackageManager getPackageManager(){return packages;}
 public String getPackageName(){return "ai.alphacompute.alphaphone";}
 public ContentResolver getContentResolver(){return new ContentResolver();}
 public void unregisterReceiver(BroadcastReceiver receiver){receivers.remove(receiver);}
 public void broadcast(Intent intent){for(BroadcastReceiver receiver:receivers)receiver.onReceive(this,intent);}
}
