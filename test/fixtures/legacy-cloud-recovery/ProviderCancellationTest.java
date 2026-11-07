package ai.elizaresearch.alphaphone;

import java.io.File;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import ai.eliza.plugins.agent.runtime.CredentialIntentFence;
import ai.eliza.plugins.agent.runtime.CredentialRequestFence;
import ai.eliza.plugins.agent.runtime.NativeProviderSlot;

/** Real native slot commit + the production cancellation fence, with a paused synthetic key check. */
public final class ProviderCancellationTest {
 static void check(boolean value,String why){if(!value)throw new AssertionError(why);}
 public static void main(String[] args)throws Exception{
  android.content.Context context=new android.content.Context(new File(args[0]));
  AlphaCredentialStore initial=new AlphaCredentialStore(context);
  initial.writeCredentialSlot("cloud:production",LegacyCloudRecoveryTest.SAVED);
  AlphaLocalAgentPlugin.bindCloudProvider(initial,LegacyCloudRecoveryTest.ID,LocalAgentProviderAdmission.CLOUD_PROVIDER_MODEL);
  String original=initial.readCredentialSlot("local-agent-provider:v1");
  Object lock=AlphaLocalAgentPlugin.lifecycleLock;
  CredentialRequestFence requests=new CredentialRequestFence(lock,new CredentialIntentFence(lock));
  String request=requests.reserve();long intent=requests.begin(request);
  CountDownLatch entered=new CountDownLatch(1),resume=new CountDownLatch(1);
  AtomicReference<Throwable> failure=new AtomicReference<>();int[] retirements={0};
  AlphaLocalAgentPlugin.beforeCommit=()->retirements[0]++;
  AlphaCredentialStore store=new AlphaCredentialStore(context,()->requests.require(request,intent));
  Thread checking=new Thread(()->{try{
   NativeProviderSlot.saveVerifiedProvider(AlphaLocalAgentPlugin.providerSlot(store),"synthetic-cancelled-key",LocalAgentProviderAdmission.CEREBRAS_PROVIDER_MODEL,null,(key,model)->{entered.countDown();try{if(!resume.await(2,TimeUnit.SECONDS))throw new AssertionError("validation not released");}catch(InterruptedException interrupted){throw new RuntimeException(interrupted);}return null;},"Alpha");
  }catch(Throwable expected){failure.set(expected);}finally{requests.finish(request,intent);}});
  checking.start();check(entered.await(2,TimeUnit.SECONDS),"validation entered");requests.cancel(request);resume.countDown();checking.join(2000);
  check(!checking.isAlive()&&failure.get() instanceof IllegalStateException,"cancelled native validation refused");
  check(retirements[0]==0,"cancel before commit must not retire agent");check(original.equals(initial.readCredentialSlot("local-agent-provider:v1")),"cancel must not save or select key");check(LegacyCloudRecoveryTest.SAVED.equals(initial.readCredentialSlot("cloud:production")),"Cloud account untouched");
  String before=requests.reserve();requests.cancel(before);try{requests.begin(before);throw new AssertionError("cancel-before-dispatch admitted");}catch(IllegalStateException expected){}
  String accepted=requests.reserve();long committed=requests.begin(accepted);
  AlphaCredentialStore positive=new AlphaCredentialStore(context,()->requests.require(accepted,committed));
  check(NativeProviderSlot.saveVerifiedProvider(AlphaLocalAgentPlugin.providerSlot(positive),"synthetic-positive-key",LocalAgentProviderAdmission.CEREBRAS_PROVIDER_MODEL,null,(key,model)->null,"Alpha")==null,"positive commit succeeds");requests.finish(accepted,committed);
  check(retirements[0]>0,"positive change uses existing retirement lifecycle");check(initial.readCredentialSlot("local-agent-provider:v1").contains("synthetic-positive-key"),"positive key saved");
  String stale=requests.reserve();long older=requests.begin(stale);String newest=requests.reserve();long latest=requests.begin(newest);requests.cancel(stale);requests.require(newest,latest);requests.finish(stale,older);requests.finish(newest,latest);
  String direct=initial.readCredentialSlot("local-agent-provider:v1");retirements[0]=0;
  String clearing=requests.reserve();long clearIntent=requests.begin(clearing);
  CountDownLatch clearQueued=new CountDownLatch(1),dispatchClear=new CountDownLatch(1);failure.set(null);
  Thread queued=new Thread(()->{try{clearQueued.countDown();dispatchClear.await();AlphaLocalAgentPlugin.clearProviderSlot(new AlphaCredentialStore(context,()->requests.require(clearing,clearIntent)),false);}catch(Throwable expected){failure.set(expected);}finally{requests.finish(clearing,clearIntent);}});
  queued.start();check(clearQueued.await(2,TimeUnit.SECONDS),"clear queued");requests.cancel(clearing);dispatchClear.countDown();queued.join(2000);
  check(!queued.isAlive()&&failure.get() instanceof IllegalStateException,"queued clear cancelled");check(retirements[0]==0&&direct.equals(initial.readCredentialSlot("local-agent-provider:v1")),"cancelled Cloud switch must not clear or retire direct provider");
  String clearAccepted=requests.reserve();long clearAcceptedIntent=requests.begin(clearAccepted);
  AlphaLocalAgentPlugin.clearProviderSlot(new AlphaCredentialStore(context,()->requests.require(clearAccepted,clearAcceptedIntent)),false);requests.finish(clearAccepted,clearAcceptedIntent);
  check(initial.readCredentialSlot("local-agent-provider:v1")==null&&retirements[0]>0,"positive explicit Cloud switch clears provider normally");
  AlphaLocalAgentPlugin.beforeCommit=()->{};
  System.out.println("PASS native provider cancellation: paused validation, cancel-before-dispatch, no save/switch/retirement, positive commit");
 }
}
