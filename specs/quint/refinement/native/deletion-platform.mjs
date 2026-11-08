import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';

/** Storage, provider and Android scheduling ports. The tested coordinator owns policy. */
export function deletionPlatform() {
  const root = mkdtempSync(join(tmpdir(), 'quint-deletion-platform-'));
  const files = {
    'android/content/Context.java': `package android.content;
public class Context {
  public Context getApplicationContext() {
    return this;
  }
  public ContentResolver getContentResolver() {
    return new ContentResolver();
  }
}`,
    'android/content/ContentResolver.java': `package android.content;
public class ContentResolver {}`,
    'android/os/SystemClock.java': `package android.os;
public class SystemClock {
  public static long elapsedRealtime() {
    return ai.elizaresearch.alphaphone.DeletionTestPorts.elapsed;
  }
}`,
    'android/provider/Settings.java': `package android.provider;
public class Settings {
  public static class Global {
    public static final String BOOT_COUNT = "boot";
    public static int getInt(android.content.ContentResolver resolver, String key) {
      if (ai.elizaresearch.alphaphone.DeletionTestPorts.unknownBoot)
        throw new IllegalStateException("Unavailable boot count");
      return ai.elizaresearch.alphaphone.DeletionTestPorts.boot;
    }
  }
}`,
    'androidx/work/ExistingWorkPolicy.java': `package androidx.work;
public enum ExistingWorkPolicy { REPLACE }`,
    'androidx/work/OneTimeWorkRequest.java': `package androidx.work;
public class OneTimeWorkRequest {
  public long delay;
  public static class Builder {
    private long delay;
    public Builder(Class<?> worker) {}
    public Builder setInitialDelay(long value, java.util.concurrent.TimeUnit unit) {
      delay = unit.toMillis(value);
      return this;
    }
    public OneTimeWorkRequest build() {
      OneTimeWorkRequest request = new OneTimeWorkRequest();
      request.delay = delay;
      return request;
    }
  }
}`,
    'androidx/work/WorkManager.java': `package androidx.work;
public class WorkManager {
  public static WorkManager getInstance(android.content.Context context) {
    return new WorkManager();
  }
  public void enqueueUniqueWork(String name, ExistingWorkPolicy policy, OneTimeWorkRequest request) {
    ai.elizaresearch.alphaphone.DeletionTestPorts.schedule(request.delay);
  }
}`,
    'ai/elizaresearch/alphaphone/DeletionWorker.java': `package ai.elizaresearch.alphaphone;
public class DeletionWorker {}`,
    'ai/elizaresearch/alphaphone/AlphaCredentialStore.java': `package ai.elizaresearch.alphaphone;
public class AlphaCredentialStore {
  public AlphaCredentialStore(android.content.Context context) {}
  public String readCredentialSlot(String key) {
    return DeletionTestPorts.values.get(key);
  }
  public void writeCredentialSlot(String key, String value) throws Exception {
    DeletionTestPorts.write(key, value);
  }
  public org.json.JSONObject providerAdmissionSnapshot() {
    return new org.json.JSONObject(DeletionTestPorts.provider.toString());
  }
}`,
    'ai/elizaresearch/alphaphone/AlphaLocalAgentPlugin.java': `package ai.elizaresearch.alphaphone;
public class AlphaLocalAgentPlugin {
  public static org.json.JSONObject captureReminderOwnerSession() {
    return new org.json.JSONObject(DeletionTestPorts.session.toString());
  }
  public static org.json.JSONObject readReminderOwnerRoute(
      org.json.JSONObject session, String path, org.json.JSONObject headers) {
    return DeletionTestPorts.ownerRoute(session, path, headers);
  }
}`,
    'ai/elizaresearch/alphaphone/AlphaCalendarPlugin.java': `package ai.elizaresearch.alphaphone;
public class AlphaCalendarPlugin {
  public static final Object CONFIGURATION = new Object();
}`,
    'ai/elizaresearch/alphaphone/CalendarSyncBridge.java': `package ai.elizaresearch.alphaphone;
public class CalendarSyncBridge {
  public static String deletionRefusal(
      android.content.Context context, org.json.JSONObject owner, org.json.JSONObject target) {
    return DeletionTestPorts.refusal;
  }
  public static org.json.JSONObject dispatchDeletion(
      android.content.Context context, org.json.JSONObject target) throws Exception {
    return DeletionTestPorts.delete(target);
  }
}`,
    'ai/elizaresearch/alphaphone/CalendarScopedDeletionReview.java': `package ai.elizaresearch.alphaphone;
public class CalendarScopedDeletionReview {
  public static org.json.JSONObject dispatch(android.content.Context context, org.json.JSONObject target)
      throws Exception {
    return DeletionTestPorts.delete(target);
  }
}`,
    'ai/eliza/plugins/calendar/CalendarPlugin.java': `package ai.eliza.plugins.calendar;
public class CalendarPlugin {
  public static org.json.JSONObject deleteReviewedExact(
      android.content.Context context, Object configuration, org.json.JSONObject target) throws Exception {
    return ai.elizaresearch.alphaphone.DeletionTestPorts.delete(target);
  }
}`,
    'ai/elizaresearch/alphaphone/CalendarDeletionIdentity.java': `package ai.elizaresearch.alphaphone;
public class CalendarDeletionIdentity {
  public long eventId;
  public static CalendarDeletionIdentity parse(String value) {
    throw new AssertionError("Unexercised legacy calendar identity");
  }
}`,
    'ai/elizaresearch/alphaphone/AlphaReminders.java': `package ai.elizaresearch.alphaphone;
import org.json.*;
public class AlphaReminders {
  public static Engine engine(android.content.Context context) {
    return new Engine();
  }
  public static class Engine {
    public JSONArray pendingDeletions() {
      return new JSONArray(DeletionTestPorts.reminders.toString());
    }
    public JSONObject read(String id) {
      return DeletionTestPorts.reminderRows.get(id);
    }
    public JSONObject stageDeletion(
        String id, String owner, JSONObject target, JSONObject clock, JSONObject binding) {
      return DeletionTestPorts.stageReminder(id, owner, target, clock, binding);
    }
    public JSONObject settleDeletion(String id, String owner, JSONObject clock, boolean undo) {
      return DeletionTestPorts.settleReminder(id, undo);
    }
    public void pauseDeletion(String id, String owner, String reason) {
      DeletionTestPorts.pauseReminder(id, reason);
    }
  }
}`
  };
  const paths = [];
  for (const [name, source] of Object.entries(files)) {
    const path = join(root, name);
    mkdirSync(dirname(path), {recursive: true});
    writeFileSync(path, source);
    paths.push(path);
  }
  return {paths, sources: files, close: () => rmSync(root, {recursive: true, force: true})};
}
