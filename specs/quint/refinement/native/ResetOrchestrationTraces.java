package ai.alphacompute.alphaphone;

import ai.eliza.plugins.system.SenseListenerClient;
import ai.eliza.plugins.system.reset.DataReset;
import ai.eliza.plugins.system.reset.ResetAuthorization;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import org.json.JSONArray;
import org.json.JSONObject;

/** Calls the unchanged authorization, reset coordinator and application startup classes. */
public final class ResetOrchestrationTraces {
 private static final class Scenario {
  final Trace trace;
  final JSONArray events = new JSONArray();
  final ResetAuthorization authorization = new ResetAuthorization();
  final AlphaApplication application = new AlphaApplication();
  boolean preparing;
  boolean markerWriteStarted;
  boolean attemptActive;
  boolean reservationSeen;
  boolean listenerSeen;
  boolean androidSeen;
  long[] priorBudget;
  int priorListenerCalls,priorAndroidCalls;

  Scenario(String name, Path root) throws Exception {
   android.content.Context.data = root.resolve(name).toFile();
   android.content.Context.data.mkdirs();
   android.app.Application.process = "fixture.alpha";
   android.app.ActivityManager.mode = 1;
   android.app.ActivityManager.calls = 0;
   android.app.ActivityManager.startsFail = false;
   android.app.ActivityManager.starts = java.util.List.of(new android.app.ApplicationStartInfo(123, android.app.ApplicationStartInfo.START_REASON_LAUNCHER));
   android.content.Context.recoveries = 0;
   SenseListenerClient.resetSaved = false;
   SenseListenerClient.calls = 0;
   NativeSourceHost.started = 0;
   ResetTraceHooks.listenerAcknowledged = false;
   ResetTraceHooks.dispatched = false;
   ResetTraceHooks.recoveryVisible = false;
   ResetTraceHooks.failWrite = null;
   ResetTraceHooks.crashAfterCommit = null;
   ResetTraceHooks.failDirectoryAfter = null;
   ResetTraceHooks.lastCommittedName = null;
   ResetTraceHooks.skipCommitFor = null;
   ResetTraceHooks.observer = (kind, detail) -> {};
   application.attachBaseContext(application);
   application.onCreate();
   trace = new Trace(name, observe());
   trace.value.put("sourceEvents", events);
   ResetTraceHooks.observer = this::event;
  }

  JSONObject observe() {
   try {
    long[] failures = AlphaDataReset.RESET.failureState(application);
    boolean marker = AlphaDataReset.RESET.pending(application);
    return Trace.fields("review", Trace.read(authorization, "active"), "confirmed", Trace.read(authorization, "confirmed"),
      "authGeneration", Trace.read(authorization, "generation"), "marker", marker,
      "failures", Math.min(3, failures[0]), "budgetReadable", failures[1] >= 0,
      "processInitialized", NativeSourceHost.started > 0,
      "listenerRevoked", ResetTraceHooks.listenerAcknowledged,
      "dispatched", ResetTraceHooks.dispatched, "recoveryVisible", ResetTraceHooks.recoveryVisible);
   } catch (Exception error) { throw new IllegalStateException(error); }
  }

  void event(String kind, String detail) {
   if (preparing && kind.equals("write-start") && detail.equals("reset-alpha.pending")) markerWriteStarted = true;
   JSONObject observation = observe();
   long[] failures = AlphaDataReset.RESET.failureState(application);
   events.put(new JSONObject().put("kind", kind).put("detail", detail).put("observation", observation)
     .put("rawFailureCount", failures[0]).put("rawFirstFailure", failures[1])
     .put("initializerCalls", NativeSourceHost.started).put("listenerCalls", SenseListenerClient.calls)
     .put("androidCalls", android.app.ActivityManager.calls));
   if (preparing && kind.equals("durable-write") && detail.equals("reset-alpha.failures")) {
    trace.step("prepareBudget", observation, true);
   } else if (preparing && kind.equals("durable-write") && detail.equals("reset-alpha.pending")) {
    trace.step("persistMarker", observation, true); preparing = false;
   } else if (attemptActive && !reservationSeen && kind.equals("durable-write") && detail.equals("reset-alpha.failures")) {
    long[] current = AlphaDataReset.RESET.failureState(application);
    String[] record;
    try{record=Files.readString(new File(android.content.Context.data,"reset-alpha.failures").toPath()).split(":",-1);}
    catch(java.io.IOException unreadable){throw new IllegalStateException(unreadable);}
    if(record.length==3&&record[2].equals("OPEN")){
     boolean fresh = priorBudget[0] == 0 || priorBudget[1] < 0 || priorBudget[1] != current[1];
     trace.step("reserveAttempt", observation, true, fresh); reservationSeen = true;
    }else{
     if(record.length!=2||current[0]!=priorBudget[0]||current[1]!=priorBudget[1]||
       SenseListenerClient.calls!=priorListenerCalls||android.app.ActivityManager.calls!=priorAndroidCalls)
      throw new AssertionError("Open reservation settlement changed budget or dispatched an effect");
     trace.stutter("settle open reservation without dispatch",observation);
    }
   } else if (attemptActive && kind.equals("listener-result")) {
    trace.step("listenerResult", observation, Boolean.parseBoolean(detail)); listenerSeen = true;
   } else if (attemptActive && kind.equals("android-result")) {
    trace.step("androidResult", observation, Boolean.parseBoolean(detail)); androidSeen = true;
   } else if (kind.equals("recovery-visible")) trace.step("showRecovery", observation, true);
   else if (kind.equals("process-exit")) trace.step("exitProcess", observation);
   else trace.stutter(kind + " " + detail, observation);
  }

  void authorize(boolean persist, boolean interruptBefore, boolean interruptAfter) throws Exception {
   long ticket = authorization.begin(); trace.step("beginReview", observe());
   authorization.confirm(ticket); trace.step("confirm", observe(), ticket);
   boolean accepted = authorization.authenticate(ticket, true);
   events.put(new JSONObject().put("kind", "credential-result").put("accepted", accepted).put("observation", observe()));
   trace.step("authenticationResult", observe(), ticket, true);
   if (!accepted || interruptBefore) return;
   if (!persist) ResetTraceHooks.failWrite = "reset-alpha.pending";
   if (interruptAfter) ResetTraceHooks.crashAfterCommit = "reset-alpha.pending";
   preparing = true;
   try { AlphaDataReset.RESET.record(application); }
   catch (ResetTraceHooks.Interruption expected) { events.put(new JSONObject().put("kind", "process-interrupted-after-marker")); }
   catch (Exception failed) {
    events.put(new JSONObject().put("kind", "marker-write-failed").put("type", failed.getClass().getName()));
    if (AlphaDataReset.RESET.pending(application)) trace.stutter("record failed after marker commit", observe());
    else trace.step(markerWriteStarted ? "persistMarker" : "prepareBudget", observe(), false);
   }
   preparing = false;
   ResetTraceHooks.failWrite = null;
   ResetTraceHooks.crashAfterCommit = null;
   trace.stutter("record returned or interrupted", observe());
  }

  void directAttempt(long now, boolean acknowledged, int androidMode, boolean explicitRetry) {
   SenseListenerClient.resetSaved = acknowledged;
   android.app.ActivityManager.mode = androidMode;
   ResetTraceHooks.listenerAcknowledged = false;
   beginAttempt(explicitRetry);
   DataReset.Outcome outcome = explicitRetry ? AlphaDataReset.RESET.retry(application, now) : AlphaDataReset.RESET.automaticAttempt(application, now);
   endAttempt();
   events.put(new JSONObject().put("kind", "attempt-result").put("outcome", outcome.name()).put("observation", observe()));
  }

  void beginAttempt(boolean explicit) {
   attemptActive = true; reservationSeen = listenerSeen = androidSeen = false;
   priorBudget = AlphaDataReset.RESET.failureState(application);
   priorListenerCalls=SenseListenerClient.calls;priorAndroidCalls=android.app.ActivityManager.calls;
   ResetTraceHooks.listenerAcknowledged = false;
   ResetTraceHooks.dispatched = false;
   trace.step("beginAttempt", observe(), explicit);
  }
  void endAttempt() {
   if (!reservationSeen) trace.step("reserveAttempt", observe(), false, false);
   else {
    if (!listenerSeen) { trace.step("abandonReservation", observe()); attemptActive = false; return; }
    if (listenerSeen && ResetTraceHooks.listenerAcknowledged && !androidSeen) trace.step("androidResult", observe(), false);
    trace.step("finishAttempt", observe());
   }
   attemptActive = false;
  }

  void launch(int reason) {
   NativeSourceHost.started = 0;
   ResetTraceHooks.recoveryVisible = false;
   ResetTraceHooks.dispatched = false;
   android.app.ActivityManager.starts = java.util.List.of(new android.app.ApplicationStartInfo(123, reason));
   trace.step("launch", observe(), false);
   beginAttempt(false);
   try { AlphaApplication restarted = new AlphaApplication(); restarted.attachBaseContext(application); restarted.onCreate(); }
   catch (android.os.Process.Exit expected) { events.put(new JSONObject().put("kind", "startup-exited")); }
   endAttempt();
   trace.stutter("startup terminal", observe());
  }
 }

 public static void main(String[] args) throws Exception {
  Path root = Path.of(args[0]); JSONArray traces = new JSONArray();
  for (String mode : new String[]{"marker", "write-failed", "before-marker-interruption", "after-marker-interruption"}) {
   Scenario scenario = new Scenario(mode, root);
   scenario.authorize(!mode.equals("write-failed"), mode.equals("before-marker-interruption"), mode.equals("after-marker-interruption"));
   if (AlphaDataReset.RESET.pending(scenario.application)) scenario.launch(android.app.ApplicationStartInfo.START_REASON_LAUNCHER);
   traces.put(scenario.trace.value);
  }
  Scenario retired = new Scenario("retired-authentication", root);
  long token = retired.authorization.begin(); retired.trace.step("beginReview", retired.observe());
  retired.authorization.confirm(token); retired.trace.step("confirm", retired.observe(), token);
  retired.authorization.retire(); retired.trace.step("retireActivity", retired.observe());
  retired.authorization.authenticate(token, true); retired.trace.step("authenticationResult", retired.observe(), token, true);
  traces.put(retired.trace.value);

  Scenario budget = new Scenario("same-window-explicit-retry", root);
  budget.authorize(true, false, false);
  long first = System.currentTimeMillis();
  for (int attempt = 0; attempt < 3; attempt++) budget.directAttempt(first + attempt, false, 1, false);
  budget.directAttempt(first + 3, false, 1, true);
  traces.put(budget.trace.value);

  for (boolean acknowledged : new boolean[]{false, true}) for (int androidMode : new int[]{0, 1, 2}) {
   Scenario result = new Scenario("dispatch-" + acknowledged + "-" + androidMode, root);
   result.authorize(true, false, false);
   result.directAttempt(System.currentTimeMillis(), acknowledged, androidMode, false);
   traces.put(result.trace.value);
  }
  Scenario startup = new Scenario("bounded-startup", root);
  startup.authorize(true, false, false);
  for (int launch = 0; launch < 5; launch++) startup.launch(launch == 4 ? android.app.ApplicationStartInfo.START_REASON_JOB : android.app.ApplicationStartInfo.START_REASON_LAUNCHER);
  traces.put(startup.trace.value);

  Scenario acceptedPending = new Scenario("accepted-clear-marker-survives", root);
  acceptedPending.authorize(true, false, false);
  acceptedPending.directAttempt(System.currentTimeMillis(), true, 0, false);
  android.app.ActivityManager.mode = 1;
  acceptedPending.launch(android.app.ApplicationStartInfo.START_REASON_LAUNCHER);
  traces.put(acceptedPending.trace.value);

  Scenario failedBudget = new Scenario("failure-budget-write-unavailable", root);
  failedBudget.authorize(true, false, false);
  ResetTraceHooks.failWrite = "reset-alpha.failures";
  for (int launch = 0; launch < 5; launch++) failedBudget.launch(android.app.ApplicationStartInfo.START_REASON_LAUNCHER);
  if (SenseListenerClient.calls != 0 || AlphaDataReset.RESET.failureState(failedBudget.application)[0] != 0)
   throw new AssertionError("Failure-budget reproduction changed");
  traces.put(failedBudget.trace.value);

  Scenario corrupt = new Scenario("unreadable-budget", root);
  corrupt.authorize(true, false, false);
  Files.writeString(new File(android.content.Context.data, "reset-alpha.failures").toPath(), "garbage");
  corrupt.trace.step("corruptBudget", corrupt.observe());
  corrupt.launch(android.app.ApplicationStartInfo.START_REASON_JOB);
  corrupt.directAttempt(System.currentTimeMillis(), false, 1, true);
  traces.put(corrupt.trace.value);
  for (String target : new String[]{"reset-alpha.failures", "reset-alpha.pending"}) {
   Scenario partial = new Scenario("record-sync-failed-" + target, root);
   ResetTraceHooks.failDirectoryAfter = target;
   partial.authorize(true, false, false);
   traces.put(partial.trace.value);
  }
  Scenario partialReservation = new Scenario("reservation-sync-failed", root);
  partialReservation.authorize(true, false, false);
  ResetTraceHooks.failDirectoryAfter = "reset-alpha.failures";
  partialReservation.directAttempt(System.currentTimeMillis(), false, 1, false);
  partialReservation.directAttempt(System.currentTimeMillis(), false, 1, false);
  partialReservation.directAttempt(System.currentTimeMillis(), false, 1, false);
  traces.put(partialReservation.trace.value);
  Scenario uncommitted = new Scenario("reservation-not-committed", root);
  uncommitted.authorize(true, false, false);
  ResetTraceHooks.skipCommitFor = "reset-alpha.failures";
  uncommitted.directAttempt(System.currentTimeMillis(), false, 1, false);
  uncommitted.directAttempt(System.currentTimeMillis(), false, 1, false);
  traces.put(uncommitted.trace.value);
  System.out.println(traces);
 }
}
