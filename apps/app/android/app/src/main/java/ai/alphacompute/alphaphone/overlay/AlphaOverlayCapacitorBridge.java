package ai.alphacompute.alphaphone.overlay;

import ai.alphacompute.alphaphone.AlphaCorePluginDispatch;
import ai.alphacompute.alphaphone.AlphaCoreSignInHost;
import ai.alphacompute.alphaphone.AlphaCoreSpeechHost;
import ai.alphacompute.alphaphone.BillingReturn;
import ai.alphacompute.alphaphone.BuildConfig;
import ai.alphacompute.alphaphone.ipc.AlphaContextRegistryService;
import ai.alphacompute.alphaphone.ipc.AlphaPreferencesProvider;
import ai.alphacompute.alphaphone.ipc.AlphaSuitePolicyLoader;
import ai.alphacompute.ipc.AlphaIpcContract;
import ai.alphacompute.ipc.AlphaSuitePolicy;
import ai.eliza.os.agent.AgentChannel;
import ai.eliza.os.agent.AgentService;
import ai.eliza.os.agent.ChannelPolicy.FailCode;
import ai.eliza.os.agent.ChannelPolicy.Outcome;
import ai.eliza.os.agent.ChannelPolicy.Topic;
import ai.eliza.plugins.signin.CloudRequestPolicy;
import ai.eliza.plugins.signin.CloudRequests;
import ai.eliza.plugins.signin.DeviceCustody;
import ai.eliza.plugins.signin.LargeBodyGrant;
import android.content.Context;
import android.database.ContentObserver;
import android.graphics.Rect;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.Log;
import android.webkit.WebView;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.function.Consumer;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

/**
 * Origin-restricted Capacitor-compatible JS-to-Native bridge for the {@link AlphaVoiceInteractionSession}
 * WebView, exposing {@code ElizaAgent}, {@code ElizaCloud}, {@code ElizaSignIn}, {@code AlphaPreferences},
 * {@code AlphaContext}, and {@code AlphaOverlayHost} directly in-process over {@link AgentService#channel()}.
 */
final class AlphaOverlayCapacitorBridge implements AutoCloseable {
    private static final String TAG = "AlphaOverlayCapBridge";
    private static final String CHANNEL_NAME = "alphaOverlayCap";
    private static final String CAPACITOR_CONFIG = "capacitor.config.json";
    private static final int MAX_MESSAGE_CHARS = 2 * 1024 * 1024;

    private final Context appContext;
    private final String overlayOrigin;
    private final String assetDomain;
    private final String owner = "overlay-" + UUID.randomUUID();
    private final Consumer<String> scriptSink;
    private final LargeBodyGrant grants;
    private final CloudRequests cloudRequests;
    private final AlphaSuitePolicy suitePolicy;
    private final AlphaCoreSpeechHost speechHost;
    private final ExecutorService workers = Executors.newFixedThreadPool(4, task -> {
        Thread thread = new Thread(task, "AlphaOverlayCapIo");
        thread.setDaemon(true);
        return thread;
    });
    private final AutoCloseable statusObserver;
    private final AutoCloseable signInObserver;
    private final AutoCloseable signInHostObserver;
    private final AutoCloseable billingReturnObserver;
    private final AutoCloseable localLlmProgressObserver;
    private final AutoCloseable callStateWatch;
    private final ContentObserver preferencesObserver;
    private volatile boolean closed;

    private AlphaOverlayCapacitorBridge(
        Context context,
        String assetDomain,
        Consumer<String> scriptSink
    ) {
        this.appContext = context.getApplicationContext();
        this.assetDomain = assetDomain;
        this.overlayOrigin = "https://" + assetDomain;
        this.scriptSink = scriptSink;
        this.grants = new LargeBodyGrant(appContext.getCacheDir());
        this.suitePolicy = AlphaSuitePolicyLoader.load(appContext);
        CloudRequestPolicy cloudPolicy = new CloudRequestPolicy(loadCloudRoutesJson(appContext));
        this.cloudRequests = cloudPolicy.loaded() ? new CloudRequests(cloudPolicy, grants) : null;
        this.speechHost = new AlphaCoreSpeechHost(appContext, this::emitPluginEvent);
        this.statusObserver = AgentService.observe(() ->
            emitPluginEvent("ElizaAgent", "status", AgentService.status(appContext))
        );
        this.signInObserver = AlphaCorePluginDispatch.observeSignIn(appContext, receipt ->
            emitPluginEvent("ElizaSignIn", "signInSettled", receipt)
        );
        this.signInHostObserver = AlphaCoreSignInHost.shared(appContext).subscribe((eventName, data) ->
            emitPluginEvent("ElizaSignIn", eventName, data)
        );
        this.billingReturnObserver = BillingReturn.subscribe(sessionId -> {
            if (!closed) {
                scriptSink.accept("window.dispatchEvent(new Event('alpha-billing-return'))");
            }
        });
        this.localLlmProgressObserver = AlphaCorePluginDispatch.subscribeLocalLlmProgress(progress ->
            emitPluginEvent("AlphaLocalLlm", "downloadProgress", progress)
        );
        this.callStateWatch = AlphaCorePluginDispatch.watchCallState(appContext, state ->
            emitPluginEvent("AlphaCallState", "callState", state)
        );
        this.preferencesObserver = new ContentObserver(new Handler(Looper.getMainLooper())) {
            @Override public void onChange(boolean selfChange, Uri uri) {
                String changedKey = uri == null ? null : uri.getLastPathSegment();
                String changedValue = changedKey == null ? null : AlphaPreferencesProvider.readForCore(appContext, changedKey);
                JSONObject event = new JSONObject();
                try {
                    event.put("key", changedKey == null ? JSONObject.NULL : changedKey);
                    event.put("value", changedValue == null ? JSONObject.NULL : changedValue);
                } catch (JSONException ignored) {
                }
                emitPluginEvent("AlphaPreferences", "changed", event);
            }
        };
        try {
            appContext.getContentResolver().registerContentObserver(
                Uri.parse(AlphaIpcContract.PREFERENCES_URI_STRING),
                true,
                preferencesObserver
            );
        } catch (RuntimeException ignored) {
        }
    }

    static AlphaOverlayCapacitorBridge attach(
        Context context,
        WebView webView,
        String assetDomain,
        Consumer<String> scriptSink
    ) {
        AlphaOverlayCapacitorBridge bridge = new AlphaOverlayCapacitorBridge(context, assetDomain, scriptSink);
        Set<String> allowedOrigins = Collections.singleton(bridge.overlayOrigin);
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            try {
                WebViewCompat.addDocumentStartJavaScript(webView, bootstrapScript(), allowedOrigins);
            } catch (RuntimeException unavailable) {
                Log.w(TAG, "Document start script unavailable for overlay WebView", unavailable);
            }
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            try {
                WebViewCompat.addWebMessageListener(
                    webView,
                    CHANNEL_NAME,
                    allowedOrigins,
                    (page, message, source, mainFrame, reply) -> {
                        if (page == webView && mainFrame && bridge.isOverlayOrigin(source)) {
                            bridge.handleMessage(message);
                        }
                    }
                );
            } catch (RuntimeException unavailable) {
                Log.w(TAG, "WebMessageListener unavailable for overlay WebView", unavailable);
            }
        }
        return bridge;
    }

    static String bootstrapScript() {
        return "(() => {"
            + " if (window.__alphaOverlayCapInstalled) return;"
            + " window.__alphaOverlayCapInstalled = true;"
            + " const headers = ["
            + "  { name: 'ElizaAgent', methods: ["
            + "   { name: 'getStatus', rtype: 'promise' }, { name: 'start', rtype: 'promise' },"
            + "   { name: 'stop', rtype: 'promise' }, { name: 'restart', rtype: 'promise' },"
            + "   { name: 'request', rtype: 'promise' }, { name: 'requestStream', rtype: 'promise' },"
            + "   { name: 'abort', rtype: 'promise' }, { name: 'subscribeEvents', rtype: 'promise' },"
            + "   { name: 'unsubscribeEvents', rtype: 'promise' }, { name: 'reviewRecovery', rtype: 'promise' },"
            + "   { name: 'archiveRecovery', rtype: 'promise' }, { name: 'addListener' }, { name: 'removeListener' }"
            + "  ]},"
            + "  { name: 'ElizaCloud', methods: ["
            + "   { name: 'request', rtype: 'promise' }, { name: 'cancel', rtype: 'promise' },"
            + "   { name: 'readGrant', rtype: 'promise' }, { name: 'openExternal', rtype: 'promise' },"
            + "   { name: 'addListener' }, { name: 'removeListener' }"
            + "  ]},"
            + "  { name: 'ElizaSignIn', methods: ["
            + "   { name: 'status', rtype: 'promise' }, { name: 'serviceInfo', rtype: 'promise' },"
            + "   { name: 'startEmail', rtype: 'promise' }, { name: 'startPhone', rtype: 'promise' },"
            + "   { name: 'startGoogle', rtype: 'promise' }, { name: 'reauthenticate', rtype: 'promise' },"
            + "   { name: 'upgradeMailLease', rtype: 'promise' }, { name: 'cancelMailLeaseUpgrade', rtype: 'promise' },"
            + "   { name: 'resend', rtype: 'promise' }, { name: 'verify', rtype: 'promise' },"
            + "   { name: 'sendFactorCode', rtype: 'promise' }, { name: 'cancel', rtype: 'promise' },"
            + "   { name: 'signOut', rtype: 'promise' }, { name: 'openSignIn', rtype: 'promise' },"
            + "   { name: 'addListener' }, { name: 'removeListener' }"
            + "  ]},"
            + "  { name: 'AlphaLocalLlm', methods: ["
            + "   { name: 'catalog', rtype: 'promise' }, { name: 'status', rtype: 'promise' },"
            + "   { name: 'download', rtype: 'promise' }, { name: 'cancelDownload', rtype: 'promise' },"
            + "   { name: 'activate', rtype: 'promise' }, { name: 'unload', rtype: 'promise' },"
            + "   { name: 'delete', rtype: 'promise' }, { name: 'generate', rtype: 'promise' },"
            + "   { name: 'setMode', rtype: 'promise' }, { name: 'addListener' }, { name: 'removeListener' }"
            + "  ]},"
            + "  { name: 'AlphaCarrierSetup', methods: ["
            + "   { name: 'read', rtype: 'promise' }, { name: 'readEid', rtype: 'promise' },"
            + "   { name: 'openSettings', rtype: 'promise' }, { name: 'addListener' }, { name: 'removeListener' }"
            + "  ]},"
            + "  { name: 'AlphaInboxNotices', methods: ["
            + "   { name: 'configure', rtype: 'promise' }, { name: 'withdraw', rtype: 'promise' },"
            + "   { name: 'status', rtype: 'promise' }, { name: 'pending', rtype: 'promise' },"
            + "   { name: 'consume', rtype: 'promise' }, { name: 'releaseQuestion', rtype: 'promise' },"
            + "   { name: 'notificationSettings', rtype: 'promise' }, { name: 'addListener' }, { name: 'removeListener' }"
            + "  ]},"
            + "  { name: 'AlphaHostedDigestDelivery', methods: ["
            + "   { name: 'read', rtype: 'promise' }, { name: 'syncManual', rtype: 'promise' },"
            + "   { name: 'setBackground', rtype: 'promise' }, { name: 'enableNotifications', rtype: 'promise' },"
            + "   { name: 'peekNotice', rtype: 'promise' }, { name: 'settleNotice', rtype: 'promise' },"
            + "   { name: 'addListener' }, { name: 'removeListener' }"
            + "  ]},"
            + "  { name: 'AlphaPreferences', methods: ["
            + "   { name: 'get', rtype: 'promise' }, { name: 'set', rtype: 'promise' },"
            + "   { name: 'remove', rtype: 'promise' }, { name: 'snapshot', rtype: 'promise' },"
            + "   { name: 'addListener' }, { name: 'removeListener' }"
            + "  ]},"
            + "  { name: 'AlphaContext', methods: ["
            + "   { name: 'publish', rtype: 'promise' }, { name: 'clear', rtype: 'promise' },"
            + "   { name: 'getActive', rtype: 'promise' }, { name: 'replyAction', rtype: 'promise' },"
            + "   { name: 'addListener' }, { name: 'removeListener' }"
            + "  ]},"
            + "  { name: 'AlphaOverlayHost', methods: ["
            + "   { name: 'setTouchableRegions', rtype: 'promise' }, { name: 'setFocusable', rtype: 'promise' },"
            + "   { name: 'dismiss', rtype: 'promise' }, { name: 'openAppIntent', rtype: 'promise' },"
            + "   { name: 'addListener' }, { name: 'removeListener' }"
            + "  ]},"
            + "  { name: 'AlphaVoiceCloud', methods: ["
            + "   { name: 'checkPermissions', rtype: 'promise' }, { name: 'requestPermissions', rtype: 'promise' },"
            + "   { name: 'warmSpeechOutput', rtype: 'promise' }, { name: 'localSpeechStatus', rtype: 'promise' },"
            + "   { name: 'releaseLocalSpeech', rtype: 'promise' }, { name: 'holdSpeechEngine', rtype: 'promise' },"
            + "   { name: 'releaseSpeechEngineHold', rtype: 'promise' }, { name: 'liveCaptureStatus', rtype: 'promise' },"
            + "   { name: 'startLiveCapture', rtype: 'promise' }, { name: 'stopLiveCapture', rtype: 'promise' },"
            + "   { name: 'synthesizeLocal', rtype: 'promise' }, { name: 'play', rtype: 'promise' },"
            + "   { name: 'setSpeechOutputMuted', rtype: 'promise' }, { name: 'stopPlayback', rtype: 'promise' },"
            + "   { name: 'cancel', rtype: 'promise' }, { name: 'startRecording', rtype: 'promise' },"
            + "   { name: 'stopRecording', rtype: 'promise' }, { name: 'getRecordingMetrics', rtype: 'promise' },"
            + "   { name: 'cancelRecording', rtype: 'promise' }, { name: 'dictationForeground', rtype: 'promise' },"
            + "   { name: 'transcribeLocalRecording', rtype: 'promise' }, { name: 'nativeVoiceTiming', rtype: 'promise' },"
            + "   { name: 'markVoiceTurn', rtype: 'promise' }, { name: 'clearNativeVoiceTiming', rtype: 'promise' },"
            + "   { name: 'addListener' }, { name: 'removeListener' }"
            + "  ]},"
            + "  { name: 'ElizaCloudSpeech', methods: ["
            + "   { name: 'checkPermissions', rtype: 'promise' }, { name: 'requestPermissions', rtype: 'promise' },"
            + "   { name: 'prewarmCloudSpeech', rtype: 'promise' }, { name: 'cloudStreamTiming', rtype: 'promise' },"
            + "   { name: 'startCloudSpeech', rtype: 'promise' }, { name: 'stopCloudSpeech', rtype: 'promise' },"
            + "   { name: 'setCloudSpeechMuted', rtype: 'promise' }, { name: 'setCloudSpeechOutputMuted', rtype: 'promise' },"
            + "   { name: 'speakCloudSpeech', rtype: 'promise' }, { name: 'cancelCloudSpeech', rtype: 'promise' },"
            + "   { name: 'addListener' }, { name: 'removeListener' }"
            + "  ]},"
            + "  { name: 'AlphaDevice', methods: ["
            + "   { name: 'copyText', rtype: 'promise' }, { name: 'shareText', rtype: 'promise' },"
            + "   { name: 'haptic', rtype: 'promise' }, { name: 'recommendedTimeout', rtype: 'promise' },"
            + "   { name: 'setSystemBarAppearance', rtype: 'promise' }, { name: 'setAgentGoogleConsent', rtype: 'promise' },"
            + "   { name: 'diagnosticsFacts', rtype: 'promise' }, { name: 'settingsFacts', rtype: 'promise' },"
            + "   { name: 'snapshot', rtype: 'promise' }, { name: 'passwordProviderStatus', rtype: 'promise' },"
            + "   { name: 'takeBillingReturn', rtype: 'promise' }, { name: 'updateState', rtype: 'promise' },"
            + "   { name: 'checkForUpdate', rtype: 'promise' }, { name: 'installUpdate', rtype: 'promise' },"
            + "   { name: 'activateUpdate', rtype: 'promise' }, { name: 'continueUpdate', rtype: 'promise' },"
            + "   { name: 'openUpdatePermissionSettings', rtype: 'promise' }, { name: 'textAsk', rtype: 'promise' },"
            + "   { name: 'closeTextAsk', rtype: 'promise' }, { name: 'openAlphaOverlay', rtype: 'promise' },"
            + "   { name: 'launchSiblingApp', rtype: 'promise' }, { name: 'finishTask', rtype: 'promise' },"
            + "   { name: 'openSettings', rtype: 'promise' }, { name: 'addListener' }, { name: 'removeListener' }"
            + "  ]},"
            + "  { name: 'ElizaSecureStore', methods: ["
            + "   { name: 'status', rtype: 'promise' }, { name: 'get', rtype: 'promise' },"
            + "   { name: 'set', rtype: 'promise' }, { name: 'remove', rtype: 'promise' },"
            + "   { name: 'compareAndExchange', rtype: 'promise' }"
            + "  ]},"
            + "  { name: 'AlphaAssistantDraft', methods: ["
            + "   { name: 'read', rtype: 'promise' }, { name: 'exchange', rtype: 'promise' }"
            + "  ]},"
            + "  { name: 'ElizaActionJournal', methods: ["
            + "   { name: 'reserve', rtype: 'promise' }, { name: 'markApplying', rtype: 'promise' },"
            + "   { name: 'finish', rtype: 'promise' }, { name: 'get', rtype: 'promise' },"
            + "   { name: 'list', rtype: 'promise' }, { name: 'edit', rtype: 'promise' },"
            + "   { name: 'pending', rtype: 'promise' }, { name: 'undo', rtype: 'promise' },"
            + "   { name: 'dismiss', rtype: 'promise' }, { name: 'telephonyDeletionReceipt', rtype: 'promise' }"
            + "  ]},"
            + "  { name: 'ElizaNotifications', methods: ["
            + "   { name: 'workflowPresentationCapabilities', rtype: 'promise' }, { name: 'status', rtype: 'promise' },"
            + "   { name: 'list', rtype: 'promise' }, { name: 'crossAppStatus', rtype: 'promise' },"
            + "   { name: 'pendingWorkflowTap', rtype: 'promise' }, { name: 'addListener' }, { name: 'removeListener' }"
            + "  ]},"
            + "  { name: 'ElizaPasswords', methods: ["
            + "   { name: 'status', rtype: 'promise' }"
            + "  ]},"
            + "  { name: 'ElizaSystem', methods: ["
            + "   { name: 'getSystemFacts', rtype: 'promise' }, { name: 'getStatus', rtype: 'promise' },"
            + "   { name: 'getBuildInfo', rtype: 'promise' }, { name: 'getDeviceSettings', rtype: 'promise' },"
            + "   { name: 'openSettings', rtype: 'promise' }, { name: 'openSettingsPage', rtype: 'promise' },"
            + "   { name: 'crashLog', rtype: 'promise' }, { name: 'clearCrashLog', rtype: 'promise' }"
            + "  ]},"
            + "  { name: 'AlphaCallState', methods: ["
            + "   { name: 'callState', rtype: 'promise' }, { name: 'addListener' }, { name: 'removeListener' }"
            + "  ]}"
            + " ];"
            + " const pending = new Map();"
            + " const listeners = new Map();"
            + " let seq = 0;"
            + " const post = (payload) => {"
            + "  const port = window." + CHANNEL_NAME + ";"
            + "  if (!port || typeof port.postMessage !== 'function') return false;"
            + "  port.postMessage(JSON.stringify(payload));"
            + "  return true;"
            + " };"
            + " window.androidBridge = window.androidBridge || {};"
            + " const cap = (window.Capacitor = window.Capacitor || {});"
            + " cap.PluginHeaders = headers;"
            + " cap.nativePromise = (plugin, method, options) => new Promise((resolve, reject) => {"
            + "  const callId = 'ov-' + (++seq);"
            + "  pending.set(callId, { resolve, reject });"
            + "  if (!post({ kind: 'call', callId, plugin, method, options: options || {} })) {"
            + "   pending.delete(callId);"
            + "   reject(Object.assign(new Error('Overlay bridge unavailable'), { code: 'UNAVAILABLE' }));"
            + "  }"
            + " });"
            + " cap.nativeCallback = (plugin, method, options, cb) => {"
            + "  const opts = options || {};"
            + "  const eventName = typeof opts.eventName === 'string' ? opts.eventName : '';"
            + "  const id = typeof opts.callbackId === 'string' && opts.callbackId ? opts.callbackId : ('cb-' + (++seq));"
            + "  const bucketKey = plugin + ':' + eventName;"
            + "  if (method === 'addListener' && typeof cb === 'function') {"
            + "   let map = listeners.get(bucketKey);"
            + "   if (!map) { map = new Map(); listeners.set(bucketKey, map); }"
            + "   map.set(id, cb);"
            + "  } else if (method === 'removeListener') {"
            + "   const map = listeners.get(bucketKey);"
            + "   if (map) map.delete(id);"
            + "  }"
            + "  return id;"
            + " };"
            + " window.__alphaOverlayDeliver = (msg) => {"
            + "  if (!msg || typeof msg !== 'object') return;"
            + "  if (msg.kind === 'reply') {"
            + "   const entry = pending.get(msg.callId);"
            + "   if (!entry) return;"
            + "   pending.delete(msg.callId);"
            + "   if (msg.ok) entry.resolve(msg.data);"
            + "   else entry.reject(Object.assign(new Error(msg.message || msg.code || 'Error'), { code: msg.code || 'ERROR' }));"
            + "  } else if (msg.kind === 'event') {"
            + "   const map = listeners.get(msg.plugin + ':' + msg.eventName);"
            + "   if (!map) return;"
            + "   for (const fn of [...map.values()]) { try { fn(msg.data); } catch (_) {} }"
            + "  }"
            + " };"
            + "})();";
    }

    boolean isOverlayOrigin(Uri uri) {
        return uri != null
            && "https".equalsIgnoreCase(uri.getScheme())
            && assetDomain.equalsIgnoreCase(uri.getHost());
    }

    void emitPluginEvent(String plugin, String eventName, JSONObject data) {
        if (closed || plugin == null || eventName == null) return;
        JSONObject envelope = new JSONObject();
        try {
            envelope.put("kind", "event")
                .put("plugin", plugin)
                .put("eventName", eventName)
                .put("data", data == null ? new JSONObject() : data);
        } catch (JSONException impossible) {
            return;
        }
        deliverEnvelope(envelope);
    }

    void onSessionShow() {
        speechHost.onOverlayShow();
    }

    void onSessionHide() {
        speechHost.onOverlayHide();
    }

    @Override public void close() {
        closed = true;
        AgentService.channel().abandon(owner);
        speechHost.close();
        try {
            statusObserver.close();
        } catch (Exception ignored) {
        }
        try {
            signInObserver.close();
        } catch (Exception ignored) {
        }
        try {
            signInHostObserver.close();
        } catch (Exception ignored) {
        }
        try {
            billingReturnObserver.close();
        } catch (Exception ignored) {
        }
        try {
            localLlmProgressObserver.close();
        } catch (Exception ignored) {
        }
        try {
            callStateWatch.close();
        } catch (Exception ignored) {
        }
        try {
            appContext.getContentResolver().unregisterContentObserver(preferencesObserver);
        } catch (RuntimeException ignored) {
        }
        workers.shutdownNow();
        grants.clear();
    }

    private void handleMessage(WebMessageCompat message) {
        if (closed || message == null || message.getType() != WebMessageCompat.TYPE_STRING) return;
        String raw = message.getData();
        if (raw == null || raw.isEmpty() || raw.length() > MAX_MESSAGE_CHARS) return;
        JSONObject req;
        try {
            req = new JSONObject(raw);
        } catch (JSONException malformed) {
            return;
        }
        if (!"call".equals(req.optString("kind"))) return;
        String callId = req.optString("callId", "");
        String plugin = req.optString("plugin", "");
        String method = req.optString("method", "");
        JSONObject options = req.optJSONObject("options");
        if (options == null) options = new JSONObject();
        if (callId.isEmpty() || plugin.isEmpty() || method.isEmpty()) return;

        switch (plugin) {
            case "ElizaAgent" -> handleAgent(callId, method, options);
            case "ElizaCloud" -> {
                if ("openExternal".equals(method)) {
                    AlphaCorePluginDispatch.dispatch(
                        appContext,
                        suitePolicy,
                        plugin,
                        method,
                        options,
                        data -> resolveCall(callId, data),
                        (code, msg) -> rejectCall(callId, code, msg)
                    );
                } else {
                    handleCloud(callId, method, options);
                }
            }
            case "AlphaPreferences" -> handlePreferences(callId, method, options);
            case "AlphaContext" -> handleContext(callId, method);
            case "AlphaOverlayHost" -> handleOverlayHost(callId, method, options);
            case "AlphaVoiceCloud", "ElizaCloudSpeech" -> speechHost.dispatch(
                plugin,
                method,
                callId,
                options,
                data -> resolveCall(callId, data),
                (code, msg) -> rejectCall(callId, code, msg)
            );
            default -> {
                JSONObject finalOptions = options;
                runWorker(callId, () -> {
                    boolean handled = AlphaCorePluginDispatch.dispatch(
                        appContext,
                        suitePolicy,
                        plugin,
                        method,
                        finalOptions,
                        data -> resolveCall(callId, data),
                        (code, msg) -> rejectCall(callId, code, msg)
                    );
                    if (!handled) {
                        rejectCall(callId, "UNIMPLEMENTED", "Plugin not available in overlay: " + plugin);
                    }
                });
            }
        }
    }

    private void handleAgent(String callId, String method, JSONObject options) {
        switch (method) {
            case "getStatus" -> resolveCall(callId, AgentService.status(appContext));
            case "start" -> runAgentLifecycle(callId, () -> AgentService.start(appContext));
            case "stop" -> runAgentLifecycle(callId, () -> AgentService.stop(appContext));
            case "restart" -> runAgentLifecycle(callId, () -> AgentService.restart(appContext));
            case "request" -> handleAgentRequest(callId, options);
            case "requestStream" -> handleAgentStream(callId, options);
            case "abort", "unsubscribeEvents" -> {
                String id = options.optString("id", "");
                boolean aborted = AgentService.channel().abort(owner, id);
                resolveCall(callId, jsonObject("aborted", aborted));
            }
            case "subscribeEvents" -> handleAgentSubscribe(callId, options);
            case "reviewRecovery" -> {
                AgentService.Review review = AgentService.reviewRecovery(appContext);
                JSONObject answer = new JSONObject();
                try {
                    if (review == null) answer.put("kind", "unavailable");
                    else answer.put("kind", "reviewable")
                        .put("reviewToken", review.token())
                        .put("retainedCount", review.retainedCount());
                } catch (JSONException ignored) {
                }
                resolveCall(callId, answer);
            }
            case "archiveRecovery" -> {
                int archived = AgentService.archiveRecovery(appContext, options.optString("reviewToken", ""));
                JSONObject answer = new JSONObject();
                try {
                    if (archived < 0) answer.put("kind", "unavailable");
                    else answer.put("kind", "archived").put("archivedCount", archived);
                } catch (JSONException ignored) {
                }
                resolveCall(callId, answer);
            }
            default -> rejectCall(callId, "UNIMPLEMENTED", "Unsupported ElizaAgent method: " + method);
        }
    }

    private void runAgentLifecycle(String callId, Runnable action) {
        try {
            action.run();
            resolveCall(callId, AgentService.status(appContext));
        } catch (IllegalStateException refused) {
            rejectCall(callId, "Broken", refused.getMessage());
        }
    }

    private void handleAgentRequest(String callId, JSONObject options) {
        String id = options.optString("id", "");
        String resolvedId = id.isEmpty() ? UUID.randomUUID().toString() : id;
        FailCode refused = askAgent(options, resolvedId, false, new AgentChannel.Listener() {
            @Override public void head(String id, long index, int status, Map<String, String> headers) {}
            @Override public void chunk(String id, long index, byte[] data) {}
            @Override public void event(String id, long index, JSONObject event) {}

            @Override public void settled(String id, Outcome outcome, byte[] body) {
                if (outcome.kind() == ai.eliza.os.agent.ChannelPolicy.OutcomeKind.RESPONSE) {
                    resolveCall(callId, agentResponseJson(outcome.status(), body));
                } else {
                    FailCode code = outcome.kind() == ai.eliza.os.agent.ChannelPolicy.OutcomeKind.FAILED
                        && outcome.code() != null ? outcome.code() : FailCode.BROKEN;
                    rejectCall(callId, failCodeName(code), failCodeName(code));
                }
            }
        });
        if (refused != null) {
            rejectCall(callId, failCodeName(refused), failCodeName(refused));
        }
    }

    private void handleAgentStream(String callId, JSONObject options) {
        String id = options.optString("id", "");
        FailCode refused = askAgent(options, id, true, new AgentChannel.Listener() {
            @Override public void head(String streamId, long index, int status, Map<String, String> headers) {
                JSONObject frame = agentFrame(streamId, "head", index);
                JSONObject named = new JSONObject();
                try {
                    frame.put("status", status);
                    if (headers != null) {
                        for (Map.Entry<String, String> entry : headers.entrySet()) {
                            named.put(entry.getKey(), entry.getValue());
                        }
                    }
                    frame.put("headers", named);
                } catch (JSONException ignored) {
                }
                emitPluginEvent("ElizaAgent", "streamData", frame);
            }

            @Override public void chunk(String streamId, long index, byte[] data) {
                JSONObject frame = agentFrame(streamId, "chunk", index);
                try {
                    frame.put("dataBase64", Base64.encodeToString(data, Base64.NO_WRAP));
                } catch (JSONException ignored) {
                }
                emitPluginEvent("ElizaAgent", "streamData", frame);
            }

            @Override public void event(String streamId, long index, JSONObject event) {}

            @Override public void settled(String streamId, Outcome outcome, byte[] body) {
                emitPluginEvent("ElizaAgent", "streamEnd", agentEnding(streamId, outcome));
            }
        });
        if (refused != null) {
            rejectCall(callId, failCodeName(refused), failCodeName(refused));
        } else {
            resolveCall(callId, jsonObject("id", id));
        }
    }

    private void handleAgentSubscribe(String callId, JSONObject options) {
        String id = options.optString("id", "");
        String topicName = options.optString("topic", "");
        Topic topic = switch (topicName) {
            case "voice" -> Topic.VOICE;
            case "view" -> Topic.VIEW;
            default -> null;
        };
        if (topic == null) {
            rejectCall(callId, "RouteRefused", "RouteRefused");
            return;
        }
        String clientId = options.optString("clientId", owner);
        FailCode refused = AgentService.channel().subscribe(owner, id, topic, clientId, new AgentChannel.Listener() {
            @Override public void head(String subId, long index, int status, Map<String, String> headers) {}
            @Override public void chunk(String subId, long index, byte[] data) {}

            @Override public void event(String subId, long index, JSONObject event) {
                JSONObject heard = agentFrame(subId, "event", index);
                try {
                    heard.put("event", event == null ? new JSONObject() : event);
                } catch (JSONException ignored) {
                }
                emitPluginEvent("ElizaAgent", "agentEvent", heard);
            }

            @Override public void settled(String subId, Outcome outcome, byte[] body) {
                emitPluginEvent("ElizaAgent", "agentEvent", agentEnding(subId, outcome));
            }
        });
        if (refused != null) {
            rejectCall(callId, failCodeName(refused), failCodeName(refused));
        } else {
            resolveCall(callId, jsonObject("id", id));
        }
    }

    private FailCode askAgent(JSONObject options, String id, boolean streamed, AgentChannel.Listener listener) {
        Object body = options.opt("body");
        String text = body == null || body == JSONObject.NULL
            ? null
            : (body instanceof String plain ? JSONObject.quote(plain) : body.toString());
        byte[] bytes = text == null ? null : text.getBytes(StandardCharsets.UTF_8);
        Map<String, Object> headers = new LinkedHashMap<>();
        Object given = options.opt("headers");
        if (given instanceof JSONObject obj) {
            for (Iterator<String> keys = obj.keys(); keys.hasNext(); ) {
                String key = keys.next();
                headers.put(key, obj.opt(key));
            }
        }
        return AgentService.channel().ask(
            owner,
            id,
            options.optString("method", ""),
            options.optString("path", ""),
            streamed,
            bytes,
            headers,
            listener
        );
    }

    private void handleCloud(String callId, String method, JSONObject options) {
        if ("cancel".equals(method)) {
            String id = options.optString("id", "");
            boolean cancelled = cloudRequests != null && !id.isEmpty() && cloudRequests.cancel(id);
            resolveCall(callId, jsonObject("cancelled", cancelled));
            return;
        }
        if ("readGrant".equals(method)) {
            String grantId = options.optString("grant", "");
            runWorker(callId, () -> {
                try {
                    LargeBodyGrant.Chunk chunk = grants.read(grantId);
                    if (chunk == null) {
                        rejectCall(callId, "grant-unknown", "grant-unknown");
                    } else {
                        JSONObject reply = new JSONObject();
                        try {
                            reply.put("data", Base64.encodeToString(chunk.data(), Base64.NO_WRAP))
                                .put("done", chunk.done());
                        } catch (JSONException ignored) {
                        }
                        resolveCall(callId, reply);
                    }
                } catch (IOException lost) {
                    rejectCall(callId, "grant-unreadable", "grant-unreadable");
                }
            });
            return;
        }
        if (!"request".equals(method)) {
            rejectCall(callId, "UNIMPLEMENTED", "Unsupported ElizaCloud method: " + method);
            return;
        }
        if (cloudRequests == null) {
            rejectCall(callId, AlphaIpcContract.CLOUD_NOT_CONFIGURED, AlphaIpcContract.CLOUD_NOT_CONFIGURED);
            return;
        }
        String httpMethod = options.optString("method", "");
        String target = options.optString("target", "");
        if (httpMethod.isBlank() || target.isBlank()) {
            rejectCall(callId, AlphaIpcContract.CLOUD_INVALID_REQUEST, AlphaIpcContract.CLOUD_INVALID_REQUEST);
            return;
        }
        Map<String, String> headers = new LinkedHashMap<>();
        JSONObject rawHeaders = options.optJSONObject("headers");
        if (rawHeaders != null) {
            for (Iterator<String> keys = rawHeaders.keys(); keys.hasNext(); ) {
                String key = keys.next();
                Object value = rawHeaders.opt(key);
                if (value instanceof String str) headers.put(key, str);
            }
        }
        Object rawBody = options.opt("body");
        byte[] bytes = rawBody instanceof String text ? text.getBytes(StandardCharsets.UTF_8) : null;
        String reqId = options.has("id") && !options.isNull("id") ? options.optString("id", null) : null;
        String sessionCred = options.has("expectedSessionCredentialId") && !options.isNull("expectedSessionCredentialId")
            ? options.optString("expectedSessionCredentialId", null) : null;
        String cred = options.has("expectedCredentialId") && !options.isNull("expectedCredentialId")
            ? options.optString("expectedCredentialId", null) : null;
        boolean billingSession = sessionCred != null && !sessionCred.isBlank();
        String expectedCredentialId = billingSession ? sessionCred : cred;
        runWorker(callId, () -> {
            String origin = BuildConfig.CLOUD_API_ORIGIN;
            CloudRequests.Outcome outcome = cloudRequests.send(
                reqId,
                origin,
                DeviceCustody.cloud(appContext, origin),
                httpMethod.toUpperCase(Locale.ROOT),
                target,
                headers,
                bytes,
                expectedCredentialId,
                billingSession
            );
            if (outcome instanceof CloudRequests.Failed failed) {
                String code = failed.failure().name().toLowerCase(Locale.ROOT).replace('_', '-');
                rejectCall(callId, code, code);
                return;
            }
            CloudRequests.Answered answered = (CloudRequests.Answered) outcome;
            JSONObject reply = new JSONObject();
            try {
                reply.put("status", answered.status());
                if (answered.etag() != null) reply.put("etag", answered.etag());
                if (answered.contentType() != null) reply.put("contentType", answered.contentType());
                if (answered.retryAfter() != null) reply.put("retryAfter", answered.retryAfter());
                LargeBodyGrant.Grant grant = answered.grant();
                if (grant == null) {
                    byte[] bodyBytes = answered.body() == null ? new byte[0] : answered.body();
                    reply.put("body", Base64.encodeToString(bodyBytes, Base64.NO_WRAP));
                } else {
                    reply.put("grant", new JSONObject()
                        .put("id", grant.id())
                        .put("size", grant.size())
                        .put("sha256", grant.sha256()));
                }
            } catch (JSONException ignored) {
            }
            resolveCall(callId, reply);
        });
    }

    private void handlePreferences(String callId, String method, JSONObject options) {
        switch (method) {
            case "get" -> {
                String key = options.optString("key", "");
                if (!AlphaIpcContract.isReadablePreferenceKey(key)) {
                    rejectCall(callId, "DENIED", "Preference key is not readable");
                    return;
                }
                String value = AlphaPreferencesProvider.readForCore(appContext, key);
                JSONObject out = new JSONObject();
                try {
                    out.put("value", value == null ? JSONObject.NULL : value);
                } catch (JSONException ignored) {
                }
                resolveCall(callId, out);
            }
            case "set" -> {
                String key = options.optString("key", "");
                String value = options.has("value") && !options.isNull("value") ? options.optString("value", null) : null;
                if (!AlphaIpcContract.isSharedPreferenceKey(key) || value == null) {
                    rejectCall(callId, "DENIED", "Preference key is not writable");
                    return;
                }
                if (AlphaPreferencesProvider.writeForCore(appContext, key, value)) {
                    resolveCall(callId, new JSONObject());
                } else {
                    rejectCall(callId, "FAILED", "Could not persist preference");
                }
            }
            case "remove" -> {
                String key = options.optString("key", "");
                if (!AlphaIpcContract.isSharedPreferenceKey(key)) {
                    rejectCall(callId, "DENIED", "Preference key is not writable");
                    return;
                }
                if (AlphaPreferencesProvider.removeForCore(appContext, key)) {
                    resolveCall(callId, new JSONObject());
                } else {
                    rejectCall(callId, "FAILED", "Could not remove preference");
                }
            }
            case "snapshot" -> {
                JSONObject values = new JSONObject();
                for (Map.Entry<String, String> entry : AlphaPreferencesProvider.snapshotForCore(appContext).entrySet()) {
                    try {
                        values.put(entry.getKey(), entry.getValue());
                    } catch (JSONException ignored) {
                    }
                }
                JSONObject out = new JSONObject();
                try {
                    out.put("values", values);
                } catch (JSONException ignored) {
                }
                resolveCall(callId, out);
            }
            default -> rejectCall(callId, "UNIMPLEMENTED", "Unsupported AlphaPreferences method: " + method);
        }
    }

    private void handleContext(String callId, String method) {
        if ("getActive".equals(method)) {
            String activeJson = AlphaContextRegistryService.currentActiveContextJson();
            JSONObject out = new JSONObject();
            try {
                if (activeJson == null || activeJson.isBlank()) {
                    out.put("active", JSONObject.NULL);
                } else {
                    out.put("active", new JSONTokener(activeJson).nextValue());
                }
            } catch (JSONException fallback) {
                try {
                    out.put("active", activeJson);
                } catch (JSONException ignored) {
                }
            }
            resolveCall(callId, out);
            return;
        }
        if ("publish".equals(method)) {
            resolveCall(callId, jsonObject("published", false));
            return;
        }
        if ("clear".equals(method)) {
            resolveCall(callId, jsonObject("cleared", false));
            return;
        }
        if ("replyAction".equals(method)) {
            resolveCall(callId, jsonObject("delivered", false));
            return;
        }
        rejectCall(callId, "UNIMPLEMENTED", "Unsupported AlphaContext method: " + method);
    }

    private void handleOverlayHost(String callId, String method, JSONObject options) {
        AlphaOverlayHostPlugin.HostDelegate host = AlphaOverlayHostPlugin.currentHost();
        switch (method) {
            case "setTouchableRegions" -> {
                if (host != null) {
                    float density = (float) options.optDouble(
                        "density",
                        appContext.getResources().getDisplayMetrics().density
                    );
                    if (!Float.isFinite(density) || density <= 0f) density = 1f;
                    JSONArray raw = options.optJSONArray("rects");
                    List<Rect> rects = new ArrayList<>();
                    if (raw != null) {
                        for (int index = 0; index < raw.length(); index++) {
                            JSONObject item = raw.optJSONObject(index);
                            if (item == null) continue;
                            int left = Math.round((float) item.optDouble("left", 0) * density);
                            int top = Math.round((float) item.optDouble("top", 0) * density);
                            int right = Math.round((float) item.optDouble("right", 0) * density);
                            int bottom = Math.round((float) item.optDouble("bottom", 0) * density);
                            if (right > left && bottom > top) rects.add(new Rect(left, top, right, bottom));
                        }
                    }
                    host.setTouchableRegions(rects);
                }
                resolveCall(callId, new JSONObject());
            }
            case "setFocusable" -> {
                if (host != null) host.setFocusable(options.optBoolean("focusable", false));
                resolveCall(callId, new JSONObject());
            }
            case "dismiss" -> {
                if (host != null) host.dismiss();
                resolveCall(callId, new JSONObject());
            }
            case "openAppIntent" -> {
                String uri = options.optString("uri", "");
                String claimId = options.has("claimId") && !options.isNull("claimId") ? options.optString("claimId", null) : null;
                String payloadJson = options.has("payloadJson") && !options.isNull("payloadJson")
                    ? options.optString("payloadJson", null) : null;
                boolean opened = host != null && host.openAppIntent(uri, claimId, payloadJson);
                resolveCall(callId, jsonObject("opened", opened));
            }
            default -> rejectCall(callId, "UNIMPLEMENTED", "Unsupported AlphaOverlayHost method: " + method);
        }
    }

    private void runWorker(String callId, Runnable work) {
        try {
            workers.execute(work);
        } catch (RejectedExecutionException closedPool) {
            rejectCall(callId, AlphaIpcContract.CLOUD_NOT_CONFIGURED, AlphaIpcContract.CLOUD_NOT_CONFIGURED);
        }
    }

    private void resolveCall(String callId, JSONObject data) {
        JSONObject envelope = new JSONObject();
        try {
            envelope.put("kind", "reply")
                .put("callId", callId)
                .put("ok", true)
                .put("data", data == null ? new JSONObject() : data);
        } catch (JSONException impossible) {
            return;
        }
        deliverEnvelope(envelope);
    }

    private void rejectCall(String callId, String code, String message) {
        JSONObject envelope = new JSONObject();
        try {
            envelope.put("kind", "reply")
                .put("callId", callId)
                .put("ok", false)
                .put("code", code == null ? "ERROR" : code)
                .put("message", message == null ? (code == null ? "Error" : code) : message);
        } catch (JSONException impossible) {
            return;
        }
        deliverEnvelope(envelope);
    }

    private void deliverEnvelope(JSONObject envelope) {
        if (closed) return;
        String encoded = JSONObject.quote(envelope.toString());
        scriptSink.accept("(() => { if (typeof window.__alphaOverlayDeliver === 'function') window.__alphaOverlayDeliver(JSON.parse(" + encoded + ")); })()");
    }

    private static JSONObject jsonObject(String key, Object value) {
        JSONObject out = new JSONObject();
        try {
            out.put(key, value);
        } catch (JSONException ignored) {
        }
        return out;
    }

    private static JSONObject agentFrame(String id, String kind, long index) {
        JSONObject out = new JSONObject();
        try {
            out.put("id", id).put("kind", kind).put("index", index);
        } catch (JSONException ignored) {
        }
        return out;
    }

    private static JSONObject agentEnding(String id, Outcome outcome) {
        JSONObject out = new JSONObject();
        try {
            out.put("id", id);
            switch (outcome.kind()) {
                case FAILED -> out.put("kind", "failed").put("code", outcome.code() == null ? "Broken" : failCodeName(outcome.code()));
                case ERROR -> out.put("kind", "error");
                case ABORTED -> out.put("kind", "aborted");
                case END, RESPONSE -> out.put("kind", "end");
            }
        } catch (JSONException ignored) {
        }
        return out;
    }

    private static JSONObject agentResponseJson(long status, byte[] body) {
        JSONObject out = new JSONObject();
        String text = body == null ? "" : new String(body, StandardCharsets.UTF_8);
        Object data = JSONObject.NULL;
        if (!text.isEmpty()) {
            try {
                data = new JSONTokener(text).nextValue();
            } catch (JSONException notJson) {
                data = text;
            }
        }
        try {
            out.put("status", status).put("data", data);
        } catch (JSONException ignored) {
        }
        return out;
    }

    private static String failCodeName(FailCode code) {
        return switch (code) {
            case NOT_READY -> "NotReady";
            case ROUTE_REFUSED -> "RouteRefused";
            case TOO_LARGE -> "TooLarge";
            case ID_IN_USE -> "IdInUse";
            case TOPIC_IN_USE -> "TopicInUse";
            case BUSY -> "Busy";
            case RESTARTED -> "Restarted";
            case BROKEN -> "Broken";
        };
    }

    private static String loadCloudRoutesJson(Context context) {
        try (InputStream in = context.getAssets().open(CAPACITOR_CONFIG)) {
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
}
