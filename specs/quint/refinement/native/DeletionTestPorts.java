package ai.elizaresearch.alphaphone;
import java.util.*;
import org.json.*;

/** External replies and durable values, with observed write/provider boundaries. */
public final class DeletionTestPorts {
  public static final Map<String, String> values = new HashMap<>();
  public static final List<Long> schedules = new ArrayList<>();
  public static final Map<String, JSONObject> reminderRows = new HashMap<>();
  public static JSONArray reminders = new JSONArray();
  public static JSONObject provider = new JSONObject(), session = new JSONObject();
  public static final JSONArray portEvents = new JSONArray();
  public static JSONObject reminderReply;
  public static int reminderSettles, reminderPauses, reminderStages;
  public static String failDispatchId;
  public static long elapsed;
  public static int boot, writes, deletes;
  public static boolean unknownBoot, failSchedule;
  public static int failBefore = -1, failAfter = -1;
  public static String refusal, outcome = "deleted";
  public static Runnable afterWrite = () -> {};
  public static Runnable beforeDelete = () -> {};
  public static Runnable onOwnerRoute = () -> {};
  public static void schedule(long delay) {
    portEvents.put(new JSONObject().put("kind", "schedule").put("delay", delay));
    if (failSchedule)
      throw new IllegalStateException("Scheduler refused");
    schedules.add(delay);
  }
  public static void write(String key, String value) throws Exception {
    writes++;
    portEvents.put(new JSONObject().put("kind", "write-start").put("slot", key).put("sequence", writes));
    if (writes == failBefore)
      throw new java.io.IOException("Write refused");
    if (failDispatchId != null && key.equals(NativeDeletionCoordinator.JOURNAL)) {
      JSONObject next = new JSONObject(value).getJSONObject("records").optJSONObject(failDispatchId);
      if (next != null && next.optString("phase").equals("dispatching")) {
        failDispatchId = null;
        throw new java.io.IOException("Selected dispatch write refused");
      }
    }
    values.put(key, value);
    afterWrite.run();
    if (writes == failAfter)
      throw new java.io.IOException("Write committed then failed");
  }
  public static JSONObject delete(JSONObject target) throws Exception {
    deletes++;
    beforeDelete.run();
    return new JSONObject().put("status", outcome);
  }
  public static void initializeAgent() throws Exception {
    provider = new JSONObject()
                   .put("accountRef", "account-a")
                   .put("environment", "production")
                   .put("sessionGeneration", "generation0");
    session = new JSONObject()
                  .put("ownerId", "subject0")
                  .put("token", "token0")
                  .put("expiresAt", System.currentTimeMillis() + 3600000);
    String slot = "device:"
        + HostedResultNotices.hash(
            new JSONArray().put("https://device.alpha.invalid").put("subject0").put("agent0").toString());
    values.put(slot,
        new JSONObject()
            .put("installationId", "00000000-0000-4000-8000-000000000001")
            .put("enrollmentId", "enrollment0")
            .put("key", "a".repeat(64))
            .toString());
  }
  public static JSONObject ownerRoute(JSONObject requested, String path, JSONObject headers) {
    JSONObject body;
    switch (path) {
      case "/api/auth/me":
        body = new JSONObject()
                   .put("identity",
                       new JSONObject().put("id", session.getString("ownerId")).put("kind", "owner"))
                   .put("access", new JSONObject().put("role", "OWNER").put("mode", "session"))
                   .put("session",
                       new JSONObject()
                           .put("kind", "machine")
                           .put("id", session.getString("token"))
                           .put("expiresAt", session.getLong("expiresAt")));
        break;
      case "/api/agents":
        body = new JSONObject().put(
            "agents", new JSONArray().put(new JSONObject().put("id", "agent0").put("status", "running")));
        break;
      case "/api/client-devices/context":
        body = new JSONObject()
                   .put("subjectUserId", "subject0")
                   .put("agentId", "agent0")
                   .put("installationId", "00000000-0000-4000-8000-000000000001")
                   .put("enrollmentId", "enrollment0");
        break;
      default:
        throw new AssertionError("Unconfigured owner route " + path);
    }
    onOwnerRoute.run();
    return new JSONObject().put("status", 200).put("body", body.toString());
  }
  public static JSONObject stageReminder(
      String id, String owner, JSONObject target, JSONObject clock, JSONObject binding) {
    reminderStages++;
    portEvents.put(
        new JSONObject().put("kind", "reminder-stage").put("id", id).put("owner", owner).put("clock", clock));
    if (reminderReply == null)
      throw new AssertionError("Reminder stage reply not configured");
    reminders = new JSONArray().put(new JSONObject(reminderReply.toString()));
    return new JSONObject(reminderReply.toString());
  }
  public static JSONObject settleReminder(String id, boolean undo) {
    reminderSettles++;
    portEvents.put(new JSONObject().put("kind", "reminder-settle").put("id", id).put("undo", undo));
    if (reminderReply == null)
      throw new AssertionError("Reminder settle reply not configured");
    reminders = new JSONArray().put(new JSONObject(reminderReply.toString()));
    return new JSONObject(reminderReply.toString());
  }
  public static void pauseReminder(String id, String reason) {
    reminderPauses++;
    portEvents.put(new JSONObject().put("kind", "reminder-pause").put("id", id).put("reason", reason));
    if (reminderReply == null)
      throw new AssertionError("Reminder pause reply not configured");
    reminders = new JSONArray().put(new JSONObject(reminderReply.toString()));
  }
}
