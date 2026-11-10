package ai.alphacompute.alphaphone;

import ai.eliza.plugins.actionjournal.deletion.DeferredDeletionCoordinator;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.*;

/** Executes the whole coordinator and journal, observing persisted bytes and provider calls. */
public final class DeletionCoordinatorTraces {
  static DeferredDeletionCoordinator coordinator;
  static Trace trace;
  static String previous = "absent";
  static boolean reminder;
  static final JSONArray events = new JSONArray();
  static final JSONObject target =
      new JSONObject().put("version", 3).put("sourceId", "1").put("eventId", "2").put("revision", "0");
  static void check(boolean condition, String reason) {
    if (!condition)
      throw new AssertionError(reason);
  }
  static JSONObject row() {
    if (reminder)
      return DeletionTestPorts.reminders.optJSONObject(0);
    String bytes = DeletionTestPorts.values.get(NativeDeletionCoordinator.JOURNAL);
    return bytes == null ? null : new JSONObject(bytes).getJSONObject("records").optJSONObject("first");
  }
  static int admitted(JSONObject row) {
    if (row == null)
      return 0;
    String phase = row.getString("phase");
    return row.has("outcome")
            || java.util.Set.of("dispatching", "deleted", "conflict", "unknown").contains(phase)
        ? 1
        : 0;
  }
  static JSONObject observe() {
    JSONObject row = row();
    JSONObject observed =
        Trace.fields("phase", row == null ? "absent" : row.getString("phase"), "dispatches", admitted(row));
    events.put(new JSONObject()
            .put("observation", observed)
            .put("providerCalls", DeletionTestPorts.deletes)
            .put("writes", DeletionTestPorts.writes)
            .put("schedules", new JSONArray(DeletionTestPorts.schedules))
            .put("journal", row == null ? JSONObject.NULL : row));
    return observed;
  }
  static JSONObject receipt() throws Exception {
    JSONObject row = coordinator.receipt(reminder ? "reminder" : "calendar", "first");
    return Trace.fields(
        "phase", row == null ? "absent" : row.getString("phase"), "dispatches", admitted(row));
  }
  static void writeObserved() {
    if (trace == null)
      return;
    JSONObject row = row();
    String next = row == null ? "absent" : row.getString("phase");
    JSONObject observation = observe();
    if (!next.equals(previous)) {
      if (next.equals("queued"))
        trace.step("stage", observation);
      else if (next.equals("dispatching") || next.equals("paused") && previous.equals("queued"))
        trace.step("claim", observation);
      else if (next.equals("undone"))
        trace.step("undo", observation);
      else if (previous.equals("dispatching"))
        trace.step(
            "providerResult", observation, row.getJSONObject("outcome").optString("status", "unknown"), true);
      else
        throw new AssertionError("Unmapped durable transition " + previous + " -> " + next);
    }
    previous = next;
  }
  static JSONObject owner(boolean agent) throws Exception {
    return agent ? coordinator.agentOwner() : coordinator.manualOwner();
  }
  static void stage(JSONObject owner) throws Exception {
    coordinator.stageCalendar(target, owner, "first");
  }
  static void expire() {
    DeletionTestPorts.elapsed = 10001;
    trace.step("expireWindow", observe());
  }
  static void settled() throws Exception {
    trace.stutter("coordinator returned", receipt());
  }
  static void ordinary(String outcome) throws Exception {
    stage(owner(false));
    expire();
    DeletionTestPorts.outcome = outcome;
    coordinator.reconcile();
    settled();
    int calls = DeletionTestPorts.deletes;
    coordinator.reconcile();
    check(DeletionTestPorts.deletes == calls, "Repeated dispatch");
    trace.stutter("second wake-up does not replay", receipt());
    if (outcome.equals("permission-required")) {
      coordinator.undo("calendar", "first");
      check(DeletionTestPorts.deletes == 1, "Undo re-dispatched provider");
    }
  }
  static void undo(boolean reboot) throws Exception {
    stage(owner(false));
    if (reboot) {
      DeletionTestPorts.boot++;
      trace.step("reboot", observe());
      coordinator.reconcile();
      check(DeletionTestPorts.deletes == 0, "Changed boot dispatched");
    }
    coordinator.undo("calendar", "first");
    check(DeletionTestPorts.deletes == 0, "Undo dispatched");
    settled();
  }
  static void openWindow() throws Exception {
    JSONObject owner = owner(false);
    stage(owner);
    coordinator.reconcile();
    check(DeletionTestPorts.deletes == 0
            && DeletionTestPorts.schedules.get(DeletionTestPorts.schedules.size() - 1) == 10000,
        "Open window did not schedule expiry");
    coordinator.stageCalendar(target, owner, "first");
    trace.step("repeatStage", observe(), 0, 0);
    try {
      coordinator.stageCalendar(new JSONObject(target.toString()).put("revision", "1"), owner, "first");
      throw new AssertionError("Operation identity adopted a different target");
    } catch (IllegalArgumentException expected) {
    }
    trace.step("repeatStage", observe(), 0, 1);
    check(coordinator.calendarPending(1, 2), "Queued calendar event was not fenced from sync");
  }
  static void stageFailure(String mode) throws Exception {
    JSONObject owner = owner(false);
    if (mode.equals("before")) {
      DeletionTestPorts.failBefore = DeletionTestPorts.writes + 1;
      trace.step("storageFailure", observe());
    } else if (mode.equals("after")) {
      DeletionTestPorts.failAfter = DeletionTestPorts.writes + 1;
    } else
      DeletionTestPorts.failSchedule = true;
    boolean failed = false;
    try {
      stage(owner);
    } catch (Exception expected) {
      failed = true;
    }
    check(failed && DeletionTestPorts.deletes == 0, "Failed staging dispatched a provider call");
    DeletionTestPorts.failBefore = DeletionTestPorts.failAfter = -1;
    DeletionTestPorts.failSchedule = false;
    if (mode.equals("before")) {
      check(row() == null, "Pre-write failure persisted the stage");
      trace.step("storageRecovers", observe());
      stage(owner);
    } else {
      check(row() != null, "Committed stage was lost after an exception");
      trace.stutter("stage persisted before failure", observe());
    }
    coordinator.start();
    check(DeletionTestPorts.schedules.get(DeletionTestPorts.schedules.size() - 1) == 0,
        "Startup did not rearm retained deletion");
    expire();
    coordinator.reconcile();
    settled();
  }
  static void claimFailure(boolean committed) throws Exception {
    stage(owner(false));
    expire();
    if (committed)
      DeletionTestPorts.failAfter = DeletionTestPorts.writes + 1;
    else {
      DeletionTestPorts.failBefore = DeletionTestPorts.writes + 1;
      trace.step("storageFailure", observe());
    }
    check(coordinator.reconcile(), "Failed write did not request worker retry");
    check(DeletionTestPorts.deletes == 0, "Unconfirmed admission dispatched");
    if (committed) {
      trace.step("observeReceipt", receipt());
      coordinator.reconcile();
      check(DeletionTestPorts.deletes == 0, "Uncertain intent replayed");
    } else {
      trace.stutter("write refused", observe());
      DeletionTestPorts.failBefore = -1;
      trace.step("storageRecovers", observe());
      coordinator.reconcile();
      settled();
    }
  }
  static void outcomeFailure(boolean committed) throws Exception {
    stage(owner(false));
    expire();
    if (committed)
      DeletionTestPorts.failAfter = DeletionTestPorts.writes + 2;
    else
      DeletionTestPorts.failBefore = DeletionTestPorts.writes + 2;
    check(coordinator.reconcile(), "Unconfirmed result did not request retry");
    check(DeletionTestPorts.deletes == 1, "Provider call count");
    if (!committed) {
      trace.step("providerResult", observe(), "deleted", false);
      trace.step("observeReceipt", receipt());
    } else
      trace.stutter("exception after result replacement", receipt());
    coordinator.reconcile();
    check(DeletionTestPorts.deletes == 1, "Result failure replayed delete");
    if (!committed) {
      coordinator.dismiss("calendar", "first");
      trace.step("dismissUnknown", receipt());
      check(coordinator.pending().length() == 0, "Acknowledged uncertainty remains visible");
    }
  }
  static void restart() throws Exception {
    JSONObject owner = owner(false);
    stage(owner);
    expire();
    DeletionTestPorts.failBefore = DeletionTestPorts.writes + 2;
    coordinator.reconcile();
    trace.step("providerResult", observe(), "deleted", false);
    trace.step("observeReceipt", receipt());
    java.lang.reflect.Field field = NativeDeletionCoordinator.class.getDeclaredField("instance");
    field.setAccessible(true);
    field.set(null, null);
    coordinator = NativeDeletionCoordinator.get(new android.content.Context());
    DeletionTestPorts.failBefore = -1;
    coordinator.reconcile();
    check(DeletionTestPorts.deletes == 1, "Restart replayed uncertain delete");
    trace.stutter("new coordinator restores retained bytes", receipt());
  }
  static void staleOwner() throws Exception {
    stage(owner(true));
    expire();
    AtomicReference<Throwable> failure = new AtomicReference<>();
    Thread worker = new Thread(() -> {
      try {
        coordinator.reconcile();
      } catch (Throwable error) {
        failure.set(error);
      }
    });
    synchronized (coordinator) {
      worker.start();
      long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
      while (worker.getState() != Thread.State.BLOCKED && System.nanoTime() < deadline) Thread.sleep(1);
      check(worker.getState() == Thread.State.BLOCKED, "Reconcile did not reach coordinator lock");
      DeletionTestPorts.provider.put("sessionGeneration", "generation1");
      trace.step("ownerChanges", observe());
    }
    worker.join(5000);
    check(!worker.isAlive(), "Reconcile did not finish");
    if (failure.get() != null)
      throw new AssertionError(failure.get());
    check(DeletionTestPorts.deletes == 0, "Retired owner dispatched provider deletion");
    settled();
  }
  static void staleStage() throws Exception {
    JSONObject owner = owner(true);
    DeletionTestPorts.provider.put("sessionGeneration", "generation1");
    trace.step("ownerChanges", observe());
    try {
      stage(owner);
      throw new AssertionError("Retired review staged");
    } catch (SecurityException expected) {
    }
    check(row() == null, "Refused review wrote a row");
    trace.stutter("retired review rejected before persistence", observe());
  }
  static void multipleRows() throws Exception {
    JSONObject owner = owner(false);
    stage(owner);
    coordinator.stageCalendar(new JSONObject(target.toString()).put("eventId", "3"), owner, "second");
    DeletionTestPorts.elapsed = 5000;
    coordinator.stageCalendar(new JSONObject(target.toString()).put("eventId", "4"), owner, "third");
    DeletionTestPorts.elapsed = 10001;
    trace.step("expireWindow", observe());
    DeletionTestPorts.failDispatchId = "first";
    trace.step("storageFailure", observe());
    check(coordinator.reconcile(), "Row failure did not request retry");
    check(coordinator.receipt("calendar", "second").getString("phase").equals("deleted"),
        "Row failure blocked later row");
    check(coordinator.receipt("calendar", "third").getString("phase").equals("queued"),
        "Open row was settled early");
    check(DeletionTestPorts.schedules.get(DeletionTestPorts.schedules.size() - 1) == 4999,
        "Later deadline was not scheduled after failure");
    trace.stutter("row isolation and later wake-up", observe());
    trace.step("storageRecovers", observe());
    coordinator.reconcile();
    check(DeletionTestPorts.deletes == 2, "Recovered row did not dispatch exactly once");
    settled();
  }
  static void reminder(String scenario) throws Exception {
    reminder = true;
    JSONObject owner = owner(scenario.equals("reminder-retired") || scenario.equals("reminder-session-retired"));
    JSONObject selected = new JSONObject().put("reminderId", "reminder0").put("occurrenceId", "occurrence0");
    JSONObject row = new JSONObject()
                         .put("id", "first")
                         .put("owner", owner.toString())
                         .put("target", selected)
                         .put("phase", "queued")
                         .put("continuity", "boot:0")
                         .put("createdElapsed", 0)
                         .put("expiresElapsed", 10000);
    DeletionTestPorts.reminderReply = row;
    coordinator.stageReminder(selected, owner, "first", null);
    trace.step("stage", observe());
    if (scenario.equals("reminder-undo")) {
      DeletionTestPorts.reminderReply =
          new JSONObject(row.toString()).put("phase", "undone").put("effects", "complete");
      coordinator.undo("reminder", "first");
      trace.step("undo", observe());
      return;
    }
    if (scenario.equals("reminder-open")) {
      coordinator.reconcile();
      check(DeletionTestPorts.reminderSettles == 0
              && DeletionTestPorts.schedules.get(DeletionTestPorts.schedules.size() - 1) == 10000,
          "Open reminder was not scheduled");
      trace.stutter("open reminder remains queued", observe());
      return;
    }
    expire();
    if (scenario.equals("reminder-retired")) {
      DeletionTestPorts.provider.put("sessionGeneration", "generation1");
      trace.step("ownerChanges", observe());
      DeletionTestPorts.reminderReply = new JSONObject(row.toString()).put("phase", "paused");
      check(!coordinator.reconcile(), "Changed reminder owner failed instead of pausing");
      check(DeletionTestPorts.reminderPauses == 1 && DeletionTestPorts.reminderSettles == 0
              && DeletionTestPorts.deletes == 0,
          "Changed reminder owner dispatched instead of pausing");
      check(row().similar(new JSONObject(row.toString()).put("phase", "paused")),
          "Changed reminder owner changed the deletion identity or lease");
      trace.step("claim", observe());
      check(!coordinator.reconcile() && DeletionTestPorts.reminderPauses == 1
              && DeletionTestPorts.reminderSettles == 0 && DeletionTestPorts.deletes == 0,
          "Repeated reconciliation replayed the retired reminder");
      trace.stutter("changed owner remains paused without provider effects", observe());
      return;
    }
    if (scenario.equals("reminder-session-retired")) {
      DeletionTestPorts.session.put("token", "replacement-token");
      trace.step("ownerChanges", observe());
      DeletionTestPorts.reminderReply = new JSONObject(row.toString()).put("phase", "paused");
      check(!coordinator.reconcile(), "Retired review fence failed instead of pausing");
      check(DeletionTestPorts.reminderPauses == 1 && DeletionTestPorts.reminderSettles == 0
              && DeletionTestPorts.deletes == 0,
          "Retired reminder review dispatched");
      check(row().similar(new JSONObject(row.toString()).put("phase", "paused")),
          "Retired reminder review changed the deletion identity or lease");
      trace.step("claim", observe());
      return;
    }
    DeletionTestPorts.reminderReply =
        new JSONObject(row.toString()).put("phase", "deleted").put("effects", "pending");
    coordinator.reconcile();
    trace.macro("reminder provider settled", observe(), Trace.action("claim"),
        Trace.action("providerResult", "deleted", true));
    DeletionTestPorts.reminderReply.put("effects", "complete");
    DeletionTestPorts.reminderRows.put(
        "reminder0", new JSONObject().put("status", "cancelled").put("occurrenceId", "occurrence0"));
    coordinator.reconcile();
    check(DeletionTestPorts.reminderSettles == 2, "Pending reminder effects were not reconciled");
    check(coordinator.deletedNoteOrigins().length() == 1,
        "Completed reminder deletion did not retire its note link");
    trace.stutter("idempotent reminder effects complete", observe());
  }
  public static void main(String[] args) throws Exception {
    DeletionTestPorts.initializeAgent();
    coordinator = NativeDeletionCoordinator.get(new android.content.Context());
    // Establish the installation identity before tracing the selected deletion row.
    coordinator.manualOwner();
    trace = new Trace(args[0], observe());
    trace.value.put("sourceEvents", events).put("portEvents", DeletionTestPorts.portEvents);
    DeletionTestPorts.afterWrite = DeletionCoordinatorTraces::writeObserved;
    switch (args[0]) {
      case "deleted":
        ordinary("deleted");
        break;
      case "conflict":
        ordinary("conflict");
        break;
      case "permission":
        ordinary("permission-required");
        break;
      case "unknown":
        ordinary("unknown");
        break;
      case "undo":
        undo(false);
        break;
      case "reboot":
        undo(true);
        break;
      case "open":
        openWindow();
        break;
      case "claim-refused":
        claimFailure(false);
        break;
      case "claim-committed-error":
        claimFailure(true);
        break;
      case "outcome-refused":
        outcomeFailure(false);
        break;
      case "outcome-committed-error":
        outcomeFailure(true);
        break;
      case "restart":
        restart();
        break;
      case "stale-owner":
        staleOwner();
        break;
      case "stale-stage":
        staleStage();
        break;
      case "multiple-rows":
        multipleRows();
        break;
      case "stage-refused":
        stageFailure("before");
        break;
      case "stage-committed-error":
        stageFailure("after");
        break;
      case "stage-schedule-error":
        stageFailure("schedule");
        break;
      case "reminder-open":
      case "reminder-undo":
      case "reminder-retired":
      case "reminder-session-retired":
      case "reminder-effects":
        reminder(args[0]);
        break;
      default:
        throw new AssertionError(args[0]);
    }
    System.out.println(new JSONArray().put(trace.value));
  }
}
