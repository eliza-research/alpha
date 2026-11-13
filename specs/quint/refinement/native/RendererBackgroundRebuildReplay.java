package ai.alphacompute.alphaphone;

import android.content.Intent;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import android.widget.LinearLayout;
import androidx.lifecycle.Lifecycle;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Replays RendererBackgroundRebuild model steps on two real MainActivity surfaces sharing the
 * process-wide RendererRecoveryBudget. The harness plays Android and the renderer process: it
 * holds each activity's started state, which WebViews lost their renderer and whether that was a
 * crash, and the clock. Every count, decision and rebuild is the product's.
 */
public final class RendererBackgroundRebuildReplay {
  /** A surface whose started state the harness sets; decides nothing. */
  static final class Surface extends MainActivity {
    final boolean assistant;
    final Lifecycle lifecycle = new Lifecycle();
    Surface(boolean assistant) {
      this.assistant = assistant;
    }
    @Override
    protected boolean isAssistantSurface() {
      return assistant;
    }
    @Override
    public Lifecycle getLifecycle() {
      return lifecycle;
    }
  }
  static final class Slot {
    Surface activity;
    boolean owed, owedCrash, reportVisible;
  }
  static final Map<String, Slot> slots = new LinkedHashMap<>();
  static int rendererDeaths;
  static boolean reclaimSpent;

  static void check(boolean value, String message) {
    if (!value)
      throw new AssertionError(message);
  }
  static Object read(Object target, Class<?> type, String name) throws Exception {
    Field field = type.getDeclaredField(name);
    field.setAccessible(true);
    return field.get(target);
  }
  static RendererRecoveryBudget budget() throws Exception {
    return (RendererRecoveryBudget) read(null, MainActivity.class, "recoveryBudget");
  }
  static Surface create(String name, boolean home, boolean started) {
    boolean assistant = name.equals("assistant");
    Surface surface = new Surface(assistant);
    surface.lifecycle.state = started ? Lifecycle.State.STARTED : Lifecycle.State.CREATED;
    surface.taskId = assistant ? 2 : 1;
    surface.setIntent(!assistant && home ? new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
                                         : new Intent("icon"));
    surface.onCreate(null);
    check(surface.getBridge() != null && !surface.wasHandedOff(), name + " has no page");
    return surface;
  }
  static MainActivityPorts.Scheduled pending(Surface surface) {
    return MainActivityPorts.scheduled.stream()
        .filter(task -> task.view() == surface.getWindow().getDecorView())
        .findFirst()
        .orElse(null);
  }
  static boolean rendererAlive(Slot slot) {
    return !slot.owed && !slot.activity.getBridge().getWebView().destroyed;
  }
  static void report(Slot slot, boolean crash) {
    Surface surface = slot.activity;
    check(surface.getBridge().listeners.get(0).onRenderProcessGone(surface.getBridge().getWebView(),
              new RenderProcessGoneDetail() {
                @Override
                public boolean didCrash() {
                  return crash;
                }
              }),
        "The surface did not handle its own renderer's death");
  }
  static void recreate(String name) {
    Slot slot = slots.get(name);
    Surface old = slot.activity;
    boolean started = old.lifecycle.state == Lifecycle.State.STARTED;
    Intent held = old.getIntent();
    old.onDestroy();
    Surface next = new Surface(old.assistant);
    next.lifecycle.state = started ? Lifecycle.State.STARTED : Lifecycle.State.CREATED;
    next.taskId = old.taskId;
    next.setIntent(held);
    next.onCreate(null);
    slot.activity = next;
    slot.owedCrash = false;
    slot.reportVisible = false;
  }
  static void fire(Surface surface) {
    MainActivityPorts.Scheduled task = pending(surface);
    MainActivityPorts.time = Math.max(MainActivityPorts.time, task.due());
    MainActivityPorts.run(task);
  }
  static void initialize(boolean home, int prior) throws Exception {
    Slot launcher = new Slot();
    launcher.activity = create("launcher", home, true);
    slots.put("launcher", launcher);
    // Earlier counted crashes of the launcher's page, each recovered through the product's path.
    for (int i = 0; i < prior; i++) {
      report(launcher, true);
      fire(launcher.activity);
      check(launcher.activity.recreates == 1, "An earlier crash inside the budget did not recreate");
      recreate("launcher");
      rendererDeaths++;
    }
    Slot assistant = new Slot();
    assistant.activity = create("assistant", home, false);
    slots.put("assistant", assistant);
  }
  static JSONObject observe() throws Exception {
    RendererRecoveryBudget budget = budget();
    Method showsHome = MainActivity.class.getDeclaredMethod("showsHome");
    showsHome.setAccessible(true);
    check(!(Boolean) showsHome.invoke(slots.get("assistant").activity), "The assistant surface shows Home");
    JSONObject surfaces = new JSONObject();
    for (Map.Entry<String, Slot> entry : slots.entrySet()) {
      Slot slot = entry.getValue();
      Surface surface = slot.activity;
      MainActivityPorts.Scheduled task = pending(surface);
      surfaces.put(entry.getKey(),
          new JSONObject()
              .put("alive", rendererAlive(slot))
              .put("owed", slot.owed)
              .put("owedCrash", slot.owedCrash)
              .put("createdAt", read(surface, MainActivity.class, "rendererDeathsAtCreate"))
              .put("started", surface.lifecycle.state == Lifecycle.State.STARTED)
              .put("recovering", read(surface, MainActivity.class, "recoveringRenderer"))
              .put("pendingRebuild", read(surface, MainActivity.class, "pendingRebuild"))
              .put("escape", surface.content instanceof LinearLayout)
              .put("scheduled", task == null ? "none" : task.delay() == 0 ? "now" : "backoff")
              .put("recreateRequested", surface.recreates > 0)
              .put("reportVisible", slot.reportVisible));
      check(task == null || task.delay() == 0 || task.delay() == RendererRecoveryBudget.BACKOFF_MS,
          "An unexpected recreation delay");
      check(surface.recreates <= 1, "One instance asked to be recreated twice");
    }
    boolean started = (Boolean) read(budget, RendererRecoveryBudget.class, "started");
    long windowStart = (Long) read(budget, RendererRecoveryBudget.class, "windowStart");
    return new JSONObject()
        .put("home", showsHome.invoke(slots.get("launcher").activity))
        .put("losses", read(budget, RendererRecoveryBudget.class, "lossesInWindow"))
        .put("deaths", budget.deaths())
        .put("stale", started && MainActivityPorts.time - windowStart > RendererRecoveryBudget.WINDOW_MS)
        .put("surfaces", surfaces)
        .put("rendererDeaths", rendererDeaths)
        .put("reclaimSpent", reclaimSpent);
  }
  public static void main(String[] args) throws Exception {
    JSONArray trace = new JSONArray(Files.readString(Path.of(args[0])));
    JSONArray observed = new JSONArray();
    for (int i = 0; i < trace.length(); i++) {
      JSONObject step = trace.getJSONObject(i), picks = step.getJSONObject("picks");
      String action = step.getString("action");
      Slot slot = picks.has("name") ? slots.get(picks.getString("name")) : null;
      switch (action) {
        case "init":
          initialize(picks.getBoolean("home"), picks.getInt("prior"));
          break;
        case "":
          break;
        case "start":
          slot.activity.lifecycle.state = Lifecycle.State.STARTED;
          slot.activity.onStart();
          break;
        case "stop":
          slot.activity.onStop();
          slot.activity.lifecycle.state = Lifecycle.State.CREATED;
          break;
        case "rendererDies":
          rendererDeaths++;
          for (Slot each : slots.values())
            if (rendererAlive(each)) {
              each.owed = true;
              each.owedCrash = picks.getBoolean("crashed");
            }
          break;
        case "report": {
          long before = budget().deaths();
          boolean visible = slot.activity.lifecycle.state == Lifecycle.State.STARTED;
          WebView dead = slot.activity.getBridge().getWebView();
          report(slot, slot.owedCrash);
          check(dead.destroyed && dead.getParent() == null, "The dead WebView was kept");
          if (!slot.owedCrash && !visible && budget().deaths() != before)
            reclaimSpent = true;
          slot.owed = false;
          slot.reportVisible = visible;
          break;
        }
        case "repeatReport":
          report(slot, true);
          break;
        case "timerFires":
          fire(slot.activity);
          break;
        case "reload": {
          LinearLayout panel = (LinearLayout) slot.activity.content;
          for (android.view.View view : panel.children)
            if (view instanceof android.widget.Button button && button.text.equals("Reload"))
              button.performClick();
          break;
        }
        case "recreated":
          recreate(picks.getString("name"));
          break;
        case "windowPasses":
          MainActivityPorts.time += RendererRecoveryBudget.WINDOW_MS + 1;
          break;
        default:
          throw new AssertionError("No product step for " + action);
      }
      observed.put(observe());
    }
    System.out.println(observed);
  }
}
