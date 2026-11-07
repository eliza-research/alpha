import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture,jsonJar,nativeSource,root,runJvm} from './fixtures/jvm-tools.mjs';

function method(source,signature){
 const start=source.indexOf(signature);assert.ok(start>=0,signature);
 for(let i=source.indexOf('{',start),depth=0;i<source.length;i++){
  if(source[i]==='{')depth++;
  if(source[i]==='}'&&--depth===0)return source.slice(start,i+1);
 }
 throw Error('Unclosed production method '+signature);
}

test('real Gmail withdrawal and a lifecycle-first vault writer finish under forced contention',()=>{
 assert.ok(jsonJar,'Pinned JVM JSON dependency required');
 const directory=mkdtempSync(join(tmpdir(),'gmail-vault-contention-'));
 const file=(name,source)=>{const path=join(directory,name);writeFileSync(path,source);return path;};
 const native=name=>readFileSync(nativeSource(name),'utf8');
 const agent=native('AlphaLocalAgentPlugin.java'),store=native('AlphaCredentialStore.java');
 const start=store.indexOf('  if(!"cloud:production".equals(name)');
 const end=store.indexOf('  return AlphaLocalAgentPlugin.mutateCredentials(',start);
 assert.ok(start>=0&&end>start,'the exact noncritical slot branch is present');
 const vault=readFileSync(join(root,'vendor/eliza/plugins/plugin-native-secure-store/android/src/main/java/ai/eliza/plugins/securestore/nativeonly/JsonCredentialSlots.java'),'utf8');
 const key=method(vault,' private SecretKey key()');
 const shared=join(root,'vendor/eliza/plugins/plugin-native-notifications/android/src/main/java/ai/eliza/plugins/notifications');
 try{
  const sources=[
   nativeSource('GmailBackground.java'),nativeSource('CloudDeployment.java'),
   join(shared,'MailBackgroundDelivery.java'),join(shared,'MailHistoryReconciliation.java'),
   fixture('secure-store-memory/android/util/AtomicFile.java'),fixture('GmailBackgroundLockContentionTest.java'),
   // Host substitutions are limited to Android keystore, context, notification and scheduling APIs.
   file('JsonCredentialSlots.java',vault.replace(key,' private SecretKey key(){return new javax.crypto.spec.SecretKeySpec(new byte[32],"AES");}')
    .replace('import android.security.keystore.KeyGenParameterSpec;','').replace('import android.security.keystore.KeyProperties;','')),
   file('Context.java',`package android.content;
import java.io.File;
public final class Context {
 private final File directory;
 public Context(File directory){this.directory=directory;}
 public Context getApplicationContext(){return this;}
 public File getNoBackupFilesDir(){return directory;}
}`),
   file('MailNoticePoster.java',`package ai.eliza.plugins.notifications;
import android.content.Context;
public final class MailNoticePoster implements MailBackgroundDelivery.Notices {
 public static int cancellations;
 public static final class Config {
  public Config(String channel,String name,String description,String action,String tag,String question,String prefix,int icon,
                String title,String text,String fallback,String fallbackText,String ask,Class<?> activity){}
 }
 public MailNoticePoster(Context context,Config config){}
 public boolean allowed(){return false;}
 public boolean active(String key){return false;}
 public void post(String key){throw new AssertionError("Unexpected notice");}
 public void cancel(String key){throw new AssertionError("Unexpected notice");}
 public void cancelAll(){cancellations++;}
}`),
   file('ProductPorts.java',`package ai.elizaresearch.alphaphone;
import android.content.Context;
import ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots;
import java.io.File;
import org.json.JSONObject;
final class AlphaLocalAgentPlugin {
 static final Object lifecycleLock=new Object();
 ${agent.includes('static Object credentialLifecycleLock(')?method(agent,'static Object credentialLifecycleLock('):''}
 ${method(agent,'static <T> T withCredentialSlotMutation(')}
}
final class AlphaCredentialStore {
 interface CloudChangeObserver {void changed()throws Exception;}
 static void observeCloudChanges(CloudChangeObserver observer){}
 static final class StorageFullException extends Exception {}
 final Runnable assertOwner=()->{};
 final JsonCredentialSlots slots;
 AlphaCredentialStore(Context context){
  slots=new JsonCredentialSlots(new File(context.getNoBackupFilesDir(),"connection-credentials"),"fixture",name->2*1024*1024);
 }
 ${method(store,' String readCredentialSlot(')}
 void writeCredentialSlot(String name,String value){throw new AssertionError("Unexpected Gmail state write");}
 ${method(store,' void removeCredentialSlot(')}
 ${method(store,' private boolean mutateSlot(')}
 private boolean mutateSlotOnce(String name,String expected,String value,boolean compare)throws Exception{
 ${store.slice(start,end)}
  throw new AssertionError("Unexpected critical credential mutation");
 }
}
final class LocalAgentProviderAdmission {
 static final String PROVIDER_SLOT="local-agent-provider:v1";
 static JSONObject verifiedCloudIdentity(JSONObject value){throw new AssertionError("Unexpected network identity read");}
}
final class AlphaDataReset {
 static final AlphaDataReset RESET=new AlphaDataReset();
 boolean pending(Context context){return false;}
}
final class GmailDeliveryWorker {
 static int cancellations;
 static void schedule(Context context,String generation){throw new AssertionError("Unexpected background scheduling");}
 static void cancel(Context context){cancellations++;}
}
final class R {static final class drawable {static final int notification_icon=1;}}
final class MainActivity {}
`),
  ];
  assert.match(runJvm(sources,'ai.elizaresearch.alphaphone.GmailBackgroundLockContentionTest',{json:true,args:[directory]}),
   /^PASS actual Gmail withdrawal and lifecycle-first vault write/);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
