package ai.alphacompute.alphaphone;

import ai.alphacompute.alphaphone.overlay.AlphaOverlayHostPlugin;
import ai.alphacompute.alphaphone.overlay.AlphaVoiceInteractionService;
import ai.alphacompute.ipc.AlphaIpcContract;
import ai.alphacompute.ipc.AlphaSuitePolicy;
import ai.alphacompute.localllm.AlphaLocalLlmCatalog;
import ai.alphacompute.localllm.AlphaLocalLlmPlugin;
import ai.alphacompute.localllm.AlphaLocalModelManager;
import ai.eliza.os.agent.AgentConfig;
import ai.eliza.plugins.actionjournal.ActionJournal;
import ai.eliza.plugins.actionjournal.ActionJournalPlugin;
import ai.eliza.plugins.actionjournal.deletion.DeferredDeletionCoordinator;
import ai.eliza.plugins.actionjournal.deletion.DeferredDeletionJournal;
import ai.eliza.plugins.notifications.MailHistoryReconciliation;
import ai.eliza.plugins.notifications.NotificationMirrorPolicy;
import ai.eliza.plugins.securestore.nativeonly.SecureSlotPolicy.Caller;
import ai.eliza.plugins.securestore.nativeonly.SecureSlotPolicy.ExchangeOutcome;
import ai.eliza.plugins.securestore.nativeonly.SecureSlots;
import ai.eliza.plugins.signin.CloudRequestPolicy;
import ai.eliza.plugins.signin.CredentialPolicy;
import ai.eliza.plugins.signin.CredentialPolicy.Notice;
import ai.eliza.plugins.signin.CredentialReader;
import ai.eliza.plugins.signin.DeviceCustody;
import ai.eliza.plugins.system.SystemFacts;
import ai.eliza.plugins.system.SystemSettingsPages;
import android.Manifest;
import android.app.ActivityOptions;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationChannelGroup;
import android.app.NotificationManager;
import android.app.role.RoleManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;
import android.service.notification.StatusBarNotification;
import android.telephony.SubscriptionInfo;
import android.telephony.SubscriptionManager;
import android.telephony.TelephonyManager;
import android.telephony.euicc.EuiccManager;
import android.view.accessibility.AccessibilityManager;
import android.view.autofill.AutofillManager;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CopyOnWriteArraySet;
import java.util.concurrent.TimeUnit;
import java.util.function.BiConsumer;
import java.util.function.Consumer;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Shared in-process AlphaCore plugin dispatcher serving both {@code AlphaOverlayCapacitorBridge}
 * and {@code AlphaPlatformBrokerService} with one authoritative implementation.
 */
public final class AlphaCorePluginDispatch {
    private static final String CAPACITOR_CONFIG = "capacitor.config.json";
    private static final double MAX_REVISION = 9_007_199_254_740_991d;
    private static final long SYNC_DISPATCH_TIMEOUT_MS = 25_000L;
    private static final Pattern DELETION_ID = Pattern.compile("[A-Za-z0-9_-]{1,128}");
    private static final Set<Consumer<JSONObject>> localLlmProgressListeners = new CopyOnWriteArraySet<>();

    private AlphaCorePluginDispatch() {}

    /** Subscribes to live {@code AlphaLocalLlm} download progress updates triggered through AlphaCore dispatch. */
    public static AutoCloseable subscribeLocalLlmProgress(Consumer<JSONObject> listener) {
        if (listener == null) return () -> {};
        localLlmProgressListeners.add(listener);
        return () -> localLlmProgressListeners.remove(listener);
    }

    private static void broadcastLocalLlmProgress(AlphaLocalModelManager.DownloadProgress progress) {
        if (progress == null) return;
        JSONObject payload;
        try {
            payload = progress.toJson();
        } catch (JSONException ignored) {
            return;
        }
        for (Consumer<JSONObject> listener : localLlmProgressListeners) {
            try {
                listener.accept(payload);
            } catch (RuntimeException ignored) {
            }
        }
    }

    /** Builds the {@code ElizaSignIn.status()} payload matching {@code @elizaos/os-bridges}'s schema. */
    public static JSONObject signInStatus(Context context) {
        CredentialReader reader = DeviceCustody.reader(context.getApplicationContext(), BuildConfig.CLOUD_API_ORIGIN);
        CredentialReader.Credential active = reader.current();
        CredentialPolicy.Account account = active != null ? active.account() : reader.account();
        JSONObject out = new JSONObject();
        try {
            out.put("ok", true)
                .put("environment", "production")
                .put("methodsKnown", true)
                .put("email", true)
                .put("sms", true)
                .put("google", true)
                .put("googleMode", "browser")
                .put("state", active != null ? "ready" : "signed_out")
                .put("signedIn", active != null);
            if (active != null) {
                out.put("credentialId", active.credentialId());
            }
            if (active != null && account != null) {
                out.put("account", new JSONObject()
                    .put("signedIn", true)
                    .put("userId", account.userId())
                    .put("organizationId", account.organizationId())
                    .put("credentialId", active.credentialId())
                    .put("keyExpiresAt", active.keyExpiresAt()));
            } else {
                out.put("account", new JSONObject().put("signedIn", false));
            }
        } catch (JSONException impossible) {
            throw new IllegalStateException(impossible);
        }
        return out;
    }

    /** Builds the {@code ElizaSignIn.serviceInfo()} payload. */
    public static JSONObject signInServiceInfo() {
        JSONObject out = new JSONObject();
        try {
            out.put("ok", true)
                .put("outcome", "ready")
                .put("origin", BuildConfig.CLOUD_API_ORIGIN);
        } catch (JSONException impossible) {
            throw new IllegalStateException(impossible);
        }
        return out;
    }

    /** Subscribes to live device credential custody updates and emits {@code signInSettled} payloads. */
    public static AutoCloseable observeSignIn(Context context, Consumer<JSONObject> onSettled) {
        Context appContext = context.getApplicationContext();
        CredentialReader reader = DeviceCustody.reader(appContext, BuildConfig.CLOUD_API_ORIGIN);
        CredentialReader.Subscription sub = reader.listen(notice -> {
            if (notice instanceof Notice.Announce) {
                CredentialReader.Credential current = reader.current();
                if (current == null) return;
                JSONObject receipt = new JSONObject();
                try {
                    receipt.put("request", 0)
                        .put("attempt", 0)
                        .put("verdict", "signed-in-as")
                        .put("credentialId", current.credentialId())
                        .put("google", "none");
                } catch (JSONException ignored) {
                    return;
                }
                onSettled.accept(receipt);
            }
        });
        return sub::close;
    }

    /** Launches an allowlisted sibling thin Alpha app with verified AlphaCore signing certificate. */
    public static boolean launchSiblingApp(
        Context context,
        AlphaSuitePolicy policy,
        String targetPackageOrView,
        String rawUri,
        String extrasJson
    ) {
        if (context == null || policy == null || targetPackageOrView == null || targetPackageOrView.isBlank()) {
            return false;
        }
        AlphaSuitePolicy.AppRule rule = resolveRule(policy, targetPackageOrView.trim());
        if (rule == null) return false;
        String pkg = rule.applicationId();
        if (!AlphaIpcContract.hasCoreSignature(context, pkg)) return false;
        Intent intent;
        if (rawUri != null && !rawUri.isBlank()) {
            Uri uri = Uri.parse(rawUri);
            if (!AlphaIpcContract.SCHEME_ALPHA.equals(uri.getScheme())) return false;
            intent = new Intent(AlphaIpcContract.ACTION_AGENT_OPEN, uri)
                .setPackage(pkg)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        } else {
            intent = context.getPackageManager().getLaunchIntentForPackage(pkg);
            if (intent == null) {
                intent = new Intent(Intent.ACTION_MAIN)
                    .addCategory(Intent.CATEGORY_LAUNCHER)
                    .setPackage(pkg);
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        }
        if (extrasJson != null && !extrasJson.isBlank()) {
            if (extrasJson.getBytes(StandardCharsets.UTF_8).length > AlphaIpcContract.MAX_INTENT_PAYLOAD_BYTES) {
                return false;
            }
            intent.putExtra(AlphaIpcContract.EXTRA_PAYLOAD, extrasJson);
        }
        try {
            Bundle options = null;
            if (Build.VERSION.SDK_INT >= 34) {
                options = ActivityOptions.makeBasic().setShareIdentityEnabled(true).toBundle();
            }
            context.startActivity(intent, options);
            return true;
        } catch (RuntimeException unavailable) {
            return false;
        }
    }

    /** Opens the system-wide Ask Alpha overlay from any AlphaCore or thin-app caller. */
    public static boolean openAlphaOverlay(Context context, String entrySource, String initialQuery, boolean startVoice) {
        return AlphaVoiceInteractionService.showOverlay(context, entrySource, initialQuery, startVoice);
    }

    /** Creates an {@link AlphaCallStateWatch} bound to {@code appContext} for live call-state events. */
    public static AutoCloseable watchCallState(Context context, Consumer<JSONObject> onChanged) {
        Context appContext = context.getApplicationContext();
        AlphaCallStateWatch watch = new AlphaCallStateWatch(appContext, () ->
            onChanged.accept(AlphaCallStatePlugin.payload(
                AlphaCallState.read(appContext),
                true,
                AlphaCallState.carrierReady(appContext)
            ))
        );
        watch.ensure();
        return watch::stop;
    }

    /** Synchronously executes a core plugin call and returns an encoded JSON envelope {@code { ok, result?, error?, message? }}. */
    public static String invokeSyncJson(
        Context context,
        AlphaSuitePolicy policy,
        String pluginName,
        String method,
        String argsJson
    ) {
        JSONObject options;
        try {
            options = argsJson == null || argsJson.isBlank() ? new JSONObject() : new JSONObject(argsJson);
        } catch (JSONException malformed) {
            options = new JSONObject();
        }
        CompletableFuture<String> pending = new CompletableFuture<>();
        boolean handled = dispatch(
            context,
            policy,
            pluginName,
            method,
            options,
            data -> {
                JSONObject envelope = new JSONObject();
                try {
                    envelope.put("ok", true).put("result", data == null ? new JSONObject() : data);
                } catch (JSONException ignored) {
                }
                pending.complete(envelope.toString());
            },
            (code, message) -> {
                JSONObject envelope = new JSONObject();
                try {
                    envelope.put("ok", false)
                        .put("error", code == null ? "ERROR" : code)
                        .put("message", message == null ? "Plugin call failed" : message);
                } catch (JSONException ignored) {
                }
                pending.complete(envelope.toString());
            }
        );
        if (!handled) {
            JSONObject envelope = new JSONObject();
            try {
                envelope.put("ok", false).put("error", "UNIMPLEMENTED").put("message", "Unsupported plugin call");
            } catch (JSONException ignored) {
            }
            return envelope.toString();
        }
        try {
            return pending.get(SYNC_DISPATCH_TIMEOUT_MS, TimeUnit.MILLISECONDS);
        } catch (Exception timedOut) {
            JSONObject envelope = new JSONObject();
            try {
                envelope.put("ok", false).put("error", "TIMEOUT").put("message", "Plugin call timed out");
            } catch (JSONException ignored) {
            }
            return envelope.toString();
        }
    }

    /** Routes a non-streaming AlphaCore plugin call directly in-process. */
    public static boolean dispatch(
        Context context,
        AlphaSuitePolicy policy,
        String pluginName,
        String method,
        JSONObject options,
        Consumer<JSONObject> resolve,
        BiConsumer<String, String> reject
    ) {
        Context appContext = context.getApplicationContext();
        JSONObject args = options == null ? new JSONObject() : options;
        switch (pluginName) {
            case "ElizaSignIn" -> {
                AlphaCoreSignInHost.shared(appContext).dispatch(
                    AlphaIpcContract.CORE_PACKAGE,
                    method,
                    args,
                    resolve,
                    reject
                );
                return true;
            }
            case "AlphaLocalLlm" -> {
                handleLocalLlm(appContext, method, args, resolve, reject);
                return true;
            }
            case "AlphaCarrierSetup" -> {
                handleCarrierSetup(appContext, method, args, resolve, reject);
                return true;
            }
            case "ElizaCloud" -> {
                if ("openExternal".equals(method)) {
                    handleCloudOpenExternal(appContext, args, resolve, reject);
                    return true;
                }
                return false;
            }
            case "AlphaDevice" -> {
                handleDevice(appContext, policy, method, args, resolve, reject);
                return true;
            }
            case "ElizaSecureStore" -> {
                handleSecureStore(appContext, method, args, resolve, reject);
                return true;
            }
            case "AlphaAssistantDraft" -> {
                handleAssistantDraft(appContext, method, args, resolve, reject);
                return true;
            }
            case "ElizaActionJournal" -> {
                handleActionJournal(appContext, method, args, resolve, reject);
                return true;
            }
            case "ElizaNotifications" -> {
                handleNotifications(appContext, method, args, resolve, reject);
                return true;
            }
            case "ElizaPasswords" -> {
                handlePasswords(appContext, method, resolve, reject);
                return true;
            }
            case "ElizaSystem" -> {
                handleSystem(appContext, method, args, resolve, reject);
                return true;
            }
            case "AlphaCallState" -> {
                if ("callState".equals(method)) {
                    resolve.accept(AlphaCallStatePlugin.payload(
                        AlphaCallState.read(appContext),
                        false,
                        AlphaCallState.carrierReady(appContext)
                    ));
                    return true;
                }
                reject.accept("UNIMPLEMENTED", "Unsupported AlphaCallState method: " + method);
                return true;
            }
            case "AlphaConnection" -> {
                handleEarlierConnection(appContext, method, args, resolve, reject);
                return true;
            }
            case "AlphaHostedDigestDelivery" -> {
                handleHostedDigestDelivery(appContext, method, args, resolve, reject);
                return true;
            }
            case "AlphaInboxNotices" -> {
                handleInboxNotices(appContext, method, args, resolve, reject);
                return true;
            }
            case "ElizaReset" -> {
                reject.accept("RequiresCoreActivity", "Device reset runs inside AlphaCore");
                return true;
            }
            default -> {
                return false;
            }
        }
    }

    private static void handleLocalLlm(
        Context context,
        String method,
        JSONObject options,
        Consumer<JSONObject> resolve,
        BiConsumer<String, String> reject
    ) {
        try {
            if ("download".equals(method)) {
                String modelId = options.optString("modelId", AlphaLocalLlmCatalog.DEFAULT_MODEL_ID);
                boolean allowMetered = options.optBoolean("allowMetered", false);
                AlphaLocalModelManager manager = AlphaLocalModelManager.shared(context);
                AlphaLocalModelManager.DownloadProgress started = manager.startDownload(
                    modelId,
                    allowMetered,
                    AlphaCorePluginDispatch::broadcastLocalLlmProgress
                );
                resolve.accept(new JSONObject()
                    .put("ok", true)
                    .put("modelId", started.modelId())
                    .put("status", started.toJson()));
                return;
            }
            resolve.accept(AlphaLocalLlmPlugin.invoke(context, method, options));
        } catch (AlphaLocalModelManager.ModelRefusedException refused) {
            reject.accept(refused.code, refused.getMessage());
        } catch (IOException | JSONException failed) {
            reject.accept(
                "LOCAL_LLM_FAILED",
                failed.getMessage() == null ? "Local LLM operation failed" : failed.getMessage()
            );
        }
    }

    private static void handleCloudOpenExternal(
        Context context,
        JSONObject options,
        Consumer<JSONObject> resolve,
        BiConsumer<String, String> reject
    ) {
        String url = options.optString("url", "");
        CloudRequestPolicy.ExternalLink link = url.isEmpty() ? null : CloudRequestPolicy.linkOf(url);
        String appLinkHost = resolveAppLinkHost(context);
        if (link == null || !CloudRequestPolicy.opensExternally(appLinkHost, link)) {
            reject.accept("link-refused", "link-refused");
            return;
        }
        BillingReturn.recordCheckoutCaller(AlphaIpcContract.CORE_PACKAGE);
        Intent view = new Intent(Intent.ACTION_VIEW, Uri.parse(url))
            .addCategory(Intent.CATEGORY_BROWSABLE)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            context.startActivity(view);
            resolve.accept(jsonPair("opened", true));
        } catch (RuntimeException unavailable) {
            reject.accept("no-browser", "no-browser");
        }
    }

    private static void handleDevice(
        Context context,
        AlphaSuitePolicy policy,
        String method,
        JSONObject options,
        Consumer<JSONObject> resolve,
        BiConsumer<String, String> reject
    ) {
        switch (method) {
            case "takeBillingReturn" -> {
                String session = BillingReturn.take();
                JSONObject out = new JSONObject();
                try {
                    out.put("session", session == null ? JSONObject.NULL : session);
                } catch (JSONException ignored) {
                }
                resolve.accept(out);
            }
            case "updateState" -> {
                try {
                    resolve.accept(AlphaDevicePlugin.readHeadlessUpdateState(context));
                } catch (Exception unavailable) {
                    reject.accept("UNAVAILABLE", "Update status unavailable");
                }
            }
            case "checkForUpdate" -> {
                try {
                    resolve.accept(AlphaDevicePlugin.checkForUpdateHeadless(context));
                } catch (Exception unavailable) {
                    reject.accept("UNAVAILABLE", "Update unavailable");
                }
            }
            case "installUpdate" -> resolve.accept(jsonPair("status", "unsupported"));
            case "activateUpdate" -> resolve.accept(new JSONObject());
            case "continueUpdate" -> reject.accept("UNAVAILABLE", "Update confirmation unavailable");
            case "openUpdatePermissionSettings" -> {
                try {
                    resolve.accept(AlphaDevicePlugin.openUpdatePermissionSettingsHeadless(context));
                } catch (RuntimeException unavailable) {
                    reject.accept("UNAVAILABLE", "Update unavailable");
                }
            }
            case "textAsk" -> resolve.accept(jsonPair("ticket", 0));
            case "closeTextAsk" -> resolve.accept(jsonPair("closed", false));
            case "copyText" -> {
                try {
                    String text = AlphaDevicePlugin.boundedShareText(options.optString("text", null));
                    ClipboardManager clipboard = context.getSystemService(ClipboardManager.class);
                    if (clipboard == null) {
                        reject.accept("UNAVAILABLE", "Clipboard unavailable.");
                        return;
                    }
                    clipboard.setPrimaryClip(ClipData.newPlainText("Alpha text", text));
                    resolve.accept(new JSONObject());
                } catch (RuntimeException invalid) {
                    reject.accept("INVALID", "Choose valid text of at most 64 KiB.");
                }
            }
            case "shareText" -> {
                try {
                    String text = AlphaDevicePlugin.boundedShareText(options.optString("text", null));
                    String title = options.optString("title", "");
                    if (title.length() > 200 || title.chars().anyMatch(c -> c < 32 || c == 127)) {
                        throw new IllegalArgumentException();
                    }
                    Intent send = new Intent(Intent.ACTION_SEND)
                        .setType("text/plain")
                        .putExtra(Intent.EXTRA_TEXT, text)
                        .putExtra(Intent.EXTRA_SUBJECT, title)
                        .putExtra(Intent.EXTRA_TITLE, title);
                    Intent chooser = Intent.createChooser(send, "Share externally").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(chooser);
                    resolve.accept(jsonPair("status", "opened"));
                } catch (IllegalArgumentException invalid) {
                    reject.accept("INVALID", "Choose valid text of at most 64 KiB.");
                } catch (RuntimeException unavailable) {
                    reject.accept("UNAVAILABLE", "Android sharing is unavailable.");
                }
            }
            case "haptic" -> {
                int constant = AlphaHaptics.constant(options.optString("kind", null), Build.VERSION.SDK_INT);
                if (constant < 0) {
                    reject.accept("INVALID", "Unknown feedback");
                    return;
                }
                boolean performed = performHapticFallback(context);
                resolve.accept(jsonPair("performed", performed));
            }
            case "recommendedTimeout" -> {
                int base = options.optInt("baseMs", -1);
                if (base < 1 || base > 600_000) {
                    reject.accept("INVALID", "Base timeout must be 1 to 600000 ms.");
                    return;
                }
                int timeout = base;
                AccessibilityManager accessibility = context.getSystemService(AccessibilityManager.class);
                if (accessibility != null) {
                    timeout = accessibility.getRecommendedTimeoutMillis(
                        base,
                        AccessibilityManager.FLAG_CONTENT_TEXT | AccessibilityManager.FLAG_CONTENT_CONTROLS
                    );
                }
                resolve.accept(jsonPair("timeoutMs", timeout));
            }
            case "setSystemBarAppearance" -> resolve.accept(new JSONObject());
            case "setAgentGoogleConsent" -> {
                if (!options.has("gmailChanges") || !options.has("calendarEdits")) {
                    reject.accept("INVALID", "Choose Gmail changes and Calendar edits.");
                    return;
                }
                boolean gmail = options.optBoolean("gmailChanges", false);
                boolean calendar = options.optBoolean("calendarEdits", false);
                try {
                    if (AlphaAgentService.keep(context, new AgentConfig.GoogleConsent(gmail, calendar))) {
                        resolve.accept(new JSONObject());
                    } else {
                        reject.accept("FAILED", "Agent consent could not be saved");
                    }
                } catch (IllegalStateException unconfigured) {
                    reject.accept("UNAVAILABLE", "The agent service is not configured");
                }
            }
            case "diagnosticsFacts" -> resolve.accept(buildDiagnosticsFacts(context));
            case "settingsFacts" -> resolve.accept(buildSettingsFacts(context));
            case "snapshot" -> resolve.accept(buildDeviceSnapshot(context));
            case "passwordProviderStatus" -> resolve.accept(PasswordProviderSupport.status(context));
            case "openAlphaOverlay" -> {
                String entrySource = options.optString("entrySource", "app");
                String initialQuery = options.has("initialQuery") && !options.isNull("initialQuery")
                    ? options.optString("initialQuery", null) : null;
                boolean startVoice = options.optBoolean("startVoice", false);
                boolean opened = openAlphaOverlay(context, entrySource, initialQuery, startVoice);
                resolve.accept(jsonPair("opened", opened));
            }
            case "launchSiblingApp" -> {
                String target = options.optString("targetPackage", options.optString("view", ""));
                String uri = options.has("uri") && !options.isNull("uri") ? options.optString("uri", null) : null;
                String extrasJson = options.has("extrasJson") && !options.isNull("extrasJson")
                    ? options.optString("extrasJson", null) : null;
                boolean launched = launchSiblingApp(context, policy, target, uri, extrasJson);
                resolve.accept(jsonPair("launched", launched));
            }
            case "finishTask" -> {
                AlphaOverlayHostPlugin.HostDelegate host = AlphaOverlayHostPlugin.currentHost();
                if (host != null) host.dismiss();
                resolve.accept(new JSONObject());
            }
            case "openSettings" -> {
                String page = options.optString("page", "");
                if ("system".equals(page)) {
                    try {
                        context.startActivity(AlphaDevicePlugin.handOff(new Intent(Settings.ACTION_SETTINGS)));
                        resolve.accept(new JSONObject().put("status", "opened").put("page", page).put("specific", true));
                    } catch (JSONException | RuntimeException unavailable) {
                        reject.accept("UNAVAILABLE", "This Android settings page is unavailable");
                    }
                    return;
                }
                if ("screen-lock".equals(page) || "all-files".equals(page)) {
                    boolean files = "all-files".equals(page);
                    if (files && Build.VERSION.SDK_INT < 30) {
                        reject.accept("UNAVAILABLE", "This Android settings page is unavailable");
                        return;
                    }
                    Intent intent = files
                        ? new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:" + context.getPackageName()))
                        : new Intent(Settings.ACTION_SECURITY_SETTINGS);
                    try {
                        context.startActivity(AlphaDevicePlugin.handOff(intent));
                        resolve.accept(new JSONObject().put("status", "opened").put("page", page).put("specific", files));
                    } catch (JSONException | RuntimeException unavailable) {
                        reject.accept("UNAVAILABLE", "This Android settings page is unavailable");
                    }
                    return;
                }
                if (SystemSettingsPages.actions(page) == null) {
                    reject.accept("INVALID", "Unsupported settings page");
                    return;
                }
                int opened = SystemSettingsPages.open(page, context.getPackageName(), intent -> context.startActivity(AlphaDevicePlugin.handOff(intent)));
                if (opened < 0) {
                    reject.accept("UNAVAILABLE", "This Android settings page is unavailable");
                    return;
                }
                try {
                    resolve.accept(new JSONObject().put("status", "opened").put("page", page).put("specific", opened == 0));
                } catch (JSONException impossible) {
                    reject.accept("ERROR", "Failed to encode settings response");
                }
            }
            default -> reject.accept("UNIMPLEMENTED", "Unsupported AlphaDevice method: " + method);
        }
    }

    private static void handleSecureStore(
        Context context,
        String method,
        JSONObject options,
        Consumer<JSONObject> resolve,
        BiConsumer<String, String> reject
    ) {
        if ("status".equals(method)) {
            JSONObject out = new JSONObject();
            try {
                SecureSlots slots = SecureSlots.forHost(context);
                slots.ensureAvailable();
                out.put("ok", true)
                    .put("available", true)
                    .put("backend", "android_keystore")
                    .put("accessibility", "credential_encrypted_device_only")
                    .put("synchronized", false)
                    .put("accessGroup", "app_only");
            } catch (Exception unavailable) {
                try {
                    out.put("ok", false)
                        .put("available", false)
                        .put("error", AlphaIpcContract.SECURE_UNAVAILABLE)
                        .put("backend", "unavailable")
                        .put("accessibility", "unavailable")
                        .put("synchronized", false)
                        .put("accessGroup", "app_only");
                } catch (JSONException impossible) {
                    throw new IllegalStateException(impossible);
                }
            }
            resolve.accept(out);
            return;
        }
        SecureSlots slots;
        try {
            slots = SecureSlots.forHost(context);
        } catch (Exception unavailable) {
            resolve.accept(secureStoreError(AlphaIpcContract.SECURE_UNAVAILABLE, null));
            return;
        }
        String key = options.optString("key", "");
        if ("get".equals(method)) {
            SecureSlots.Reading reading = slots.read(Caller.RendererCaller, key);
            if (reading instanceof SecureSlots.Present present) {
                try {
                    resolve.accept(new JSONObject().put("ok", true).put("value", present.value()));
                } catch (JSONException impossible) {
                    reject.accept("ERROR", "Secure store encoding error");
                }
                return;
            }
            if (reading instanceof SecureSlots.Absent) {
                resolve.accept(secureStoreError("not_found", null));
            } else if (reading instanceof SecureSlots.Unreadable) {
                resolve.accept(secureStoreError("unreadable", null));
            } else {
                resolve.accept(secureStoreError(AlphaIpcContract.SECURE_DENIED, null));
            }
            return;
        }
        String expected = options.has("expected") && !options.isNull("expected") ? options.optString("expected", null) : null;
        String value = options.has("value") && !options.isNull("value") ? options.optString("value", null) : null;
        ExchangeOutcome outcome = switch (method) {
            case "set" -> slots.write(Caller.RendererCaller, key, value == null ? "" : value);
            case "remove" -> slots.remove(Caller.RendererCaller, key);
            case "compareAndExchange" -> slots.compareAndExchange(Caller.RendererCaller, key, expected, value);
            default -> null;
        };
        if (outcome == null) {
            reject.accept("UNIMPLEMENTED", "Unsupported ElizaSecureStore method: " + method);
            return;
        }
        resolve.accept(encodeExchangeOutcome(outcome));
    }

    private static void handleAssistantDraft(
        Context context,
        String method,
        JSONObject options,
        Consumer<JSONObject> resolve,
        BiConsumer<String, String> reject
    ) {
        if ("read".equals(method)) {
            resolve.accept(AlphaAssistantDraftPlugin.execute(context, options, false));
        } else if ("exchange".equals(method)) {
            resolve.accept(AlphaAssistantDraftPlugin.execute(context, options, true));
        } else {
            reject.accept("UNIMPLEMENTED", "Unsupported AlphaAssistantDraft method: " + method);
        }
    }

    private static void handleActionJournal(
        Context context,
        String method,
        JSONObject options,
        Consumer<JSONObject> resolve,
        BiConsumer<String, String> reject
    ) {
        try {
            boolean hasScope = options.has("scope") && !options.isNull("scope");
            switch (method) {
                case "reserve" -> {
                    String scope = ActionJournal.scope(options.optString("scope", null));
                    String id = ActionJournal.id(options.optString("proposalId", null));
                    ActionJournal.Reservation res = AlphaActionJournalPlugin.journal(context).reserve(
                        scope,
                        id,
                        options.optString("operationId", null),
                        options.optString("operationHash", null),
                        options.optJSONObject("record")
                    );
                    JSObject value = ActionJournalPlugin.entryResponse(res.entry);
                    value.put("created", res.created);
                    resolve.accept(value);
                }
                case "markApplying" -> {
                    String scope = ActionJournal.scope(options.optString("scope", null));
                    String id = ActionJournal.id(options.optString("proposalId", null));
                    resolve.accept(ActionJournalPlugin.entryResponse(
                        AlphaActionJournalPlugin.journal(context).markApplying(scope, id, options.optString("attemptId", null))
                    ));
                }
                case "finish" -> {
                    String scope = ActionJournal.scope(options.optString("scope", null));
                    String id = ActionJournal.id(options.optString("proposalId", null));
                    resolve.accept(ActionJournalPlugin.entryResponse(
                        AlphaActionJournalPlugin.journal(context).finish(
                            scope,
                            id,
                            options.optString("status", null),
                            options.optString("summary", null),
                            options.optJSONObject("result")
                        )
                    ));
                }
                case "get" -> {
                    if (hasScope) {
                        String scope = ActionJournal.scope(options.optString("scope", null));
                        String id = ActionJournal.id(options.optString("proposalId", null));
                        resolve.accept(ActionJournalPlugin.entryResponse(AlphaActionJournalPlugin.journal(context).get(scope, id)));
                    } else {
                        JSONObject entry = DeviceExecutionJournal.of(context).get(options.optString("proposalId", null));
                        JSObject reply = ActionJournalPlugin.entryResponse(entry);
                        if (entry != null) reply.put("digest", entry.getString("digest"));
                        resolve.accept(reply);
                    }
                }
                case "list" -> {
                    if (hasScope) {
                        String scope = ActionJournal.scope(options.optString("scope", null));
                        JSONArray listed = AlphaActionJournalPlugin.journal(context).list(scope);
                        resolve.accept(new JSONObject().put("entries", listed));
                    } else {
                        resolve.accept(new JSONObject().put("entries", DeviceExecutionJournal.of(context).list()));
                    }
                }
                case "edit" -> {
                    Object raw = options.opt("expectedRevision");
                    if (hasScope || !(raw instanceof Number revision) || revision.doubleValue() < 0
                        || revision.doubleValue() >= MAX_REVISION || revision.doubleValue() != Math.floor(revision.doubleValue())) {
                        reject.accept("INVALID", "Invalid journal revision");
                        return;
                    }
                    JSONObject payload = options.getJSONObject("next");
                    boolean kept = DeviceExecutionJournal.of(context).edit(
                        options.optString("proposalId", null),
                        revision.longValue(),
                        new JSONObject(payload.toString())
                    );
                    resolve.accept(jsonPair("kept", kept));
                }
                case "pending" -> {
                    DeferredDeletionCoordinator deletions = requireTelephonyDeletions(context);
                    resolve.accept(deletions.pendingWithOrigins());
                }
                case "undo" -> {
                    DeferredDeletionCoordinator deletions = requireTelephonyDeletions(context);
                    resolve.accept(deletions.undo(options.optString("kind", null), options.optString("id", null)));
                }
                case "dismiss" -> {
                    DeferredDeletionCoordinator deletions = requireTelephonyDeletions(context);
                    resolve.accept(deletions.dismiss(options.optString("kind", null), options.optString("id", null)));
                }
                case "telephonyDeletionReceipt" -> {
                    String kind = options.optString("kind", "");
                    String id = options.optString("id", "");
                    if (!("message".equals(kind) || "voicemail".equals(kind) || "contact".equals(kind))
                        || !DELETION_ID.matcher(id).matches()) {
                        reject.accept("INVALID", "Invalid telephony deletion identity");
                        return;
                    }
                    DeferredDeletionCoordinator coordinator = requireTelephonyDeletions(context);
                    JSONObject row = coordinator.receipt(kind, id);
                    if (row == null || !DeferredDeletionJournal.same(row.getJSONObject("owner"), coordinator.manualOwner())) {
                        resolve.accept(new JSONObject());
                        return;
                    }
                    String phase = row.getString("phase");
                    JSONObject reply = switch (phase) {
                        case "deleted", "undone", "conflict", "unknown" -> new JSONObject()
                            .put("kind", kind)
                            .put("id", id)
                            .put("phase", phase);
                        default -> new JSONObject();
                    };
                    resolve.accept(reply);
                }
                default -> reject.accept("UNIMPLEMENTED", "Unsupported ElizaActionJournal method: " + method);
            }
        } catch (Exception failed) {
            reject.accept("FAILED", "Action journal unavailable or transition rejected");
        }
    }

    private static DeferredDeletionCoordinator requireTelephonyDeletions(Context context) {
        if (!AlphaImageCapability.verified(context) || !AlphaAssistActivity.unlocked(context)) {
            throw new SecurityException("Open and unlock Alpha to review pending deletions.");
        }
        return AlphaTelephonyDeletions.get(context);
    }

    private static void handleNotifications(
        Context context,
        String method,
        JSONObject options,
        Consumer<JSONObject> resolve,
        BiConsumer<String, String> reject
    ) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) {
            reject.accept("UNAVAILABLE", "Notification service unavailable");
            return;
        }
        try {
            switch (method) {
                case "workflowPresentationCapabilities" -> resolve.accept(jsonPair("protocol", 2));
                case "status" -> {
                    JSONObject out = new JSONObject();
                    JSONArray channels = new JSONArray();
                    out.put("appEnabled", manager.areNotificationsEnabled());
                    out.put("permissionGranted", Build.VERSION.SDK_INT < 33
                        || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED);
                    out.put("interruption", interruptionWord(manager.getCurrentInterruptionFilter()));
                    for (NotificationChannel channel : manager.getNotificationChannels()) {
                        JSONObject row = new JSONObject();
                        row.put("id", channel.getId());
                        row.put("name", NotificationMirrorPolicy.bounded(channel.getName(), NotificationMirrorPolicy.LABEL_LIMIT));
                        row.put("importance", channel.getImportance());
                        row.put("blocked", channel.getImportance() == NotificationManager.IMPORTANCE_NONE);
                        NotificationChannelGroup group = channel.getGroup() == null
                            ? null : manager.getNotificationChannelGroup(channel.getGroup());
                        row.put("groupBlocked", group != null && group.isBlocked());
                        channels.put(row);
                    }
                    out.put("channels", channels);
                    out.put("scope", "alpha-phone");
                    resolve.accept(out);
                }
                case "crossAppStatus" -> resolve.accept(AlphaNotificationsPlugin.MIRROR.status(context));
                case "list" -> {
                    JSONArray items = new JSONArray();
                    boolean locked = !AlphaAssistActivity.unlocked(context);
                    String label = context.getString(R.string.app_name);
                    StatusBarNotification[] rows = manager.getActiveNotifications();
                    Arrays.sort(rows, Comparator.comparingLong(StatusBarNotification::getPostTime).reversed());
                    for (StatusBarNotification row : rows) {
                        Notification n = row.getNotification();
                        boolean hidden = locked || n.visibility == Notification.VISIBILITY_SECRET;
                        String id = row.getKey() + ":" + row.getPostTime();
                        JSONObject item = new JSONObject();
                        item.put("id", id);
                        item.put("revision", id);
                        item.put("source", "own");
                        item.put("kind", "other");
                        item.put("appLabel", label);
                        item.put("title", hidden
                            ? label + " notification"
                            : NotificationMirrorPolicy.bounded(n.extras.getCharSequence(Notification.EXTRA_TITLE), NotificationMirrorPolicy.TITLE_LIMIT));
                        item.put("text", hidden
                            ? (locked ? "Unlock to view" : "Content hidden")
                            : NotificationMirrorPolicy.bounded(
                                n.extras.getCharSequence(Notification.EXTRA_BIG_TEXT, n.extras.getCharSequence(Notification.EXTRA_TEXT)),
                                NotificationMirrorPolicy.TEXT_LIMIT
                            ));
                        item.put("at", row.getPostTime());
                        item.put("clearable", row.isClearable());
                        item.put("canOpen", !hidden && n.contentIntent != null);
                        items.put(item);
                    }
                    try {
                        JSONArray external = AlphaNotificationsPlugin.MIRROR.list(context);
                        for (int i = 0; i < external.length(); i++) {
                            items.put(external.get(i));
                        }
                    } catch (Exception ignored) {
                    }
                    resolve.accept(new JSONObject().put("items", items).put("scope", "alpha-phone"));
                }
                case "pendingWorkflowTap" -> resolve.accept(new JSONObject());
                default -> reject.accept("UNIMPLEMENTED", "Unsupported ElizaNotifications method: " + method);
            }
        } catch (Exception failed) {
            reject.accept("FAILED", "Notifications unavailable");
        }
    }

    private static void handlePasswords(
        Context context,
        String method,
        Consumer<JSONObject> resolve,
        BiConsumer<String, String> reject
    ) {
        if (!"status".equals(method)) {
            reject.accept("RequiresCoreActivity", "Password vault management runs in AlphaCore");
            return;
        }
        JSONObject result = new JSONObject();
        try {
            android.app.KeyguardManager keyguard = context.getSystemService(android.app.KeyguardManager.class);
            boolean secure = keyguard != null && keyguard.isDeviceSecure();
            result.put("available", secure)
                .put("locked", true)
                .put("unlockRemainingMs", 0);
            if (!secure) result.put("reason", "no-screen-lock");
            JSONObject autofill = new JSONObject();
            autofill.put("supported", JSONObject.NULL).put("selected", "unknown");
            try {
                AutofillManager manager = context.getSystemService(AutofillManager.class);
                if (manager != null) {
                    autofill.put("supported", manager.isAutofillSupported());
                    ComponentName service = manager.getAutofillServiceComponentName();
                    autofill.put(
                        "selected",
                        service == null ? "none" : context.getPackageName().equals(service.getPackageName()) ? "this-app" : "other"
                    );
                }
            } catch (RuntimeException ignored) {
            }
            result.put("autofill", autofill);
            resolve.accept(result);
        } catch (JSONException impossible) {
            reject.accept("ERROR", "Password status unavailable");
        }
    }

    private static void handleSystem(
        Context context,
        String method,
        JSONObject options,
        Consumer<JSONObject> resolve,
        BiConsumer<String, String> reject
    ) {
        try {
            switch (method) {
                case "getSystemFacts" -> {
                    JSONObject out = new JSONObject();
                    for (Map.Entry<String, Object> entry : SystemFacts.read(context).entrySet()) {
                        out.put(entry.getKey(), entry.getValue());
                    }
                    resolve.accept(out);
                }
                case "getStatus" -> {
                    JSONArray roles = new JSONArray();
                    RoleManager roleManager = context.getSystemService(RoleManager.class);
                    roles.put(roleEntry(roleManager, "home", RoleManager.ROLE_HOME));
                    roles.put(roleEntry(roleManager, "assistant", RoleManager.ROLE_ASSISTANT));
                    resolve.accept(new JSONObject().put("roles", roles));
                }
                case "getBuildInfo" -> resolve.accept(new JSONObject()
                    .put("version", BuildConfig.VERSION_NAME)
                    .put("versionCode", BuildConfig.VERSION_CODE)
                    .put("launcher", true));
                case "getDeviceSettings" -> {
                    AudioManager audio = context.getSystemService(AudioManager.class);
                    JSONArray volumes = new JSONArray();
                    if (audio != null) {
                        volumes.put(volumeRow("music", audio, AudioManager.STREAM_MUSIC));
                        volumes.put(volumeRow("ring", audio, AudioManager.STREAM_RING));
                        volumes.put(volumeRow("alarm", audio, AudioManager.STREAM_ALARM));
                    }
                    resolve.accept(new JSONObject().put("volumes", volumes));
                }
                case "openSettings" -> {
                    context.startActivity(AlphaDevicePlugin.handOff(new Intent(Settings.ACTION_SETTINGS)));
                    resolve.accept(new JSONObject().put("outcome", "Opened").put("specific", true));
                }
                case "openSettingsPage" -> {
                    String page = options.optString("page", "");
                    if (SystemSettingsPages.actions(page) == null) {
                        resolve.accept(new JSONObject().put("outcome", "Unavailable").put("specific", false));
                        return;
                    }
                    int opened = SystemSettingsPages.open(
                        page,
                        context.getPackageName(),
                        intent -> context.startActivity(AlphaDevicePlugin.handOff(intent))
                    );
                    if (opened < 0) {
                        resolve.accept(new JSONObject().put("outcome", "Unavailable").put("specific", false));
                    } else {
                        resolve.accept(new JSONObject().put("outcome", "Opened").put("specific", opened == 0));
                    }
                }
                case "crashLog" -> resolve.accept(new JSONObject().put("entries", new JSONArray()));
                case "clearCrashLog" -> resolve.accept(new JSONObject());
                default -> reject.accept("UNIMPLEMENTED", "Unsupported ElizaSystem method: " + method);
            }
        } catch (JSONException | RuntimeException unavailable) {
            reject.accept("UNAVAILABLE", "System service unavailable");
        }
    }

    private static void handleEarlierConnection(
        Context context,
        String method,
        JSONObject options,
        Consumer<JSONObject> resolve,
        BiConsumer<String, String> reject
    ) {
        String slot = options.has("slot") && !options.isNull("slot") ? options.optString("slot", null) : null;
        if (slot == null || !AlphaEarlier.PAGE_SLOTS.matcher(slot).matches()) {
            reject.accept("INVALID", "Secure storage slot is invalid");
            return;
        }
        try {
            if ("secureRead".equals(method)) {
                String value = AlphaEarlier.read(context, slot);
                resolve.accept(new JSONObject().put("value", value == null ? JSONObject.NULL : value));
                return;
            }
            if ("secureCompareExchange".equals(method)) {
                Object expected = options.opt("expectedValue");
                if (!(expected instanceof String held) || !options.has("value") || !options.isNull("value")) {
                    reject.accept("INVALID", "Secure draft update failed");
                    return;
                }
                resolve.accept(jsonPair("status", AlphaEarlier.clear(context, slot, held) ? "saved" : "conflict"));
                return;
            }
            reject.accept("UNIMPLEMENTED", "Unsupported AlphaConnection method: " + method);
        } catch (Exception failed) {
            reject.accept("FAILED", "Secure storage read failed");
        }
    }

    private static void handleHostedDigestDelivery(
        Context context,
        String method,
        JSONObject options,
        Consumer<JSONObject> resolve,
        BiConsumer<String, String> reject
    ) {
        try {
            HostedDigestDelivery delivery = HostedDigestDelivery.get();
            switch (method) {
                case "read" -> {
                    JSONObject snapshot = delivery.read();
                    resolve.accept(new JSONObject().put("snapshot", snapshot == null ? JSONObject.NULL : snapshot));
                }
                case "peekNotice" -> {
                    JSONObject notice = delivery.peekNotice();
                    resolve.accept(new JSONObject().put("notice", notice == null ? JSONObject.NULL : notice));
                }
                case "syncManual" -> {
                    String lease = options.optString("lease", "");
                    if (!lease.matches("[a-f0-9-]{36}")) {
                        reject.accept("INVALID", "Invalid digest view");
                        return;
                    }
                    delivery.syncManual(lease);
                    resolve.accept(new JSONObject());
                }
                case "setBackground" -> {
                    if (!options.has("enabled") || !(options.opt("enabled") instanceof Boolean enabled)) {
                        reject.accept("INVALID", "Choose whether to enable background delivery");
                        return;
                    }
                    String lease = options.optString("lease", "");
                    if (!lease.matches("[a-f0-9-]{36}")) {
                        reject.accept("INVALID", "Invalid digest view");
                        return;
                    }
                    delivery.setBackground(enabled, lease);
                    resolve.accept(new JSONObject());
                }
                case "enableNotifications" -> {
                    if (!AlphaAssistActivity.unlocked(context)) {
                        reject.accept("LOCKED", "Unlock Alpha to open digest notification settings");
                        return;
                    }
                    String lease = options.optString("lease", "");
                    if (!lease.matches("[a-f0-9-]{36}")) {
                        reject.accept("INVALID", "Invalid digest view");
                        return;
                    }
                    delivery.admitted(lease).check();
                    boolean granted = Build.VERSION.SDK_INT < 33
                        || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
                    Intent intent = new Intent(granted ? Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS : Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                        .putExtra(Settings.EXTRA_APP_PACKAGE, context.getPackageName())
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    if (granted) intent.putExtra(Settings.EXTRA_CHANNEL_ID, HostedDigestNotices.CHANNEL);
                    context.startActivity(intent);
                    delivery.refreshNotices();
                    resolve.accept(new JSONObject());
                }
                case "settleNotice" -> {
                    String token = options.optString("token", "");
                    if (!token.matches("[a-f0-9-]{36}")) {
                        reject.accept("INVALID", "Invalid digest notice");
                        return;
                    }
                    String lease = options.has("questionLease") && !options.isNull("questionLease")
                        ? options.optString("questionLease", null) : null;
                    if (lease != null && !lease.matches("[a-f0-9-]{36}")) {
                        reject.accept("INVALID", "Invalid digest question lease");
                        return;
                    }
                    delivery.settleNotice(token, lease);
                    resolve.accept(new JSONObject());
                }
                default -> reject.accept("UNIMPLEMENTED", "Unsupported AlphaHostedDigestDelivery method: " + method);
            }
        } catch (Exception unavailable) {
            reject.accept("UNAVAILABLE", "Hosted digest delivery is unavailable");
        }
    }

    private static void handleInboxNotices(
        Context context,
        String method,
        JSONObject options,
        Consumer<JSONObject> resolve,
        BiConsumer<String, String> reject
    ) {
        try {
            InboxNoticeDelivery inbox = InboxNoticeDelivery.get(context);
            MailHistoryReconciliation.Guard unlockedGuard = () -> {
                if (!AlphaAssistActivity.unlocked(context)) {
                    throw new SecurityException("Unlock Alpha to manage Inbox notices");
                }
            };
            switch (method) {
                case "status" -> resolve.accept(inbox.delivery.status().put("notificationsAllowed", inbox.allowed()));
                case "configure" -> {
                    unlockedGuard.check();
                    String grant = options.optString("grantId", "");
                    if (!grant.matches("[A-Za-z0-9_-]{1,256}")) {
                        reject.accept("INVALID", "An exact Gmail grant is required");
                        return;
                    }
                    long attempt = inbox.delivery.begin(grant);
                    try {
                        if (!inbox.allowed()) {
                            throw new SecurityException("Gmail notifications are disabled");
                        }
                        JSONObject status = inbox.delivery.configure(
                            attempt,
                            options.optString("credentialId", null),
                            grant,
                            options.optString("userId", null),
                            options.optString("organizationId", null),
                            unlockedGuard
                        );
                        inbox.changed();
                        resolve.accept(status);
                    } finally {
                        inbox.delivery.releaseUnadmittedAttempt(attempt);
                    }
                }
                case "withdraw" -> {
                    inbox.delivery.withdraw(options.optString("grantId", null));
                    inbox.changed();
                    resolve.accept(new JSONObject());
                }
                case "pending" -> {
                    unlockedGuard.check();
                    resolve.accept(inbox.delivery.pending(unlockedGuard));
                }
                case "consume" -> {
                    unlockedGuard.check();
                    inbox.delivery.consume(options.optString("token", null), unlockedGuard);
                    resolve.accept(new JSONObject());
                }
                case "releaseQuestion" -> {
                    unlockedGuard.check();
                    inbox.delivery.releaseQuestion(options.optString("token", null), unlockedGuard);
                    resolve.accept(new JSONObject());
                }
                case "notificationSettings" -> {
                    unlockedGuard.check();
                    boolean granted = Build.VERSION.SDK_INT < 33
                        || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
                    Intent intent = new Intent(granted ? Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS : Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                        .putExtra(Settings.EXTRA_APP_PACKAGE, context.getPackageName())
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    if (granted) intent.putExtra(Settings.EXTRA_CHANNEL_ID, InboxNoticeDelivery.CHANNEL);
                    context.startActivity(intent);
                    inbox.changed();
                    resolve.accept(new JSONObject());
                }
                default -> reject.accept("UNIMPLEMENTED", "Unsupported AlphaInboxNotices method: " + method);
            }
        } catch (Exception unavailable) {
            reject.accept("UNAVAILABLE", "Inbox notices are unavailable");
        }
    }

    private static void handleCarrierSetup(
        Context context,
        String method,
        JSONObject options,
        Consumer<JSONObject> resolve,
        BiConsumer<String, String> reject
    ) {
        if (!AlphaAssistActivity.unlocked(context)) {
            reject.accept("LOCKED", "Unlock Alpha before reading carrier setup.");
            return;
        }
        switch (method) {
            case "read" -> {
                try {
                    resolve.accept(readCarrierSetup(context));
                } catch (RuntimeException unavailable) {
                    reject.accept("UNAVAILABLE", "Carrier setup is unavailable.");
                }
            }
            case "readEid" -> {
                try {
                    EuiccManager esim = context.getSystemService(EuiccManager.class);
                    JSObject result = esim == null
                        ? AlphaCarrierSetupPlugin.field(() -> { throw new UnsupportedOperationException(); })
                        : AlphaCarrierSetupPlugin.field(esim::getEid);
                    resolve.accept(result);
                } catch (RuntimeException unavailable) {
                    reject.accept("UNAVAILABLE", "EID is unavailable.");
                }
            }
            case "openSettings" -> {
                String page = options.optString("page", "");
                String action = switch (page) {
                    case "sim" -> Build.VERSION.SDK_INT >= 31 ? Settings.ACTION_MANAGE_ALL_SIM_PROFILES_SETTINGS : Settings.ACTION_WIRELESS_SETTINGS;
                    case "apn" -> Settings.ACTION_APN_SETTINGS;
                    default -> null;
                };
                if (action == null) {
                    reject.accept("INVALID", "Unsupported carrier settings page.");
                    return;
                }
                boolean specific = !("sim".equals(page) && Build.VERSION.SDK_INT < 31);
                try {
                    try {
                        context.startActivity(new Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                    } catch (android.content.ActivityNotFoundException missing) {
                        specific = false;
                        context.startActivity(new Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                    }
                    resolve.accept(new JSONObject().put("status", "opened").put("page", page).put("specific", specific));
                } catch (JSONException | RuntimeException unavailable) {
                    reject.accept("UNAVAILABLE", "Android carrier settings are unavailable.");
                }
            }
            default -> reject.accept("UNIMPLEMENTED", "Unsupported AlphaCarrierSetup method: " + method);
        }
    }

    private static JSObject readCarrierSetup(Context context) {
        JSObject out = new JSObject();
        out.put("status", "ready");
        out.put("aospImage", AlphaImageCapability.verified(context));
        RoleManager roles = context.getSystemService(RoleManager.class);
        out.put("smsRole", AlphaCarrierSetupPlugin.field(() -> carrierRole(roles, RoleManager.ROLE_SMS)));
        out.put("dialerRole", AlphaCarrierSetupPlugin.field(() -> carrierRole(roles, RoleManager.ROLE_DIALER)));
        boolean canChooseSms = false;
        try {
            canChooseSms = AlphaImageCapability.verified(context)
                && roles != null
                && roles.isRoleAvailable(RoleManager.ROLE_SMS)
                && !roles.isRoleHeld(RoleManager.ROLE_SMS);
        } catch (RuntimeException ignored) {
        }
        out.put("canChooseSms", canChooseSms);
        JSObject hardware = new JSObject();
        hardware.put("manufacturer", AlphaCarrierSetupPlugin.field(() -> Build.MANUFACTURER));
        hardware.put("model", AlphaCarrierSetupPlugin.field(() -> Build.MODEL));
        hardware.put("device", AlphaCarrierSetupPlugin.field(() -> Build.DEVICE));
        hardware.put("android", AlphaCarrierSetupPlugin.field(() -> Build.VERSION.RELEASE));
        hardware.put("baseband", AlphaCarrierSetupPlugin.field(Build::getRadioVersion));
        out.put("hardware", hardware);
        TelephonyManager phone = context.getSystemService(TelephonyManager.class);
        JSArray slots = new JSArray();
        int count = 0;
        try {
            if (phone != null) {
                count = Build.VERSION.SDK_INT >= 30 ? phone.getSupportedModemCount() : phone.getPhoneCount();
            }
        } catch (RuntimeException ignored) {
        }
        for (int index = 0; index < Math.min(Math.max(count, 0), 8); index++) {
            final int slot = index;
            JSObject row = new JSObject();
            row.put("slotIndex", slot);
            row.put("imei", AlphaCarrierSetupPlugin.field(() -> phone.getImei(slot)));
            row.put("simState", AlphaCarrierSetupPlugin.field(() -> carrierSimState(phone.getSimState(slot))));
            slots.put(row);
        }
        out.put("slots", slots);
        boolean euicc = context.getPackageManager().hasSystemFeature(PackageManager.FEATURE_TELEPHONY_EUICC);
        JSObject eid = new JSObject();
        eid.put("status", euicc ? "not-read" : "unsupported");
        out.put("eid", eid);
        JSObject subscriptions = new JSObject();
        JSArray items = new JSArray();
        SubscriptionManager manager = context.getSystemService(SubscriptionManager.class);
        try {
            if (manager == null) {
                subscriptions.put("status", "unavailable");
            } else {
                List<SubscriptionInfo> active = manager.getActiveSubscriptionInfoList();
                subscriptions.put("status", active == null ? "unavailable" : "available");
                if (active != null) {
                    for (SubscriptionInfo sub : active) {
                        JSObject row = new JSObject();
                        int id = sub.getSubscriptionId();
                        row.put("subscriptionId", id);
                        row.put("slotIndex", sub.getSimSlotIndex());
                        row.put("embedded", sub.isEmbedded());
                        row.put("carrier", AlphaCarrierSetupPlugin.field(sub::getCarrierName));
                        row.put("name", AlphaCarrierSetupPlugin.field(sub::getDisplayName));
                        row.put("iccid", AlphaCarrierSetupPlugin.field(sub::getIccId));
                        TelephonyManager line = phone == null ? null : phone.createForSubscriptionId(id);
                        row.put("operator", line == null ? carrierUnavailable() : AlphaCarrierSetupPlugin.field(line::getNetworkOperatorName));
                        JSObject operatorCode = line == null ? carrierUnavailable() : AlphaCarrierSetupPlugin.field(line::getNetworkOperator);
                        row.put("operatorCode", operatorCode);
                        row.put("dataState", line == null ? carrierUnavailable() : AlphaCarrierSetupPlugin.field(() -> carrierDataState(line.getDataState())));
                        row.put("networkType", line == null ? carrierUnavailable() : AlphaCarrierSetupPlugin.field(() -> carrierNetworkType(line.getDataNetworkType())));
                        row.put("dataEnabled", line == null ? carrierUnavailable() : AlphaCarrierSetupPlugin.field(() -> line.isDataEnabled() ? "On" : "Off"));
                        row.put("roaming", line == null || !"available".equals(operatorCode.optString("status"))
                            ? carrierUnavailable()
                            : AlphaCarrierSetupPlugin.field(() -> line.isNetworkRoaming() ? "Roaming" : "Not roaming"));
                        row.put("defaultData", id == SubscriptionManager.getDefaultDataSubscriptionId());
                        items.put(row);
                    }
                }
            }
        } catch (SecurityException denied) {
            subscriptions.put("status", "permission-denied");
        } catch (RuntimeException unavailable) {
            subscriptions.put("status", "unavailable");
        }
        subscriptions.put("items", items);
        out.put("subscriptions", subscriptions);
        return out;
    }

    private static JSObject carrierUnavailable() {
        return AlphaCarrierSetupPlugin.field(() -> null);
    }

    private static String carrierRole(RoleManager roles, String name) {
        return roles == null || !roles.isRoleAvailable(name) ? null : roles.isRoleHeld(name) ? "held" : "not-held";
    }

    private static String carrierSimState(int state) {
        return switch (state) {
            case TelephonyManager.SIM_STATE_ABSENT -> "No SIM";
            case TelephonyManager.SIM_STATE_PIN_REQUIRED -> "SIM PIN required";
            case TelephonyManager.SIM_STATE_PUK_REQUIRED -> "SIM PUK required";
            case TelephonyManager.SIM_STATE_NETWORK_LOCKED -> "Network locked";
            case TelephonyManager.SIM_STATE_READY -> "Ready";
            case TelephonyManager.SIM_STATE_NOT_READY -> "Not ready";
            case TelephonyManager.SIM_STATE_PERM_DISABLED -> "Permanently disabled";
            case TelephonyManager.SIM_STATE_CARD_IO_ERROR -> "SIM read error";
            case TelephonyManager.SIM_STATE_CARD_RESTRICTED -> "SIM restricted";
            default -> null;
        };
    }

    private static String carrierDataState(int state) {
        return switch (state) {
            case TelephonyManager.DATA_DISCONNECTED -> "Disconnected";
            case TelephonyManager.DATA_CONNECTING -> "Connecting";
            case TelephonyManager.DATA_CONNECTED -> "Connected";
            case TelephonyManager.DATA_SUSPENDED -> "Suspended";
            default -> null;
        };
    }

    private static String carrierNetworkType(int type) {
        return switch (type) {
            case TelephonyManager.NETWORK_TYPE_NR -> "5G NR";
            case TelephonyManager.NETWORK_TYPE_LTE -> "LTE";
            case TelephonyManager.NETWORK_TYPE_HSPAP -> "HSPA+";
            case TelephonyManager.NETWORK_TYPE_HSPA -> "HSPA";
            case TelephonyManager.NETWORK_TYPE_HSDPA -> "HSDPA";
            case TelephonyManager.NETWORK_TYPE_HSUPA -> "HSUPA";
            case TelephonyManager.NETWORK_TYPE_UMTS -> "UMTS";
            case TelephonyManager.NETWORK_TYPE_EDGE -> "EDGE";
            case TelephonyManager.NETWORK_TYPE_GPRS -> "GPRS";
            case TelephonyManager.NETWORK_TYPE_GSM -> "GSM";
            case TelephonyManager.NETWORK_TYPE_CDMA -> "CDMA";
            case TelephonyManager.NETWORK_TYPE_IWLAN -> "IWLAN";
            case TelephonyManager.NETWORK_TYPE_UNKNOWN -> null;
            default -> "Android network type " + type;
        };
    }

    private static JSONObject roleEntry(RoleManager manager, String name, String androidRole) throws JSONException {
        boolean available = manager != null && manager.isRoleAvailable(androidRole);
        boolean held = available && manager.isRoleHeld(androidRole);
        return new JSONObject()
            .put("role", name)
            .put("available", available)
            .put("held", held)
            .put("holders", new JSONArray());
    }

    private static JSONObject volumeRow(String stream, AudioManager audio, int androidStream) throws JSONException {
        return new JSONObject()
            .put("stream", stream)
            .put("current", audio.getStreamVolume(androidStream))
            .put("max", audio.getStreamMaxVolume(androidStream));
    }

    private static JSObject buildDiagnosticsFacts(Context context) {
        JSObject out = new JSObject();
        out.put("appVersion", BuildConfig.VERSION_NAME);
        out.put("versionCode", BuildConfig.VERSION_CODE);
        out.put("variant", "core");
        out.put("buildType", BuildConfig.BUILD_TYPE);
        out.put("testMocks", false);
        out.put("sdkInt", Build.VERSION.SDK_INT);
        out.put("androidRelease", Build.VERSION.RELEASE);
        out.put("securityPatch", Build.VERSION.SECURITY_PATCH);
        JSObject hashes = new JSObject();
        for (String asset : new String[] {
            "agent/alpha-source.json",
            "agent/agent-bundle.js",
            "agent/inventory.json",
            "agent/agent.mjs",
            "agent/workflow-worker/manifest.json",
            "agent/workflow-worker/files.sha256"
        }) {
            String hash = assetSha256(context, asset);
            if (hash != null) hashes.put(asset, hash);
        }
        out.put("runtimeHashes", hashes);
        try (InputStream in = context.getAssets().open("agent/alpha-source.json")) {
            String base = new JSONObject(new String(AlphaUtil.readBounded(in, 64 * 1024, null), StandardCharsets.UTF_8))
                .optString("base", "");
            if (base.matches("[0-9a-f]{40}")) out.put("upstreamPin", base);
        } catch (Exception ignored) {
        }
        return out;
    }

    private static JSObject buildSettingsFacts(Context context) {
        JSObject out = new JSObject();
        out.put("androidRelease", Build.VERSION.RELEASE);
        out.put("startupPermissionDefaults", AlphaImageCapabilities.startupPermissionDefaults(context));
        try {
            int boot = Settings.Global.getInt(context.getContentResolver(), Settings.Global.BOOT_COUNT, -1);
            if (boot >= 0) out.put("bootCount", boot);
        } catch (RuntimeException ignored) {
        }
        AlphaDevicePlugin.putSettingsGrants(context, out);
        return out;
    }

    private static JSObject buildDeviceSnapshot(Context context) {
        JSObject out = new JSObject();
        for (Map.Entry<String, Object> fact : SystemFacts.read(context).entrySet()) {
            out.put(fact.getKey(), fact.getValue());
        }
        out.put("model", Build.MODEL);
        out.put("manufacturer", Build.MANUFACTURER);
        out.put("androidRelease", Build.VERSION.RELEASE);
        out.put("securityPatch", Build.VERSION.SECURITY_PATCH);
        out.put("build", Build.DISPLAY);
        out.put("appVersion", BuildConfig.VERSION_NAME);
        out.put("readAt", System.currentTimeMillis());
        int scale = AlphaDevicePlugin.textScalePercent(context);
        out.put("textScalePercent", scale);
        out.put("effectiveTextZoom", AlphaDevicePlugin.effectiveTextZoom(context, scale));
        NotificationManager notifications = context.getSystemService(NotificationManager.class);
        out.put("notificationsEnabled", notifications != null && notifications.areNotificationsEnabled());
        AlphaDevicePlugin.putSettingsGrants(context, out);
        out.put("passwordProvider", PasswordProviderSupport.status(context));
        AlphaDevicePlugin.appFacts(context, out);
        return out;
    }

    private static String assetSha256(Context context, String asset) {
        try (InputStream in = context.getAssets().open(asset)) {
            return AlphaUtil.sha256Hex(in);
        } catch (Exception absent) {
            return null;
        }
    }

    private static boolean performHapticFallback(Context context) {
        try {
            Vibrator vibrator = context.getSystemService(Vibrator.class);
            if (vibrator == null || !vibrator.hasVibrator()) return false;
            vibrator.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_CLICK));
            return true;
        } catch (RuntimeException unavailable) {
            return false;
        }
    }

    private static String resolveAppLinkHost(Context context) {
        try (InputStream in = context.getAssets().open(CAPACITOR_CONFIG)) {
            byte[] bytes = AlphaUtil.readBounded(in, 256 * 1024, null);
            JSONObject root = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
            JSONObject plugins = root.optJSONObject("plugins");
            JSONObject signIn = plugins == null ? null : plugins.optJSONObject("ElizaSignIn");
            JSONObject envs = signIn == null ? null : signIn.optJSONObject("environments");
            JSONObject prod = envs == null ? null : envs.optJSONObject("production");
            String host = prod == null ? null : prod.optString("appLinkHost", "");
            if (host != null && !host.isBlank()) return host;
        } catch (Exception ignored) {
        }
        try {
            String host = Uri.parse(BuildConfig.CLOUD_API_ORIGIN).getHost();
            return host == null ? "" : host;
        } catch (RuntimeException ignored) {
            return "";
        }
    }

    private static AlphaSuitePolicy.AppRule resolveRule(AlphaSuitePolicy policy, String key) {
        AlphaSuitePolicy.AppRule byPkg = policy.ruleForPackage(key);
        if (byPkg != null) return byPkg;
        AlphaSuitePolicy.AppRule byView = policy.ruleForView(key);
        if (byView != null) return byView;
        return policy.ruleForId(key.toLowerCase(java.util.Locale.ROOT));
    }

    private static String interruptionWord(int filter) {
        return switch (filter) {
            case NotificationManager.INTERRUPTION_FILTER_ALL -> "all";
            case NotificationManager.INTERRUPTION_FILTER_PRIORITY -> "priority";
            case NotificationManager.INTERRUPTION_FILTER_ALARMS -> "alarms";
            case NotificationManager.INTERRUPTION_FILTER_NONE -> "none";
            default -> "unknown";
        };
    }

    private static JSONObject encodeExchangeOutcome(ExchangeOutcome outcome) {
        return switch (outcome) {
            case Written, Removed -> {
                try {
                    yield new JSONObject().put("ok", true).put("outcome", outcome.name());
                } catch (JSONException impossible) {
                    throw new IllegalStateException(impossible);
                }
            }
            case Conflict -> secureStoreError("conflict", outcome);
            case CapacityRefused -> secureStoreError("storage_full", outcome);
            case Refused -> secureStoreError(AlphaIpcContract.SECURE_DENIED, outcome);
            case Failed -> secureStoreError("native_error", outcome);
            case Unconfirmed -> secureStoreError("unconfirmed", outcome);
        };
    }

    private static JSONObject secureStoreError(String code, ExchangeOutcome outcome) {
        JSONObject out = new JSONObject();
        try {
            out.put("ok", false).put("error", code);
            if (outcome != null) out.put("outcome", outcome.name());
        } catch (JSONException impossible) {
            throw new IllegalStateException(impossible);
        }
        return out;
    }

    private static JSONObject jsonPair(String key, Object value) {
        JSONObject out = new JSONObject();
        try {
            out.put(key, value);
        } catch (JSONException ignored) {
        }
        return out;
    }
}
