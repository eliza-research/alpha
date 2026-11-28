// spec/app/clock/index.md, "Story: Hear and prioritize ringing alerts"
package ai.alphacompute.alphaphone.clock;

import ai.alphacompute.ipc.AlphaIpcContract;
import android.content.BroadcastReceiver;
import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONException;

public final class ClockAuthority extends ContentProvider {
    static final String STANDALONE = "ai.alphacompute.clock";
    private static final String AUTHORITY = STANDALONE + ".alerts";
    private static final String CLAIM = "ai.alphacompute.clock.AUTHORITY_READY";
    private static final String OWNED = "owned";
    private static final String STORE = "clock-alert-authority";

    @Override public boolean onCreate() { return true; }

    @Override public Bundle call(String method, String arg, Bundle extras) {
        Context context = getContext();
        if (!OWNED.equals(method) || context == null || !STANDALONE.equals(context.getPackageName())
                || !AlphaIpcContract.CORE_PACKAGE.equals(getCallingPackage())
                || !AlphaIpcContract.hasSameSignatureAsCore(context)) throw new SecurityException("Unrecognized Clock owner");
        var requested = extras == null ? null : extras.getStringArrayList(OWNED);
        if (requested == null || requested.size() > 80) throw new IllegalArgumentException("Invalid Clock ownership query");
        var store = context.getSharedPreferences(STORE, Context.MODE_PRIVATE);
        var found = new ArrayList<String>();
        for (String id : requested) if (id != null && store.contains(id)) found.add(id);
        Bundle reply = new Bundle();
        reply.putStringArrayList(OWNED, found);
        return reply;
    }

    static String identity(String kind, String remoteId) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest((kind + ":" + remoteId).getBytes(StandardCharsets.UTF_8));
            return Base64.encodeToString(digest, Base64.NO_WRAP | Base64.URL_SAFE | Base64.NO_PADDING);
        } catch (NoSuchAlgorithmException impossible) { throw new AssertionError(impossible); }
    }

    static Set<String> adopted(Context context, Collection<String> identities) {
        if (identities.isEmpty() || !AlphaIpcContract.CORE_PACKAGE.equals(context.getPackageName())) return Set.of();
        var provider = context.getPackageManager().resolveContentProvider(AUTHORITY, 0);
        if (provider == null || !STANDALONE.equals(provider.packageName)
                || !AlphaIpcContract.hasCoreSignature(context, STANDALONE)) return Set.of();
        var query = new Bundle();
        query.putStringArrayList(OWNED, new ArrayList<>(identities));
        Bundle result = context.getContentResolver().call(Uri.parse("content://" + AUTHORITY), OWNED, null, query);
        if (result == null || result.getStringArrayList(OWNED) == null) throw new IllegalStateException("Clock ownership unavailable");
        return new HashSet<>(result.getStringArrayList(OWNED));
    }

    static void claim(Context context, JSONArray known, Collection<String> active) throws Exception {
        if (!STANDALONE.equals(context.getPackageName())) return;
        var ids = new HashSet<>(active);
        for (int i = 0; i < known.length(); i++) {
            var item = known.getJSONObject(i);
            String kind = item.getString("kind"), remoteId = item.getString("remoteId");
            if ((!"timer".equals(kind) && !"alarm".equals(kind)) || remoteId.isEmpty()) throw new JSONException("Invalid Clock owner record");
            ids.add(identity(kind, remoteId));
        }
        var store = context.getSharedPreferences(STORE, Context.MODE_PRIVATE);
        ids.removeIf(store::contains);
        if (ids.isEmpty()) return;
        var editor = store.edit();
        for (String id : ids) editor.putBoolean(id, true);
        if (!editor.commit()) throw new java.io.IOException("Could not claim Clock schedules");
        var wake = new Intent(CLAIM).setClassName(AlphaIpcContract.CORE_PACKAGE, Changed.class.getName());
        context.sendBroadcast(wake, AlphaIpcContract.PERMISSION_AGENT_IPC);
    }

    public static final class Changed extends BroadcastReceiver {
        @Override public void onReceive(Context context, Intent intent) {
            if (!CLAIM.equals(intent.getAction())) return;
            ClockAlertReceiver.dispatch(context, intent, goAsync());
        }
    }

    @Override public Cursor query(Uri uri, String[] p, String s, String[] args, String order) { throw new UnsupportedOperationException(); }
    @Override public String getType(Uri uri) { return null; }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String s, String[] args) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String s, String[] args) { throw new UnsupportedOperationException(); }
}
