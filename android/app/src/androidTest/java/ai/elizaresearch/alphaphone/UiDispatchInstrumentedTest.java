package ai.elizaresearch.alphaphone;
import android.os.Handler;
import android.os.HandlerThread;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.Test;
import static org.junit.Assert.*;
/** Real Android queue regression, isolated from the product UI thread. */
public final class UiDispatchInstrumentedTest {
 @Test public void expiredQueuedEffectNeverRunsAndStartedEffectIsUnknown()throws Exception{
  org.junit.Assume.assumeTrue("Explicit dispatch fixture", "1".equals(InstrumentationRegistry.getArguments().getString("uiDispatch")));
  HandlerThread thread=new HandlerThread("disposable-dispatch-fixture");thread.start();Handler handler=new Handler(thread.getLooper());CountDownLatch release=new CountDownLatch(1),entered=new CountDownLatch(1);
  try{
   handler.post(()->{entered.countDown();try{release.await(5,TimeUnit.SECONDS);}catch(InterruptedException e){Thread.currentThread().interrupt();}});assertTrue(entered.await(2,TimeUnit.SECONDS));
   AtomicInteger effects=new AtomicInteger();CountDownLatch done=new CountDownLatch(1);
   TestUiDispatch queued=TestUiDispatch.postForFixture(handler,()->{effects.incrementAndGet();done.countDown();},50);
   try{queued.await(done,"queued fixture");fail("Blocked queue must time out");}catch(AssertionError expected){assertTrue(expected.getMessage().contains("cancelled before dispatch"));}
   release.countDown();CountDownLatch drained=new CountDownLatch(1);handler.post(drained::countDown);assertTrue(drained.await(2,TimeUnit.SECONDS));assertEquals(0,effects.get());
   CountDownLatch running=new CountDownLatch(1),finish=new CountDownLatch(1),completed=new CountDownLatch(1);
   TestUiDispatch started=TestUiDispatch.postForFixture(handler,()->{effects.incrementAndGet();running.countDown();try{finish.await(5,TimeUnit.SECONDS);}catch(InterruptedException e){Thread.currentThread().interrupt();}finally{completed.countDown();}},1000);
   try{assertTrue(running.await(2,TimeUnit.SECONDS));try{started.await(completed,"started fixture");fail("Running effect must time out");}catch(AssertionError expected){assertTrue(expected.getMessage().contains("already dispatched; result unknown; not retried"));}}finally{finish.countDown();}
   assertTrue(completed.await(2,TimeUnit.SECONDS));assertEquals(1,effects.get());
  }finally{release.countDown();thread.quitSafely();thread.join(3000);assertFalse(thread.isAlive());}
 }
}
