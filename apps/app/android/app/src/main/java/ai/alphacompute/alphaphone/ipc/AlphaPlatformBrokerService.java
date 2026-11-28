package ai.alphacompute.alphaphone.ipc;

import ai.alphacompute.alphaphone.AlphaCorePluginDispatch;
import ai.alphacompute.alphaphone.AlphaCoreSignInHost;
import ai.alphacompute.alphaphone.AlphaCoreSpeechHost;
import ai.alphacompute.alphaphone.BillingReturn;
import ai.alphacompute.alphaphone.BuildConfig;
import ai.alphacompute.ipc.AlphaIpcContract;
import ai.alphacompute.ipc.AlphaSuitePolicy;
import ai.alphacompute.ipc.IAlphaCloudCallback;
import ai.alphacompute.ipc.IAlphaEventCallback;
import ai.alphacompute.ipc.IAlphaPlatformBroker;
import ai.alphacompute.ipc.PfdStreams;
import ai.eliza.os.agent.AgentService;
import ai.eliza.plugins.securestore.nativeonly.SecureSlotPolicy.Caller;
import ai.eliza.plugins.securestore.nativeonly.SecureSlotPolicy.ExchangeOutcome;
import ai.eliza.plugins.securestore.nativeonly.SecureSlots;
import ai.eliza.plugins.signin.CloudRequestPolicy;
import ai.eliza.plugins.signin.CloudRequests;
import ai.eliza.plugins.signin.DeviceCustody;
import ai.eliza.plugins.signin.LargeBodyGrant;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Binder;
import android.os.Build;
import android.os.IBinder;
import android.os.ParcelFileDescriptor;
import android.os.RemoteCallbackList;
import android.os.RemoteException;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Signature-protected Binder broker anchoring Cloud custody, Sign-In state, SecureStore slots, and Google consent in AlphaCore. */
public final class AlphaPlatformBrokerService extends Service {
    private static final String CAPACITOR_CONFIG = "capacitor.config.json";
    private static final String AGENT_CONSENT_STORE = "alpha-agent";
    private static final String CONSENT_GMAIL = "google-gmail-changes";
    private static final String CONSENT_CALENDAR = "google-calendar-edits";
    private static final int MAX_CLOUD_REPLY_BYTES = 64 * 1024 * 1024;
    private static final long CORE_SPEECH_TIMEOUT_MS = 15_000L;
    private static final Object CONSENT_LOCK = new Object();

    private volatile AlphaSuitePolicy policy = AlphaSuitePolicy.defaults();
    private final ExecutorService workers = Executors.newFixedThreadPool(4, task -> {
        Thread thread = new Thread(task, "AlphaPlatformBroker");
        thread.setDaemon(true);
        return thread;
    });
    private final RemoteCallbackList<IAlphaEventCallback> signInObservers = new RemoteCallbackList<>();
    private final AtomicLong signInEventSeq = new AtomicLong();
    private final AtomicReference<SpeechCapture> activeSpeechCapture = new AtomicReference<>();

    private LargeBodyGrant grants;
    private CloudRequests cloudRequests;
    private AlphaCoreSpeechHost speechHost;
    private AutoCloseable signInSubscription;
    private AutoCloseable signInHostSubscription;
    private AutoCloseable billingReturnSubscription;
    private AutoCloseable localLlmProgressSubscription;

    private static final class SpeechCapture {
        final List<JSONObject> events = new CopyOnWriteArrayList<>();
        final AtomicBoolean playbackStopped = new AtomicBoolean(false);
    }

    private final IAlphaPlatformBroker.Stub binder = new IAlphaPlatformBroker.Stub() {
        @Override public void cloudRequest(
            String callId,
            String method,
            String path,
            String queryJson,
            String headersJson,
            byte[] inlineBody,
            ParcelFileDescriptor bodyFd,
            String expectedCredentialId,
            String expectedSessionCredentialId,
            IAlphaCloudCallback cb
        ) {
            if (cb == null) {
                closeQuietly(bodyFd);
                return;
            }
            String callingPkg = verifyPackageOrNull();
            if (callingPkg == null) {
                closeQuietly(bodyFd);
                notifyCloudError(cb, callId, AlphaIpcContract.CLOUD_NOT_LISTED, "Caller signature rejected");
                return;
            }
            if (!policy.isCloudRouteAllowed(callingPkg, path)) {
                closeQuietly(bodyFd);
                notifyCloudError(cb, callId, AlphaIpcContract.CLOUD_NOT_LISTED, "Cloud route not permitted for " + callingPkg);
                return;
            }
            if (cloudRequests == null) {
                closeQuietly(bodyFd);
                notifyCloudError(cb, callId, AlphaIpcContract.CLOUD_NOT_CONFIGURED, "Cloud policy not loaded");
                return;
            }
            String target = buildTarget(path, queryJson);
            if (target == null || method == null || method.isBlank()) {
                closeQuietly(bodyFd);
                notifyCloudError(cb, callId, AlphaIpcContract.CLOUD_INVALID_REQUEST, "Invalid cloud request");
                return;
            }
            if (path.startsWith("/api/v1/subscriptions/checkout") || path.startsWith("/api/v1/subscriptions/portal")) {
                BillingReturn.recordCheckoutCaller(callingPkg);
            }
            Map<String, String> headers = parseStringMap(headersJson);
            boolean billingSession = expectedSessionCredentialId != null && !expectedSessionCredentialId.isBlank();
            String bindingId = billingSession ? expectedSessionCredentialId : expectedCredentialId;
            try {
                workers.execute(() -> executeCloud(callId, method, target, headers, inlineBody, bodyFd, bindingId, billingSession, cb));
            } catch (RejectedExecutionException shuttingDown) {
                closeQuietly(bodyFd);
                notifyCloudError(cb, callId, "network", "Broker shutting down");
            }
        }

        @Override public String signInCall(String method, String argsJson) {
            String callingPkg = requireAuthorizedPackage();
            if (!policy.isSignInMethodAllowed(callingPkg, method)) {
                return signInError("Rejected", "Sign-in method not permitted for " + callingPkg);
            }
            return handleSignInMethod(callingPkg, method, argsJson);
        }

        @Override public String secureStoreCall(String op, String key, String expected, String value) {
            String callingPkg = requireAuthorizedPackage();
            if ("status".equals(op)) {
                return handleSecureStoreStatus();
            }
            if (!policy.isSecureStoreSlotAllowed(callingPkg, key)) {
                return secureStoreFailure(AlphaIpcContract.SECURE_DENIED, null);
            }
            return handleSecureStoreOp(op, key, expected, value);
        }

        @Override public boolean setAgentGoogleConsent(boolean gmailChanges, boolean calendarEdits) {
            String callingPkg = requireAuthorizedPackage();
            if (!policy.isGoogleConsentAllowed(callingPkg)) {
                throw new SecurityException("Google consent change not permitted for " + callingPkg);
            }
            return keepGoogleConsent(gmailChanges, calendarEdits);
        }

        @Override public String diagnosticsFactsJson() {
            requireAuthorizedPackage();
            JSONObject facts = new JSONObject();
            try {
                facts.put("appVersion", BuildConfig.VERSION_NAME)
                    .put("versionCode", BuildConfig.VERSION_CODE)
                    .put("variant", "core")
                    .put("buildType", BuildConfig.BUILD_TYPE)
                    .put("testMocks", false)
                    .put("sdkInt", Build.VERSION.SDK_INT)
                    .put("androidRelease", Build.VERSION.RELEASE)
                    .put("securityPatch", Build.VERSION.SECURITY_PATCH);
            } catch (JSONException impossible) {
                throw new IllegalStateException(impossible);
            }
            return facts.toString();
        }

        @Override public String corePluginCall(String pluginName, String method, String argsJson) {
            String callingPkg = requireAuthorizedPackage();
            if (pluginName == null || pluginName.isBlank() || method == null || method.isBlank()) {
                return pluginErrorEnvelope("INVALID", "Plugin name and method are required");
            }
            if ("AlphaDevice".equals(pluginName) && "setAgentGoogleConsent".equals(method)
                && !policy.isGoogleConsentAllowed(callingPkg)) {
                return pluginErrorEnvelope("UNAUTHORIZED", "Google consent change not permitted for " + callingPkg);
            }
            if ("AlphaVoiceCloud".equals(pluginName) || "ElizaCloudSpeech".equals(pluginName)) {
                return invokeSpeechPluginSync(pluginName, method, argsJson);
            }
            return AlphaCorePluginDispatch.invokeSyncJson(AlphaPlatformBrokerService.this, policy, pluginName, method, argsJson);
        }

        @Override public void registerSignInObserver(IAlphaEventCallback cb) {
            requireAuthorizedPackage();
            if (cb != null) {
                signInObservers.register(cb);
            }
        }

        @Override public void unregisterSignInObserver(IAlphaEventCallback cb) {
            requireAuthorizedPackage();
            if (cb != null) {
                signInObservers.unregister(cb);
            }
        }

        @Override public boolean launchSiblingApp(String targetPackage, String uri, String extrasJson) {
            requireAuthorizedPackage();
            return AlphaCorePluginDispatch.launchSiblingApp(
                AlphaPlatformBrokerService.this,
                policy,
                targetPackage,
                uri,
                extrasJson
            );
        }

        @Override public boolean openAlphaOverlay(String entrySource, String initialQuery, boolean startVoice) {
            requireAuthorizedPackage();
            return AlphaCorePluginDispatch.openAlphaOverlay(
                AlphaPlatformBrokerService.this,
                entrySource,
                initialQuery,
                startVoice
            );
        }
    };

    @Override public void onCreate() {
        super.onCreate();
        policy = AlphaSuitePolicyLoader.load(this);
        grants = new LargeBodyGrant(getCacheDir());
        CloudRequestPolicy cloudPolicy = new CloudRequestPolicy(loadCloudRoutesJson());
        if (cloudPolicy.loaded()) {
            cloudRequests = new CloudRequests(cloudPolicy, grants);
        }
        signInSubscription = AlphaCorePluginDispatch.observeSignIn(this, this::broadcastSignInSettled);
        signInHostSubscription = AlphaCoreSignInHost.shared(this).subscribe(this::broadcastSignInEvent);
        billingReturnSubscription = BillingReturn.subscribe(this::broadcastBillingReturn);
        localLlmProgressSubscription = AlphaCorePluginDispatch.subscribeLocalLlmProgress(
            progress -> broadcastSignInEvent("downloadProgress", progress)
        );
    }

    @Override public IBinder onBind(Intent intent) {
        return binder;
    }

    @Override public void onDestroy() {
        closeAutoQuietly(signInSubscription);
        signInSubscription = null;
        closeAutoQuietly(signInHostSubscription);
        signInHostSubscription = null;
        closeAutoQuietly(billingReturnSubscription);
        billingReturnSubscription = null;
        closeAutoQuietly(localLlmProgressSubscription);
        localLlmProgressSubscription = null;
        signInObservers.kill();
        if (speechHost != null) {
            speechHost.close();
            speechHost = null;
        }
        workers.shutdownNow();
        if (grants != null) grants.clear();
        super.onDestroy();
    }

    private void executeCloud(
        String callId,
        String method,
        String target,
        Map<String, String> headers,
        byte[] inlineBody,
        ParcelFileDescriptor bodyFd,
        String expectedCredentialId,
        boolean billingSession,
        IAlphaCloudCallback cb
    ) {
        byte[] requestBytes;
        try {
            requestBytes = PfdStreams.unpack(inlineBody, bodyFd, AlphaIpcContract.MAX_PFD_BODY_BYTES);
        } catch (IOException failed) {
            String code = failed instanceof PfdStreams.PayloadTooLargeException ? "body-too-large" : "network";
            notifyCloudError(cb, callId, code, failed.getMessage());
            return;
        }
        String origin = BuildConfig.CLOUD_API_ORIGIN;
        CloudRequests.Outcome outcome = cloudRequests.send(
            callId,
            origin,
            DeviceCustody.cloud(this, origin),
            method.toUpperCase(Locale.ROOT),
            target,
            headers,
            requestBytes,
            expectedCredentialId,
            billingSession
        );
        if (outcome instanceof CloudRequests.Failed failed) {
            String wire = failed.failure().name().toLowerCase(Locale.ROOT).replace('_', '-');
            notifyCloudError(cb, callId, wire, wire);
            return;
        }
        CloudRequests.Answered answered = (CloudRequests.Answered) outcome;
        byte[] replyBytes;
        try {
            replyBytes = readReplyBytes(answered);
        } catch (IOException failed) {
            notifyCloudError(cb, callId, "reply-too-large", failed.getMessage());
            return;
        }
        String replyHeadersJson = encodeCloudHeaders(answered);
        try (PfdStreams.Payload packed = PfdStreams.pack(replyBytes, MAX_CLOUD_REPLY_BYTES)) {
            cb.onResponse(callId, answered.status(), replyHeadersJson, packed.inlineBody(), packed.bodyFd());
        } catch (IOException | RemoteException failed) {
            notifyCloudError(cb, callId, "network", failed.getMessage());
        }
    }

    private byte[] readReplyBytes(CloudRequests.Answered answered) throws IOException {
        LargeBodyGrant.Grant grant = answered.grant();
        if (grant == null) {
            return answered.body() == null ? new byte[0] : answered.body();
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream((int) Math.min(grant.size(), 1024 * 1024));
        while (true) {
            LargeBodyGrant.Chunk chunk = grants.read(grant.id());
            if (chunk == null) throw new IOException("Cloud reply grant missing");
            out.write(chunk.data());
            if (out.size() > MAX_CLOUD_REPLY_BYTES) throw new IOException("Cloud reply exceeds limit");
            if (chunk.done()) break;
        }
        return out.toByteArray();
    }

    private String handleSignInMethod(String callingPkg, String method, String argsJson) {
        return AlphaCoreSignInHost.shared(this).invokeSync(callingPkg, method, argsJson);
    }

    private synchronized AlphaCoreSpeechHost ensureSpeechHost() {
        if (speechHost == null) {
            speechHost = new AlphaCoreSpeechHost(this, this::handleSpeechEvent);
        }
        return speechHost;
    }

    private void handleSpeechEvent(String pluginName, String eventName, JSONObject data) {
        String name = eventName == null ? "" : eventName;
        JSONObject payload = data == null ? new JSONObject() : data;
        SpeechCapture capture = activeSpeechCapture.get();
        if (capture != null && !name.isEmpty()) {
            try {
                capture.events.add(new JSONObject().put("name", name).put("payload", payload));
            } catch (JSONException ignored) {
            }
            if ("playbackStopped".equals(name) || "playbackEnded".equals(name) || "playbackFailed".equals(name)) {
                capture.playbackStopped.set(true);
            }
        }
        if (!name.isEmpty()) {
            broadcastSignInEvent(name, payload);
            try {
                broadcastSignInEvent(
                    "speechEvent",
                    new JSONObject()
                        .put("plugin", pluginName == null ? "AlphaVoiceCloud" : pluginName)
                        .put("name", name)
                        .put("payload", payload)
                );
            } catch (JSONException ignored) {
            }
        }
    }

    private String invokeSpeechPluginSync(String pluginName, String method, String argsJson) {
        JSONObject options;
        try {
            options = argsJson == null || argsJson.isBlank() ? new JSONObject() : new JSONObject(argsJson);
        } catch (JSONException malformed) {
            options = new JSONObject();
        }
        SpeechCapture capture = new SpeechCapture();
        SpeechCapture previous = activeSpeechCapture.getAndSet(capture);
        CompletableFuture<String> pending = new CompletableFuture<>();
        try {
            ensureSpeechHost().dispatch(
                pluginName,
                method,
                "broker-" + System.nanoTime(),
                options,
                data -> {
                    JSONObject out = new JSONObject();
                    try {
                        out.put("ok", true).put("result", data == null ? new JSONObject() : data);
                        if (!capture.events.isEmpty()) {
                            JSONArray captured = new JSONArray();
                            for (JSONObject item : new ArrayList<>(capture.events)) {
                                captured.put(item);
                            }
                            out.put("events", captured);
                        }
                        if (capture.playbackStopped.get()) {
                            out.put("playbackStopped", true);
                        }
                    } catch (JSONException ignored) {
                    }
                    pending.complete(out.toString());
                },
                (code, message) -> pending.complete(pluginErrorEnvelope(code, message))
            );
            return pending.get(CORE_SPEECH_TIMEOUT_MS, TimeUnit.MILLISECONDS);
        } catch (Exception timedOut) {
            return pluginErrorEnvelope("TIMEOUT", "Core speech request timed out");
        } finally {
            activeSpeechCapture.compareAndSet(capture, previous);
        }
    }

    private void broadcastSignInSettled(JSONObject receipt) {
        broadcastSignInEvent("signInSettled", receipt);
    }

    private void broadcastBillingReturn(String sessionId) {
        JSONObject payload = new JSONObject();
        try {
            payload.put("session", sessionId == null ? JSONObject.NULL : sessionId);
        } catch (JSONException ignored) {
        }
        broadcastSignInEvent("billingReturned", payload);
    }

    private void broadcastSignInEvent(String eventName, JSONObject data) {
        long seq = signInEventSeq.incrementAndGet();
        String name = eventName == null || eventName.isBlank() ? "signInSettled" : eventName;
        String payload = data == null ? "{}" : data.toString();
        int count = signInObservers.beginBroadcast();
        try {
            for (int index = 0; index < count; index++) {
                try {
                    signInObservers.getBroadcastItem(index).onEvent(name, seq, payload);
                } catch (RemoteException ignored) {
                }
            }
        } finally {
            signInObservers.finishBroadcast();
        }
    }

    private static void closeAutoQuietly(AutoCloseable closeable) {
        if (closeable != null) {
            try {
                closeable.close();
            } catch (Exception ignored) {
            }
        }
    }

    private static String pluginErrorEnvelope(String code, String message) {
        JSONObject out = new JSONObject();
        try {
            out.put("ok", false)
                .put("error", code == null ? "ERROR" : code)
                .put("message", message == null ? "Plugin call failed" : message);
        } catch (JSONException ignored) {
        }
        return out.toString();
    }

    private String handleSecureStoreStatus() {
        JSONObject out = new JSONObject();
        try {
            SecureSlots slots = SecureSlots.forHost(this);
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
        return out.toString();
    }

    private String handleSecureStoreOp(String op, String key, String expected, String value) {
        SecureSlots slots;
        try {
            slots = SecureSlots.forHost(this);
        } catch (Exception unavailable) {
            return secureStoreFailure(AlphaIpcContract.SECURE_UNAVAILABLE, null);
        }
        if ("get".equals(op)) {
            SecureSlots.Reading reading = slots.read(Caller.RendererCaller, key);
            if (reading instanceof SecureSlots.Present present) {
                try {
                    return new JSONObject().put("ok", true).put("value", present.value()).toString();
                } catch (JSONException impossible) {
                    throw new IllegalStateException(impossible);
                }
            }
            if (reading instanceof SecureSlots.Absent) return secureStoreFailure("not_found", null);
            if (reading instanceof SecureSlots.Unreadable) return secureStoreFailure("unreadable", null);
            return secureStoreFailure(AlphaIpcContract.SECURE_DENIED, null);
        }
        ExchangeOutcome outcome = switch (op == null ? "" : op) {
            case "set" -> slots.write(Caller.RendererCaller, key, value == null ? "" : value);
            case "remove" -> slots.remove(Caller.RendererCaller, key);
            case "compareAndExchange" -> slots.compareAndExchange(Caller.RendererCaller, key, expected, value);
            default -> ExchangeOutcome.Refused;
        };
        return encodeExchangeOutcome(outcome);
    }

    private boolean keepGoogleConsent(boolean gmailChanges, boolean calendarEdits) {
        synchronized (CONSENT_LOCK) {
            SharedPreferences prefs = getSharedPreferences(AGENT_CONSENT_STORE, Context.MODE_PRIVATE);
            boolean hadPrevious = prefs.contains(CONSENT_GMAIL) && prefs.contains(CONSENT_CALENDAR);
            boolean prevGmail = prefs.getBoolean(CONSENT_GMAIL, false);
            boolean prevCalendar = prefs.getBoolean(CONSENT_CALENDAR, false);
            if (hadPrevious && prevGmail == gmailChanges && prevCalendar == calendarEdits) {
                return true;
            }
            if (!prefs.edit().putBoolean(CONSENT_GMAIL, gmailChanges).putBoolean(CONSENT_CALENDAR, calendarEdits).commit()) {
                return false;
            }
            String state = AgentService.status(this).optString("state");
            if (!"running".equals(state) && !"starting".equals(state)) {
                return true;
            }
            try {
                AgentService.restart(this);
                return true;
            } catch (IllegalStateException refused) {
                SharedPreferences.Editor revert = prefs.edit();
                if (hadPrevious) {
                    revert.putBoolean(CONSENT_GMAIL, prevGmail).putBoolean(CONSENT_CALENDAR, prevCalendar);
                } else {
                    revert.remove(CONSENT_GMAIL).remove(CONSENT_CALENDAR);
                }
                revert.commit();
                return false;
            }
        }
    }

    private String loadCloudRoutesJson() {
        try (InputStream in = getAssets().open(CAPACITOR_CONFIG)) {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[4096];
            for (int n; (n = in.read(chunk)) != -1; ) {
                buffer.write(chunk, 0, n);
            }
            JSONObject root = new JSONObject(buffer.toString(StandardCharsets.UTF_8.name()));
            JSONObject plugins = root.optJSONObject("plugins");
            JSONObject cloud = plugins == null ? null : plugins.optJSONObject("ElizaCloud");
            JSONArray routes = cloud == null ? null : cloud.optJSONArray("routes");
            return routes == null ? null : routes.toString();
        } catch (IOException | JSONException unavailable) {
            return null;
        }
    }

    private String verifyPackageOrNull() {
        return AlphaIpcContract.verifySameSignaturePackage(this, Binder.getCallingUid(), policy);
    }

    private String requireAuthorizedPackage() {
        String pkg = verifyPackageOrNull();
        if (pkg == null) {
            throw new SecurityException("Unauthorized IPC caller UID " + Binder.getCallingUid());
        }
        return pkg;
    }

    private static String buildTarget(String path, String queryJson) {
        if (path == null || !path.startsWith("/") || path.contains("?") || path.contains("#")) return null;
        if (queryJson == null || queryJson.isBlank() || "{}".equals(queryJson.trim())) return path;
        try {
            JSONObject query = new JSONObject(queryJson);
            StringBuilder builder = new StringBuilder(path);
            char separator = '?';
            for (Iterator<String> keys = query.keys(); keys.hasNext(); ) {
                String key = keys.next();
                String val = query.optString(key, "");
                builder.append(separator)
                    .append(URLEncoder.encode(key, StandardCharsets.UTF_8))
                    .append('=')
                    .append(URLEncoder.encode(val, StandardCharsets.UTF_8));
                separator = '&';
            }
            return builder.toString();
        } catch (JSONException malformed) {
            return null;
        }
    }

    private static Map<String, String> parseStringMap(String json) {
        Map<String, String> map = new LinkedHashMap<>();
        if (json == null || json.isBlank()) return map;
        try {
            JSONObject obj = new JSONObject(json);
            for (Iterator<String> keys = obj.keys(); keys.hasNext(); ) {
                String key = keys.next();
                Object value = obj.opt(key);
                if (value instanceof String text) {
                    map.put(key, text);
                }
            }
        } catch (JSONException ignored) {
        }
        return map;
    }

    private static String encodeCloudHeaders(CloudRequests.Answered answered) {
        JSONObject headers = new JSONObject();
        try {
            if (answered.etag() != null) headers.put("etag", answered.etag());
            if (answered.contentType() != null) headers.put("contentType", answered.contentType());
            if (answered.retryAfter() != null) headers.put("retryAfter", answered.retryAfter());
        } catch (JSONException impossible) {
            throw new IllegalStateException(impossible);
        }
        return headers.toString();
    }

    private static String encodeExchangeOutcome(ExchangeOutcome outcome) {
        return switch (outcome) {
            case Written, Removed -> {
                try {
                    yield new JSONObject().put("ok", true).put("outcome", outcome.name()).toString();
                } catch (JSONException impossible) {
                    throw new IllegalStateException(impossible);
                }
            }
            case Conflict -> secureStoreFailure("conflict", outcome);
            case CapacityRefused -> secureStoreFailure("storage_full", outcome);
            case Refused -> secureStoreFailure(AlphaIpcContract.SECURE_DENIED, outcome);
            case Failed -> secureStoreFailure("native_error", outcome);
            case Unconfirmed -> secureStoreFailure("unconfirmed", outcome);
        };
    }

    private static String secureStoreFailure(String code, ExchangeOutcome outcome) {
        JSONObject out = new JSONObject();
        try {
            out.put("ok", false).put("error", code);
            if (outcome != null) out.put("outcome", outcome.name());
        } catch (JSONException impossible) {
            throw new IllegalStateException(impossible);
        }
        return out.toString();
    }

    private static String signInError(String code, String message) {
        JSONObject out = new JSONObject();
        try {
            out.put("ok", false).put("error", code).put("message", message);
        } catch (JSONException impossible) {
            throw new IllegalStateException(impossible);
        }
        return out.toString();
    }

    private static void notifyCloudError(IAlphaCloudCallback cb, String callId, String code, String message) {
        try {
            cb.onError(callId, code, message == null ? code : message);
        } catch (RemoteException ignored) {
        }
    }

    private static void closeQuietly(ParcelFileDescriptor fd) {
        if (fd != null) {
            try {
                fd.close();
            } catch (IOException ignored) {
            }
        }
    }
}
