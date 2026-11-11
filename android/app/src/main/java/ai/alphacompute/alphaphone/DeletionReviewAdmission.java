package ai.alphacompute.alphaphone;

import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/** A review's nonblocking admission point; durable I/O runs only after admit wins. */
final class DeletionReviewAdmission {
 private static final int QUEUED=0,ADMITTED=1,RETIRED=2;
 private final AtomicInteger state=new AtomicInteger(QUEUED);
 private final AtomicBoolean settled=new AtomicBoolean();
 boolean queued(){return state.get()==QUEUED;}
 boolean admit(){return state.compareAndSet(QUEUED,ADMITTED);}
 void retire(){state.compareAndSet(QUEUED,RETIRED);}
 boolean settle(){retire();return settled.compareAndSet(false,true);}
}
