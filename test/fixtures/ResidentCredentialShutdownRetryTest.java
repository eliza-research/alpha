package ai.elizaresearch.alphaphone;
public final class ResidentCredentialShutdownRetryTest {
 static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
 static void fails(String name,ResidentCredentialShutdownRetry.Guard operation)throws Exception {
  try{operation.check();throw new AssertionError(name+" unexpectedly passed");}catch(IllegalStateException expected){}
 }
 public static void main(String[] ignored)throws Exception {
  long[] now={0};int[] checks={0},sleeps={0};
  // An actual later strict acknowledgment, rather than a dead child, permits completion.
  ResidentCredentialShutdownRetry.await(()->checks[0]++,()->now[0]>=100,()->true,()->now[0],ms->{now[0]+=ms;sleeps[0]++;},200);
  check(sleeps[0]==2&&checks[0]>=6,"transient refusal must wait for exact acknowledgment");
  now[0]=0;
  fails("unknown owner despite absent service",()->ResidentCredentialShutdownRetry.await(()->{},()->false,()->true,()->now[0],ms->now[0]+=ms,100));
  now[0]=0;
  fails("acknowledgment with socket/service alive",()->ResidentCredentialShutdownRetry.await(()->{},()->true,()->false,()->now[0],ms->now[0]+=ms,100));
  now[0]=0;int[] ownerChecks={0};
  fails("cancellation during native status observation",()->ResidentCredentialShutdownRetry.await(()->{if(++ownerChecks[0]>1)throw new IllegalStateException("cancelled");},()->true,()->true,()->now[0],ms->now[0]+=ms,100));
  now[0]=0;int[] acknowledgments={0};
  fails("superseded acknowledgment",()->ResidentCredentialShutdownRetry.await(()->{},()->++acknowledgments[0]==1,()->true,()->now[0],ms->now[0]+=ms,100));
  now[0]=0;
  try {ResidentCredentialShutdownRetry.await(()->{},()->false,()->true,()->now[0],ms->{throw new InterruptedException();},100);throw new AssertionError("interruption");}catch(InterruptedException expected){}
  System.out.println("PASS strict retry: later exact acknowledgment, unknown owner, live socket, canceled owner, stale acknowledgment, interruption");
 }
}
