package com.android.provision;

import android.app.Activity;
import android.app.admin.DevicePolicyManager;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.os.Process;
import android.os.UserManager;
import android.provider.Settings;
import android.view.inputmethod.InputMethodInfo;
import android.view.inputmethod.InputMethodManager;
import java.util.Objects;

/** Privileged Provision adapter; never invoked for a completed or enterprise provisioning branch. */
final class AlphaFreshPresets {
    private AlphaFreshPresets() {}
    static boolean shouldRunWelcome(Context context) {
        try {
            if (Settings.Secure.getInt(context.getContentResolver(), Settings.Secure.USER_SETUP_COMPLETE, 0) != 0
                    || !Process.myUserHandle().isSystem()) return false;
            DevicePolicyManager policy = context.getSystemService(DevicePolicyManager.class);
            UserManager users = context.getSystemService(UserManager.class);
            // Missing services keep the welcome visible for a recoverable retry; they never finish it.
            return (policy == null || policy.getDeviceOwnerComponentOnCallingUser() == null)
                    && (users == null || !users.isManagedProfile());
        } catch (IllegalStateException | SecurityException unavailable) {
            return true; // Unknown state keeps a recoverable welcome, never silent completion.
        }
    }
    static boolean eligible(Context context) {
        try {
            DevicePolicyManager policy = context.getSystemService(DevicePolicyManager.class);
            UserManager users = context.getSystemService(UserManager.class);
            // Unknown policy/user state cannot authorize first-run setting writes.
            if (policy == null || users == null) return false;
            return AlphaFreshSetupPolicy.eligible(
                    Settings.Secure.getInt(context.getContentResolver(), Settings.Secure.USER_SETUP_COMPLETE, 0) != 0,
                    policy.getDeviceOwnerComponentOnCallingUser() != null || users.isManagedProfile(),
                    Process.myUserHandle().isSystem());
        } catch (IllegalStateException | SecurityException unavailable) { return false; }
    }

    static AlphaFreshSetupPolicy.ImeResult ensureKeyboard(Activity activity) {
        try {
            return AlphaFreshSetupPolicy.ensureKeyboard(new AlphaFreshSetupPolicy.ImePort() {
                public boolean eligible() { return AlphaFreshPresets.eligible(activity); }
                public String selected() { return Settings.Secure.getString(activity.getContentResolver(), Settings.Secure.DEFAULT_INPUT_METHOD); }
                public String enabled() { return Settings.Secure.getString(activity.getContentResolver(), Settings.Secure.ENABLED_INPUT_METHODS); }
                public String target() {
                    InputMethodManager manager = activity.getSystemService(InputMethodManager.class);
                    if (manager == null) return null;
                    for (InputMethodInfo method : manager.getInputMethodList()) {
                        if ("com.android.inputmethod.latin".equals(method.getPackageName())
                                && "com.android.inputmethod.latin.LatinIME".equals(method.getServiceName())
                                && method.getServiceInfo().enabled && method.getServiceInfo().applicationInfo.enabled
                                && (method.getServiceInfo().applicationInfo.flags & ApplicationInfo.FLAG_SYSTEM) != 0) {
                            return method.getId();
                        }
                    }
                    return null;
                }
                public boolean enableIfUnchanged(String expected, String value) {
                    if (!eligible() || !Objects.equals(expected, enabled()) || nonempty(selected())) return false;
                    return Settings.Secure.putString(activity.getContentResolver(), Settings.Secure.ENABLED_INPUT_METHODS, value);
                }
                public boolean selectIfEmpty(String value) {
                    if (!eligible() || nonempty(selected())) return false;
                    // Pinned InputMethodManager.setInputMethod(null, id) explicitly recommends
                    // these secure-setting updates instead of its deprecated null-token behavior.
                    return Settings.Secure.putString(activity.getContentResolver(), Settings.Secure.DEFAULT_INPUT_METHOD, value);
                }
            });
        } catch (IllegalStateException | SecurityException failure) {
            return AlphaFreshSetupPolicy.ImeResult.FAILED;
        }
    }
    private static boolean nonempty(String value) { return value != null && !value.isEmpty(); }
}
