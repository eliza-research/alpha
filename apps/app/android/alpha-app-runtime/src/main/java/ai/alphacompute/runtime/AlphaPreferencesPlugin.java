package ai.alphacompute.runtime;

import ai.alphacompute.ipc.AlphaIpcContract;
import android.database.ContentObserver;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;

/** Capacitor bridge to {@code AlphaPreferencesProvider} for cross-app appearance, preferences, text scale, and install id. */
@CapacitorPlugin(name = "AlphaPreferences")
public final class AlphaPreferencesPlugin extends Plugin {
    private ContentObserver observer;

    @Override public void load() {
        if (!AlphaIpcContract.hasSameSignatureAsCore(getContext())) return;
        observer = new ContentObserver(new Handler(Looper.getMainLooper())) {
            @Override public void onChange(boolean selfChange, Uri uri) {
                String key = uri == null ? null : uri.getLastPathSegment();
                if (key == null || !AlphaIpcContract.isReadablePreferenceKey(key)) {
                    notifyListeners("changed", new JSObject().put("key", JSONObject.NULL));
                    return;
                }
                String value = readKey(key);
                notifyListeners("changed", new JSObject()
                    .put("key", key)
                    .put("value", value == null ? JSONObject.NULL : value));
            }
        };
        try {
            getContext().getContentResolver().registerContentObserver(
                Uri.parse(AlphaIpcContract.PREFERENCES_URI_STRING),
                true,
                observer
            );
        } catch (SecurityException ignored) {
            observer = null;
        }
    }

    @Override protected void handleOnDestroy() {
        if (observer != null) {
            try {
                getContext().getContentResolver().unregisterContentObserver(observer);
            } catch (RuntimeException ignored) {
            }
            observer = null;
        }
        super.handleOnDestroy();
    }

    @PluginMethod public void get(PluginCall call) {
        String key = call.getString("key");
        if (!AlphaIpcContract.isReadablePreferenceKey(key)) {
            call.reject("Preference key not shared", AlphaIpcContract.FAIL_ROUTE_REFUSED);
            return;
        }
        String value = readKey(key);
        call.resolve(new JSObject()
            .put("found", value != null)
            .put("value", value == null ? JSONObject.NULL : value));
    }

    @PluginMethod public void set(PluginCall call) {
        String key = call.getString("key");
        String value = call.getString("value");
        if (!AlphaIpcContract.isSharedPreferenceKey(key) || value == null) {
            call.reject("Preference key not writable", AlphaIpcContract.FAIL_ROUTE_REFUSED);
            return;
        }
        Bundle extras = new Bundle();
        extras.putString(AlphaIpcContract.PREF_ARG_VALUE, value);
        Bundle reply = callProvider(AlphaIpcContract.PREF_METHOD_SET, key, extras);
        boolean ok = reply != null && reply.getBoolean(AlphaIpcContract.PREF_RESULT_OK, false);
        call.resolve(new JSObject().put("ok", ok));
    }

    @PluginMethod public void remove(PluginCall call) {
        String key = call.getString("key");
        if (!AlphaIpcContract.isSharedPreferenceKey(key)) {
            call.reject("Preference key not writable", AlphaIpcContract.FAIL_ROUTE_REFUSED);
            return;
        }
        Bundle reply = callProvider(AlphaIpcContract.PREF_METHOD_REMOVE, key, null);
        boolean ok = reply != null && reply.getBoolean(AlphaIpcContract.PREF_RESULT_OK, false);
        call.resolve(new JSObject().put("ok", ok));
    }

    @PluginMethod public void snapshot(PluginCall call) {
        Bundle reply = callProvider(AlphaIpcContract.PREF_METHOD_SNAPSHOT, null, null);
        JSObject values = new JSObject();
        if (reply != null) {
            Bundle bundle = reply.getBundle(AlphaIpcContract.PREF_RESULT_SNAPSHOT);
            if (bundle == null) bundle = reply;
            for (String key : AlphaIpcContract.READABLE_PREFERENCE_KEYS) {
                String value = bundle.getString(key);
                if (value != null) values.put(key, value);
            }
        }
        call.resolve(new JSObject().put("values", values));
    }

    private String readKey(String key) {
        Bundle reply = callProvider(AlphaIpcContract.PREF_METHOD_GET, key, null);
        if (reply == null || !reply.getBoolean(AlphaIpcContract.PREF_RESULT_FOUND, false)) return null;
        return reply.getString(AlphaIpcContract.PREF_ARG_VALUE);
    }

    private Bundle callProvider(String method, String key, Bundle extras) {
        if (!AlphaIpcContract.hasSameSignatureAsCore(getContext())) return null;
        try {
            return getContext().getContentResolver().call(
                Uri.parse(AlphaIpcContract.PREFERENCES_URI_STRING),
                method,
                key,
                extras
            );
        } catch (RuntimeException unavailable) {
            return null;
        }
    }
}
