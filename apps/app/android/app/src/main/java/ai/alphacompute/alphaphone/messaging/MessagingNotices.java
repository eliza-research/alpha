// spec/app/slack/notices.md, "Story: Hear about Slack DMs, mentions and thread replies per workspace"; spec/app/telegram/notices.md, "Story: Hear about new Telegram messages without noise"
package ai.alphacompute.alphaphone.messaging;

import ai.alphacompute.ipc.AlphaIpcContract;
import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.json.JSONException;
import org.json.JSONObject;

public final class MessagingNotices {
    static final List<String> PROVIDERS = List.of("slack", "telegram");
    static final String OPEN = "ai.alphacompute.messaging.OPEN";
    private static final String SCHEME = "alpha-messaging-notice", TAP = "selected";

    static String thin(String provider) { return "ai.alphacompute." + provider; }

    static String label(String provider) { return "slack".equals(provider) ? "Slack" : "Telegram"; }

    static boolean serves(Context context, String provider) {
        String own = context.getPackageName();
        return PROVIDERS.contains(provider) && (AlphaIpcContract.CORE_PACKAGE.equals(own) || thin(provider).equals(own));
    }

    static String channel(String provider) { return "alpha.messages." + provider; }

    static JSONObject target(JSONObject input, boolean complete) throws JSONException {
        if (input == null) throw new IllegalArgumentException("Missing notice target");
        String provider = field(input, "provider", false);
        if (!PROVIDERS.contains(provider)) throw new IllegalArgumentException("Unknown messaging app");
        var result = new JSONObject().put("provider", provider);
        List<String> keys = provider.equals("slack") ? List.of("scope", "workspace", "channel", "thread") : List.of("scope", "peer");
        for (String key : keys) {
            if (!complete && !input.has(key)) continue;
            String value = field(input, key, key.equals("thread"));
            if (key.equals("scope") && !value.matches("[A-Za-z0-9_-]{43}")) throw new IllegalArgumentException("Invalid notice scope");
            result.put(key, value);
        }
        if (result.length() != input.length()) throw new IllegalArgumentException("Unrecognized notice selector");
        return result;
    }

    private static String field(JSONObject input, String key, boolean empty) {
        Object value = input.opt(key);
        if (!(value instanceof String text) || (!empty && text.trim().isEmpty()) || text.length() > 256) {
            throw new IllegalArgumentException("Invalid notice " + key);
        }
        return text;
    }

    private static boolean matches(JSONObject target, JSONObject selector) throws JSONException {
        var keys = selector.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            if (!selector.getString(key).equals(target.optString(key, null))) return false;
        }
        return true;
    }

    private static String tag(String target) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(target.getBytes(StandardCharsets.UTF_8));
            return "alpha-message:" + Base64.encodeToString(digest, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
        } catch (NoSuchAlgorithmException impossible) { throw new AssertionError(impossible); }
    }

    private static SharedPreferences rows(Context context, String provider) {
        return context.getSharedPreferences("messaging-notices-" + provider, Context.MODE_PRIVATE);
    }

    private static void save(SharedPreferences.Editor edit) {
        if (!edit.commit()) throw new IllegalStateException("Could not save private messaging notice");
    }

    static boolean allowed(Context context, String provider) {
        if (!serves(context, provider)) return false;
        var manager = context.getSystemService(NotificationManager.class);
        var channel = new NotificationChannel(channel(provider), label(provider), NotificationManager.IMPORTANCE_DEFAULT);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        manager.createNotificationChannel(channel);
        return (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
            && manager.areNotificationsEnabled() && manager.getNotificationChannel(channel.getId()).getImportance() != NotificationManager.IMPORTANCE_NONE;
    }

    static synchronized String post(Context context, JSONObject target, String title, String body) throws JSONException {
        String provider = target.getString("provider");
        if (!allowed(context, provider)) return null;
        var manager = context.getSystemService(NotificationManager.class);
        var launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launch == null || launch.getComponent() == null) return null;
        String token = UUID.randomUUID().toString();
        Uri uri = Uri.fromParts(SCHEME, token, null);
        launch.setAction(OPEN).setData(uri).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        var open = PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_IMMUTABLE);
        var dismiss = PendingIntent.getBroadcast(context, 0, new Intent(context, Dismissed.class).setData(uri), PendingIntent.FLAG_IMMUTABLE);
        var redacted = new Notification.Builder(context, channel(provider))
            .setSmallIcon(android.R.drawable.stat_notify_chat).setContentTitle(label(provider)).setContentText("New message").build();
        var notice = new Notification.Builder(context, channel(provider))
            .setSmallIcon(android.R.drawable.stat_notify_chat).setCategory(Notification.CATEGORY_MESSAGE)
            .setVisibility(Notification.VISIBILITY_PRIVATE).setPublicVersion(redacted).setContentTitle(title).setContentText(body)
            .setOnlyAlertOnce(true).setAutoCancel(true).setContentIntent(open).setDeleteIntent(dismiss).build();
        String key = target.toString();
        var prefs = rows(context, provider);
        save(prefs.edit().putString(key, token));
        try {
            manager.notify(tag(key), 1, notice);
            return token;
        } catch (RuntimeException failure) {
            save(prefs.edit().remove(key));
            manager.cancel(tag(key), 1);
            throw failure;
        }
    }

    static synchronized void withdraw(Context context, JSONObject selector) throws JSONException {
        String provider = selector.getString("provider");
        if (!serves(context, provider)) return;
        var prefs = rows(context, provider);
        var manager = context.getSystemService(NotificationManager.class);
        var edit = prefs.edit();
        var canceled = new ArrayList<String>();
        boolean changed = false;
        for (var row : prefs.getAll().entrySet()) {
            String key = row.getKey();
            boolean tapped = key.equals(TAP);
            JSONObject target = tapped ? new JSONObject((String) row.getValue()).getJSONObject("target") : new JSONObject(key);
            if (!matches(target, selector)) continue;
            changed = true;
            if (!tapped) canceled.add(key);
            edit.remove(key);
        }
        if (changed) save(edit);
        for (String key : canceled) manager.cancel(tag(key), 1);
    }

    static String token(Intent intent) {
        Uri uri = intent == null ? null : intent.getData();
        if (uri == null || !SCHEME.equals(uri.getScheme()) || !uri.isOpaque() || uri.getFragment() != null) return null;
        String token = uri.getSchemeSpecificPart();
        return token != null && token.matches("[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}") ? token : null;
    }

    static synchronized JSONObject pending(Context context, String provider) {
        if (!serves(context, provider)) return new JSONObject();
        String request = rows(context, provider).getString(TAP, null);
        if (request == null) return new JSONObject();
        try { return new JSONObject(request); }
        catch (JSONException corrupt) { throw new IllegalStateException("Stored notification target is unreadable", corrupt); }
    }

    static synchronized void retireTray(Context context, JSONObject target) throws JSONException {
        var prefs = rows(context, target.getString("provider"));
        String key = target.toString();
        if (!prefs.contains(key)) return;
        save(prefs.edit().remove(key));
        context.getSystemService(NotificationManager.class).cancel(tag(key), 1);
    }

    public static synchronized boolean opened(Context context, Intent intent) {
        String token = token(intent);
        if (token == null || !OPEN.equals(intent.getAction())) return false;
        for (String provider : PROVIDERS) {
            if (!serves(context, provider)) continue;
            var prefs = rows(context, provider);
            if (token.equals(pending(context, provider).optString("token", null))) return true;
            for (var row : prefs.getAll().entrySet()) {
                if (!token.equals(row.getValue())) continue;
                try {
                    String request = new JSONObject().put("target", new JSONObject(row.getKey())).put("token", token).toString();
                    save(prefs.edit().remove(row.getKey()).putString(TAP, request));
                    context.getSystemService(NotificationManager.class).cancel(tag(row.getKey()), 1);
                    return true;
                } catch (JSONException corrupt) { throw new IllegalStateException("Stored notification target is unreadable", corrupt); }
            }
        }
        return false;
    }

    static synchronized boolean consume(Context context, String token) {
        if (token == null) return false;
        for (String provider : PROVIDERS) {
            if (!serves(context, provider)) continue;
            var prefs = rows(context, provider);
            if (!token.equals(pending(context, provider).optString("token", null))) continue;
            save(prefs.edit().remove(TAP));
            return true;
        }
        return false;
    }

    private static synchronized void dismissed(Context context, String token) {
        if (token == null) return;
        for (String provider : PROVIDERS) {
            if (!serves(context, provider)) continue;
            var prefs = rows(context, provider);
            for (var row : prefs.getAll().entrySet()) {
                if (token.equals(row.getValue())) { save(prefs.edit().remove(row.getKey())); return; }
            }
        }
    }

    public static final class Dismissed extends BroadcastReceiver {
        @Override public void onReceive(Context context, Intent intent) { dismissed(context, token(intent)); }
    }
}
