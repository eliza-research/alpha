package ai.alphacompute.runtime;

import ai.alphacompute.ipc.AlphaIpcContract;
import ai.alphacompute.ipc.AlphaSuitePolicy;
import ai.alphacompute.ipc.IAlphaPlatformBroker;
import android.Manifest;
import android.app.Activity;
import android.app.KeyguardManager;
import android.app.NotificationManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Looper;
import android.os.RemoteException;
import android.os.UserManager;
import android.provider.Settings;
import android.view.HapticFeedbackConstants;
import android.view.View;
import android.view.accessibility.AccessibilityManager;
import android.view.autofill.AutofillManager;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.lifecycle.Lifecycle;
import androidx.lifecycle.LifecycleOwner;
import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

/** Drop-in Capacitor {@code AlphaDevice} plugin for thin standalone Alpha apps, combining local device actions with brokered AlphaCore operations. */
@CapacitorPlugin(name = "AlphaDevice", permissions = {
    @Permission(alias = "camera", strings = { Manifest.permission.CAMERA }),
    @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
})
public final class RemoteDevicePlugin extends CorePluginProxy {
    private static final String PROTON_PASS_PACKAGE = "proton.android.pass";
    private static final byte[] PROTON_PASS_CERT = decodeHex("dcc9439ec1a6c6a8d0203f3423ee42bcc8b970628e53cb73a0393f398dd5b853");

    @Override protected String corePluginName() {
        return "AlphaDevice";
    }

    @PluginMethod public void copyText(PluginCall call) {
        final String text;
        try {
            text = boundedShareText(call.getString("text"));
        } catch (IllegalArgumentException invalid) {
            call.reject("Choose valid text of at most 64 KiB.");
            return;
        }
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Open and unlock Alpha before copying.");
            return;
        }
        activity.runOnUiThread(() -> {
            if (!isForegroundUnlocked(activity)) {
                call.reject("Open and unlock Alpha before copying.");
                return;
            }
            try {
                ClipboardManager clipboard = activity.getSystemService(ClipboardManager.class);
                if (clipboard == null) throw new IllegalStateException();
                clipboard.setPrimaryClip(ClipData.newPlainText("Alpha text", text));
                call.resolve();
            } catch (RuntimeException unavailable) {
                call.reject("Clipboard unavailable.");
            }
        });
    }

    @PluginMethod public void shareText(PluginCall call) {
        final String text;
        final String title;
        try {
            text = boundedShareText(call.getString("text"));
            title = call.getString("title", "");
            if (title.length() > 200 || title.chars().anyMatch(ch -> ch < 32 || ch == 127)) {
                throw new IllegalArgumentException();
            }
        } catch (IllegalArgumentException invalid) {
            call.reject("Choose valid text of at most 64 KiB.");
            return;
        }
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Open and unlock Alpha before sharing.");
            return;
        }
        activity.runOnUiThread(() -> {
            if (!isForegroundUnlocked(activity)) {
                call.reject("Open and unlock Alpha before sharing.");
                return;
            }
            try {
                Intent send = new Intent(Intent.ACTION_SEND)
                    .setType("text/plain")
                    .putExtra(Intent.EXTRA_TEXT, text)
                    .putExtra(Intent.EXTRA_SUBJECT, title)
                    .putExtra(Intent.EXTRA_TITLE, title);
                activity.startActivity(Intent.createChooser(send, "Share externally"));
                call.resolve(new JSObject().put("status", "opened"));
            } catch (RuntimeException unavailable) {
                call.reject("Android sharing is unavailable.");
            }
        });
    }

    @PluginMethod public void shareDiagnostics(PluginCall call) {
        String text = call.getString("text");
        if (text == null || text.length() > 256 * 1024) {
            call.reject("Diagnostics are too large");
            return;
        }
        try {
            Object parsed = new JSONTokener(text).nextValue();
            if (!(parsed instanceof JSONObject obj) || !"alpha-diagnostics/v1".equals(obj.optString("format"))) {
                throw new IllegalArgumentException();
            }
        } catch (Exception invalid) {
            call.reject("Diagnostics are not valid");
            return;
        }
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Open and unlock Alpha before sharing.");
            return;
        }
        activity.runOnUiThread(() -> {
            if (!isForegroundUnlocked(activity)) {
                call.reject("Open and unlock Alpha before sharing.");
                return;
            }
            try {
                Intent send = new Intent(Intent.ACTION_SEND)
                    .setType("text/plain")
                    .putExtra(Intent.EXTRA_TEXT, text)
                    .putExtra(Intent.EXTRA_SUBJECT, "Alpha Phone diagnostics");
                activity.startActivity(Intent.createChooser(send, "Share diagnostics"));
                call.resolve(new JSObject().put("status", "opened"));
            } catch (RuntimeException unavailable) {
                call.reject("Sharing is unavailable");
            }
        });
    }

    @PluginMethod public void haptic(PluginCall call) {
        int feedback = hapticConstant(call.getString("kind"), Build.VERSION.SDK_INT);
        if (feedback < 0) {
            call.reject("Unknown feedback");
            return;
        }
        Activity activity = getActivity();
        if (activity == null || getBridge() == null) {
            call.reject("Alpha view is unavailable");
            return;
        }
        activity.runOnUiThread(() -> {
            Bridge bridge = getBridge();
            View view = bridge == null ? null : bridge.getWebView();
            if (view == null || activity.isFinishing() || activity.isDestroyed()) {
                call.reject("Alpha view is unavailable");
                return;
            }
            call.resolve(new JSObject().put("performed", view.performHapticFeedback(feedback)));
        });
    }

    @PluginMethod public void recommendedTimeout(PluginCall call) {
        Integer base = call.getInt("baseMs");
        if (base == null || base < 1 || base > 600000) {
            call.reject("Base timeout must be 1 to 600000 ms.");
            return;
        }
        int timeout = base;
        AccessibilityManager accessibility = getContext().getSystemService(AccessibilityManager.class);
        if (accessibility != null) {
            timeout = accessibility.getRecommendedTimeoutMillis(
                base,
                AccessibilityManager.FLAG_CONTENT_TEXT | AccessibilityManager.FLAG_CONTENT_CONTROLS
            );
        }
        call.resolve(new JSObject().put("timeoutMs", timeout));
    }

    @PluginMethod public void setSystemBarAppearance(PluginCall call) {
        Boolean dark = call.getBoolean("dark");
        if (dark == null) {
            call.reject("Choose light or dark.");
            return;
        }
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Alpha view is unavailable");
            return;
        }
        activity.runOnUiThread(() -> {
            if (activity.isFinishing() || activity.isDestroyed()) {
                call.reject("Alpha view is unavailable");
                return;
            }
            WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(activity.getWindow(), activity.getWindow().getDecorView());
            bars.setAppearanceLightStatusBars(!dark);
            bars.setAppearanceLightNavigationBars(!dark);
            call.resolve();
        });
    }

    @PluginMethod public void setVolumeShutter(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled");
        if (enabled == null) {
            call.reject("Choose on or off.");
            return;
        }
        Activity activity = getActivity();
        if (!(activity instanceof AlphaBaseActivity thinActivity)) {
            call.reject("Alpha view is unavailable");
            return;
        }
        activity.runOnUiThread(() -> {
            thinActivity.setVolumeShutter(enabled);
            call.resolve();
        });
    }

    @PluginMethod public void setTextScale(PluginCall call) {
        Integer percent = call.getInt("percent");
        if (percent == null || percent < 75 || percent > 150) {
            call.reject("Text size must be 75 to 150 percent.");
            return;
        }
        runOnWorker(call, () -> {
            if (AlphaIpcContract.hasSameSignatureAsCore(getContext())) {
                Bundle extras = new Bundle();
                extras.putString(AlphaIpcContract.PREF_ARG_VALUE, String.valueOf(percent));
                try {
                    getContext().getContentResolver().call(
                        Uri.parse(AlphaIpcContract.PREFERENCES_URI_STRING),
                        AlphaIpcContract.PREF_METHOD_SET,
                        AlphaIpcContract.KEY_TEXT_SCALE,
                        extras
                    );
                } catch (RuntimeException ignored) {
                }
            }
            float fontScale = getContext().getResources().getConfiguration().fontScale;
            if (!Float.isFinite(fontScale) || fontScale <= 0f) fontScale = 1f;
            JSObject out = new JSObject()
                .put("textScalePercent", percent)
                .put("effectiveTextZoom", Math.max(1, Math.round(percent * fontScale)));
            call.resolve(out);
        });
    }

    @PluginMethod public void accessPermissionStatus(PluginCall call) {
        String permission = normalizeAccessPermission(call.getString("permission", ""));
        if (permission == null) {
            call.reject("Unknown access permission");
            return;
        }
        PermissionState state = resolveAccessPermissionState(permission);
        if (state == null) {
            call.reject("Android permission is unavailable");
        } else {
            call.resolve(new JSObject().put("state", state.toString()));
        }
    }

    @PluginMethod public void requestAccessPermission(PluginCall call) {
        String permission = normalizeAccessPermission(call.getString("permission", ""));
        Activity activity = getActivity();
        if (permission == null || activity == null) {
            call.reject("Android permission is unavailable");
            return;
        }
        activity.runOnUiThread(() -> {
            if (!isForegroundUnlocked(activity)) {
                call.reject("Open and unlock Alpha before asking for access");
                return;
            }
            PermissionState state = resolveAccessPermissionState(permission);
            if (state != PermissionState.PROMPT && state != PermissionState.PROMPT_WITH_RATIONALE) {
                accessPermissionStatus(call);
                return;
            }
            try {
                requestPermissionForAlias(permission, call, "accessPermissionAnswered");
            } catch (IllegalStateException closed) {
                call.reject("Android permission is unavailable");
            }
        });
    }

    @Override @PluginMethod public void requestPermissions(PluginCall call) {
        requestAccessPermission(call);
    }

    @PermissionCallback private void accessPermissionAnswered(PluginCall call) {
        accessPermissionStatus(call);
    }

    @PluginMethod public void openSettings(PluginCall call) {
        String page = call.getString("page", "");
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("This Android settings page is unavailable");
            return;
        }
        if ("system".equals(page)) {
            activity.runOnUiThread(() -> {
                if (activity.isFinishing() || activity.isDestroyed()) {
                    call.reject("This Android settings page is unavailable");
                    return;
                }
                try {
                    activity.startActivity(handOff(new Intent(Settings.ACTION_SETTINGS)));
                } catch (RuntimeException unavailable) {
                    call.reject("This Android settings page is unavailable");
                    return;
                }
                call.resolve(new JSObject().put("status", "opened").put("page", page).put("specific", true));
            });
            return;
        }
        if ("screen-lock".equals(page) || "all-files".equals(page)) {
            boolean files = "all-files".equals(page);
            if (files && Build.VERSION.SDK_INT < 30) {
                call.reject("This Android settings page is unavailable");
                return;
            }
            Intent intent = files
                ? new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:" + getContext().getPackageName()))
                : new Intent(Settings.ACTION_SECURITY_SETTINGS);
            activity.runOnUiThread(() -> {
                if (!isForegroundUnlocked(activity)) {
                    call.reject("Open and unlock Alpha first");
                    return;
                }
                try {
                    activity.startActivity(handOff(intent));
                } catch (RuntimeException unavailable) {
                    call.reject("This Android settings page is unavailable");
                    return;
                }
                call.resolve(new JSObject().put("status", "opened").put("page", page).put("specific", files));
            });
            return;
        }
        String[] candidates = settingsActionsForPage(page);
        if (candidates == null) {
            call.reject("Unsupported settings page");
            return;
        }
        activity.runOnUiThread(() -> {
            if (activity.isFinishing() || activity.isDestroyed()) {
                call.reject("This Android settings page is unavailable");
                return;
            }
            int opened = openSettingsCandidate(activity, page, candidates);
            if (opened < 0) {
                call.reject("This Android settings page is unavailable");
                return;
            }
            call.resolve(new JSObject().put("status", "opened").put("page", page).put("specific", opened == 0));
        });
    }

    @PluginMethod public void passwordProviderStatus(PluginCall call) {
        call.resolve(readPasswordProviderStatus(getContext()));
    }

    @PluginMethod public void openPasswordProvider(PluginCall call) {
        String action = call.getString("action", "");
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Open and unlock Alpha before choosing a password provider.");
            return;
        }
        activity.runOnUiThread(() -> {
            if (!isForegroundUnlocked(activity)) {
                call.reject("Open and unlock Alpha before choosing a password provider.");
                return;
            }
            try {
                Intent target = passwordProviderIntent(getContext(), action);
                String destination = Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE.equals(target.getAction()) ? "provider-picker" : "external";
                try {
                    activity.startActivity(handOff(target));
                } catch (android.content.ActivityNotFoundException missing) {
                    if (!"settings".equals(action) || !Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE.equals(target.getAction())) {
                        throw missing;
                    }
                    activity.startActivity(handOff(new Intent(Settings.ACTION_SETTINGS)));
                    destination = "system-settings";
                }
                if (Settings.ACTION_SETTINGS.equals(target.getAction())) {
                    destination = "system-settings";
                }
                call.resolve(new JSObject().put("status", "opened").put("destination", destination));
            } catch (RuntimeException unavailable) {
                call.reject("Password provider setup could not be opened. No provider change is confirmed.");
            }
        });
    }

    @PluginMethod public void settingsFacts(PluginCall call) {
        JSObject out = new JSObject();
        out.put("androidRelease", Build.VERSION.RELEASE);
        out.put("startupPermissionDefaults", false);
        try {
            int boot = Settings.Global.getInt(getContext().getContentResolver(), Settings.Global.BOOT_COUNT, -1);
            if (boot >= 0) out.put("bootCount", boot);
        } catch (RuntimeException unavailable) {
            out.remove("bootCount");
        }
        putSettingsGrants(getContext(), out);
        call.resolve(out);
    }

    @PluginMethod public void snapshot(PluginCall call) {
        Context context = getContext();
        JSObject out = new JSObject();
        out.put("model", Build.MODEL);
        out.put("manufacturer", Build.MANUFACTURER);
        out.put("androidRelease", Build.VERSION.RELEASE);
        out.put("securityPatch", Build.VERSION.SECURITY_PATCH);
        out.put("build", Build.DISPLAY);
        out.put("readAt", System.currentTimeMillis());
        try {
            PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            if (info.versionName != null) out.put("appVersion", info.versionName);
            out.put("appVersionCode", info.getLongVersionCode());
            if (info.lastUpdateTime > 0L) out.put("appUpdatedAt", info.lastUpdateTime);
        } catch (PackageManager.NameNotFoundException ignored) {
        }
        NotificationManager notifications = context.getSystemService(NotificationManager.class);
        out.put("notificationsEnabled", notifications != null && notifications.areNotificationsEnabled());
        putSettingsGrants(context, out);
        out.put("passwordProvider", readPasswordProviderStatus(context));
        call.resolve(out);
    }

    @PluginMethod public void openNotificationShade(PluginCall call) {
        Activity activity = getActivity();
        String status = activity == null || activity.isFinishing() || activity.isDestroyed() || !activity.hasWindowFocus()
            ? "not-in-front"
            : "unsupported";
        call.resolve(new JSObject().put("status", status));
    }

    @PluginMethod public void finishTask(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.resolve(new JSObject().put("finished", false));
            return;
        }
        activity.runOnUiThread(() -> {
            if (!activity.isFinishing() && !activity.isDestroyed()) {
                activity.finishAndRemoveTask();
            }
            call.resolve(new JSObject().put("finished", true));
        });
    }

    @PluginMethod public void textAsk(PluginCall call) {
        call.resolve(new JSObject().put("ticket", 0));
    }

    @PluginMethod public void closeTextAsk(PluginCall call) {
        call.resolve(new JSObject().put("closed", false));
    }

    @PluginMethod public void diagnosticsFacts(PluginCall call) {
        runOnWorker(call, () -> {
            IAlphaPlatformBroker broker = connectBroker();
            if (broker != null) {
                try {
                    String raw = broker.diagnosticsFactsJson();
                    if (raw != null && !raw.isBlank()) {
                        call.resolve(new JSObject(raw));
                        return;
                    }
                } catch (RemoteException | SecurityException | JSONException ignored) {
                }
            }
            JSObject fallback = new JSObject();
            fallback.put("variant", "thin");
            fallback.put("testMocks", false);
            fallback.put("sdkInt", Build.VERSION.SDK_INT);
            fallback.put("androidRelease", Build.VERSION.RELEASE);
            fallback.put("securityPatch", Build.VERSION.SECURITY_PATCH);
            try {
                PackageInfo info = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
                if (info.versionName != null) fallback.put("appVersion", info.versionName);
                fallback.put("versionCode", info.getLongVersionCode());
            } catch (PackageManager.NameNotFoundException ignored) {
            }
            call.resolve(fallback);
        });
    }

    @PluginMethod public void setAgentGoogleConsent(PluginCall call) {
        Boolean gmail = call.getBoolean("gmailChanges");
        Boolean calendar = call.getBoolean("calendarEdits");
        if (gmail == null || calendar == null) {
            call.reject("Choose Gmail changes and Calendar edits.");
            return;
        }
        runOnWorker(call, () -> {
            IAlphaPlatformBroker broker = connectBroker();
            if (broker == null) {
                call.reject("The agent service is not configured");
                return;
            }
            try {
                if (broker.setAgentGoogleConsent(gmail, calendar)) {
                    call.resolve();
                } else {
                    call.reject("Agent consent could not be saved");
                }
            } catch (RemoteException | SecurityException refused) {
                call.reject("Agent consent could not be saved");
            }
        });
    }

    @PluginMethod public void openAlphaOverlay(PluginCall call) {
        String entrySource = call.getString("entrySource", "thin-app");
        String initialQuery = call.getString("initialQuery", "");
        boolean startVoice = Boolean.TRUE.equals(call.getBoolean("startVoice", false));
        runOnWorker(call, () -> {
            IAlphaPlatformBroker broker = connectBroker();
            if (broker == null) {
                call.reject("AlphaCoreUnavailable", "AlphaCoreUnavailable");
                return;
            }
            try {
                boolean opened = broker.openAlphaOverlay(entrySource, initialQuery, startVoice);
                call.resolve(new JSObject().put("opened", opened));
            } catch (RemoteException | SecurityException refused) {
                call.reject("AlphaCoreUnavailable", "AlphaCoreUnavailable");
            }
        });
    }

    @PluginMethod public void launchSiblingApp(PluginCall call) {
        String targetPackage = resolveSiblingPackage(
            call.getString("targetPackage"),
            call.getString("view"),
            call.getString("appId")
        );
        if (targetPackage == null || targetPackage.isBlank()) {
            call.reject("Unknown sibling app");
            return;
        }
        String uri = call.getString("uri", "");
        JSObject extras = call.getObject("extras");
        String extrasJson = extras == null ? "{}" : extras.toString();
        runOnWorker(call, () -> {
            IAlphaPlatformBroker broker = connectBroker();
            if (broker == null) {
                call.reject("AlphaCoreUnavailable", "AlphaCoreUnavailable");
                return;
            }
            try {
                boolean launched = broker.launchSiblingApp(targetPackage, uri, extrasJson);
                call.resolve(new JSObject().put("launched", launched).put("targetPackage", targetPackage));
            } catch (RemoteException | SecurityException refused) {
                call.reject("AlphaCoreUnavailable", "AlphaCoreUnavailable");
            }
        });
    }

    @PluginMethod public void takeBillingReturn(PluginCall call) { forwardToCore(call, "takeBillingReturn"); }
    @PluginMethod public void checkForUpdate(PluginCall call) { forwardToCore(call, "checkForUpdate"); }
    @PluginMethod public void installUpdate(PluginCall call) { forwardToCore(call, "installUpdate"); }
    @PluginMethod public void updateState(PluginCall call) { forwardToCore(call, "updateState"); }
    @PluginMethod public void activateUpdate(PluginCall call) { forwardToCore(call, "activateUpdate"); }
    @PluginMethod public void continueUpdate(PluginCall call) { forwardToCore(call, "continueUpdate"); }
    @PluginMethod public void openUpdatePermissionSettings(PluginCall call) { forwardToCore(call, "openUpdatePermissionSettings"); }

    private static String resolveSiblingPackage(String explicitPackage, String view, String appId) {
        if (explicitPackage != null && !explicitPackage.isBlank()) return explicitPackage;
        AlphaSuitePolicy policy = AlphaSuitePolicy.defaults();
        if (view != null && !view.isBlank()) {
            AlphaSuitePolicy.AppRule rule = policy.ruleForView(view);
            if (rule != null) return rule.applicationId();
        }
        if (appId != null && !appId.isBlank()) {
            AlphaSuitePolicy.AppRule rule = policy.ruleForId(appId);
            if (rule != null) return rule.applicationId();
        }
        return null;
    }

    private static String normalizeAccessPermission(String permission) {
        return "camera".equals(permission) || "notifications".equals(permission) ? permission : null;
    }

    private PermissionState resolveAccessPermissionState(String permission) {
        if ("notifications".equals(permission) && Build.VERSION.SDK_INT < 33) return PermissionState.GRANTED;
        return getPermissionState(permission);
    }

    private static String boundedShareText(String text) {
        if (text == null || text.isBlank() || text.indexOf('\0') >= 0 || text.length() > 65536) {
            throw new IllegalArgumentException();
        }
        try {
            ByteBuffer bytes = StandardCharsets.UTF_8.newEncoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .encode(CharBuffer.wrap(text));
            if (bytes.remaining() > 65536) throw new IllegalArgumentException();
        } catch (CharacterCodingException malformed) {
            throw new IllegalArgumentException();
        }
        return text;
    }

    private static boolean isForegroundUnlocked(Activity activity) {
        if (activity == null || activity.isFinishing() || activity.isDestroyed()) return false;
        if (Looper.myLooper() != Looper.getMainLooper()) return false;
        if (!activity.hasWindowFocus()) return false;
        if (!(activity instanceof LifecycleOwner owner) || !owner.getLifecycle().getCurrentState().isAtLeast(Lifecycle.State.RESUMED)) {
            return false;
        }
        KeyguardManager lock = activity.getSystemService(KeyguardManager.class);
        UserManager users = activity.getSystemService(UserManager.class);
        return lock != null && users != null && !lock.isDeviceLocked() && users.isUserUnlocked();
    }

    private static int hapticConstant(String kind, int sdk) {
        if (kind == null) return -1;
        return switch (kind) {
            case "toggle-on" -> sdk >= 34 ? HapticFeedbackConstants.TOGGLE_ON : HapticFeedbackConstants.CLOCK_TICK;
            case "toggle-off" -> sdk >= 34 ? HapticFeedbackConstants.TOGGLE_OFF : HapticFeedbackConstants.CLOCK_TICK;
            case "confirm" -> sdk >= 30 ? HapticFeedbackConstants.CONFIRM : HapticFeedbackConstants.VIRTUAL_KEY;
            case "long-press" -> HapticFeedbackConstants.LONG_PRESS;
            default -> -1;
        };
    }

    private static Intent handOff(Intent intent) {
        return intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    }

    private static String[] settingsActionsForPage(String page) {
        if (page == null) return null;
        return switch (page) {
            case "accounts" -> new String[] { Settings.ACTION_SYNC_SETTINGS };
            case "wifi" -> new String[] { Settings.ACTION_WIFI_SETTINGS };
            case "bluetooth" -> new String[] { Settings.ACTION_BLUETOOTH_SETTINGS };
            case "mobile" -> new String[] { Settings.ACTION_DATA_ROAMING_SETTINGS, Settings.ACTION_WIRELESS_SETTINGS };
            case "airplane" -> new String[] { Settings.ACTION_AIRPLANE_MODE_SETTINGS, Settings.ACTION_WIRELESS_SETTINGS };
            case "location" -> new String[] { Settings.ACTION_LOCATION_SOURCE_SETTINGS };
            case "display" -> new String[] { Settings.ACTION_DISPLAY_SETTINGS };
            case "sound" -> new String[] { Settings.ACTION_SOUND_SETTINGS };
            case "battery" -> new String[] { Settings.ACTION_BATTERY_SAVER_SETTINGS };
            case "about" -> new String[] { Settings.ACTION_DEVICE_INFO_SETTINGS };
            case "developer" -> new String[] { Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS };
            case "notifications" -> new String[] { Settings.ACTION_APP_NOTIFICATION_SETTINGS };
            case "privacy" -> new String[] { Settings.ACTION_APPLICATION_DETAILS_SETTINGS };
            case "default-apps" -> new String[] { Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS };
            case "dnd" -> new String[] { "android.settings.ZEN_MODE_SETTINGS", Settings.ACTION_ZEN_MODE_PRIORITY_SETTINGS };
            default -> null;
        };
    }

    private static int openSettingsCandidate(Activity activity, String page, String[] candidates) {
        String packageName = activity.getPackageName();
        for (int index = 0; index < candidates.length; index++) {
            Intent intent = new Intent(candidates[index]);
            if ("privacy".equals(page)) intent.setData(Uri.parse("package:" + packageName));
            if ("notifications".equals(page)) intent.putExtra(Settings.EXTRA_APP_PACKAGE, packageName);
            try {
                activity.startActivity(handOff(intent));
                return index;
            } catch (RuntimeException ignored) {
            }
        }
        return -1;
    }

    private static void putSettingsGrants(Context context, JSObject out) {
        JSObject grants = new JSObject();
        boolean fine = context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        boolean coarse = context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        out.put("locationAccess", fine ? "precise" : coarse ? "approximate" : "denied");
        grants.put("Microphone", context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED);
        grants.put("Location", fine || coarse);
        grants.put("Camera", context.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED);
        grants.put("Calendar", context.checkSelfPermission(Manifest.permission.READ_CALENDAR) == PackageManager.PERMISSION_GRANTED);
        out.put("permissions", grants);
    }

    private static boolean isTrustedProtonPass(Context context) {
        return context.getPackageManager().hasSigningCertificate(PROTON_PASS_PACKAGE, PROTON_PASS_CERT, PackageManager.CERT_INPUT_SHA256);
    }

    private static JSObject readPasswordProviderStatus(Context context) {
        JSObject result = new JSObject();
        result.put("installation", "unknown");
        result.put("selection", "unknown");
        result.put("support", "unknown");
        try {
            ApplicationInfo app = context.getPackageManager().getApplicationInfo(PROTON_PASS_PACKAGE, 0);
            result.put("installation", !isTrustedProtonPass(context) ? "unrecognized-publisher" : app.enabled ? "installed" : "disabled");
        } catch (PackageManager.NameNotFoundException absent) {
            result.put("installation", "absent");
        } catch (RuntimeException ignored) {
        }
        try {
            AutofillManager manager = context.getSystemService(AutofillManager.class);
            if (manager != null) {
                result.put("support", manager.isAutofillSupported() ? "available" : "unavailable");
                ComponentName service = manager.getAutofillServiceComponentName();
                result.put("selection", service == null ? "none" : PROTON_PASS_PACKAGE.equals(service.getPackageName()) ? "proton" : "other");
            }
        } catch (RuntimeException ignored) {
        }
        return result;
    }

    private static Intent passwordProviderIntent(Context context, String action) {
        if ("settings".equals(action)) {
            AutofillManager manager = context.getSystemService(AutofillManager.class);
            if (isTrustedProtonPass(context) && manager != null && manager.isAutofillSupported()) {
                return new Intent(Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE, Uri.parse("package:" + PROTON_PASS_PACKAGE));
            }
            return new Intent(Settings.ACTION_SETTINGS);
        }
        if ("install".equals(action)) {
            return new Intent(Intent.ACTION_VIEW, Uri.parse("https://proton.me/pass/download"));
        }
        if ("open".equals(action)) {
            if (!isTrustedProtonPass(context)) throw new IllegalStateException("Provider publisher is not verified");
            Intent launch = context.getPackageManager().getLaunchIntentForPackage(PROTON_PASS_PACKAGE);
            if (launch == null) throw new IllegalStateException("Provider app is unavailable");
            return launch;
        }
        throw new IllegalArgumentException("Unsupported password provider action");
    }

    private static byte[] decodeHex(String hex) {
        byte[] bytes = new byte[hex.length() / 2];
        for (int index = 0; index < bytes.length; index++) {
            bytes[index] = (byte) Integer.parseInt(hex.substring(index * 2, index * 2 + 2), 16);
        }
        return bytes;
    }
}
