package ai.elizaresearch.alphaphone;

import ai.elizaresearch.alphaphone.ResidentScheduleRearm.Decision;

/** Plain-JVM checks of the resident schedule re-arming policy. Not an Android, emulator or device test. */
public final class ResidentScheduleRearmTest {
 private static void check(boolean condition,String name){if(!condition)throw new AssertionError(name);}

 public static void main(String[] args){
  String[] rearming={ResidentScheduleRearm.BOOT_COMPLETED,ResidentScheduleRearm.PACKAGE_REPLACED,ResidentScheduleRearm.TIME_SET,ResidentScheduleRearm.TIMEZONE_CHANGED};
  for(String action:rearming){
   check(ResidentScheduleRearm.handles(action),"handles "+action);
   check(ResidentScheduleRearm.decide(action,true,true,true,true)==Decision.START,"starts on "+action);
   check(ResidentScheduleRearm.decide(action,false,true,true,true)==Decision.LOCKED,"waits for unlock on "+action);
   check(ResidentScheduleRearm.decide(action,true,false,true,true)==Decision.NOT_PACKAGED,"needs a packaged runtime on "+action);
   check(ResidentScheduleRearm.decide(action,true,true,false,true)==Decision.NOT_ENABLED,"fresh install is not started on "+action);
   check(ResidentScheduleRearm.decide(action,true,true,true,false)==Decision.LIFECYCLE_BUSY,"never races a stop or provider change on "+action);
  }
  for(String action:new String[]{null,"","android.intent.action.LOCKED_BOOT_COMPLETED","android.intent.action.SCREEN_ON","android.intent.action.TIME_TICK"}){
   check(!ResidentScheduleRearm.handles(action),"ignores "+action);
   check(ResidentScheduleRearm.decide(action,true,true,true,true)==Decision.IGNORE,"never starts on "+action);
  }
  // Admission and start share one lock: the idle check and the start both run while it is held.
  Object lock=new Object();
  int[] started={0};boolean[] heldAtCheck={false},heldAtStart={false};
  Decision started1=ResidentScheduleRearm.admitAndStart(lock,ResidentScheduleRearm.BOOT_COMPLETED,true,true,true,
   ()->{heldAtCheck[0]=Thread.holdsLock(lock);return true;},()->{heldAtStart[0]=Thread.holdsLock(lock);started[0]++;});
  check(started1==Decision.START&&started[0]==1,"admitted start runs once");
  check(heldAtCheck[0]&&heldAtStart[0],"check and start run under the lifecycle lock");
  check(ResidentScheduleRearm.admitAndStart(lock,ResidentScheduleRearm.TIME_SET,true,true,true,()->false,()->started[0]++)==Decision.LIFECYCLE_BUSY&&started[0]==1,"a stopping lifecycle never starts");
  check(ResidentScheduleRearm.admitAndStart(lock,ResidentScheduleRearm.TIME_SET,true,true,false,()->true,()->started[0]++)==Decision.NOT_ENABLED&&started[0]==1,"not enabled never starts");
  check(ResidentScheduleRearm.admitAndStart(lock,"android.intent.action.SCREEN_ON",true,true,true,()->true,()->started[0]++)==Decision.IGNORE&&started[0]==1,"other broadcasts never start");
  // A stop that waits for the lock lands only after the admitted start, never between check and start.
  Thread stopper=new Thread(()->{synchronized(lock){}});
  boolean[] stopperWaited={false};
  ResidentScheduleRearm.admitAndStart(lock,ResidentScheduleRearm.BOOT_COMPLETED,true,true,true,()->{stopper.start();return true;},()->{
   try{stopper.join(100);}catch(InterruptedException e){throw new AssertionError(e);}
   stopperWaited[0]=stopper.isAlive();
  });
  try{stopper.join(5000);}catch(InterruptedException e){throw new AssertionError(e);}
  check(stopperWaited[0]&&!stopper.isAlive(),"a concurrent stop waits for the admitted start");
  System.out.println("PASS resident schedule rearm");
 }
}
