package ai.elizaresearch.alphaphone;

import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/** Host-JVM check of the shared worker guard. Not Android or Capacitor evidence. */
public final class PluginWorkersTest {
 private static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
 public static void main(String[] args)throws Exception {
  AtomicInteger refused=new AtomicInteger();
  ExecutorService live=Executors.newSingleThreadExecutor();CountDownLatch ran=new CountDownLatch(1);
  check(PluginWorkers.submit(live,ran::countDown,refused::incrementAndGet),"a live worker accepts work");
  check(ran.await(5,TimeUnit.SECONDS)&&refused.get()==0,"accepted work runs and nothing is refused");
  live.shutdown();
  boolean[] ranAfterStop={false};
  check(!PluginWorkers.submit(live,()->ranAfterStop[0]=true,refused::incrementAndGet),"a stopped worker does not throw and reports refusal");
  check(refused.get()==1&&!ranAfterStop[0],"the refusal answers the call once; the work never runs");
  ExecutorService stoppedNow=Executors.newSingleThreadExecutor();stoppedNow.shutdownNow();
  check(!PluginWorkers.submit(stoppedNow,()->{},refused::incrementAndGet)&&refused.get()==2,"shutdownNow is refused the same way");
  // A bounded worker that is full refuses instead of throwing (Maps and Voice use bounded queues).
  CountDownLatch release=new CountDownLatch(1);
  ThreadPoolExecutor full=new ThreadPoolExecutor(1,1,30,TimeUnit.SECONDS,new ArrayBlockingQueue<>(1));
  check(PluginWorkers.submit(full,()->{try{release.await();}catch(InterruptedException ignored){}},refused::incrementAndGet),"first task runs");
  check(PluginWorkers.submit(full,()->{},refused::incrementAndGet),"second task queues");
  check(!PluginWorkers.submit(full,()->{},refused::incrementAndGet)&&refused.get()==3,"a full queue is refused");
  release.countDown();full.shutdown();check(full.awaitTermination(5,TimeUnit.SECONDS),"bounded worker drains");
  System.out.println("PASS plugin workers");
 }
}
