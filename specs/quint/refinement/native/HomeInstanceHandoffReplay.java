package ai.alphacompute.alphaphone;

import android.content.Intent;
import java.lang.reflect.Field;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.TreeSet;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Replays HomeInstanceHandoff model steps on the real MainActivity. The harness plays Android: it
 * resolves a start to the task of its kind (1 home, 2 standard), reuses that task's page owner or
 * creates an instance, and lists the standard task for a move only when the step says the move
 * works. Every hand-off, acknowledgement and task-kind decision is MainActivity's.
 */
public final class HomeInstanceHandoffReplay {
  static final String START = "replay.start";
  static boolean counting;
  static int delivered;
  /** Records the delivery of an external start's intent; decides nothing. */
  static final class Page extends MainActivity {
    @Override
    public void onNewIntent(Intent intent) {
      if (counting && intent != null && intent.getStringExtra(START) != null)
        delivered++;
      super.onNewIntent(intent);
    }
  }
  static final List<Page> instances = new ArrayList<>();
  static int starts, handOffs, frontStarts, frontArrivals, lastLiveTask = -1;
  static boolean lastLiveHome, handedOffWhileUnreliable;
  static String operation = "init";
  static Page lastHandedOff;

  static Object staticField(String name) throws Exception {
    Field field = MainActivity.class.getDeclaredField(name);
    field.setAccessible(true);
    return field.get(null);
  }
  static void check(boolean value, String message) {
    if (!value)
      throw new AssertionError(message);
  }
  static Page create(int task, Intent intent) {
    Page page = new Page();
    page.taskId = task;
    page.setIntent(intent);
    page.onCreate(null);
    instances.add(page);
    return page;
  }
  static boolean ownsPage(Page page) {
    return !page.isDestroyed() && !page.wasHandedOff() && page.loads > 0;
  }
  static Page owner(int task) {
    for (Page page : instances)
      if (ownsPage(page) && page.getTaskId() == task)
        return page;
    return null;
  }
  static Intent start(boolean home) {
    Intent intent = home ? new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME) : new Intent("notice");
    return intent.putExtra(START, "start-" + starts);
  }
  static Intent front(boolean home) throws Exception {
    Intent intent = home
        ? new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).setPackage("ai.alphacompute.alphaphone")
        : new Intent("explicit:" + MainActivity.class.getName());
    return intent.putExtra("alpha.frontStart", (String) staticField("FRONT_START_TOKEN"));
  }
  static int launches() {
    int count = 0;
    for (int i = 0; i < MainActivityPorts.events.length(); i++)
      if ("start-activity".equals(MainActivityPorts.events.getJSONObject(i).getString("kind")))
        count++;
    return count;
  }
  static void externalStart(boolean home, boolean moveWorks, boolean startWorks) throws Exception {
    int task = home ? 1 : 2;
    Intent intent = start(home);
    starts++;
    counting = true;
    Page reused = owner(task);
    if (reused != null) {
      reused.onNewIntent(intent);
      operation = "new-intent";
    } else {
      MainActivityPorts.tasks.clear();
      if (moveWorks)
        MainActivityPorts.tasks.add(new android.app.ActivityManager.AppTask(2));
      MainActivityPorts.failLaunch = !startWorks;
      boolean unreliable = (Boolean) staticField("handOffUnreliable");
      int before = launches();
      Page created = create(task, intent);
      if (created.wasHandedOff()) {
        check(created.loads == 0 && created.isFinishing(), "A handed-off instance kept a page");
        handOffs++;
        handedOffWhileUnreliable = unreliable;
        lastHandedOff = created;
        if (startWorks)
          frontStarts += launches() - before;
        operation = "hand-off";
      } else {
        check(launches() == before, "A page owner started another activity");
        operation = "own-page";
      }
      MainActivityPorts.failLaunch = false;
    }
    counting = false;
  }
  static void frontStartArrives(String outcome, boolean home) throws Exception {
    frontArrivals++;
    Page live = (Page) MainActivity.liveInstance();
    if (outcome.equals("live")) {
      check(live != null, "The model delivered a front start to a missing live instance");
      live.onNewIntent(front(home));
      operation = "front-acknowledged";
    } else if (outcome.equals("returned")) {
      lastHandedOff.onNewIntent(front(home));
      operation = "front-returned";
    } else {
      int before = launches();
      Page created = create(home ? 1 : 2, front(home));
      check(launches() == before, "An instance made by a front start started another activity");
      operation = created.wasHandedOff() ? "front-made-instance" : "own-page";
    }
  }
  static void relaunch(boolean heldIntentHome) {
    Page live = (Page) MainActivity.liveInstance();
    live.setIntent(heldIntentHome ? new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
                                  : new Intent("sign-in-return").setData("alphaphone://return"));
    Intent held = live.getIntent();
    int task = live.getTaskId();
    live.onDestroy();
    create(task, held);
    operation = "relaunch";
  }
  static JSONObject observe() throws Exception {
    MainActivity live = MainActivity.liveInstance();
    if (live != null) {
      lastLiveTask = live.getTaskId();
      lastLiveHome = live.startedAsHome();
    }
    TreeSet<Integer> pages = new TreeSet<>();
    for (Page page : instances)
      if (ownsPage(page))
        check(pages.add(page.getTaskId()), "Two page owners share a task");
    return new JSONObject()
        .put("liveTask", live == null ? 0 : live.getTaskId())
        .put("liveTaskId", lastLiveTask)
        .put("liveTaskHome", lastLiveHome)
        .put("pages", new JSONArray(pages))
        .put("unacked", staticField("unackedFrontStarts"))
        .put("unreliable", staticField("handOffUnreliable"))
        .put("frontInFlight", frontStarts - frontArrivals)
        .put("starts", starts)
        .put("delivered", delivered)
        .put("handOffs", handOffs)
        .put("handedOffWhileUnreliable", handedOffWhileUnreliable)
        .put("operation", operation);
  }
  public static void main(String[] args) throws Exception {
    JSONArray trace = new JSONArray(Files.readString(Path.of(args[0])));
    JSONArray observed = new JSONArray();
    for (int i = 0; i < trace.length(); i++) {
      JSONObject step = trace.getJSONObject(i), picks = step.getJSONObject("picks");
      switch (step.getString("action")) {
        case "init":
        case "":
          break;
        case "externalStart":
          externalStart(picks.getBoolean("home"), picks.getBoolean("first"), picks.getBoolean("second"));
          break;
        case "frontStartArrives":
          frontStartArrives(picks.getString("outcome"), picks.getBoolean("home"));
          break;
        case "liveResumes":
          MainActivity.liveInstance().onResume();
          operation = "resume";
          break;
        case "relaunch":
          relaunch(picks.getBoolean("home"));
          break;
        case "destroyLive": {
          MainActivity live = MainActivity.liveInstance();
          live.finish();
          live.onDestroy();
          operation = "destroy";
          break;
        }
        default:
          throw new AssertionError("No product step for " + step.getString("action"));
      }
      observed.put(observe());
    }
    System.out.println(observed);
  }
}
