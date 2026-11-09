package ai.eliza.sense;

import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

/** Synthetic recognition responses and observation of the real utterance array. */
public final class ListenerInputPorts {
 public static final AtomicInteger calls=new AtomicInteger();
 public static final BlockingQueue<String> responses=new LinkedBlockingQueue<>();
 public static volatile float[] lastSamples;
 public static long ticket(){return Listener.epoch.ticket();}
 public static String transcribe(float[] samples){
  lastSamples=samples;calls.incrementAndGet();
  try{
   String result=responses.poll(8,TimeUnit.SECONDS);
   if(result==null)throw new AssertionError("Listener ASR port response deadline");
   return result;
  }catch(InterruptedException interrupted){Thread.currentThread().interrupt();throw new IllegalStateException(interrupted);}
 }
 private ListenerInputPorts(){}
}
