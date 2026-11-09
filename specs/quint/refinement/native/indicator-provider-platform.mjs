import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';

/** Android caller identity, binder and provider primitives for the actual lease endpoint. */
export function indicatorProviderPlatform(){
 const directory=mkdtempSync(join(tmpdir(),'quint-indicator-provider-'));
 const files={
  'android/content/Context.java':`package android.content;public class Context {
   public int checkCallingPermission(String permission){return ai.eliza.sense.ProviderPorts.authorized?0:-1;}
   public android.content.pm.PackageManager getPackageManager(){return new android.content.pm.PackageManager();}
  }`,
  'android/content/pm/PackageManager.java':`package android.content.pm;public class PackageManager {
   public static final int PERMISSION_GRANTED=0,SIGNATURE_MATCH=0;
   public String[] getPackagesForUid(int uid){return ai.eliza.sense.ProviderPorts.owners;}
   public int checkSignatures(String first,String second){return ai.eliza.sense.ProviderPorts.signed?0:-1;}
  }`,
  'android/content/ContentProvider.java':`package android.content;public abstract class ContentProvider {
   public Context getContext(){return ai.eliza.sense.ProviderPorts.context;}
   public abstract boolean onCreate();public abstract android.os.Bundle call(String method,String arg,android.os.Bundle extras);
   public abstract android.database.Cursor query(android.net.Uri uri,String[] projection,String selection,String[] args,String order);
   public abstract String getType(android.net.Uri uri);public abstract android.net.Uri insert(android.net.Uri uri,ContentValues values);
   public abstract int delete(android.net.Uri uri,String selection,String[] args);public abstract int update(android.net.Uri uri,ContentValues values,String selection,String[] args);
  }`,
  'android/content/ContentValues.java':'package android.content;public class ContentValues {}',
  'android/database/Cursor.java':'package android.database;public interface Cursor {}',
  'android/net/Uri.java':'package android.net;public class Uri {}',
  'android/os/RemoteException.java':'package android.os;public class RemoteException extends Exception {}',
  'android/os/IBinder.java':`package android.os;public interface IBinder {
   interface DeathRecipient {void binderDied();}
   void linkToDeath(DeathRecipient callback,int flags)throws RemoteException;
   boolean unlinkToDeath(DeathRecipient callback,int flags);
  }`,
  'android/os/Binder.java':`package android.os;public class Binder {
   public static int getCallingUid(){return ai.eliza.sense.ProviderPorts.uid;}
   public static long clearCallingIdentity(){ai.eliza.sense.ProviderPorts.identities.incrementAndGet();return 1;}
   public static void restoreCallingIdentity(long identity){ai.eliza.sense.ProviderPorts.identities.decrementAndGet();}
  }`,
  'android/os/SystemClock.java':'package android.os;public class SystemClock {public static long elapsedRealtime(){return ai.eliza.sense.ProviderPorts.now;}}',
  'android/os/Bundle.java':`package android.os;public class Bundle {
   private final java.util.Map<String,Object> values=new java.util.HashMap<>();
   public void putBinder(String key,IBinder value){values.put(key,value);}public IBinder getBinder(String key){return (IBinder)values.get(key);}
   public void putLong(String key,long value){values.put(key,value);}public long getLong(String key,long fallback){return values.containsKey(key)?(Long)values.get(key):fallback;}
   public void putBoolean(String key,boolean value){values.put(key,value);}public boolean getBoolean(String key,boolean fallback){return values.containsKey(key)?(Boolean)values.get(key):fallback;}
   public void putString(String key,String value){values.put(key,value);}public String getString(String key){return (String)values.get(key);}
  }`,
  'ai/eliza/sense/Listener.java':`package ai.eliza.sense;final class Listener {
   static final IndicatorLease lease=new IndicatorLease();static boolean screenInteractive=true,microphoneHeld;
   static long leaseBoot(android.content.Context context){return ProviderPorts.boot;}
   static boolean observeIndicatorLease(android.content.Context context,long now){return lease.verdict(now,ProviderPorts.boot,false,screenInteractive)==IndicatorLease.Loss.NONE;}
   static void refresh(android.content.Context context){ProviderPorts.refreshes.incrementAndGet();}
  }`,
 };
 for(const [name,source] of Object.entries(files)){const path=join(directory,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,source);}
 return {directory,paths:Object.keys(files).map(name=>join(directory,name)),close:()=>rmSync(directory,{recursive:true,force:true})};
}
