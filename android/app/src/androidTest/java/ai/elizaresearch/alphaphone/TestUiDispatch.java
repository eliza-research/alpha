package ai.elizaresearch.alphaphone;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
/** Synchronous Handler ordering is preserved. No timeout widening or effect retry. */
final class TestUiDispatch {
 private final Handler handler;
 private final DispatchClaim claim;
 private final Runnable queued;
 private final long deadline;
 private TestUiDispatch(Handler handler,Runnable action,long timeoutMs){
  this.handler=handler;deadline=SystemClock.elapsedRealtime()+timeoutMs;claim=new DispatchClaim(deadline);
  queued=()->{if(claim.start(SystemClock.elapsedRealtime()))action.run();};
  if(!handler.post(queued))throw new AssertionError("Test dispatch looper is unavailable");
 }
 static TestUiDispatch post(Runnable action){return new TestUiDispatch(new Handler(Looper.getMainLooper()),action,8000);}
 static TestUiDispatch postForFixture(Handler handler,Runnable action,long timeoutMs){return new TestUiDispatch(handler,action,timeoutMs);}
 boolean started(){return claim.started();}
 void await(CountDownLatch completion,String diagnostic)throws InterruptedException{
  final boolean complete;
  try{complete=completion.await(Math.max(0,deadline-SystemClock.elapsedRealtime()),TimeUnit.MILLISECONDS);}
  catch(InterruptedException interrupted){claim.cancel();handler.removeCallbacks(queued);throw interrupted;}
  if(complete)return;
  boolean cancelled=claim.cancel();handler.removeCallbacks(queued);
  StringBuilder stack=new StringBuilder();StackTraceElement[] frames=handler.getLooper().getThread().getStackTrace();
  for(int i=0;i<Math.min(frames.length,24);i++)stack.append("\n  at ").append(frames[i]);
  throw new AssertionError(diagnostic+" timed out; "+(cancelled?"queued command cancelled before dispatch":"already dispatched; result unknown; not retried")+"\nQueue: "+queueSummary(handler.getLooper())+"\nDispatch thread:"+stack);
 }
 private static String queueSummary(Looper looper){
  // Never retain raw dump lines: Message.obj/callback.toString may contain user data.
  final int[] counts={0,0};
  try{looper.dump(line->{if(line.contains("Message "))counts[0]++;if(line.contains("barrier="))counts[1]++;},"");}
  catch(RuntimeException error){return "unavailable";}
  return "messageEntries="+counts[0]+", syncBarrierEntries="+counts[1];
 }
}
