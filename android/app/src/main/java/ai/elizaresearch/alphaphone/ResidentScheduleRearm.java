package ai.elizaresearch.alphaphone;

/**
 * Pure policy for bringing the resident agent back after reboot, an app update, or a clock or
 * time-zone change (#394). Digests and agent schedules live in the resident runtime and run only
 * while it does, so this only starts a resident that is not running; a running resident is left
 * untouched (the start is a no-op) and keeps relying on the runtime's own timers. Nothing is
 * replayed here; how the runtime treats an occurrence that passed while it was off is upstream
 * behaviour and was not exercised by this policy's tests. Lifecycle state is process-local, so an
 * owner stop does not survive process death or reboot: the next broadcast brings the agent back, as
 * the always-on on-device agent intends. No Android imports: plain-JVM tested.
 */
final class ResidentScheduleRearm {
 static final String BOOT_COMPLETED="android.intent.action.BOOT_COMPLETED";
 static final String PACKAGE_REPLACED="android.intent.action.MY_PACKAGE_REPLACED";
 static final String TIME_SET="android.intent.action.TIME_SET";
 static final String TIMEZONE_CHANGED="android.intent.action.TIMEZONE_CHANGED";

 enum Decision {
  /** Not a re-arming broadcast. */
  IGNORE,
  /** Credential-encrypted agent state is unavailable; the owner's unlock and next launch start it. */
  LOCKED,
  /** This build carries no on-device runtime. */
  NOT_PACKAGED,
  /** The owner has not enabled the on-device agent here (fresh install) or the device is below its floor. */
  NOT_ENABLED,
  /** A surface is stopping the agent or changing its provider; that lifecycle owns the next start. */
  LIFECYCLE_BUSY,
  /** Start a resident that is not running. A running resident is untouched: the start is a no-op. */
  START
 }

 private ResidentScheduleRearm(){}

 static boolean handles(String action){
  return BOOT_COMPLETED.equals(action)||PACKAGE_REPLACED.equals(action)||TIME_SET.equals(action)||TIMEZONE_CHANGED.equals(action);
 }

 /**
  * Admission and start under one lock, so a stop or provider change cannot land between the check
  * and the start (a start delivered after that stop would leave a service with no agent).
  */
 static Decision admitAndStart(Object lock,String action,boolean userUnlocked,boolean runtimePackaged,boolean ownerEnabled,java.util.function.BooleanSupplier lifecycleIdle,Runnable start){
  synchronized(lock){
   Decision decision=decide(action,userUnlocked,runtimePackaged,ownerEnabled,lifecycleIdle.getAsBoolean());
   if(decision==Decision.START)start.run();
   return decision;
  }
 }

 static Decision decide(String action,boolean userUnlocked,boolean runtimePackaged,boolean ownerEnabled,boolean lifecycleIdle){
  if(!handles(action))return Decision.IGNORE;
  if(!userUnlocked)return Decision.LOCKED;
  if(!runtimePackaged)return Decision.NOT_PACKAGED;
  if(!ownerEnabled)return Decision.NOT_ENABLED;
  if(!lifecycleIdle)return Decision.LIFECYCLE_BUSY;
  return Decision.START;
 }
}
