package ai.alphacompute.alphaphone.ipc;

import ai.alphacompute.alphaphone.AlphaAgentService;
import ai.alphacompute.ipc.AlphaIpcContract;
import ai.alphacompute.ipc.AlphaSuitePolicy;
import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Binder;
import android.os.Bundle;
import android.os.Process;
import android.util.Log;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

/** Signature-protected ContentProvider synchronizing allowlisted non-secret preferences across AlphaCore and thin apps. */
public final class AlphaPreferencesProvider extends ContentProvider {
    private static final String TAG = "AlphaPreferencesProvider";
    private static final String PREFS_NAME = "alpha-shared-preferences";
    private static final String APPEARANCE_PREFS = "alpha-appearance";
    private static final String TEXT_SCALE_INT_KEY = "text-scale-percent";
    private static final int MAX_PREF_VALUE_BYTES = 16_384;

    private volatile AlphaSuitePolicy policy = AlphaSuitePolicy.defaults();

    @Override public boolean onCreate() {
        policy = AlphaSuitePolicyLoader.load(getContext());
        return true;
    }

    @Override public Bundle call(String method, String arg, Bundle extras) {
        Context context = getContext();
        if (context == null) return null;
        String callingPkg = resolveAuthorizedCaller(context);
        if (callingPkg == null) {
            throw new SecurityException("Unauthorized AlphaPreferences caller UID " + Binder.getCallingUid());
        }
        Log.i(TAG, "call caller=" + callingPkg + " method=" + (method == null ? "" : method) + " key=" + (arg == null ? "" : arg));
        SharedPreferences store = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return switch (method == null ? "" : method) {
            case AlphaIpcContract.PREF_METHOD_GET -> handleGet(context, store, arg);
            case AlphaIpcContract.PREF_METHOD_SET -> handleSet(context, store, callingPkg, arg, extras);
            case AlphaIpcContract.PREF_METHOD_REMOVE -> handleRemove(context, store, callingPkg, arg);
            case AlphaIpcContract.PREF_METHOD_SNAPSHOT -> handleSnapshot(context, store);
            default -> throw new IllegalArgumentException("Unsupported AlphaPreferences method: " + method);
        };
    }

    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        return null;
    }

    @Override public String getType(Uri uri) {
        return null;
    }

    @Override public Uri insert(Uri uri, ContentValues values) {
        throw new UnsupportedOperationException("Use ContentResolver.call for AlphaPreferencesProvider");
    }

    @Override public int delete(Uri uri, String selection, String[] selectionArgs) {
        throw new UnsupportedOperationException("Use ContentResolver.call for AlphaPreferencesProvider");
    }

    @Override public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        throw new UnsupportedOperationException("Use ContentResolver.call for AlphaPreferencesProvider");
    }

    private Bundle handleGet(Context context, SharedPreferences store, String key) {
        if (!AlphaIpcContract.isReadablePreferenceKey(key)) {
            throw new SecurityException("Preference key is not readable: " + key);
        }
        String value = readValue(context, store, key);
        Bundle reply = new Bundle();
        reply.putBoolean(AlphaIpcContract.PREF_RESULT_FOUND, value != null);
        if (value != null) {
            reply.putString(AlphaIpcContract.PREF_ARG_VALUE, value);
        }
        return reply;
    }

    private Bundle handleSet(Context context, SharedPreferences store, String callingPkg, String key, Bundle extras) {
        if (!policy.isSharedPreferenceWriteAllowed(callingPkg, key)) {
            throw new SecurityException("Package " + callingPkg + " may not write shared key " + key);
        }
        String value = extras == null ? null : extras.getString(AlphaIpcContract.PREF_ARG_VALUE);
        if (value == null || value.getBytes(StandardCharsets.UTF_8).length > MAX_PREF_VALUE_BYTES) {
            throw new IllegalArgumentException("Shared preference value is missing or oversized");
        }
        boolean committed = store.edit().putString(key, value).commit();
        if (committed && AlphaIpcContract.KEY_TEXT_SCALE.equals(key)) {
            mirrorTextScale(context, value);
        }
        if (committed) {
            context.getContentResolver().notifyChange(AlphaIpcContract.preferenceKeyUri(key), null);
            notifyAgentIfAiPreference(context, key);
        }
        Bundle reply = new Bundle();
        reply.putBoolean(AlphaIpcContract.PREF_RESULT_OK, committed);
        return reply;
    }

    private Bundle handleRemove(Context context, SharedPreferences store, String callingPkg, String key) {
        if (!policy.isSharedPreferenceWriteAllowed(callingPkg, key)) {
            throw new SecurityException("Package " + callingPkg + " may not remove shared key " + key);
        }
        boolean committed = store.edit().remove(key).commit();
        if (committed && AlphaIpcContract.KEY_TEXT_SCALE.equals(key)) {
            context.getSharedPreferences(APPEARANCE_PREFS, Context.MODE_PRIVATE).edit().remove(TEXT_SCALE_INT_KEY).commit();
        }
        if (committed) {
            context.getContentResolver().notifyChange(AlphaIpcContract.preferenceKeyUri(key), null);
            notifyAgentIfAiPreference(context, key);
        }
        Bundle reply = new Bundle();
        reply.putBoolean(AlphaIpcContract.PREF_RESULT_OK, committed);
        return reply;
    }

    private Bundle handleSnapshot(Context context, SharedPreferences store) {
        Bundle values = new Bundle();
        for (String key : AlphaIpcContract.READABLE_PREFERENCE_KEYS) {
            String value = readValue(context, store, key);
            if (value != null) {
                values.putString(key, value);
            }
        }
        Bundle reply = new Bundle();
        reply.putBundle(AlphaIpcContract.PREF_RESULT_SNAPSHOT, values);
        return reply;
    }

    private String readValue(Context context, SharedPreferences store, String key) {
        return readValueInternal(context, store, key);
    }

    /** In-process read helper for AlphaCore's overlay surface. */
    public static String readForCore(Context context, String key) {
        if (context == null || !AlphaIpcContract.isReadablePreferenceKey(key)) return null;
        SharedPreferences store = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return readValueInternal(context, store, key);
    }

    /** In-process write helper for AlphaCore's overlay surface. */
    public static boolean writeForCore(Context context, String key, String value) {
        if (context == null || !AlphaIpcContract.isSharedPreferenceKey(key) || value == null) return false;
        if (value.getBytes(StandardCharsets.UTF_8).length > MAX_PREF_VALUE_BYTES) return false;
        SharedPreferences store = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        boolean committed = store.edit().putString(key, value).commit();
        if (committed && AlphaIpcContract.KEY_TEXT_SCALE.equals(key)) {
            mirrorTextScale(context, value);
        }
        if (committed) {
            context.getContentResolver().notifyChange(AlphaIpcContract.preferenceKeyUri(key), null);
            notifyAgentIfAiPreference(context, key);
        }
        return committed;
    }

    /** In-process remove helper for AlphaCore's overlay surface. */
    public static boolean removeForCore(Context context, String key) {
        if (context == null || !AlphaIpcContract.isSharedPreferenceKey(key)) return false;
        SharedPreferences store = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        boolean committed = store.edit().remove(key).commit();
        if (committed && AlphaIpcContract.KEY_TEXT_SCALE.equals(key)) {
            context.getSharedPreferences(APPEARANCE_PREFS, Context.MODE_PRIVATE).edit().remove(TEXT_SCALE_INT_KEY).commit();
        }
        if (committed) {
            context.getContentResolver().notifyChange(AlphaIpcContract.preferenceKeyUri(key), null);
            notifyAgentIfAiPreference(context, key);
        }
        return committed;
    }

    private static void notifyAgentIfAiPreference(Context context, String key) {
        if (AlphaIpcContract.KEY_AI_MODE.equals(key) || AlphaIpcContract.KEY_LOCAL_MODEL.equals(key)) {
            AlphaAgentService.onAiPreferenceChanged(context);
        }
    }

    /** In-process snapshot helper for AlphaCore's overlay surface. */
    public static Map<String, String> snapshotForCore(Context context) {
        Map<String, String> values = new LinkedHashMap<>();
        if (context == null) return values;
        SharedPreferences store = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        for (String key : AlphaIpcContract.READABLE_PREFERENCE_KEYS) {
            String value = readValueInternal(context, store, key);
            if (value != null) values.put(key, value);
        }
        return values;
    }

    private static String readValueInternal(Context context, SharedPreferences store, String key) {
        String direct = store.getString(key, null);
        if (direct != null) return direct;
        if (AlphaIpcContract.KEY_TEXT_SCALE.equals(key)) {
            SharedPreferences appearance = context.getSharedPreferences(APPEARANCE_PREFS, Context.MODE_PRIVATE);
            if (appearance.contains(TEXT_SCALE_INT_KEY)) {
                int percent = appearance.getInt(TEXT_SCALE_INT_KEY, 100);
                if (percent >= 75 && percent <= 150) return Integer.toString(percent);
            }
        }
        return null;
    }

    private static void mirrorTextScale(Context context, String raw) {
        try {
            int parsed = Integer.parseInt(raw.trim());
            if (parsed >= 75 && parsed <= 150) {
                context.getSharedPreferences(APPEARANCE_PREFS, Context.MODE_PRIVATE)
                    .edit()
                    .putInt(TEXT_SCALE_INT_KEY, parsed)
                    .commit();
            }
        } catch (NumberFormatException ignored) {
        }
    }

    private String resolveAuthorizedCaller(Context context) {
        int callingUid = Binder.getCallingUid();
        if (callingUid == Process.myUid()) {
            return AlphaIpcContract.CORE_PACKAGE;
        }
        return AlphaIpcContract.verifySameSignaturePackage(context, callingUid, policy);
    }
}
