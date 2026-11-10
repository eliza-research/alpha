package ai.elizaresearch.alphaphone;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
public final class SerialStorageTasksTest {
 public static void main(String[] args)throws Exception{
  SerialStorageTasks queue=new SerialStorageTasks();
  CountDownLatch serializing=new CountDownLatch(1),release=new CountDownLatch(1),second=new CountDownLatch(1);
  AtomicInteger order=new AtomicInteger(),rejected=new AtomicInteger();AtomicReference<Throwable> failure=new AtomicReference<>();
  try{
   queue.submit(()->{try{if(order.incrementAndGet()!=1)throw new AssertionError();serializing.countDown();if(!release.await(5,TimeUnit.SECONDS))throw new AssertionError("release");if(order.incrementAndGet()!=2)throw new AssertionError("response overlapped");}catch(Throwable t){failure.set(t);}},rejected::incrementAndGet);
   if(!serializing.await(5,TimeUnit.SECONDS))throw new AssertionError("first operation");
   queue.submit(()->{if(order.incrementAndGet()!=3)failure.set(new AssertionError("read/CAS started before prior response completed"));second.countDown();},rejected::incrementAndGet);
   if(second.await(100,TimeUnit.MILLISECONDS))throw new AssertionError("storage response overlapped next read/CAS");
   release.countDown();if(!second.await(5,TimeUnit.SECONDS))throw new AssertionError("second operation");
   if(failure.get()!=null)throw new AssertionError(failure.get());if(rejected.get()!=0)throw new AssertionError("valid operations rejected");
  }finally{release.countDown();queue.close();}
  CountDownLatch started=new CountDownLatch(1),block=new CountDownLatch(1),closed=new CountDownLatch(1);AtomicInteger executed=new AtomicInteger();
  SerialStorageTasks retiring=new SerialStorageTasks();
  retiring.submit(()->{started.countDown();try{block.await();}catch(InterruptedException expected){Thread.currentThread().interrupt();}finally{closed.countDown();}},()->{});
  if(!started.await(5,TimeUnit.SECONDS))throw new AssertionError("retiring operation");
  for(int i=0;i<3;i++)retiring.submit(executed::incrementAndGet,rejected::incrementAndGet);
  retiring.close();if(!closed.await(5,TimeUnit.SECONDS))throw new AssertionError("running operation not interrupted");
  if(retiring.submit(executed::incrementAndGet,rejected::incrementAndGet))throw new AssertionError("post-close submission accepted");
  if(executed.get()!=0||rejected.get()!=4)throw new AssertionError("retired writes executed or queued calls left unresolved");
  System.out.println("PASS serialized storage responses and retirement");
 }
}
