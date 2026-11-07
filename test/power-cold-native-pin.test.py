"""Execute the actual native-only Power pin policy, with slot/Android inputs modeled. No secrets/device."""
from pathlib import Path
import subprocess,tempfile,unittest
ROOT=Path(__file__).resolve().parents[1]
JAVA=ROOT/'android/app/src/main/java/ai/elizaresearch/alphaphone'
JDK=Path('/opt/homebrew/opt/openjdk@21/bin')

def write(root,name,text):
 p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text)

class NativePowerPin(unittest.TestCase):
 def test_actual_pin_refuses_aba_account_provider_permission_and_pending_changes(self):
  source=(JAVA/'AlphaLocalAgentPlugin.java').read_text()
  policy=source[source.index(' private static long powerAuthorizationMutationEpoch;'):source.index(' private final java.util.Set<String> cancelledStarts')]
  with tempfile.TemporaryDirectory() as temp:
   out=Path(temp)
   write(out,'android/Manifest.java','package android;public class Manifest{public static class permission{public static final String RECORD_AUDIO="mic";}}')
   write(out,'android/content/pm/PackageManager.java','package android.content.pm;public class PackageManager{public static final int PERMISSION_GRANTED=0;}')
   write(out,'android/content/Context.java','package android.content;public class Context{public int permission=0;public Context getApplicationContext(){return this;}public int checkSelfPermission(String s){return permission;}}')
   write(out,'org/json/JSONObject.java','package org.json;public class JSONObject{private final java.util.Map<String,String> m=new java.util.HashMap<>();public JSONObject put(String k,String v){m.put(k,v);return this;}public String getString(String k){if(!m.containsKey(k))throw new IllegalStateException();return m.get(k);}public String optString(String k){return m.getOrDefault(k,"");}}')
   write(out,'ai/eliza/plugins/system/SenseListenerClient.java','package ai.eliza.plugins.system;public class SenseListenerClient{public interface PowerLaunchValidator{boolean isCurrent();boolean authorize(String accountRef,java.util.function.BooleanSupplier consume);}}')
   write(out,'ai/eliza/plugins/securestore/nativeonly/JsonCredentialSlots.java','package ai.eliza.plugins.securestore.nativeonly;public class JsonCredentialSlots{public static final Object LOCK=new Object();}')
   write(out,'ai/elizaresearch/alphaphone/AlphaCredentialStore.java','package ai.elizaresearch.alphaphone;import org.json.JSONObject;public class AlphaCredentialStore{static JSONObject admission;AlphaCredentialStore(android.content.Context c){}JSONObject providerAdmissionSnapshot(){synchronized(ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots.LOCK){if(admission==null)throw new IllegalStateException();return admission;}}}')
   prefix='package ai.elizaresearch.alphaphone;import android.content.Context;import org.json.JSONObject;public class AlphaLocalAgentPlugin{static final Object lifecycleLock=new Object();static boolean stopping;static long lifecycleEpoch,credentialMutationEpoch=-1,credentialShutdownRequest=-1;'
   write(out,'ai/elizaresearch/alphaphone/AlphaLocalAgentPlugin.java',prefix+policy+r'''
    static JSONObject admitted(String account,String generation){return new JSONObject().put("provider","elizacloud").put("environment","production").put("accountRef",account).put("sessionGeneration",generation);}
    static void check(boolean value){if(!value)throw new AssertionError();}
    public static void main(String[] args){
     Context context=new Context();AlphaCredentialStore.admission=admitted("account-A","generation-A");
     PowerLaunchPin pin=capturePowerLaunchPin(context);check(pin!=null&&pin.isCurrent()&&pin.authorize("account-A",()->true)&&!pin.authorize("account-B",()->{throw new AssertionError("foreign account callback");}));
     lifecycleEpoch++;check(pin.isCurrent()); // ordinary startup is not an account mutation
     AlphaCredentialStore.admission=admitted("account-B","generation-A");check(!pin.isCurrent());
     AlphaCredentialStore.admission=admitted("account-A","generation-B");check(!pin.isCurrent());
     AlphaCredentialStore.admission=admitted("account-A","generation-A");
     boolean refused=false;try{powerAuthorizationChanged();}catch(IllegalStateException expected){refused=true;}check(refused);
     synchronized(lifecycleLock){synchronized(ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots.LOCK){powerAuthorizationChanged();powerAuthorizationChanged();}}
     check(!pin.isCurrent()); // A -> B -> A never resurrects a prior launch
     pin=capturePowerLaunchPin(context);check(pin!=null);
     credentialMutationEpoch=1;check(!pin.isCurrent()&&capturePowerLaunchPin(context)==null);credentialMutationEpoch=-1;
     credentialShutdownRequest=2;check(!pin.isCurrent()&&capturePowerLaunchPin(context)==null);credentialShutdownRequest=-1;
     stopping=true;check(!pin.isCurrent()&&capturePowerLaunchPin(context)==null);stopping=false;
     context.permission=-1;check(!pin.isCurrent()&&capturePowerLaunchPin(context)==null);context.permission=0;
     AlphaCredentialStore.admission=null;check(!pin.isCurrent()&&capturePowerLaunchPin(context)==null);
     AlphaCredentialStore.admission=admitted("account-A","generation-A").put("provider","cerebras");check(!pin.isCurrent()&&capturePowerLaunchPin(context)==null);
     System.out.println("PASS native pin exact account/generation, normal startup, ABA, lock ownership, mutation/shutdown, permission, missing/nonCloud admission");
    }
   }''')
   subprocess.run([str(JDK/'javac'),'--release','17','-d',str(out),*[str(p) for p in out.rglob('*.java')]],check=True,capture_output=True)
   output=subprocess.check_output([str(JDK/'java'),'-cp',str(out),'ai.elizaresearch.alphaphone.AlphaLocalAgentPlugin'],text=True)
   self.assertIn('PASS native pin',output)

 def test_actual_store_commits_advance_epoch_for_every_authority_mutation(self):
  import os
  sdk=Path(os.environ.get('ALPHA_POWER_SDK_ROOT',str(ROOT/'vendor/eliza')))
  admission=sdk/'plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/runtime/NativeProviderAdmission.java'
  self.assertTrue(admission.is_file(),'Set ALPHA_POWER_SDK_ROOT to the reviewed paired SDK')
  jars=list((Path.home()/'.gradle/caches/modules-2/files-2.1/org.json/json/20250517').glob('*/json-20250517.jar'))
  self.assertTrue(jars,'Pinned org.json JVM dependency is required')
  source=(JAVA/'AlphaLocalAgentPlugin.java').read_text()
  marker=source[source.index(' private static long powerAuthorizationMutationEpoch;'):source.index(' private final java.util.Set<String> cancelledStarts')]
  mutation=source[source.index(' interface CredentialMutation<T>'):source.index(' static boolean providerAdmissionReadable()')]
  with tempfile.TemporaryDirectory() as temp:
   out=Path(temp)
   write(out,'android/content/Context.java','package android.content;public class Context{public Context getApplicationContext(){return this;}public int checkSelfPermission(String permission){return 0;}public java.io.File getNoBackupFilesDir(){return new java.io.File("fixture");}}')
   write(out,'android/Manifest.java','package android;public class Manifest{public static class permission{public static final String RECORD_AUDIO="mic";}}')
   write(out,'android/content/pm/PackageManager.java','package android.content.pm;public class PackageManager{public static final int PERMISSION_GRANTED=0;}')
   write(out,'ai/eliza/plugins/system/SenseListenerClient.java','package ai.eliza.plugins.system;public class SenseListenerClient{public interface PowerLaunchValidator{boolean isCurrent();boolean authorize(String accountRef,java.util.function.BooleanSupplier consume);}}')
   write(out,'android/util/AtomicFile.java','package android.util;public class AtomicFile{}')
   write(out,'android/os/SystemClock.java','package android.os;public class SystemClock{public static long elapsedRealtime(){return 1;}}')
   write(out,'ai/eliza/plugins/securestore/nativeonly/JsonCredentialSlots.java',r'''package ai.eliza.plugins.securestore.nativeonly;
import java.io.File;import android.util.AtomicFile;public class JsonCredentialSlots{
 public static final Object LOCK=new Object();private static final java.util.Map<String,String> values=new java.util.HashMap<>();
 public interface Limits{int limit(String name);}public static class CapacityException extends IllegalArgumentException{}
 public JsonCredentialSlots(File d,String alias,Limits l){}public JsonCredentialSlots(File d,String alias,Limits l,Limits retained){}
 public static boolean failNextWrite;public String read(String n){return values.get(n);}public void write(String n,String v){if(failNextWrite){failNextWrite=false;throw new IllegalStateException("synthetic write refusal");}values.put(n,v);}public void remove(String n){values.remove(n);}
 public String slotHash(String n){return n;}public AtomicFile slotFile(String hash){return new AtomicFile();}
}''')
   write(out,'ai/elizaresearch/alphaphone/CloudDeployment.java','package ai.elizaresearch.alphaphone;class CloudDeployment{static String storageSlot(String name){return name;}}')
   write(out,'ai/elizaresearch/alphaphone/ElizaAgentService.java','package ai.elizaresearch.alphaphone;class ElizaAgentService{static long stopForCredentialChange(android.content.Context c){return 1;}static org.json.JSONObject getLocalAgentBootState(android.content.Context c){return new org.json.JSONObject();}static boolean isCredentialShutdownConfirmed(long request){return true;}}')
   fields='package ai.elizaresearch.alphaphone;import android.content.Context;import org.json.JSONObject;class AlphaLocalAgentPlugin{static final Object lifecycleLock=new Object();static long lifecycleEpoch,credentialMutationEpoch=-1,credentialShutdownRequest=-1,startRequestEpoch;static String startRequestId;static boolean startOwnsLaunch,accepting=true,stopping;static class Superseded extends Exception{}static void invalidateCalls(){}static void clearEnrollment(){}static boolean shutdownConfirmed(JSONObject state){return true;}static boolean providerAdmissionReadable(){return credentialMutationEpoch<0;}'
   write(out,'ai/elizaresearch/alphaphone/AlphaLocalAgentPlugin.java',fields+marker+mutation+'}')
   write(out,'ai/elizaresearch/alphaphone/CommitTest.java',r'''package ai.elizaresearch.alphaphone;
import org.json.JSONObject;public class CommitTest{
 static int checks;static void check(boolean b){checks++;if(!b)throw new AssertionError("check "+checks);}
 static long epoch(){try{java.lang.reflect.Field f=AlphaLocalAgentPlugin.class.getDeclaredField("powerAuthorizationMutationEpoch");f.setAccessible(true);return f.getLong(null);}catch(Exception error){throw new AssertionError(error);}}
 static JSONObject selection(){return new JSONObject().put("provider","elizacloud").put("credentialId","33333333-3333-4333-8333-333333333333").put("model",LocalAgentProviderAdmission.CLOUD_PROVIDER_MODEL);}
 public static void main(String[]args)throws Exception{
  AlphaCredentialStore s=new AlphaCredentialStore(new android.content.Context());String slot=LocalAgentProviderAdmission.PROVIDER_SLOT;
  String a=new JSONObject().put("credentialId","33333333-3333-4333-8333-333333333333").put("token","synthetic-A-token").toString(),b=new JSONObject(a).put("token","synthetic-B-token").toString();
  long e=epoch();s.writeCredentialSlot("cloud:production",a);check(epoch()==++e); // no-provider/no-shutdown commit
  s.writeCredentialSlot("cloud:production",a);check(epoch()==e); // exact no-op
  check(!s.compareExchangeCredentialSlot("cloud:production","wrong",b));check(epoch()==e); // CAS refusal
  check(s.compareExchangeCredentialSlot("cloud:production",a,b));check(epoch()==++e);
  s.writeCredentialSlot("cloud:production",a);check(epoch()==++e); // A-B-A cannot reuse epoch
  s.removeCredentialSlot("cloud:production");check(epoch()==++e);s.writeCredentialSlot("cloud:production",a);check(epoch()==++e);
  String selected=selection().toString();s.writeCredentialSlot(slot,selected);check(epoch()==++e);
  JSONObject identity=LocalAgentProviderAdmission.verifiedCloudIdentity(new JSONObject().put("id","11111111-1111-4111-8111-111111111111"));
  String admitted=s.compareExchangeProviderAdmission(selected,selected,"cloud:production",a,identity);check(admitted!=null&&epoch()==++e);
  // A new Android process sees an already admitted account before normal resident startup.
  AlphaLocalAgentPlugin.stopping=false;AlphaLocalAgentPlugin.credentialShutdownRequest=-1;
  AlphaLocalAgentPlugin.PowerLaunchPin initial=AlphaLocalAgentPlugin.capturePowerLaunchPin(new android.content.Context());check(initial!=null&&initial.isCurrent());
  final String validCredential=a;final JSONObject validIdentity=identity;
  String rebound=LocalAgentProviderAdmission.bindCloudProvider(new LocalAgentProviderAdmission.CloudBindingStore(){
   public String readProvider()throws Exception{return s.readCredentialSlot(slot);}public String readCloud()throws Exception{return s.readCredentialSlot("cloud:production");}public void assertCurrent(){}public JSONObject identity(String token){return validIdentity;}
   public String admit(String previous,String selection,String cloud,JSONObject verified)throws Exception{return s.compareExchangeProviderAdmission(previous,selection,"cloud:production",cloud,verified);}public void rollback(String binding,String previous)throws Exception{s.rollbackProviderAdmission(binding,previous);}
  },selection().getString("credentialId"),LocalAgentProviderAdmission.CLOUD_PROVIDER_MODEL,System::currentTimeMillis);
  check(!rebound.equals(admitted));check(epoch()==e);check(initial.isCurrent()); // random revision changed, authority did not
  admitted=rebound;
  String metadata=new JSONObject(a).put("expiresAt",System.currentTimeMillis()+600000).put("displayLabel","benign").toString();
  s.writeCredentialSlot("cloud:production",metadata);check(epoch()==e&&initial.isCurrent());
  s.writeCredentialSlot("cloud:production",a);check(epoch()==e&&initial.isCurrent());
  JSONObject otherIdentity=LocalAgentProviderAdmission.verifiedCloudIdentity(new JSONObject().put("id","44444444-4444-4444-8444-444444444444"));
  String other=s.compareExchangeProviderAdmission(admitted,selection().toString(),"cloud:production",a,otherIdentity);check(epoch()==++e&&!initial.isCurrent());
  admitted=s.compareExchangeProviderAdmission(other,selection().toString(),"cloud:production",a,identity);check(epoch()==++e&&!initial.isCurrent()); // account A-B-A never resurrects grant
  AlphaLocalAgentPlugin.stopping=false;AlphaLocalAgentPlugin.credentialShutdownRequest=-1;
  AlphaLocalAgentPlugin.PowerLaunchPin current=AlphaLocalAgentPlugin.capturePowerLaunchPin(new android.content.Context());check(current!=null&&current.isCurrent());
  ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots.failNextWrite=true;
  boolean writeFailed=false;try{s.writeCredentialSlot(slot,admitted);}catch(IllegalStateException expectedFailure){writeFailed=true;}
  check(writeFailed&&epoch()==++e&&!current.isCurrent());check(admitted.equals(s.readCredentialSlot(slot))); // uncertain/failed write fails closed


  // Same raw value still strips admission when persisted: this previously missed the mutation marker.
  s.writeCredentialSlot(slot,admitted);check(epoch()==++e);check(!s.readCredentialSlot(slot).equals(admitted));
  String stripped=s.readCredentialSlot(slot);admitted=s.compareExchangeProviderAdmission(stripped,selected,"cloud:production",a,identity);check(epoch()==++e);
  check(s.compareExchangeProviderAdmission("foreign",selected,"cloud:production",a,identity)==null);check(epoch()==e);
  s.rollbackProviderAdmission(admitted,null);check(epoch()==++e&&s.readCredentialSlot(slot)==null);
  s.writeCredentialSlot(slot,selected);check(epoch()==++e);admitted=s.compareExchangeProviderAdmission(selected,selected,"cloud:production",a,identity);check(epoch()==++e);
  s.writeCredentialSlot("cloud:production",b);check(epoch()==++e); // shutdown path + nested admission invalidation, one epoch
  check(s.providerAdmissionGeneration()==null);s.removeCredentialSlot(slot);check(epoch()==++e);
  s.rollbackProviderAdmission(admitted,null);check(epoch()==e); // no foreign replay
  s.writeCredentialSlot(slot,selection().put("model","different-model").toString());check(epoch()==++e);
  s.writeCredentialSlot(slot,selection().put("provider","cerebras").put("key","synthetic-direct-key").toString());check(epoch()==++e);
  s.writeCredentialSlot(slot,selection().put("environment","staging").toString());check(epoch()==++e);
  s.removeCredentialSlot(slot);check(epoch()==++e);

  System.out.println("PASS actual credential-store commits: "+checks+" checks; no-shutdown/write/remove/CAS/ABA/admission/rollback/stripping/shutdown paths");
 }
}''')
   sources=[str(path)for path in out.rglob('*.java')]+[str(admission),str(JAVA/'LocalAgentProviderAdmission.java'),str(JAVA/'AlphaCredentialStore.java')]
   compilation=subprocess.run([str(JDK/'javac'),'--release','17','-cp',str(jars[0]),'-d',str(out),*sources],capture_output=True)
   self.assertEqual(compilation.returncode,0,compilation.stderr.decode())
   output=subprocess.check_output([str(JDK/'java'),'-cp',str(out)+':'+str(jars[0]),'ai.elizaresearch.alphaphone.CommitTest'],text=True)
   self.assertIn('PASS actual credential-store commits',output)
   # Recompile the actual store/admission and extracted real policy/mutation methods against
   # Android36, excluding all modeled android classes and the executable host harness.
   slots=out/'ai/eliza/plugins/securestore/nativeonly/JsonCredentialSlots.java'
   slots.write_text(slots.read_text().replace('return new AtomicFile();','return null;'))
   api=Path.home()/'Library/Android/sdk/platforms/android-36/android.jar'
   self.assertTrue(api.is_file(),'Android36 API is required')
   api_sources=[name for name in sources if not Path(name).is_relative_to(out/'android') and not name.endswith('/CommitTest.java')]
   api_compile=subprocess.run([str(JDK/'javac'),'--release','17','-cp',str(api)+':'+str(jars[0]),'-d',str(out/'api36'),*api_sources],capture_output=True)
   self.assertEqual(api_compile.returncode,0,api_compile.stderr.decode())


if __name__=='__main__':unittest.main()
