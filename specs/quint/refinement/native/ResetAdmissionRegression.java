package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.system.SenseListenerClient;
import ai.eliza.plugins.system.reset.DataReset;
import ai.eliza.plugins.system.reset.ResetAuthorization;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

/** Actual file locks and source admission, with synthetic listener/Android ports. */
public final class ResetAdmissionRegression {
 private static int checks;
 private static AlphaApplication app;
 private static void check(boolean condition, String name) { checks++; if (!condition) throw new AssertionError(name); }
 private static void setup(Path root, String name) throws Exception {
  android.content.Context.data = root.resolve(name).toFile(); android.content.Context.data.mkdirs();
  app = new AlphaApplication(); SenseListenerClient.calls = 0; SenseListenerClient.resetSaved = false;
  android.app.ActivityManager.calls = 0; android.app.ActivityManager.mode = 1;
  ResetTraceHooks.observer = (kind, detail) -> {};
  ResetTraceHooks.failWrite = null; ResetTraceHooks.crashAfterCommit = null;
  ResetTraceHooks.failDirectoryAfter = null; ResetTraceHooks.lastCommittedName = null;
  ResetTraceHooks.skipCommitFor = null;
 }
 private static Path budget() { return new File(android.content.Context.data, "reset-alpha.failures").toPath(); }
 private static Path marker() { return new File(android.content.Context.data, "reset-alpha.pending").toPath(); }
 private static long count() { return AlphaDataReset.RESET.failureState(app)[0]; }
 private static void missingMarker() throws Exception {
  check(AlphaDataReset.RESET.automaticAttempt(app, 1000) == DataReset.Outcome.DEFERRED, "no automatic authority");
  check(AlphaDataReset.RESET.retry(app, 1000) == DataReset.Outcome.DEFERRED, "no manual authority");
  check(SenseListenerClient.calls == 0 && android.app.ActivityManager.calls == 0, "no unapproved effects");
  check(android.content.Context.data.listFiles().length == 0, "no stale callback files");
 }
 public static void main(String[] args) throws Exception {
  Path root = Path.of(args[0]);
  if (args.length > 1 && args[1].equals("child")) {
   android.content.Context.data = root.toFile(); app = new AlphaApplication(); SenseListenerClient.resetSaved = false;
   DataReset.Outcome result = AlphaDataReset.RESET.automaticAttempt(app, Long.parseLong(args[2]));
   System.out.println(new JSONObject().put("calls", SenseListenerClient.calls).put("outcome", result.name()));
   return;
  }
  setup(root, "absent"); missingMarker();
  for (String file : new String[]{"reset-alpha.failures", "reset-alpha.pending"}) {
   setup(root, "prepare-failure-" + file); ResetTraceHooks.failWrite = file;
   try { AlphaDataReset.RESET.record(app); throw new AssertionError("write accepted"); } catch (java.io.IOException expected) { }
   check(!AlphaDataReset.RESET.pending(app), "failed preparation has no marker");
   check(AlphaDataReset.RESET.automaticAttempt(app, 1000) == DataReset.Outcome.DEFERRED && SenseListenerClient.calls == 0, "failed preparation dispatches nothing");
  }
  setup(root, "reservation-failure"); AlphaDataReset.RESET.record(app); ResetTraceHooks.failWrite = "reset-alpha.failures";
  for (int i = 0; i < 5; i++) check(AlphaDataReset.RESET.automaticAttempt(app, 1000) == DataReset.Outcome.DEFERRED, "unwritable automatic budget");
  check(count() == 0 && SenseListenerClient.calls == 0 && android.app.ActivityManager.calls == 0, "failed reservation never dispatches");
  ResetTraceHooks.failWrite = null;
  check(AlphaDataReset.RESET.automaticAttempt(app, 1000) == DataReset.Outcome.LISTENER_UNACKNOWLEDGED && count() == 1, "reservation recovers durably");
  for(String target:new String[]{"reset-alpha.failures","reset-alpha.pending"}){
   setup(root,"post-commit-"+target);ResetTraceHooks.failDirectoryAfter=target;
   try{AlphaDataReset.RESET.record(app);throw new AssertionError("directory sync accepted");}catch(java.io.IOException expected){}
   check(Files.exists(budget())&&count()==0,"committed initial budget survives exception");
   check(AlphaDataReset.RESET.pending(app)==target.equals("reset-alpha.pending"),"marker reflects committed bytes after exception");
   check(Files.readString(budget()).equals("0:0")&&(!Files.exists(marker())||java.util.Arrays.equals(Files.readAllBytes(marker()),new byte[]{1})),
     "exact committed bytes survive post-replacement failure");
  }
  setup(root,"reservation-sync");AlphaDataReset.RESET.record(app);ResetTraceHooks.failDirectoryAfter="reset-alpha.failures";
  check(AlphaDataReset.RESET.automaticAttempt(app,1000)==DataReset.Outcome.DEFERRED&&count()==1&&SenseListenerClient.calls==0,
    "failed directory sync keeps consumed reservation without dispatch");
  AlphaDataReset.RESET.automaticAttempt(app,1001);check(count()==2&&SenseListenerClient.calls==1,"next admission uses next slot");
  setup(root,"silent-noncommit");AlphaDataReset.RESET.record(app);ResetTraceHooks.skipCommitFor="reset-alpha.failures";
  check(AlphaDataReset.RESET.automaticAttempt(app,1000)==DataReset.Outcome.DEFERRED&&count()==0&&SenseListenerClient.calls==0,
    "readback detects silent AtomicFile noncommit before effects");

  setup(root, "crash-reservation"); AlphaDataReset.RESET.record(app); ResetTraceHooks.crashAfterCommit = "reset-alpha.failures";
  try { AlphaDataReset.RESET.automaticAttempt(app, 1000); throw new AssertionError("missing crash"); } catch (ResetTraceHooks.Interruption expected) { }
  check(count() == 1 && SenseListenerClient.calls == 0, "crash consumes reservation before effect");
  ResetTraceHooks.crashAfterCommit = null; AlphaDataReset.RESET.automaticAttempt(app, 1001);
  check(count() == 2 && SenseListenerClient.calls == 1, "restart cannot reuse reservation");

  setup(root, "exhausted"); AlphaDataReset.RESET.record(app);
  for (int i = 0; i < 3; i++) AlphaDataReset.RESET.automaticAttempt(app, 1000 + i);
  check(count() == 3 && SenseListenerClient.calls == 3, "three admitted attempts");
  check(AlphaDataReset.RESET.automaticAttempt(app, 1003) == DataReset.Outcome.DEFERRED && SenseListenerClient.calls == 3, "fourth automatic deferred");
  AlphaDataReset.RESET.retry(app, 1004); check(count() == 4 && SenseListenerClient.calls == 4, "manual retry retains window count");
  AlphaDataReset.RESET.record(app); check(count() == 4, "repeated record preserves existing budget");
  Files.writeString(budget(), Integer.MAX_VALUE + ":1000"); AlphaDataReset.RESET.retry(app, 1005);
  check(count() == Integer.MAX_VALUE, "count saturates without overflow");

  for (String corrupt : new String[]{null, "garbage", "0:0:", "0:0::", "0:0:0"}) {
   setup(root, "legacy-" + corrupt); Files.write(marker(), new byte[]{1});
   if (corrupt != null) Files.writeString(budget(), corrupt);
   check(AlphaDataReset.RESET.automaticAttempt(app, 1000) == DataReset.Outcome.DEFERRED && SenseListenerClient.calls == 0, "legacy invalid budget deferred");
   AlphaDataReset.RESET.retry(app, 1000); check(count() == 1 && SenseListenerClient.calls == 1, "explicit legacy repair reserves first");
  }
  setup(root, "window"); AlphaDataReset.RESET.record(app);
  for (long now : new long[]{61000, 999}) {
   Files.writeString(budget(), "3:1000"); AlphaDataReset.RESET.automaticAttempt(app, now);
   check(count() == 1 && AlphaDataReset.RESET.failureState(app)[1] == now, "boundary or backward clock creates window");
  }
  setup(root, "order"); AlphaDataReset.RESET.record(app); SenseListenerClient.resetSaved = true;
  ResetTraceHooks.observer = (kind, detail) -> {
   if (kind.equals("listener-result") || kind.equals("android-call")) check(count() == 1, "durable reservation before external callback");
  };
  AlphaDataReset.RESET.automaticAttempt(app, 1000);
  check(android.app.ActivityManager.calls == 1, "acknowledgement precedes Android");
  ResetTraceHooks.observer = (kind, detail) -> {};

  setup(root, "removed"); AlphaDataReset.RESET.record(app);
  ResetTraceHooks.observer = (kind, detail) -> {
   if (kind.equals("durable-write") && detail.equals("reset-alpha.failures")) marker().toFile().delete();
  };
  check(AlphaDataReset.RESET.automaticAttempt(app, 1000) == DataReset.Outcome.DEFERRED && SenseListenerClient.calls == 0, "removed marker retires reserved call");
  ResetTraceHooks.observer = (kind, detail) -> {};

  setup(root, "removed-during-listener"); AlphaDataReset.RESET.record(app); SenseListenerClient.resetSaved = true;
  ResetTraceHooks.observer = (kind, detail) -> {
   if (kind.equals("listener-result")) marker().toFile().delete();
  };
  check(AlphaDataReset.RESET.automaticAttempt(app, 1000) == DataReset.Outcome.DEFERRED && android.app.ActivityManager.calls == 0,
    "marker removed during listener retires clear callback");
  ResetTraceHooks.observer = (kind, detail) -> {};

  setup(root, "concurrent"); AlphaDataReset.RESET.record(app); long now = System.currentTimeMillis(); Files.writeString(budget(), "2:" + now);
  String java = Path.of(System.getProperty("java.home"), "bin", "java").toString();
  ProcessBuilder command = new ProcessBuilder(java, "-cp", System.getProperty("java.class.path"), ResetAdmissionRegression.class.getName(), android.content.Context.data.toString(), "child", Long.toString(now));
  java.lang.Process first = command.start(), second = command.start();
  check(first.waitFor(15, TimeUnit.SECONDS) && second.waitFor(15, TimeUnit.SECONDS), "children complete");
  String firstOut = new String(first.getInputStream().readAllBytes()), secondOut = new String(second.getInputStream().readAllBytes());
  check(first.exitValue() == 0 && second.exitValue() == 0, "child failures " + new String(first.getErrorStream().readAllBytes()) + new String(second.getErrorStream().readAllBytes()));
  check(new JSONObject(firstOut).getInt("calls") + new JSONObject(secondOut).getInt("calls") == 1, "cross-process final slot reserved once");
  check(count() == 3, "cross-process durable count");
  setup(root, "contended-lock"); AlphaDataReset.RESET.record(app);
  try(java.io.RandomAccessFile held=new java.io.RandomAccessFile(new File(android.content.Context.data,"reset-alpha.lock"),"rw");
      java.nio.channels.FileLock lock=held.getChannel().lock()){
   java.lang.Process blocked=new ProcessBuilder(java,"-cp",System.getProperty("java.class.path"),ResetAdmissionRegression.class.getName(),
     android.content.Context.data.toString(),"child",Long.toString(now)).start();
   check(blocked.waitFor(5,TimeUnit.SECONDS),"contended process must not wait on another reset");
   JSONObject answer=new JSONObject(new String(blocked.getInputStream().readAllBytes()));
   check(answer.getInt("calls")==0&&answer.getString("outcome").equals("DEFERRED"),"contended lock defers without effects");
  }
  System.out.println(new JSONObject().put("checks", checks).put("crossProcess", true));
 }
}
