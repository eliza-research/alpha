package ai.alphacompute.alphaphone;

import ai.eliza.plugins.agent.runtime.CredentialShutdownLease;
import ai.eliza.plugins.agent.updater.RuntimeUpdatePause;
import android.content.Context;
import android.content.pm.PackageInstaller;
import android.os.Build;
import android.provider.Settings;
import androidx.lifecycle.Lifecycle;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import java.io.File;
import java.nio.channels.FileChannel;
import java.nio.file.AccessDeniedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

public final class UpdateCompositionHarness {
 private static final int SESSION = 41;

 private static final class Gate implements Runnable {
  final CountDownLatch entered = new CountDownLatch(1);
  final CountDownLatch resume = new CountDownLatch(1);
  @Override public void run() {
   entered.countDown();
   try { require(resume.await(10, TimeUnit.SECONDS), "controller did not release its fixture port"); }
   catch (InterruptedException interrupted) { throw new AssertionError(interrupted); }
  }
  void await() throws Exception { require(entered.await(10, TimeUnit.SECONDS), "source did not reach fixture port"); }
  void open() { resume.countDown(); }
 }

 private final Context context;
 private final PackageInstaller installer;
 private final Path journal;
 private final Object lock;
 private final Trace trace;
 private final Map<Integer,AlphaDevicePlugin> bridges = new TreeMap<>();
 private final Map<Plugin,JSObject> requests = new ConcurrentHashMap<>();
 private final String baseline, target, signer;
 private String activationId;
 private String journalOutcome = "configured";
 private boolean zero = true;
 private boolean syncDenied;
 private PluginCall install;
 private final Gate acquiring = new Gate(), confirming = new Gate(), sending = new Gate();

 private UpdateCompositionHarness(String name, File cache) throws Exception {
  context = UpdateFlowTest.installing(cache);
  AlphaDevicePlugin.UpdatePause.configure(context);
  installer = context.packages.installer;
  journal = context.data.toPath().resolve("app-update-pause");
  baseline = AlphaDevicePlugin.UpdatePause.digest(AlphaDevicePlugin.UpdatePause.executingApk);
  target = UpdateFlowTest.offered().getData().optString("sha256");
  signer = AlphaDevicePlugin.appSigner(context);
  lock = field("updateBarrier");
  Plugin.ready = requests::put;
  AlphaLocalAgentPlugin.acquiring = acquiring;
  AlphaLocalAgentPlugin.confirming = confirming;
  installer.sending = sending;
  trace = new Trace(name, observe());
 }

 private static void require(boolean condition, String error) {
  if (!condition) throw new AssertionError(error);
 }
 private static Object field(String name) throws Exception {
  var field = AlphaDevicePlugin.class.getDeclaredField(name);
  field.setAccessible(true);
  return field.get(null);
 }
 private int exactActivation(String id) {
  if (id == null) return 0;
  require(activationId != null && activationId.equals(id), "unexpected activation UUID");
  return 1;
 }
 private int bridgeNumber(Object bridge) throws Exception {
  if (bridge == null) return 0;
  for (var entry : bridges.entrySet()) {
   if (entry.getValue() == bridge || Trace.read(entry.getValue(), "updateBridgeId").equals(bridge)) return entry.getKey();
  }
  throw new AssertionError("unexpected bridge receipt");
 }
 private JSONArray bridgeSet(Object raw) throws Exception {
  var ids = new ArrayList<Integer>();
  for (Object bridge : (Set<?>) raw) ids.add(bridgeNumber(bridge));
  Collections.sort(ids);
  return new JSONArray(ids);
 }
 private String digest(String hash) {
  if (baseline.equals(hash)) return "base";
  if (target.equals(hash)) return "target";
  throw new AssertionError("unexpected APK digest");
 }
 private JSONObject record(RuntimeUpdatePause.Record row) {
  if (row == null) return new JSONObject().put("id",0).put("session",0).put("boot",0)
   .put("baselineCode",0).put("baselineDigest","none").put("targetCode",0)
   .put("targetDigest","none").put("signer","none").put("committing",false);
  require(signer.equals(row.signer), "journal signer matches the admitted archive");
  return new JSONObject().put("id",exactActivation(row.id)).put("session",row.session).put("boot",row.boot)
   .put("baselineCode",row.baselineCode).put("baselineDigest",digest(row.baselineDigest))
   .put("targetCode",row.targetCode).put("targetDigest",digest(row.targetDigest)).put("signer","trusted")
   .put("committing",row.committing);
 }

 private JSONObject observe() throws Exception {
  synchronized (lock) {
   var row = AlphaDevicePlugin.UpdatePause.store().read();
   Object active = field("activation"), prepared = field("updateResume");
   Boolean ready = active == null ? null : (Boolean)((CompletableFuture<?>)Trace.read(active,"ready")).getNow(null);
   var info = installer.getSessionInfo(SESSION);
   String session = info == null ? "absent" : info.isSealed() ? "sealed" : "bound";
   if (info != null) {
    zero = info.getProgress() == 0f;
    String expected = "alpha-update://" + context.getPackageName() + "/8/" + target + "/" + signer +
      "/" + Settings.Global.bootCount + "/intent";
    require(expected.equals(String.valueOf(info.getReferrerUri())), "exact Android session binding");
   }
   var evidence = new JSONObject().put("session",session).put("zero",zero).put("boot",Settings.Global.bootCount)
    .put("sdk",Build.VERSION.SDK_INT).put("releaseBuild","REL".equals(Build.VERSION.CODENAME))
    .put("installedCode",context.packages.installed.getLongVersionCode())
    .put("installedDigest",digest(AlphaDevicePlugin.UpdatePause.digest(context.getApplicationInfo().sourceDir)))
    .put("signer","trusted").put("confirmed",AlphaLocalAgentPlugin.confirmed);
   boolean startup = true;
   try { RuntimeUpdatePause.beforeStart(); }
   catch (IllegalStateException pending) { startup = false; }
   long request = AlphaDevicePlugin.UpdatePause.shutdownRequest;
   boolean lease = AlphaLocalAgentPlugin.lease.isCurrent(request);
   require(lease == (request >= 0), "wrapper and exact resident shutdown lease agree");
   if (lease) {
    try { AlphaLocalAgentPlugin.lease.beforeStart(); throw new AssertionError("owned lease admitted startup"); }
    catch (CredentialShutdownLease.Pending pending) { /* Actual service lease rejected startup. */ }
   }
   int terminal = exactActivation((String)field("settledActivation"));
   int audience = bridgeNumber(field("settledResumeBridge"));
   for (var entry : bridges.entrySet()) {
    var read = nativeRead(entry.getValue());
    require(read.optBoolean("pending", false) == !startup, "renderer readback and startup gate agree");
    require(read.optBoolean("resume", false) == (startup && audience == entry.getKey()), "exact resume readback audience");
   }
   int pendingSession = prepared != null && active == null && installer.committed.contains((Integer)field("updateSession"))
    ? exactActivation((String)Trace.read(prepared,"id")) : 0;
   String outcome = (String)field("settledOutcome");
   return new JSONObject()
    .put("startupAdmitted",startup).put("residentStartAdmitted",startup && !lease)
    .put("resumeAudience",startup ? audience : 0)
    .put("state.activation.registered",bridgeSet(field("updateBridges")))
    .put("state.activation.seen",new JSONArray(bridges.keySet()))
    .put("state.activation.serial",activationId == null ? 0 : 1)
    .put("state.activation.installerOwner",active == null ? 0 : bridgeNumber(Trace.read(active,"owner")))
    .put("state.activation.active",active == null ? 0 : exactActivation((String)Trace.read(active,"id")))
    .put("state.activation.waiting",active == null ? new JSONArray() : bridgeSet(Trace.read(active,"waiting")))
    .put("state.activation.acknowledged",active == null ? new JSONArray() : bridgeSet(Trace.read(active,"acknowledged")))
    .put("state.activation.eligible",active == null ? new JSONArray() : bridgeSet(Trace.read(active,"resumeEligible")))
    .put("state.activation.invalid",active != null && (Boolean)Trace.read(active,"invalid"))
    .put("state.activation.ready",active == null ? "none" : ready == null ? "pending" : ready ? "yes" : "no")
    .put("state.activation.sealed",active != null && (Boolean)Trace.read(active,"sealed"))
    .put("state.activation.stopRequested",active != null && request >= 0)
    .put("state.activation.prepared",prepared == null ? 0 : exactActivation((String)Trace.read(prepared,"id")))
    .put("state.activation.preparedOwner",prepared == null ? 0 : bridgeNumber(Trace.read(prepared,"initiatingBridge")))
    .put("state.activation.preparedEligible",prepared == null ? new JSONArray() : bridgeSet(Trace.read(prepared,"eligible")))
    .put("state.activation.pendingSession",pendingSession)
    .put("state.activation.confirmationOwner",bridgeNumber(field("updateOwner")))
    .put("state.activation.terminal",terminal).put("state.activation.outcome",outcome == null ? "none" : outcome)
    .put("state.activation.resumeBridge",audience)
    .put("state.activation.commits",installer.committed.size())
    .put("state.activation.stopCalls",AlphaLocalAgentPlugin.stops)
    .put("state.pause.file",row != null ? "record" : Files.exists(journal.resolve("pause")) ? "empty" : "missing")
    .put("state.pause.record",record(row)).put("state.pause.staged",Files.exists(journal.resolve("pause.next")))
    .put("state.pause.liveOwner",exactActivation(AlphaDevicePlugin.UpdatePause.liveOwner))
    .put("state.pause.shutdown",lease).put("state.pause.stops",AlphaLocalAgentPlugin.stops)
    .put("state.pause.releases",AlphaLocalAgentPlugin.releases).put("state.pause.evidence",evidence)
    .put("state.pause.outcome",journalOutcome).put("state.pause.syncDenied",syncDenied)
    .put("state.pause.generation",1).put("state.pause.executingCode",BuildConfig.VERSION_CODE)
    .put("state.pause.executingDigest",digest(AlphaDevicePlugin.UpdatePause.digest(AlphaDevicePlugin.UpdatePause.executingApk)));
  }
 }

 private static JSObject nativeRead(AlphaDevicePlugin bridge) throws Exception {
  var read = AlphaDevicePlugin.class.getDeclaredMethod("readUpdateState");
  read.setAccessible(true);
  return (JSObject)read.invoke(bridge);
 }
 private JSObject updateState(int bridge) throws Exception {
  PluginCall call = new PluginCall(new JSObject());
  bridges.get(bridge).updateState(call);call.awaitAnswer();
  require(call.resolved.get() == 1,"native state readback resolved");
  return call.result;
 }
 private void register(int bridge) throws Exception {
  bridges.put(bridge,UpdateFlowTest.bridge(context,Lifecycle.State.RESUMED));
  trace.step("register",observe(),bridge);
 }
 private void begin() throws Exception {
  install = UpdateFlowTest.offered();
  bridges.get(1).installUpdate(install);
  long deadline = System.nanoTime()+TimeUnit.SECONDS.toNanos(10);
  while (requests.size() < bridges.size() && System.nanoTime() < deadline) Thread.sleep(1);
  require(requests.size() == bridges.size(),"exact draft barrier reached all registered bridges");
  activationId = requests.get(bridges.get(1)).optString("activationId");
  trace.step("begin",observe(),1);
 }
 private void ack(int bridge, boolean ready, boolean eligible) throws Exception {
  synchronized (lock) {
   var event = requests.get(bridges.get(bridge));
   var data = new JSObject().put("activationId",event.optString("activationId"))
    .put("bridgeId",event.optString("bridgeId")).put("ready",ready);
   if (eligible) data.put("resumeEligible",true);
   var call = new PluginCall(data);
   bridges.get(bridge).activateUpdate(call);
   require(call.resolved.get() == 1,"exact draft receipt admitted");
   var observation=observe();
   var ack=Trace.action("acknowledge",bridge,1,bridge,ready ? "yes" : "no",eligible ? "eligible" : "absent");
   // Android staging can be abandoned before the worker reacquires updateBarrier to publish failure.
   if (!ready && "absent".equals(observation.getJSONObject("state.pause.evidence").getString("session")))
    trace.macro("draft refusal and independently observed staging abandonment",observation,ack,Trace.action("observeAbandonedStage"));
   else trace.macro("exact draft receipt",observation,ack);
  }
 }
 private void staged() throws Exception {
  register(1);register(2);begin();ack(1,true,true);ack(2,true,false);
  acquiring.await();journalOutcome="acquired";
  trace.step("sealAcquire",observe());
  acquiring.open();confirming.await();journalOutcome="stopped";
  trace.step("requestConfirmedStop",observe());
  confirming.open();sending.await();journalOutcome="committing";
  trace.step("markCommitting",observe());
  sending.open();install.awaitAnswer();
  require(install.resolved.get()==1,"synthetic Android commit returned");
  trace.macro("Android session takes custody after the durable commit mark",observe(),
   Trace.action("handOff"),Trace.action("observeSession","sealed",false));
 }
 private void endSession() throws Exception {
  installer.destroy(SESSION);
  trace.step("observeSession",observe(),"absent",false);
 }
 private void continueFromStartupBridge() throws Exception {
  UpdateFlowTest.confirmation(context,SESSION);
  UpdateFlowTest.dismissed(bridges.get(1));
  var paused=updateState(2);
  require(paused.optBoolean("canContinue",false),"startup bridge can continue exact Android confirmation");
  var data=new JSObject().put("activationId",paused.optString("activationId")).put("bridgeId",paused.optString("bridgeId"));
  var call=new PluginCall(data);
  bridges.get(2).continueUpdate(call);call.awaitAnswer();
  require(call.resolved.get()==1 && field("updateOwner")==bridges.get(2),"continued Android confirmation owns no mounted resume receipt");
  trace.step("continueConfirmation",observe(),2);
 }

 private JSONObject run(String mode) throws Exception {
  switch (mode) {
   case "refused-before-pause":
    register(1);begin();ack(1,false,false);install.awaitAnswer();
    require(install.rejected.get()==1,"refused preparation never dispatched install");
    trace.step("refuse",observe());
    break;
   case "exact-canceled-release":
    staged();continueFromStartupBridge();endSession();
    var canceled=updateState(2);
    require("canceled".equals(canceled.optString("outcome")) && AlphaLocalAgentPlugin.releases==1,"confirmed exact release precedes terminal");
    journalOutcome="released";
    trace.step("publishCancellation",observe(),2);
    break;
   case "ambiguous-terminal-sync":
    staged();endSession();
    if (!Files.getFileStore(journal).supportsFileAttributeView("posix"))
     return new JSONObject().put("skip","POSIX directory permissions unavailable");
    Files.setPosixFilePermissions(journal,PosixFilePermissions.fromString("-wx------"));
    try (var channel=FileChannel.open(journal,StandardOpenOption.READ)) {
     return new JSONObject().put("skip","host bypasses POSIX mode denial");
    } catch (AccessDeniedException expected) {
     syncDenied=true;trace.step("denySync",observe(),true);
     try { AlphaDevicePlugin.UpdatePause.reconcile();throw new AssertionError("directory sync unexpectedly succeeded"); }
     catch (AccessDeniedException denied) { journalOutcome="sync-error"; }
     trace.step("reconcileHeld",observe());
    } finally {
     Files.setPosixFilePermissions(journal,PosixFilePermissions.fromString("rwx------"));
    }
    syncDenied=false;trace.step("denySync",observe(),false);
    var idle=updateState(2);
    require(idle.optBoolean("idle",false) && idle.optString("outcome")==null && AlphaLocalAgentPlugin.releases==0,
     "no terminal or lease release may be inferred from the visible tombstone");
    journalOutcome="held";
    trace.step("reconcileHeld",observe());
    break;
   default: throw new IllegalArgumentException(mode);
  }
  return new JSONObject().put("trace",trace.value);
 }

 private void close() throws Exception {
  acquiring.open();confirming.open();sending.open();
  UpdateFlowTest.retireFixtureWorkers();
  erase(context.data.toPath());
 }
 private static void erase(Path directory) throws Exception {
  try (var files=Files.walk(directory)) {
   for (Path path:files.sorted(Comparator.reverseOrder()).toArray(Path[]::new)) Files.delete(path);
  }
 }
 public static void main(String[] args) throws Exception {
  UpdateFlowTest.serveFixtureHttps();
  Path cache=Files.createTempDirectory("quint-update-composition");
  var fixture=new UpdateCompositionHarness(args[0],cache.toFile());
  try { System.out.println(fixture.run(args[0])); }
  finally { fixture.close();erase(cache); }
 }
}
