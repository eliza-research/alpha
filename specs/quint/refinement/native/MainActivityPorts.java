package ai.alphacompute.alphaphone;

import android.content.Intent;
import android.view.View;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/** Controlled Android scheduling/task/Settings facts. No recovery policy is evaluated here. */
public final class MainActivityPorts {
  public record Scheduled(View view, Runnable callback, long due, long delay) {}
  public static long time;
  public static boolean bridgeAvailable = true, failLaunch, failTaskMove;
  public static final List<Scheduled> scheduled = new ArrayList<>();
  public static final List<android.app.ActivityManager.AppTask> tasks = new ArrayList<>();
  public static Set<String> settings =
      Set.of(RendererRecoveryBudget.ACTION_SETTINGS, RendererRecoveryBudget.ACTION_HOME_SETTINGS,
          RendererRecoveryBudget.ACTION_MANAGE_DEFAULT_APPS_SETTINGS);
  public static final JSONArray events = new JSONArray();
  public static int moves;
  public static String externalTarget = "none";
  public static void post(View view, Runnable callback, long delay) {
    scheduled.add(new Scheduled(view, callback, time + delay, delay));
    events.put(new JSONObject().put("kind", "schedule").put("delay", delay));
  }
  public static void run(Scheduled task) {
    if (time < task.due())
      throw new AssertionError("Timer has not elapsed");
    scheduled.remove(task);
    task.callback().run();
  }
  public static void launch(Intent intent) {
    events.put(new JSONObject().put("kind", "start-activity").put("action", intent.getAction()));
    if (failLaunch)
      throw new IllegalStateException("Activity start refused");
    if (settings.contains(intent.getAction()))
      externalTarget = intent.getAction();
  }
  public static void moveTask(int id) {
    events.put(new JSONObject().put("kind", "move-task").put("task", id));
    if (failTaskMove)
      throw new IllegalStateException("Task move refused");
    moves++;
  }
}
