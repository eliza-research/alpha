package ai.elizaresearch.alphaphone;
import java.util.concurrent.atomic.AtomicInteger;
/** A timed-out queued effect cannot claim execution later. Started effects remain uncertain. */
final class DispatchClaim {
 private final AtomicInteger state=new AtomicInteger(); // 0 queued, 1 started, 2 cancelled
 private final long deadline;
 DispatchClaim(long deadline){this.deadline=deadline;}
 boolean start(long now){if(now>=deadline){cancel();return false;}return state.compareAndSet(0,1);}
 boolean cancel(){return state.compareAndSet(0,2)||state.get()==2;}
 boolean started(){return state.get()==1;}
}
