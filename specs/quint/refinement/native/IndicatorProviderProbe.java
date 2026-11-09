package ai.eliza.sense;

import ai.elizaresearch.alphaphone.Trace;
import android.os.*;
import java.lang.reflect.Field;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import org.json.*;

/** Holds the provider monitor while two real acquire calls reach it. */
public final class IndicatorProviderProbe {
 public static final class Token implements IBinder {
  public volatile DeathRecipient recipient;
  public void linkToDeath(DeathRecipient value,int flags){recipient=value;}
  public boolean unlinkToDeath(DeathRecipient value,int flags){if(recipient==value){recipient=null;return true;}return false;}
 }
 static long generation(Object recipient)throws Exception {
  for(Field field:recipient.getClass().getDeclaredFields())if(field.getType()==long.class){field.setAccessible(true);return (long)field.get(recipient);}
  throw new AssertionError("No captured lease generation");
 }
 static void blocked(Thread thread)throws Exception {
  long until=System.nanoTime()+TimeUnit.SECONDS.toNanos(5);
  while(thread.getState()!=Thread.State.BLOCKED){if(System.nanoTime()>until)throw new AssertionError("Acquire did not reach held provider lock");Thread.sleep(1);}
 }
 public static void main(String[]args)throws Exception {
  IndicatorLeaseProvider provider=new IndicatorLeaseProvider();int mismatches=0;JSONArray examples=new JSONArray();
  for(int attempt=0;attempt<32;attempt++){
   AtomicReference<Throwable> error=new AtomicReference<>();Token a=new Token(),b=new Token();
   Runnable first=()->{try{Bundle input=new Bundle();input.putBinder(IndicatorLease.KEY_TOKEN,a);provider.call(IndicatorLease.ACQUIRE,null,input);}catch(Throwable failure){error.set(failure);}};
   Runnable second=()->{try{Bundle input=new Bundle();input.putBinder(IndicatorLease.KEY_TOKEN,b);provider.call(IndicatorLease.ACQUIRE,null,input);}catch(Throwable failure){error.set(failure);}};
   Thread one=new Thread(first),two=new Thread(second);
   synchronized(IndicatorLeaseProvider.class){one.start();blocked(one);two.start();blocked(two);}
   one.join(5000);two.join(5000);if(one.isAlive()||two.isAlive())throw new AssertionError("Acquire did not settle");if(error.get()!=null)throw new AssertionError(error.get());
   Object recipient=Trace.read(provider,"linkedRecipient");long linked=generation(recipient),lease=(long)Trace.read(Listener.lease,"generation");
   if(linked!=lease){mismatches++;if(examples.length()<3)examples.put(new JSONObject().put("linkedGeneration",linked).put("leaseGeneration",lease));}
  }
  System.out.println(new JSONObject().put("attempts",32).put("mismatches",mismatches).put("examples",examples).put("unrestoredIdentities",ProviderPorts.identities.get()));
 }
}
