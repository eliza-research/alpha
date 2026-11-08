package ai.elizaresearch.alphaphone;

import android.content.ContextWrapper;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.io.File;
import java.lang.reflect.*;
import java.net.*;
import java.util.UUID;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import static org.junit.Assert.*;

/** Real Android Handler + the shared bridge's serial executor (LocalSpeechBridgePlugin); no microphone/network/model access. */
public final class VoiceWorkerSettlementInstrumentedTest {
 private interface Body { void run(Object request) throws Exception; }
 private static Field field(String name)throws Exception{Field f=ai.eliza.voice.LocalSpeechBridgePlugin.class.getDeclaredField(name);f.setAccessible(true);return f;}
 private static void result(Object request)throws Exception{Field f=request.getClass().getDeclaredField("result");f.setAccessible(true);f.set(request,new JSObject().put("ready",true));}
 private static void submit(AlphaVoiceCloudPlugin plugin,Call call,Body body)throws Exception{
  Class<?> type=Class.forName(ai.eliza.voice.LocalSpeechBridgePlugin.class.getName()+"$Work");Method m=ai.eliza.voice.LocalSpeechBridgePlugin.class.getDeclaredMethod("submit",PluginCall.class,type);m.setAccessible(true);
  Object work=java.lang.reflect.Proxy.newProxyInstance(type.getClassLoader(),new Class<?>[]{type},(proxy,method,args)->{body.run(args[0]);return null;});m.invoke(plugin,call,work);
 }
 private static class Call extends PluginCall {
  final CountDownLatch done=new CountDownLatch(1);volatile String error;volatile Runnable continuation;
  Call(){super(null,"AlphaVoiceCloud",UUID.randomUUID().toString(),"test",new JSObject().put("requestId",UUID.randomUUID().toString()));}
  @Override public void resolve(JSObject value){resolve();}
  @Override public void resolve(){if(continuation!=null)continuation.run();done.countDown();}
  @Override public void reject(String message){error=message;if(continuation!=null)continuation.run();done.countDown();}
  void await()throws Exception{assertTrue("Bridge settlement deadline",done.await(10,TimeUnit.SECONDS));}
 }
 @Test public void settlementFollowsConnectionCleanupAndAllowsContinuation()throws Exception{
  AlphaVoiceCloudPlugin p=new AlphaVoiceCloudPlugin();ExecutorService worker=(ExecutorService)field("workers").get(p);
  CountDownLatch disconnectEntered=new CountDownLatch(1),releaseDisconnect=new CountDownLatch(1);AtomicReference<Throwable> failure=new AtomicReference<>();Call first=new Call(),next=new Call();
  try{
   first.continuation=()->{try{assertTrue(((ai.eliza.voice.SpeechRequestGate)field("gate").get(p)).idle());submit(p,next,VoiceWorkerSettlementInstrumentedTest::result);}catch(Throwable e){failure.set(e);}};
   submit(p,first,request->{Field f=request.getClass().getDeclaredField("connection");f.setAccessible(true);f.set(request,new HttpURLConnection(new URL("http://127.0.0.1/")){
    public void connect(){}public boolean usingProxy(){return false;}public void disconnect(){disconnectEntered.countDown();try{assertTrue(releaseDisconnect.await(10,TimeUnit.SECONDS));}catch(InterruptedException e){Thread.currentThread().interrupt();throw new AssertionError(e);}}
   });result(request);});
   assertTrue(disconnectEntered.await(10,TimeUnit.SECONDS));assertFalse("Must not resolve while cleanup is blocked",first.done.await(100,TimeUnit.MILLISECONDS));releaseDisconnect.countDown();first.await();next.await();assertNull(failure.get());assertNull(first.error);assertNull(next.error);
  }finally{releaseDisconnect.countDown();worker.shutdown();assertTrue(worker.awaitTermination(10,TimeUnit.SECONDS));}
 }
 @Test public void rejectedWorkReleasesAdmissionBeforeFailureContinuation()throws Exception{
  AlphaVoiceCloudPlugin p=new AlphaVoiceCloudPlugin();ExecutorService worker=(ExecutorService)field("workers").get(p);Call first=new Call(),next=new Call();AtomicReference<Throwable> failure=new AtomicReference<>();
  try{
   first.continuation=()->{try{assertTrue(((ai.eliza.voice.SpeechRequestGate)field("gate").get(p)).idle());submit(p,next,VoiceWorkerSettlementInstrumentedTest::result);}catch(Throwable error){failure.set(error);}};
   submit(p,first,request->{throw new java.io.IOException("synthetic failure");});first.await();next.await();assertNotNull(first.error);assertNull(next.error);assertNull(failure.get());
  }finally{worker.shutdown();assertTrue(worker.awaitTermination(10,TimeUnit.SECONDS));}
 }
 @Test public void cancellationWaitsForWorkerAndRejectsAdmissionDuringDrain()throws Exception{
  AlphaVoiceCloudPlugin p=new AlphaVoiceCloudPlugin();ExecutorService worker=(ExecutorService)field("workers").get(p);File directory=new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getCacheDir(),"voice-drain-test-"+UUID.randomUUID());assertTrue(directory.mkdir());
  ContextWrapper context=new ContextWrapper(InstrumentationRegistry.getInstrumentation().getTargetContext()){@Override public File getCacheDir(){return directory;}};field("capture").set(p,new ai.eliza.voice.LocalVoiceRecording(context,"alpha-cloud-voice-",value->{}));
  CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1);Call first=new Call(),cancel=new Call(),blocked=new Call(),next=new Call();
  try{
   submit(p,first,request->{entered.countDown();assertTrue(release.await(10,TimeUnit.SECONDS));result(request);});assertTrue(entered.await(10,TimeUnit.SECONDS));
   p.cancelRecording(cancel);submit(p,blocked,VoiceWorkerSettlementInstrumentedTest::result);blocked.await();assertNotNull("No admission during drain",blocked.error);assertFalse("Cancellation must await worker cleanup",cancel.done.await(100,TimeUnit.MILLISECONDS));
   release.countDown();first.await();cancel.await();assertNotNull(first.error);assertNull(cancel.error);assertTrue(((ai.eliza.voice.SpeechRequestGate)field("gate").get(p)).idle());submit(p,next,VoiceWorkerSettlementInstrumentedTest::result);next.await();assertNull(next.error);
  }finally{release.countDown();worker.shutdown();assertTrue(worker.awaitTermination(10,TimeUnit.SECONDS));assertTrue(directory.delete());}
 }
}
