// spec/app/slack/notices.md, "Story: Hear about Slack DMs, mentions and thread replies per workspace"; spec/app/telegram/notices.md, "Story: Hear about new Telegram messages without noise"
package ai.alphacompute.alphaphone.messaging;

import ai.alphacompute.ipc.AlphaIpcContract;
import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.Binder;
import android.os.Bundle;
import org.json.JSONException;
import org.json.JSONObject;

public final class MessagingNoticeAuthority extends ContentProvider {
    private static final String CORE = AlphaIpcContract.CORE_PACKAGE;
    static final String STATUS = "status", POST = "post", WITHDRAW = "withdraw", RETIRE = "retire", SHOWS = "shows";

    static Uri authority(Context context, String name) {
        if (context.getPackageName().equals(name)) return null;
        String id = name + ".messaging-notices";
        var info = context.getPackageManager().resolveContentProvider(id, 0);
        return info != null && info.enabled && info.applicationInfo.enabled && name.equals(info.packageName)
            && AlphaIpcContract.hasCoreSignature(context, name) ? Uri.parse("content://" + id) : null;
    }

    static Uri canonical(Context context, String provider) {
        return CORE.equals(context.getPackageName()) ? authority(context, MessagingNotices.thin(provider)) : null;
    }

    static boolean relay(Context context, Uri uri, String method, JSONObject selector) {
        var response = context.getContentResolver().call(uri, method, selector.toString(), null);
        if (response == null || !response.containsKey("ok")) throw new IllegalStateException("Messaging notice host unavailable");
        return response.getBoolean("ok");
    }

    static boolean allowed(Context context, String provider) throws JSONException {
        if (!MessagingNotices.serves(context, provider)) return false;
        Uri host = canonical(context, provider);
        return host == null ? MessagingNotices.allowed(context, provider)
            : relay(context, host, STATUS, new JSONObject().put("provider", provider));
    }

    static boolean post(Context context, JSONObject target, String title, String body) throws JSONException {
        String provider = target.getString("provider");
        if (!MessagingNotices.serves(context, provider) || MessagingNoticeFront.shows(provider, target)) return false;
        Uri host = canonical(context, provider);
        if (host != null) {
            boolean posted = relay(context, host, POST, target);
            if (posted) MessagingNotices.retireTray(context, target);
            return posted;
        }
        Uri legacy = authority(context, CORE);
        if (legacy != null && relay(context, legacy, SHOWS, target)) return false;
        boolean posted = MessagingNotices.post(context, target, title, body) != null;
        if (posted && legacy != null) relay(context, legacy, RETIRE, target);
        return posted;
    }

    static void withdraw(Context context, JSONObject selector) throws JSONException {
        String provider = selector.getString("provider");
        if (!MessagingNotices.serves(context, provider)) return;
        MessagingNotices.withdraw(context, selector);
        Uri other = CORE.equals(context.getPackageName()) ? canonical(context, provider) : authority(context, CORE);
        if (other != null) relay(context, other, WITHDRAW, selector);
    }

    @Override public boolean onCreate() { return true; }

    @Override public Bundle call(String method, String arg, Bundle extras) {
        Context context = getContext();
        if (context == null || arg == null || arg.length() > 4096) throw new IllegalArgumentException("Missing messaging notice target");
        try {
            JSONObject target = MessagingNotices.target(new JSONObject(arg), POST.equals(method) || RETIRE.equals(method) || SHOWS.equals(method));
            String provider = target.getString("provider");
            String caller = getCallingPackage();
            if (!MessagingNotices.serves(context, provider) || caller == null || !AlphaIpcContract.hasCoreSignature(context, caller)) {
                throw new SecurityException("Unrecognized messaging notice host");
            }
            boolean legacy = CORE.equals(context.getPackageName());
            if (legacy ? !MessagingNotices.thin(provider).equals(caller) || (!WITHDRAW.equals(method) && !RETIRE.equals(method) && !SHOWS.equals(method)) : !CORE.equals(caller)) {
                throw new SecurityException("Messaging notice host does not serve that request");
            }
            long identity = Binder.clearCallingIdentity();
            boolean ok;
            try {
                ok = switch (method) {
                    case STATUS -> MessagingNotices.allowed(context, provider);
                    case SHOWS -> MessagingNoticeFront.shows(provider, target);
                    case POST -> !MessagingNoticeFront.shows(provider, target)
                        && MessagingNotices.post(context, target, MessagingNotices.label(provider), "New message") != null;
                    case RETIRE -> { MessagingNotices.retireTray(context, target); yield true; }
                    case WITHDRAW -> { MessagingNotices.withdraw(context, target); yield true; }
                    default -> throw new IllegalArgumentException("Unsupported messaging notice operation");
                };
            } finally { Binder.restoreCallingIdentity(identity); }
            var result = new Bundle();
            result.putBoolean("ok", ok);
            return result;
        } catch (JSONException invalid) { throw new IllegalArgumentException("Invalid messaging notice target", invalid); }
    }

    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String order) { throw new UnsupportedOperationException(); }
    @Override public String getType(Uri uri) { return null; }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String selection, String[] args) { throw new UnsupportedOperationException(); }
}
