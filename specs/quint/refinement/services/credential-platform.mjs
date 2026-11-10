import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';

/** Primitive platform ports for executing the real credential store on a host JVM. */
export function credentialPlatform() {
  const root = mkdtempSync(join(tmpdir(), 'quint-credential-platform-'));
  const files = {
    'android/content/Context.java': `package android.content;
import java.io.File;
public class Context {
 public Context getApplicationContext(){return this;}
 public File getNoBackupFilesDir(){return new File("unused-fixture-directory");}
}`,
    'android/util/AtomicFile.java': `package android.util;
public class AtomicFile {}`,
    'ai/eliza/plugins/securestore/nativeonly/JsonCredentialSlots.java': `package ai.eliza.plugins.securestore.nativeonly;
import java.io.File;
import java.util.HashMap;
import java.util.Map;
import java.util.function.ToIntFunction;
import android.util.AtomicFile;
public class JsonCredentialSlots {
 public static final Object LOCK=new Object();
 public static final Map<String,String> VALUES=new HashMap<>();
 public static class CapacityException extends Exception {}
 public JsonCredentialSlots(File file,String alias,ToIntFunction<String> cap){}
 public JsonCredentialSlots(File file,String alias,ToIntFunction<String> cap,ToIntFunction<String> retained){}
 public String read(String key){return VALUES.get(key);}
 public void write(String key,String value)throws CapacityException{VALUES.put(key,value);}
 public void remove(String key){VALUES.remove(key);}
 public String slotHash(String name){return name;}
 public AtomicFile slotFile(String hash){return new AtomicFile();}
}`,
    'ai/alphacompute/alphaphone/AlphaLocalAgentPlugin.java': `package ai.alphacompute.alphaphone;
import android.content.Context;
public class AlphaLocalAgentPlugin {
 public interface CredentialMutation<T>{boolean requiresShutdown()throws Exception;T commit()throws Exception;}
 public static boolean requested;
 public static Runnable beforeCommit=()->{};
 public static <T>T mutateCredentials(Context context,Runnable owner,CredentialMutation<T> mutation)throws Exception {
  owner.run();requested=mutation.requiresShutdown();beforeCommit.run();owner.run();return mutation.commit();
 }
 public static boolean providerAdmissionReadable(){return true;}
 public static long authority, intent;
 public static void powerAuthorizationChanged(){authority++;}
 public static long credentialAuthorityEpoch(){return authority;}
 public static long currentCredentialIntent(){return intent;}
 public static long reserveCredentialIntent(){return ++intent;}
 public static void requireCredentialIntent(long expected){if(expected!=intent)throw new IllegalStateException("retired intent");}
 public static <T>T withCredentialAuthority(long expected,java.util.concurrent.Callable<T> action)throws Exception {if(expected!=authority)throw new IllegalStateException("retired authority");return action.call();}
 public static <T>T withCredentialSlotMutation(Runnable owner,java.util.concurrent.Callable<T> mutation)throws Exception {owner.run();return mutation.call();}
}`,
    'ai/alphacompute/alphaphone/AlphaConnectionPlugin.java': `package ai.alphacompute.alphaphone;
public class AlphaConnectionPlugin {public static void readCloudIdentity(String token){}}`,
  };
  const paths = [];
  for (const [name, source] of Object.entries(files)) { const path = join(root, name); mkdirSync(dirname(path), {recursive: true}); writeFileSync(path, source); paths.push(path); }
  return {paths, close: () => rmSync(root, {recursive: true, force: true})};
}
