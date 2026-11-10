package ai.elizaresearch.alphaphone;

/** Bounded strict-shutdown observation. Never invents an acknowledgment or starts a runtime. */
final class ResidentCredentialShutdownRetry {
 interface Guard { void check() throws Exception; }
 interface Probe { boolean confirmed() throws Exception; }
 interface Clock { long now(); }
 interface Pause { void sleep(long millis) throws InterruptedException; }
 static void await(Guard owner,Probe exactRequest,Probe absent,Clock clock,Pause pause,long timeout)throws Exception {
  long deadline=clock.now()+timeout;
  while(true){
   owner.check();
   boolean acknowledged=exactRequest.confirmed();
   boolean stopped=absent.confirmed();
   owner.check();
   if(acknowledged&&stopped&&exactRequest.confirmed())return;
   if(clock.now()>=deadline)throw new IllegalStateException("Native shutdown unconfirmed");
   pause.sleep(50);
  }
 }
}
