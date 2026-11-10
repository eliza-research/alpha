package ai.eliza.plugins.reminders;

import ai.alphacompute.alphaphone.AlphaReminders;
import ai.alphacompute.alphaphone.Trace;
import android.app.Notification;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

// Controls only package-local wall time in the compiled pinned sources.
final class System {
 static long now;
 static long currentTimeMillis(){return now;}
}

public final class ReminderDeliveryTraces {
 static final long BASE = Instant.parse("2026-11-08T00:00:00Z").toEpochMilli();
 static final String ID = "synthetic-reminder";
 static final String TITLE = "Synthetic private title", BODY = "Synthetic private body";
 static final String BINDING = "a".repeat(64);
 static final ReminderConfiguration CONFIG = AlphaReminders.CONFIGURATION;

 static void check(boolean test, String message) {
  if (!test) throw new AssertionError(message);
 }
 static int seconds(long value) {
  check((value - BASE) % 1000 == 0, "Exact whole-second fixture clock");
  return Math.toIntExact((value - BASE) / 1000);
 }
 static long time(int seconds) { return BASE + seconds * 1000L; }
 static int optionalTime(JSONObject row, String field) throws Exception { return row.has(field) ? seconds(row.getLong(field)) : -1; }

 record Visible(int occurrence,int postedAt,int deadline,JSONObject target) {}

 static final class Fixture {
  final Context context = new Context();
  final ai.alphacompute.alphaphone.ReminderReceiver receiver = new ai.alphacompute.alphaphone.ReminderReceiver();
  final Map<String,Integer> identities = new LinkedHashMap<>();
  final Map<Integer,Intent> alarmIntents = new HashMap<>();
  final Map<Integer,Map<String,Intent>> decisions = new HashMap<>();
  final Map<String,Visible> notices = new HashMap<>();
  final Trace trace;
  ReminderEngine engine;
  JSONObject operation;
  int process = 1;
  boolean operating;
  String outcome = "none";

  Fixture(String name) throws Exception {
   System.now = BASE;
   engine = AlphaReminders.engine(context);
   check(engine == AlphaReminders.engine(context), "Product receiver and API share a process owner");
   engine.list(); // Initialize the empty durable envelope before any fault injection.
   context.notices.beforePost = this::recordNotice;
   context.alarms.beforeArm = this::recordArm;
   trace = new Trace(name, observe());
  }

  Context.Preferences envelopePrefs() { return context.getSharedPreferences(CONFIG.envelopeName,Context.MODE_PRIVATE); }
  Context.Preferences marker() { return context.getSharedPreferences(CONFIG.bootMarkerName(),Context.MODE_PRIVATE); }
  JSONObject envelope() throws Exception { return new JSONObject((String)envelopePrefs().durable().get("envelope")); }
  JSONObject rawRow() throws Exception {
   String raw = envelope().getJSONObject("records").optString(ID, "");
   return raw.isEmpty() ? new JSONObject() : new JSONObject(raw);
  }
  int occurrence(String raw) {
   if (raw == null || raw.isEmpty()) return 0;
   return identities.computeIfAbsent(raw, key -> identities.size() + 1);
  }
  String rawOccurrence(int id) {
   if (id == 0) return null;
   return identities.entrySet().stream().filter(entry -> entry.getValue() == id).map(Map.Entry::getKey)
    .findFirst().orElse("unknown-occurrence");
  }
  JSONObject observedRow() throws Exception {
   JSONObject raw = rawRow();
   if (raw.length() != 0 && !raw.has("occurrenceId")) {
    check(!engine.store.persistence.quarantined, "Legacy projection is only observed through a healthy engine");
    return engine.read(ID);
   }
   return raw;
  }

  void recordArm(PendingIntent pending) {
   try {
    JSONObject row = engine.read(ID);
    String raw = pending.intent.getStringExtra(CONFIG.occurrenceExtra);
    check(row != null && row.getString("occurrenceId").equals(raw), "Alarm is armed for the stored occurrence");
    check(CONFIG.remindAction.equals(pending.intent.getAction()) &&
      pending.intent.getData().toString().equals(CONFIG.alarmUriPrefix + ID + "/" + raw) &&
      ID.equals(pending.intent.getStringExtra(CONFIG.idExtra)), "Exact opaque alarm route");
    if (operating) {
     JSONObject receipt = envelope().getJSONObject("operations").getJSONObject(ID);
     check("effects-pending".equals(receipt.getString("phase")) &&
       "unknown".equals(receipt.getJSONObject("response").getString("status")), "Durable reviewed receipt precedes alarm effect");
    }
    // Failed arms can create an OS Intent for an uncommitted UUID. Assign
    // equality classes only from observed durable rows and actual retained arms.
   } catch (Exception unavailable) { throw new AssertionError(unavailable); }
  }

  String token(PendingIntent pending) {
   String data = pending.intent.getData().toString();
   check(CONFIG.openAction.equals(pending.intent.getAction()) && data.startsWith(CONFIG.tapUriPrefix), "Product activity route");
   String token = data.substring(CONFIG.tapUriPrefix.length());
   check(java.util.UUID.fromString(token).version() == 4 && pending.intent.getStringExtra(CONFIG.idExtra) == null,
    "Public activity handoff carries only an opaque v4 token");
   return token;
  }

  void recordNotice(Notification notice) {
   try {
    check(notice.channel.equals(CONFIG.dueChannelId()) && notice.visibility == Notification.VISIBILITY_PRIVATE &&
     TITLE.equals(notice.title) && BODY.equals(notice.text) && !notice.autoCancel && notice.onlyAlertOnce,
     "Private notification uses the due channel and retained tap semantics");
    check(notice.publicVersion != null && notice.publicVersion.title.equals(CONFIG.publicTitle) &&
     notice.publicVersion.text == null && notice.publicVersion.contentIntent == null, "Lock screen projection is redacted");
    check(context.notices.channels.get(CONFIG.dueChannelId()).getImportance() == 4, "Due channel requests high importance");
    check(notice.actions.length == 3 && notice.actions[0].title.equals("Done") &&
     notice.actions[1].title.equals("Snooze 10 minutes") && notice.actions[2].title.equals("Ask Alpha") &&
     notice.actions[2].authenticationRequired, "Exact decisions and authenticated Ask");
    JSONObject raw = observedRow();
    String occurrence = raw.getString("occurrenceId");
    JSONObject selected = new JSONObject(raw.toString());
    if ("scheduled".equals(raw.getString("status"))) selected.put("status","posted").put("postedAt",System.now);
    else check("posted".equals(raw.getString("status")), "Boot repost has an already-posted durable row");
    var method = ReminderStore.class.getDeclaredMethod("selectedRow",Context.class,String.class,JSONObject.class);
    method.setAccessible(true);
    JSONObject exact = (JSONObject)method.invoke(engine.store,context,ID,selected);
    JSONObject ledger = new JSONObject(context.secure.get(CONFIG.tapSlot));
    String token = token(notice.contentIntent), question = token(notice.actions[2].actionIntent);
    check(!token.equals(question) && !ledger.getJSONObject(token).optBoolean("question") &&
      ledger.getJSONObject(question).getBoolean("question"), "Tap and Ask retain distinct durable identities");
    check(ReminderTaps.same(ledger.getJSONObject(token).getJSONObject("target"),exact) &&
      ReminderTaps.same(ledger.getJSONObject(question).getJSONObject("target"),exact), "Tap routes are durably bound before notification effect");
    int id = occurrence(occurrence);
    notices.put(token,new Visible(id,optionalTime(selected,"postedAt"),optionalTime(selected,"at"),exact));
    Map<String,Intent> buttons = new HashMap<>();
    for (int i = 0; i < 2; i++) {
     String decision = i == 0 ? "done" : "snooze";
     Intent intent = notice.actions[i].actionIntent.intent;
     check(CONFIG.decisionAction.equals(intent.getAction()) &&
       intent.getData().toString().equals(CONFIG.decisionUriPrefix + ID + "/" + occurrence + "/" + decision) &&
       ID.equals(intent.getStringExtra(CONFIG.idExtra)) && occurrence.equals(intent.getStringExtra(CONFIG.occurrenceExtra)) &&
       decision.equals(intent.getStringExtra(CONFIG.decisionExtra)), "Exact occurrence decision route");
     buttons.put(decision,new Intent(intent));
    }
    decisions.putIfAbsent(id,buttons);
   } catch (Exception unavailable) { throw new AssertionError(unavailable); }
  }

  Visible visible() {
   var notice = context.notices.live.get(ID);
   return notice == null ? null : notices.get(token(notice.getNotification().contentIntent));
  }

  int markerClass(Object value) {
   if (value == null) return 0;
   String text = (String)value;
   check(text.startsWith("count:"), "Actual pinned boot count identity");
   return Integer.parseInt(text.substring(6));
  }

  JSONObject observe() throws Exception {
   JSONObject row = observedRow(), receipt = envelope().getJSONObject("operations").optJSONObject(ID);
   String id = row.optString("occurrenceId",null);
   int current = occurrence(id);
   check(context.alarms.live.size() <= 1, "Fixture observes one tracked alarm at a time");
   int armed = 0, alarmAt = -1;
   for (var entry : context.alarms.live.entrySet()) {
    Intent intent = entry.getKey().intent;
    armed = occurrence(intent.getStringExtra(CONFIG.occurrenceExtra));
    alarmAt = seconds(entry.getValue());
    alarmIntents.put(armed,new Intent(intent));
   }
   Visible visible = visible();
   boolean quarantine = engine.store.persistence.quarantined;
   boolean retained = visible != null && !quarantine && ReminderTaps.same(visible.target(), engine.selected(ID));
   JSONArray history = row.optJSONArray("history");
   int length = history == null ? 0 : history.length();
   return Trace.fields("now",seconds(System.now),"permission",engine.notificationsAllowed(),
    "boot",context.boot,"restoredBoot",markerClass(marker().durable().get("boot")),"markerView",markerClass(marker().getString("boot",null)),
    "process",process,"quarantined",quarantine,"status",row.optString("status","none"),
    "occurrence",current,"issued",identities.size(),"repeat",row.has("recurrence"),"silent",ReminderStore.noAlert(row),"legacy",row.optBoolean("legacyAlarm"),
    "at",optionalTime(row,"at"),"due",optionalTime(row,"dueAt"),"postedAt",optionalTime(row,"postedAt"),
    "snoozed",row.has("snoozedAt"),"history",length,"skipped",length == 0 ? 0 : history.getJSONObject(length-1).optInt("skippedDates"),
    "alarm",armed,"alarmAt",alarmAt,"arms",context.alarms.attempts,
    "visible",visible == null ? 0 : visible.occurrence(),"visibleAt",visible == null ? -1 : visible.postedAt(),
    "noticeDeadline",visible == null ? -1 : visible.deadline(),"posts",context.notices.posts,
    "receipt",receipt == null ? "none" : receipt.getString("phase"),"outcome",outcome).put("routeRetained",retained);
  }

  void point(String name,Object... args) throws Exception { trace.step(name,observe(),args); }
  void stutter(String label) throws Exception { trace.stutter(label,observe()); }
  void clock(int now) throws Exception { System.now=time(now); point("clockAt",now); }
  void permission(boolean granted) throws Exception { context.permission=granted; point("permission",granted); }
  void channel(boolean granted) throws Exception {
   check(context.permission,"Channel scenario retains notification permission");
   String due=CONFIG.dueChannelId();
   context.notices.channels.put(due,new android.app.NotificationChannel(due,"Synthetic due channel",granted?4:0));
   point("permission",granted);
  }

  void configureFault(String mode,int commit) {
   context.refuseSecure = mode.equals("route-refused");
   context.notices.refuse = mode.equals("notify-refused");
   context.alarms.refuse = mode.equals("arm-refused");
   if (mode.endsWith("before-save") || mode.endsWith("after-save")) {
    envelopePrefs().refusalAt = commit;
    envelopePrefs().commitButReportFailure = mode.endsWith("after-save");
   }
   if (mode.equals("marker-refused")) marker().refusalAt = 1;
  }
  void clearFaults() {
   context.refuseSecure = false; context.notices.refuse = false; context.alarms.refuse = false;
   envelopePrefs().refusalAt = 0; envelopePrefs().commitButReportFailure = false; marker().refusalAt = 0;
  }

  JSONObject timing(int at,boolean silent) throws Exception {
   return new JSONObject().put("dueAt",time(at)).put("alertMinutes",silent ? JSONObject.NULL : 0);
  }

  void schedule(int at,boolean repeat,boolean silent,String mode) throws Exception {
   JSONObject recurrence = null;
   if (repeat) {
    var local = Instant.ofEpochMilli(time(at)).atZone(ZoneOffset.UTC);
    recurrence = new JSONObject().put("rule","daily").put("zone","UTC").put("date",local.toLocalDate().toString())
     .put("time",local.toLocalTime().toString()).put("leadMinutes",0);
   }
   configureFault(mode,1);
   try {outcome=engine.schedule(ID,TITLE,BODY,time(at),recurrence,timing(at,silent)).getString("status");}
   catch (RuntimeException rejected) {outcome="rejected";}
   finally {clearFaults();}
   point("schedule",at,repeat,silent,mode);
  }

  void seedLegacy() throws Exception {
   // The initial empty envelope is replaced with the observed pre-upgrade input.
   envelopePrefs().edit().clear().commit();
   JSONObject legacy = new JSONObject().put("id",ID).put("title",TITLE).put("body",BODY)
    .put("status","scheduled").put("mode","inexact").put("at",time(60)).put("createdAt",BASE);
   context.getSharedPreferences(CONFIG.legacyName,Context.MODE_PRIVATE).edit().putString(ID,legacy.toString()).commit();
   check(engine.read(ID).getString("occurrenceId").startsWith("legacy_") &&
     envelope().getJSONObject("legacyArchive").getString(ID).equals(legacy.toString()), "Upgrade retains the exact legacy row");
   point("seedLegacy",60);
  }

  void operate(int at,boolean silent,String mode) throws Exception {
   JSONObject schedule = timing(at,silent).put("at",time(at)).put("recurrence",JSONObject.NULL);
   operation = new JSONObject().put("type","reminder_create").put("fields",
    new JSONObject().put("title",TITLE).put("body",BODY).put("schedule",schedule));
   configureFault(mode,2);
   operating=true;
   try {outcome=engine.operate(ID,BINDING,operation).getString("status");}
   finally {operating=false;clearFaults();}
   point("operate",at,silent,mode);
  }

  void replay(boolean same) throws Exception {
   int arms = context.alarms.attempts;
   try {
    String binding = same ? BINDING : "b".repeat(64);
    outcome=engine.operate(ID,binding,operation).getString("status");
    check(engine.operationReceipt(ID,binding,operation).getString("status").equals(outcome),"Exact operation and query receipt agree");
   } catch (IllegalArgumentException rejected) {outcome="rejected";}
   check(context.alarms.attempts == arms,"Replay or changed argument never arms");
   point("replayOperation",same);
  }

  Intent alarmIntent(int occurrence) {
   Intent existing = alarmIntents.get(occurrence);
   if (existing != null) return new Intent(existing);
   String raw = rawOccurrence(occurrence);
   return new Intent(context,CONFIG.receiverClass).setAction(CONFIG.remindAction)
    .setData(Uri.parse(CONFIG.alarmUriPrefix + ID + (raw == null ? "" : "/" + raw)))
    .putExtra(CONFIG.idExtra,ID).putExtra(CONFIG.occurrenceExtra,raw);
  }

  void deliver(int occurrence,boolean take,String mode) throws Exception {
   if (take) check(context.alarms.live.keySet().removeIf(p -> rawOccurrence(occurrence).equals(p.intent.getStringExtra(CONFIG.occurrenceExtra))),
    "Synthetic one-shot delivery takes the exact armed alarm");
   configureFault(mode,1);
   try {receiver.onReceive(context,alarmIntent(occurrence));} finally {clearFaults();}
   point("deliver",occurrence,take,mode);
  }

  void decide(int occurrence,boolean done,boolean broadcast,String mode) throws Exception {
   String verb = done ? "done" : "snooze";
   configureFault(mode,1);
   try {
    if (broadcast) receiver.onReceive(context,new Intent(decisions.get(occurrence).get(verb)));
    else outcome=engine.decide(ID,rawOccurrence(occurrence),verb).getString("status");
   } catch (RuntimeException rejected) {if (!broadcast) outcome="rejected"; else throw rejected;}
   finally {clearFaults();}
   point("decide",occurrence,done,broadcast,mode);
  }

  void cancel() throws Exception { check(engine.store.cancel(context,ID),"Known row cancellation");outcome="cancelled";point("cancel"); }
  void dismiss() throws Exception { context.notices.cancel(ID,0);point("dismiss"); }

  void restartProcess() throws Exception {
   context.recreateProcess();
   for (String field : List.of("ENGINES","CLAIMS")) {
    var members = ReminderEngine.class.getDeclaredField(field);
    members.setAccessible(true);
    ((Map<?,?>)members.get(null)).clear();
   }
   engine=AlphaReminders.engine(context);
   process++;
  }

  void restart() throws Exception {restartProcess();point("restart");}

  void reboot() throws Exception {
   context.boot++;context.alarms.live.clear();context.notices.live.clear();PendingIntent.reboot();
   restartProcess();point("reboot");
  }

  void restore(String mode) throws Exception {
   configureFault(mode,1);
   try {receiver.onReceive(context,new Intent(Intent.ACTION_BOOT_COMPLETED));}
   catch (IllegalStateException unavailable) {check(engine.store.persistence.quarantined,"Only quarantined source refuses the restore");}
   finally {clearFaults();}
   point("restore",mode);
  }

  void post() throws Exception {schedule(60,false,false,"complete");clock(60);deliver(1,true,"complete");}

  void checkPending(boolean retained) throws Exception {
   String token = token(context.notices.live.get(ID).getNotification().contentIntent);
   engine.captureTap(token);
   JSONObject pending = engine.pendingTap();
   check(token.equals(pending.getString("token")) && pending.getBoolean("retained") == retained,"Exact opaque route retains only current posted bytes");
   if (!retained) {
    try {engine.consumeTap(token);throw new AssertionError("Stale visible route accepted");}
    catch (IllegalStateException expected) {}
   }
   stutter("the independent tap ledger reads the exact visible target without modifying reminder custody");
  }
 }

 public static void main(String[] args) throws Exception {
  Fixture f = new Fixture(args[0]);
  switch (args[0]) {
   case "stale-and-early-alarm":
    f.schedule(60,false,false,"complete");
    f.schedule(120,false,false,"complete");
    f.clock(60);f.deliver(1,false,"complete");f.deliver(2,true,"complete");
    f.clock(120);f.deliver(2,true,"complete");f.checkPending(true);
    break;
   case "permission-revoked-at-delivery":
    f.schedule(60,false,false,"complete");
    f.permission(false);f.clock(60);f.deliver(1,true,"complete");
    f.permission(true);f.restore("complete");
    f.schedule(120,false,false,"complete");f.clock(120);f.deliver(2,true,"complete");
    break;
   case "blocked-due-channel-is-not-delivered":
    f.schedule(60,false,false,"complete");
    f.channel(false);f.clock(60);f.deliver(1,true,"complete");
    f.channel(true);f.restore("complete");
    check(f.context.notices.posts==0&&f.context.alarms.live.isEmpty(),"Restoring channel does not reschedule denied row");
    break;
   case "notification-before-refused-durable-post":
    f.schedule(60,false,false,"complete");f.clock(60);f.deliver(1,true,"before-save");
    check("scheduled".equals(f.rawRow().getString("status")) && f.visible() != null &&
      f.engine.store.persistence.quarantined,"Visible notification can precede refused posted-phase write");
    check(f.envelopePrefs().getString("envelope","").contains("postedAt"),"SharedPreferences memory may contain failed bytes");
    try {f.engine.read(ID);throw new AssertionError("Quarantined row read accepted");}
    catch (IllegalStateException expected) {}
    f.deliver(1,false,"complete");
    f.restart();f.checkPending(false);f.restore("complete");
    f.dismiss();f.clock(61);f.deliver(1,true,"complete");f.checkPending(true);
    break;
   case "notification-posted-bytes-after-ambiguous-commit":
    f.schedule(60,false,false,"complete");f.clock(60);f.deliver(1,true,"after-save");
    check("posted".equals(f.rawRow().getString("status")) && f.engine.store.persistence.quarantined,
      "Failed commit report does not imply posted bytes are absent");
    f.restart();f.checkPending(true);f.restore("complete");
    break;
   case "route-and-platform-refusal-recovery":
    f.schedule(60,false,false,"complete");f.clock(60);f.deliver(1,true,"route-refused");
    check(f.context.secure.isEmpty(),"No durable tap before refused route write");
    f.restore("complete");f.clock(61);f.deliver(1,true,"notify-refused");
    check(f.context.secure.containsKey(CONFIG.tapSlot) && f.visible() == null,"Prepared routes remain after rejected OS post");
    f.restore("complete");f.clock(62);f.deliver(1,true,"complete");
    break;
   case "reboot-permission-and-once-per-boot":
    f.post();
    String before = f.token(f.context.notices.live.get(ID).getNotification().contentIntent);
    f.reboot();f.permission(false);f.restore("complete");f.permission(true);f.restore("notify-refused");f.restore("complete");
    check(before.equals(f.token(f.context.notices.live.get(ID).getNotification().contentIntent)),
     "Same durable revision reuses the ordinary tap across boot");
    f.dismiss();f.restore("complete");f.reboot();f.restore("complete");
    break;
   case "boot-marker-memory-and-disk-disagree":
    f.post();f.reboot();f.restore("marker-refused");
    check(f.marker().durable().get("boot") == null && f.marker().getString("boot","").equals("count:2"),
      "Boot marker failure leaves current process memory ahead of durable marker");
    f.dismiss();f.restore("complete");f.restart();f.restore("complete");
    break;
   case "snooze-exact-occurrence-and-repeat-decision":
    f.post();f.decide(1,false,true,"complete");f.decide(1,false,false,"complete");
    f.clock(660);f.deliver(1,true,"complete");f.decide(1,false,true,"complete");
    check(f.rawRow().getLong("at") == time(1260),"Same-occurrence Snooze is reusable after the later post");
    f.decide(1,true,true,"complete");f.decide(1,true,false,"complete");
    break;
   case "daily-completion-advances-and-fences-old-action":
    f.schedule(60,true,false,"complete");f.clock(60);f.deliver(1,true,"complete");
    f.clock(172920);f.decide(1,true,true,"complete");
    f.decide(1,true,true,"complete");f.deliver(1,false,"complete");
    f.clock(259260);f.deliver(2,true,"complete");
    break;
   case "legacy-null-occurrence-retires-on-reschedule":
    f.seedLegacy();f.clock(59);f.deliver(0,false,"complete");
    f.clock(60);f.deliver(0,false,"complete");f.deliver(1,true,"complete");
    f.schedule(120,false,false,"complete");f.clock(120);f.deliver(0,false,"complete");f.deliver(2,true,"complete");
    break;
   case "reviewed-unknown-after-platform-refusal":
    f.operate(60,false,"arm-refused");f.replay(true);f.replay(false);f.restore("complete");
    break;
   case "reviewed-effect-before-refused-receipt":
    f.operate(60,false,"receipt-before-save");f.restart();f.replay(true);f.replay(false);
    f.restore("complete");f.clock(60);f.deliver(1,true,"complete");
    break;
   case "reviewed-terminal-receipt-survives-failure-report":
    f.operate(60,false,"receipt-after-save");f.restart();f.replay(true);
    break;
   case "reviewed-silent-row-has-no-alarm":
    f.operate(60,true,"complete");f.replay(true);f.clock(60);f.deliver(1,false,"complete");
    f.decide(1,false,false,"complete");f.decide(1,true,false,"complete");
    break;
   case "direct-arm-refusal-rolls-back-and-recovery":
    f.schedule(60,false,false,"complete");f.schedule(120,false,false,"arm-refused");
    f.clock(60);f.deliver(1,true,"complete");f.decide(1,false,true,"arm-refused");
    f.restore("complete");f.cancel();
    break;
   case "decision-write-fails-after-durable-snooze":
    f.post();f.decide(1,false,true,"after-save");
    check(f.visible() != null && f.rawRow().getString("status").equals("scheduled"), "Durable snooze can precede failed cleanup");
    f.restart();f.checkPending(false);f.restore("complete");f.clock(660);f.deliver(1,true,"complete");
    break;
   default: throw new AssertionError("Unknown scenario " + args[0]);
  }
  java.lang.System.out.println(f.trace.value);
 }
}
