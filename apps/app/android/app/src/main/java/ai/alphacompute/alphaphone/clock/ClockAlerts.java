// spec/app/clock/index.md, "Story: Hear and prioritize ringing alerts"
package ai.alphacompute.alphaphone.clock;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import ai.eliza.plugins.securestore.nativeonly.KeystoreTextFrame;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

final class ClockAlerts {
    static final String FIRE = "ai.alphacompute.clock.FIRE";
    static final String OPEN = "ai.alphacompute.clock.OPEN";
    private static final String CHANNEL = "alpha_clock_alarm";
    private static final String TAG = "alpha-clock/";
    private static final KeystoreTextFrame FRAME = new KeystoreTextFrame("alpha_clock_alerts", 2 * 1024 * 1024);
    private final Context context;
    private final SharedPreferences preferences;
    private final AlarmManager alarms;
    private final NotificationManager notices;
    private final byte[] aad;

    ClockAlerts(Context context) {
        this.context = context.getApplicationContext();
        preferences = context.getSharedPreferences("clock-alerts", Context.MODE_PRIVATE);
        alarms = context.getSystemService(AlarmManager.class);
        notices = context.getSystemService(NotificationManager.class);
        aad = (context.getPackageName() + ":clock-alerts:v1").getBytes(StandardCharsets.UTF_8);
    }

    private record Alert(String kind, String remoteId, long id, long at, boolean ringing, String title, boolean vibrate,
                         int hour, int minute, int daysMask, boolean snoozed) {
        String key() { return kind + "/" + id; }
        String identity() { return ClockAuthority.identity(kind, remoteId); }

        static Alert parse(JSONObject value) throws JSONException {
            String kind = value.getString("kind");
            boolean alarm = "alarm".equals(kind);
            if (!alarm && !"timer".equals(kind)) throw new JSONException("Invalid Clock alert kind");
            long id = integer(value, "id", 1, 9_007_199_254_740_991L);
            String remoteId = value.optString("remoteId", kind + "-" + id);
            if (remoteId.isEmpty()) throw new JSONException("Missing Clock record identity");
            return new Alert(kind, remoteId, id,
                integer(value, "at", 1, 8_640_000_000_000_000L), value.getBoolean("ringing"),
                value.getString("title"), value.getBoolean("vibrate"),
                alarm ? (int) integer(value, "hour", 0, 23) : 0,
                alarm ? (int) integer(value, "minute", 0, 59) : 0,
                alarm ? (int) integer(value, "daysMask", 0, 127) : 0,
                alarm && value.optBoolean("snoozed", false));
        }

        static long integer(JSONObject value, String key, long min, long max) throws JSONException {
            if (!(value.get(key) instanceof Number number) || number.doubleValue() != number.longValue()
                    || number.longValue() < min || number.longValue() > max) throw new JSONException("Invalid Clock " + key);
            return number.longValue();
        }

        JSONObject json() throws JSONException {
            return new JSONObject().put("kind", kind).put("remoteId", remoteId).put("id", id).put("at", at).put("ringing", ringing)
                .put("title", title).put("vibrate", vibrate).put("hour", hour).put("minute", minute)
                .put("daysMask", daysMask).put("snoozed", snoozed);
        }

        long nextWallTime(long after) {
            ZoneId zone = ZoneId.systemDefault();
            LocalDate today = Instant.ofEpochMilli(after).atZone(zone).toLocalDate();
            for (int offset = 0; offset <= 7; offset++) {
                LocalDate day = today.plusDays(offset);
                int weekday = day.getDayOfWeek().getValue() % 7;
                if (daysMask != 0 && (daysMask & (1 << weekday)) == 0) continue;
                var wall = day.atTime(hour, minute);
                var offsets = zone.getRules().getValidOffsets(wall);
                long first = offsets.isEmpty() ? zone.getRules().getTransition(wall).getInstant().toEpochMilli()
                    : wall.toInstant(offsets.get(0)).toEpochMilli();
                if (first > after) return first;
                if (offsets.size() == 2 && offsets.get(1).equals(zone.getRules().getOffset(Instant.ofEpochMilli(after)))) {
                    long second = wall.toInstant(offsets.get(1)).toEpochMilli();
                    if (second > after) return second;
                }
            }
            throw new IllegalStateException("No matching Clock weekday");
        }
    }

    private record Entry(Alert alert, long next, long posted, String token, boolean delivering) {
        JSONObject json() throws JSONException {
            return alert.json().put("next", next).put("posted", posted).put("token", token).put("delivering", delivering);
        }

        static Entry parse(JSONObject object) throws JSONException {
            return new Entry(Alert.parse(object), object.getLong("next"), object.getLong("posted"),
                object.getString("token"), object.getBoolean("delivering"));
        }

        String tag() { return TAG + alert.key() + "/" + posted; }
    }

    private Map<String, Entry> read() throws Exception {
        var rows = new HashMap<String, Entry>();
        String packed = preferences.getString("rows", null);
        if (packed == null) return rows;
        var values = new JSONArray(FRAME.open(packed, aad));
        for (int i = 0; i < values.length(); i++) {
            Entry row = Entry.parse(values.getJSONObject(i));
            rows.put(row.alert.key(), row);
        }
        return rows;
    }

    private void save(Map<String, Entry> rows) throws Exception {
        var values = new JSONArray();
        for (Entry row : rows.values()) values.put(row.json());
        var editor = preferences.edit();
        if (rows.isEmpty()) editor.remove("rows");
        else editor.putString("rows", FRAME.seal(values.toString(), aad));
        if (!editor.commit()) throw new IOException("Could not save Clock alerts");
    }

    boolean exact() { return Build.VERSION.SDK_INT < 31 || alarms.canScheduleExactAlarms(); }

    boolean notificationsEnabled(JSONArray alerts) throws JSONException {
        if (!notices.areNotificationsEnabled()) return false;
        for (int i = 0; i < alerts.length(); i++) {
            String channel = alerts.getJSONObject(i).getBoolean("vibrate") ? CHANNEL + "_vibrate" : CHANNEL;
            if (notices.getNotificationChannel(channel).getImportance() == NotificationManager.IMPORTANCE_NONE) return false;
        }
        return true;
    }

    private void channels() {
        for (boolean vibrate : new boolean[]{false, true}) {
            String id = vibrate ? CHANNEL + "_vibrate" : CHANNEL;
            if (notices.getNotificationChannel(id) != null) continue;
            var channel = new NotificationChannel(id, vibrate ? "Alarms and timers with vibration" : "Alarms and timers",
                NotificationManager.IMPORTANCE_HIGH);
            channel.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM), new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
            channel.enableVibration(vibrate);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
            notices.createNotificationChannel(channel);
        }
    }

    private PendingIntent alarmIntent(String key, long due, int flags) {
        var intent = new Intent(context, ClockAlertReceiver.class).setAction(FIRE)
            .setData(Uri.parse("alpha-clock:" + key)).putExtra("due", due);
        return PendingIntent.getBroadcast(context, 0, intent, flags | PendingIntent.FLAG_IMMUTABLE);
    }

    private void cancelAlarm(String key) {
        var pending = alarmIntent(key, 0, PendingIntent.FLAG_NO_CREATE);
        if (pending == null) return;
        alarms.cancel(pending);
        pending.cancel();
    }

    private void schedule(Entry row) {
        var pending = alarmIntent(row.alert.key(), row.next, PendingIntent.FLAG_UPDATE_CURRENT);
        if (exact()) {
            try {
                alarms.setAlarmClock(new AlarmManager.AlarmClockInfo(row.next, null), pending);
                return;
            }
            catch (SecurityException revoked) {}
        }
        alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, row.next, pending);
    }

    void reconcile(JSONArray alerts) throws Exception {
        reconcile(alerts, new JSONArray());
    }

    void reconcile(JSONArray alerts, JSONArray known) throws Exception {
        Map<String, Entry> previous = read();
        var rows = new HashMap<String, Entry>();
        for (int i = 0; i < alerts.length(); i++) {
            Alert alert = Alert.parse(alerts.getJSONObject(i));
            Entry old = previous.get(alert.key());
            boolean same = old != null && (old.alert.at == alert.at || alert.ringing)
                && old.alert.hour == alert.hour && old.alert.minute == alert.minute && old.alert.daysMask == alert.daysMask;
            long next = !alert.ringing ? alert.at : alert.daysMask == 0 ? 0 : alert.nextWallTime(System.currentTimeMillis());
            Entry row = same ? new Entry(alert, old.next, old.posted, old.token, old.delivering)
                : new Entry(alert, next, 0, "", false);
            if (rows.put(alert.key(), row) != null) throw new JSONException("Duplicate Clock alert");
        }
        removeAdopted(rows);
        if (!rows.equals(previous)) save(rows);
        ClockAuthority.claim(context, known, identities(rows));
        for (String key : previous.keySet()) if (!rows.containsKey(key)) cancelAlarm(key);
        restore(rows, false);
    }

    private ArrayList<String> identities(Map<String, Entry> rows) {
        var ids = new ArrayList<String>();
        for (Entry row : rows.values()) ids.add(row.alert.identity());
        return ids;
    }

    private boolean removeAdopted(Map<String, Entry> rows) {
        var owned = ClockAuthority.adopted(context, identities(rows));
        if (owned.isEmpty()) return false;
        return rows.values().removeIf(row -> {
            if (!owned.contains(row.alert.identity())) return false;
            cancelAlarm(row.alert.key());
            if (row.posted > 0) notices.cancel(row.tag(), 1);
            return true;
        });
    }

    void restore(String action) throws Exception {
        var rows = read();
        if (removeAdopted(rows)) save(rows);
        restore(rows, Intent.ACTION_TIMEZONE_CHANGED.equals(action));
    }

    private void restore(Map<String, Entry> rows, boolean timezoneChanged) throws Exception {
        channels();
        long now = System.currentTimeMillis();
        for (String key : rows.keySet()) {
            Entry row = rows.get(key);
            if (timezoneChanged && row.next > now && row.alert.kind.equals("alarm") && !row.alert.snoozed) {
                row = new Entry(row.alert, row.alert.nextWallTime(now), row.posted, row.token, row.delivering);
                rows.put(key, row);
                save(rows);
            }
            if (row.next > 0 && row.next <= now) fire(rows, row, now);
            else {
                if (row.delivering) publish(rows, row);
                if (row.next > 0) schedule(row);
            }
        }
        for (var active : notices.getActiveNotifications()) {
            String tag = active.getTag();
            if (tag != null && tag.startsWith(TAG) && rows.values().stream().noneMatch(row -> row.posted > 0 && row.tag().equals(tag)))
                notices.cancel(tag, 1);
        }
    }

    void receive(Intent intent) throws Exception {
        if (!FIRE.equals(intent.getAction())) { restore(intent.getAction()); return; }
        Uri data = intent.getData();
        if (data == null || !"alpha-clock".equals(data.getScheme())) return;
        Map<String, Entry> rows = read();
        if (removeAdopted(rows)) save(rows);
        Entry row = rows.get(data.getSchemeSpecificPart());
        if (row == null || row.next == 0 || row.next != intent.getLongExtra("due", 0)) return;
        long now = System.currentTimeMillis();
        if (row.next > now) { schedule(row); return; }
        channels();
        fire(rows, row, now);
    }

    private void fire(Map<String, Entry> rows, Entry row, long now) throws Exception {
        Alert alert = row.alert;
        long next = alert.daysMask == 0 ? 0 : alert.nextWallTime(now);
        boolean audible = !alert.kind.equals("alarm") || now - row.next < 600_000;
        Entry fired = new Entry(alert, next, audible ? row.next : 0, audible ? UUID.randomUUID().toString() : "", audible);
        rows.put(alert.key(), fired);
        save(rows);
        if (row.posted > 0) notices.cancel(row.tag(), 1);
        if (next > 0) schedule(fired);
        if (audible) publish(rows, fired);
    }

    private void publish(Map<String, Entry> rows, Entry row) throws Exception {
        Intent intent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (intent == null) throw new IllegalStateException("Clock launcher unavailable");
        intent.setAction(OPEN).setData(Uri.fromParts("alpha-clock-open", row.token, null))
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        var open = PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Alert alert = row.alert;
        var notice = new Notification.Builder(context, alert.vibrate ? CHANNEL + "_vibrate" : CHANNEL)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm).setCategory(Notification.CATEGORY_ALARM)
            .setVisibility(Notification.VISIBILITY_PRIVATE).setOnlyAlertOnce(true).setAutoCancel(true)
            .setWhen(row.posted).setShowWhen(true).setContentIntent(open)
            .setContentTitle(alert.title.trim().isEmpty() ? ("timer".equals(alert.kind) ? "Timer" : "Alarm") : alert.title)
            .setContentText("timer".equals(alert.kind) ? "Timer finished" : "Alarm ringing");
        if (alert.kind.equals("alarm")) notice.setTimeoutAfter(Math.max(1, 600_000 - (System.currentTimeMillis() - row.posted)));
        notices.notify(row.tag(), 1, notice.build());
        rows.put(alert.key(), new Entry(alert, row.next, row.posted, row.token, false));
        save(rows);
    }

    JSONObject tap(String token, boolean consume) throws Exception {
        if (token == null || token.isEmpty()) return new JSONObject();
        Map<String, Entry> rows = read();
        if (removeAdopted(rows)) save(rows);
        for (Entry row : rows.values()) {
            if (!token.equals(row.token)) continue;
            if (consume) {
                rows.put(row.alert.key(), new Entry(row.alert, row.next, row.posted, "", false));
                save(rows);
            }
            return new JSONObject().put("kind", row.alert.kind).put("id", row.alert.id).put("token", token);
        }
        return new JSONObject();
    }
}
