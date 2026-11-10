package ai.alphacompute.alphaphone;

import android.content.Intent;
import android.view.View;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.LinearLayout;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/** Real MainActivity callbacks and native buttons against controlled Android primitives. */
public final class MainActivityRecoveryTraces {
  static MainActivity owner;
  static Trace trace;
  static int activity;
  static int pendingActivity = -1;
  static long lossTime;
  static boolean handled, assistantSurface;
  static String decision = "none";
  static long delay;
  static final JSONArray raw = new JSONArray();
  static void check(boolean value, String message) {
    if (!value)
      throw new AssertionError(message);
  }
  static Object field(Object target, Class<?> type, String name) throws Exception {
    Field field = type.getDeclaredField(name);
    field.setAccessible(true);
    return field.get(target);
  }
  static Object activityField(String name) throws Exception {
    return field(owner, MainActivity.class, name);
  }
  static Object staticField(String name) throws Exception {
    return field(null, MainActivity.class, name);
  }
  static RendererRecoveryBudget budget() throws Exception {
    return (RendererRecoveryBudget) staticField("recoveryBudget");
  }
  static JSONObject budgetState() throws Exception {
    RendererRecoveryBudget budget = budget();
    return Trace.fields("started", field(budget, RendererRecoveryBudget.class, "started"), "windowStart",
        field(budget, RendererRecoveryBudget.class, "windowStart"), "losses",
        field(budget, RendererRecoveryBudget.class, "lossesInWindow"));
  }
  static MainActivityPorts.Scheduled pending(MainActivity target) {
    return MainActivityPorts.scheduled.stream()
        .filter(task -> task.view() == target.getWindow().getDecorView())
        .findFirst()
        .orElse(null);
  }
  static JSONObject observe() throws Exception {
    JSONObject state = budgetState();
    MainActivityPorts.Scheduled task = pending(owner);
    Method showsHome = MainActivity.class.getDeclaredMethod("showsHome");
    showsHome.setAccessible(true);
    boolean bridge = owner.getBridge() != null;
    state.put("s.home", showsHome.invoke(owner))
        .put("s.recovering", activityField("recoveringRenderer"))
        .put("s.rendererAlive", bridge && !owner.getBridge().getWebView().destroyed)
        .put("s.bridgeAvailable", bridge)
        .put("s.escape", owner.content instanceof LinearLayout)
        .put("s.finishing", owner.isFinishing())
        .put("s.destroyed", owner.isDestroyed())
        .put("s.activity", activity)
        .put("s.pending", task != null)
        .put("s.pendingActivity", pendingActivity)
        .put("s.lossTime", lossTime)
        .put("s.remaining", task != null && task.due() > MainActivityPorts.time ? 5000 : 0)
        .put("s.recreateRequested", owner.recreates > 0)
        .put("s.decision", decision)
        .put("s.delay", delay)
        .put("s.handled", handled)
        .put("s.externalTarget", targetClass(MainActivityPorts.externalTarget))
        .put("s.availableSettings",
            qset(MainActivityPorts.settings.stream()
                    .map(MainActivityRecoveryTraces::targetClass)
                    .collect(java.util.stream.Collectors.toSet())))
        .put("s.unackedFrontStarts", staticField("unackedFrontStarts"))
        .put("s.task", owner.getTaskId() == 7 ? 0 : 1)
        .put("s.taskHomes", taskHomes())
        .put("s.handoffUnreliable", staticField("handOffUnreliable"));
    raw.put(new JSONObject()
            .put("projection", new JSONObject(state.toString()))
            .put("task", owner.getTaskId())
            .put("bridgeLoads", owner.loads)
            .put("buttons", new JSONArray(buttons(owner)))
            .put("events", new JSONArray(MainActivityPorts.events.toString())));
    return state;
  }
  static String targetClass(String action) {
    return switch (action) {
      case RendererRecoveryBudget.ACTION_HOME_SETTINGS -> "home-settings";
      case RendererRecoveryBudget.ACTION_MANAGE_DEFAULT_APPS_SETTINGS -> "default-apps";
      case RendererRecoveryBudget.ACTION_SETTINGS -> "settings";
      default -> "none";
    };
  }
  static JSONObject qset(Set<String> values) {
    return new JSONObject().put("quintCollection", "set").put("values", new JSONArray(values));
  }
  static JSONObject taskHomes() throws Exception {
    JSONArray entries = new JSONArray();
    Map<?, ?> kinds = (Map<?, ?>) staticField("taskKinds");
    for (Map.Entry<?, ?> entry : kinds.entrySet()) {
      Object kind = entry.getValue();
      entries.put(
          new JSONArray().put(entry.getKey().equals(7) ? 0 : 1).put(field(kind, kind.getClass(), "home")));
    }
    return new JSONObject().put("quintCollection", "map").put("entries", entries);
  }
  static List<String> buttons(MainActivity target) {
    List<String> result = new ArrayList<>();
    if (target.content instanceof LinearLayout panel)
      for (View view : panel.children)
        if (view instanceof Button button)
          result.add(button.text);
    return result;
  }
  static Button button(String label) {
    if (owner.content instanceof LinearLayout panel)
      for (View view : panel.children)
        if (view instanceof Button button && button.text.equals(label))
          return button;
    throw new AssertionError("No native button " + label);
  }
  static MainActivity create(int task, Intent intent, boolean assistant) {
    MainActivity result = assistant ? new MainActivity() {
      @Override
      protected boolean isAssistantSurface() {
        return true;
      }
    } : new MainActivity();
    result.taskId = task;
    result.setIntent(intent);
    result.onCreate(null);
    return result;
  }
  static Intent homeIntent() {
    return new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
  }
  static void initial(String name, boolean home, boolean launcher, boolean assistant, boolean bridge)
      throws Exception {
    trace = new Trace(name, budgetState());
    trace.value.put("sourceObservations", raw).put("portEvents", MainActivityPorts.events);
    BuildConfig.IS_LAUNCHER = launcher;
    assistantSurface = assistant;
    MainActivityPorts.bridgeAvailable = bridge;
    owner = create(7, home ? homeIntent() : new Intent("icon"), assistant);
    if (launcher && !assistant)
      trace.step("activityReady", observe(), home, bridge);
    else
      trace.step("untrackedActivityReady", observe(), bridge);
  }
  static void loss(long now, boolean matching) throws Exception {
    MainActivityPorts.time = now;
    WebView view = matching ? owner.getBridge().getWebView() : new WebView();
    boolean wasRecovering = (Boolean) activityField("recoveringRenderer");
    handled = owner.getBridge().listeners.get(0).onRenderProcessGone(view, new RenderProcessGoneDetail());
    if (matching && !wasRecovering) {
      // Read-only history of the Activity/clock supplied to the actual admitted callback.
      pendingActivity = activity;
      lossTime = now;
    }
    if (matching && (owner.content instanceof LinearLayout || pending(owner) != null)) {
      MainActivityPorts.Scheduled task = pending(owner);
      decision = owner.content instanceof LinearLayout ? "SHOW_ESCAPE"
          : task.delay() == 0                          ? "RECREATE_NOW"
                                                       : "RECREATE_AFTER_BACKOFF";
      delay = task == null ? 0 : task.delay();
    }
    trace.step("rendererGone", observe(), now, matching);
    if (matching)
      check(view.destroyed && view.getParent() == null, "Dead WebView was retained");
  }
  static void replace(boolean expectedHome) throws Exception {
    Intent latest = owner.getIntent();
    int task = owner.getTaskId();
    owner.onDestroy();
    trace.step("destroyActivity", observe(), false);
    owner = create(task, latest, assistantSurface);
    activity++;
    check(owner.startedAsHome() == expectedHome, "Task classification changed on recreation");
    trace.step("recreationCompleted", observe(), true);
  }
  static void exhaust(boolean home) throws Exception {
    for (int i = 0; i < 4; i++) {
      loss(1, true);
      if (i < 3) {
        owner.setIntent(new Intent("callback"));
        recreateWithHome(home);
      }
    }
  }
  static void recreateWithHome(boolean home) throws Exception {
    MainActivityPorts.Scheduled task = pending(owner);
    if (task.due() > MainActivityPorts.time) {
      MainActivityPorts.time = task.due();
      trace.step("delayElapsed", observe());
    }
    MainActivityPorts.run(task);
    trace.step("dispatchRecreation", observe(), activity);
    replace(home);
  }
  static void recoveryScenario(String name) throws Exception {
    boolean home = !name.startsWith("standard"), launcher = !name.equals("standalone"),
            assistant = name.equals("assistant");
    initial(name, home, launcher, assistant, !name.equals("no-webview"));
    if (name.startsWith("settings-fallback-")) {
      MainActivityPorts.settings = name.endsWith("default")
          ? Set.of(RendererRecoveryBudget.ACTION_MANAGE_DEFAULT_APPS_SETTINGS,
                RendererRecoveryBudget.ACTION_SETTINGS)
          : name.endsWith("settings") ? Set.of(RendererRecoveryBudget.ACTION_SETTINGS)
                                      : Set.of();
      Set<String> available = MainActivityPorts.settings.stream()
                                  .map(MainActivityRecoveryTraces::targetClass)
                                  .collect(java.util.stream.Collectors.toSet());
      trace.step("configureSettings", observe(), qset(available));
    }
    if (name.equals("no-webview")) {
      check(owner.getBridge() == null && owner.content instanceof android.widget.LinearLayout,
          "Missing WebView left HOME without its native escape controls");
      owner.onResume();
      owner.onWindowFocusChanged(true);
      trace.stutter("fallback lifecycle retains native content", observe());
      return;
    }
    if (name.equals("foreign-duplicate")) {
      loss(1, false);
      loss(1, true);
      loss(1, true);
      check(MainActivityPorts.scheduled.size() == 1, "Duplicate loss scheduled another recreation");
      recreateWithHome(home);
    } else if (name.equals("closed-callback")) {
      loss(1, true);
      owner.finish();
      owner.onDestroy();
      trace.step("destroyActivity", observe(), true);
      MainActivityPorts.run(pending(owner));
      trace.step("dispatchRecreation", observe(), activity);
      check(owner.recreates == 0, "Closed Activity recreated");
    } else if (name.equals("stale-posted-after-replacement")) {
      loss(1, true);
      MainActivityPorts.Scheduled old = pending(owner);
      replace(true);
      MainActivityPorts.run(old);
      trace.step("dispatchRecreation", observe(), 0);
      check(owner.recreates == 0, "A retired callback recreated the successor");
    } else if (name.equals("configuration-recreate")) {
      owner.setIntent(new Intent("sign-in-return"));
      replace(true);
      check(owner.getBridge().listeners.size() == 1, "Recreated Activity lost its recovery listener");
    } else if (name.equals("clock-window")) {
      loss(1, true);
      recreateWithHome(home);
      loss(60001, true);
      recreateWithHome(home);
      loss(60002, true);
      recreateWithHome(home);
      loss(0, true);
    } else if (name.equals("focus-and-intent")) {
      int scripts = owner.getBridge().getWebView().scripts.size();
      owner.onWindowFocusChanged(false);
      owner.onWindowFocusChanged(true);
      check(owner.getBridge().getWebView().scripts.size() == scripts + 1,
          "Focus return was not forwarded once");
      owner.onNewIntent(homeIntent());
      owner.onResume();
      owner.onConfigurationChanged(new android.content.res.Configuration());
      int requests = androidx.core.view.ViewCompat.insetsRequests;
      owner.getBridge().listeners.get(0).onPageLoaded(new WebView());
      check(androidx.core.view.ViewCompat.insetsRequests == requests, "Foreign page requested owner insets");
      owner.getBridge().listeners.get(0).onPageLoaded(owner.getBridge().getWebView());
      check(
          androidx.core.view.ViewCompat.insetsRequests == requests + 1, "Owner page did not request insets");
      trace.step("resumeOwner", observe());
      trace.stutter("focus, HOME and page callbacks preserve recovery state", observe());
    } else {
      exhaust(home && launcher && !assistant);
      if (home && launcher && !assistant) {
        List<String> expected = new ArrayList<>(List.of("Reload"));
        if (MainActivityPorts.settings.contains(RendererRecoveryBudget.ACTION_SETTINGS))
          expected.add("Open Android Settings");
        if (!MainActivityPorts.settings.isEmpty())
          expected.add("Choose Home app");
        check(buttons(owner).equals(expected), "Missing native escape controls");
        if (name.equals("home-reload")) {
          button("Reload").performClick();
          trace.step("requestReload", observe());
          replace(true);
          loss(1, true);
          check(owner.content instanceof LinearLayout, "Manual reload erased the process budget");
        } else if (name.equals("settings-failure")) {
          MainActivityPorts.failLaunch = true;
          button("Choose Home app").performClick();
          trace.step("chooseHomeSettings", observe(), false);
          check(owner.content instanceof LinearLayout, "Failed Settings launch hid escape content");
        } else if (!MainActivityPorts.settings.isEmpty()) {
          button("Choose Home app").performClick();
          trace.step("chooseHomeSettings", observe(), true);
          if (MainActivityPorts.settings.contains(RendererRecoveryBudget.ACTION_SETTINGS)) {
            button("Open Android Settings").performClick();
            trace.step("chooseSettings", observe(), true);
          }
        }
      } else {
        check(pending(owner).delay() == 5000, "Non-HOME recovery has no backoff");
        recreateWithHome(false);
      }
    }
  }
  static void handoffScenario(String name) throws Exception {
    initial(name, name.equals("handoff-home"), true, false, true);
    if (name.equals("handoff-standard"))
      MainActivityPorts.tasks.add(new android.app.ActivityManager.AppTask(7));
    if (name.equals("handoff-start-failure"))
      MainActivityPorts.failLaunch = true;
    int attempts = name.equals("handoff-unacknowledged") ? 3 : 1;
    for (int i = 0; i < attempts; i++) {
      boolean marker = name.equals("handoff-marker");
      boolean sameTask = name.equals("handoff-same-task");
      Intent intent = marker ? new Intent("front").putExtra("alpha.frontStart", (String)staticField("FRONT_START_TOKEN"))
          : sameTask         ? new Intent("notice")
                             : homeIntent();
      if (name.equals("handoff-foreign-parcel"))
        intent.brokenExtras = true;
      MainActivity secondary = create(sameTask ? 7 : 8, intent, false);
      check(secondary.wasHandedOff() && secondary.loads == 0 && secondary.inflated.destroyed,
          "Secondary Activity loaded a renderer before handoff");
      check(secondary.isFinishing()
              && secondary.removedTask == !(sameTask || MainActivity.isHomeIntent(intent)),
          "Handoff removed the wrong task");
      trace.step("handoff", observe(), marker, sameTask, !MainActivityPorts.failLaunch);
      secondary.onDestroy();
      trace.stutter("retired handoff instance preserves the owner's task record", observe());
    }
    if (name.equals("handoff-unacknowledged") || name.equals("handoff-marker")
        || name.equals("handoff-start-failure")) {
      MainActivity next = create(9, new Intent("icon"), false);
      check(!next.wasHandedOff() && next.loads == 1, "Unreliable handoff trapped another launch");
      owner = next;
      activity++;
      trace.step("independentPageCreated", observe(), false, true);
    } else {
      if (name.equals("handoff-front-ack")) {
        owner.onNewIntent(new Intent("front").putExtra("alpha.frontStart", (String)staticField("FRONT_START_TOKEN")));
        trace.step("acknowledgeFront", observe());
      }
      owner.onResume();
      trace.step("resumeOwner", observe());
      check(staticField("unackedFrontStarts").equals(0), "Resume did not acknowledge fronting");
    }
  }
  static void homeTaskRestoration() throws Exception {
    initial("home-task-restoration", true, true, false, true);
    exhaust(true);
    MainActivity home = owner;
    MainActivity marker = create(8, new Intent("front").putExtra("alpha.frontStart", (String)staticField("FRONT_START_TOKEN")), false);
    check(marker.wasHandedOff(), "Front marker did not retire its temporary instance");
    trace.step("handoff", observe(), true, false, true);
    MainActivity standard = create(9, new Intent("icon"), false);
    check(!standard.wasHandedOff() && !standard.startedAsHome(), "Standard fallback was not independent");
    owner = standard;
    activity++;
    trace.step("independentPageCreated", observe(), false, true);
    home.setIntent(new Intent("sign-in-return"));
    home.onDestroy();
    trace.stutter("older HOME destruction retains its task kind", observe());
    MainActivity replacement = create(7, home.getIntent(), false);
    check(replacement.startedAsHome(), "Recreated HOME task lost its kind after another task opened");
    owner = replacement;
    activity++;
    trace.step("restoreKnownTask", observe(), 0, true);
    loss(1, true);
    check(owner.content instanceof LinearLayout, "Recreated HOME task lost its native escape path");
  }
  static void oldTeardown() throws Exception {
    initial("old-teardown", true, true, false, true);
    MainActivity old = owner;
    replace(true);
    old.finish();
    old.onDestroy();
    check(((Map<?, ?>) staticField("taskKinds")).containsKey(7), "Older finishing instance erased successor kind");
    trace.stutter("older finishing instance cannot retire the successor task record", observe());
    owner.setIntent(new Intent("sign-in-return"));
    replace(true);
  }
  static void finishedTaskReuse() throws Exception {
    initial("finished-task-reuse", true, true, false, true);
    owner.finish();
    owner.onDestroy();
    trace.step("destroyActivity", observe(), true);
    check(((Map<?, ?>) staticField("taskKinds")).isEmpty(), "Finished task retained its old kind");
    owner = create(7, new Intent("icon"), false);
    activity++;
    check(!owner.startedAsHome(), "Reused task id inherited a finished HOME kind");
    trace.step("newTaskActivity", observe(), 0, false, true);
  }
  public static void main(String[] args) throws Exception {
    if (args.length > 1) {
      JSONArray result = new JSONArray();
      String javaExecutable =
          java.nio.file.Path.of(System.getProperty("java.home"), "bin", "java").toString();
      for (int i = 1; i < args.length; i++) {
        Process process = new ProcessBuilder(javaExecutable, "-cp", System.getProperty("java.class.path"),
            MainActivityRecoveryTraces.class.getName(), args[i])
                              .redirectError(ProcessBuilder.Redirect.INHERIT)
                              .start();
        String output =
            new String(process.getInputStream().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
        check(process.waitFor() == 0, "Scenario failed " + args[i]);
        result.put(new JSONArray(output).getJSONObject(0));
      }
      System.out.println(result);
      return;
    }
    String name = args[0];
    if (name.equals("home-task-restoration"))
      homeTaskRestoration();
    else if (name.equals("old-teardown"))
      oldTeardown();
    else if (name.equals("finished-task-reuse"))
      finishedTaskReuse();
    else if (name.startsWith("handoff-"))
      handoffScenario(name);
    else
      recoveryScenario(name);
    System.out.println(new JSONArray().put(trace.value));
  }
}
