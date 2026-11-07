package android.content;
/** One process: every bridge's receiver hears every broadcast. */
public class Context {
 public final java.io.File cache;
 public final android.content.pm.PackageManager packages=new android.content.pm.PackageManager();
 public final java.util.List<BroadcastReceiver> receivers=new java.util.ArrayList<>();
 public Context(java.io.File cache){this.cache=cache;}
 public java.io.File getCacheDir(){return cache;}
 public android.content.pm.PackageManager getPackageManager(){return packages;}
 public String getPackageName(){return "ai.elizaresearch.alphaphone";}
 public ContentResolver getContentResolver(){return new ContentResolver();}
 public void unregisterReceiver(BroadcastReceiver receiver){receivers.remove(receiver);}
 public void broadcast(Intent intent){for(BroadcastReceiver receiver:receivers)receiver.onReceive(this,intent);}
}
