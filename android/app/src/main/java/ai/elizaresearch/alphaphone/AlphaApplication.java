package ai.elizaresearch.alphaphone;

/** Install the read-only native source callback before any resident service starts. */
public final class AlphaApplication extends android.app.Application {
 @Override protected void attachBaseContext(android.content.Context base){
  super.attachBaseContext(base);
  // Runs before ContentProvider/AndroidX Startup initialization, including WorkManager.
  // The provider-free reset recovery process shows the unfinished reset and must not stop itself.
  // A pending reset revokes Cloud keys (bounded), retries and stops this process (shared DataReset).
  AlphaDataReset.RESET.admitBeforeStartup(base,getProcessName());
 }
 private boolean resetRecoveryProcess(){return AlphaDataReset.RESET.isRecoveryProcess(this,getProcessName());}
 @Override public void onCreate(){
  super.onCreate();
  if(resetRecoveryProcess())return;NativeDigestHost host=new NativeDigestHost(this);NativeSourceHost.configure(host::read);NativeOwnerReminderHost owner=new NativeOwnerReminderHost(this);NativeSourceHost.configureOwnerReminderContext(owner::read);
  // Isolated helper processes have no app storage; only the main process keeps the problem log and schedules upkeep.
  if(android.os.Process.isIsolated()||!getPackageName().equals(getProcessName()))return;
  ai.eliza.plugins.system.crash.CrashLog.install(this);
  // A listener wake that reaches a cold process may start voice once the renderer binds a session
  // for the same native owner (shared SenseInvocation); before this registration it only opens.
  new ai.eliza.plugins.system.SenseListenerClient(this).admitOwner(()->AlphaLocalAgentPlugin.invocationOwner(this));
  // Shared voice latency trials keep Alpha's existing timing document name and build identity.
  ai.eliza.voice.VoiceLatencyProbe.configureHost("alpha-native-voice-timing-v3",BuildConfig.ELIZA_SOURCE_COMMIT,BuildConfig.ELIZA_SOURCE_DIRTY,BuildConfig.FLAVOR+"-"+BuildConfig.BUILD_TYPE);
  try{NativeDeletionCoordinator.get(this).start();}catch(RuntimeException unavailable){/* Pending intents remain durable and visible on next foreground read. */}
  try{AlphaNoteAudioPlugin.scheduleTrashBackstop(this);}catch(RuntimeException unavailable){/* Retried on the next start; the renderer still purges Trash. */}
 }
}
