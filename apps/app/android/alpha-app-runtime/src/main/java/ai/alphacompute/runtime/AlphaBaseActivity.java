package ai.alphacompute.runtime;

import ai.alphacompute.ipc.AlphaIpcContract;
import ai.alphacompute.ipc.IAlphaActionCallback;
import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.res.Configuration;
import android.database.ContentObserver;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.RemoteException;
import android.os.UserManager;
import android.util.Log;
import android.view.KeyEvent;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.PluginHandle;
import com.getcapacitor.WebViewListener;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONException;
import org.json.JSONObject;

/** Base Capacitor activity for every standalone thin Alpha app, wiring IPC proxies, shared theme/textScale, and signed agent intents. */
public abstract class AlphaBaseActivity extends BridgeActivity {
    private static final String TAG = "AlphaThinApp";
    private static final String BACK_EVENT = "window.dispatchEvent(new Event('alpha-back'))";

    private final Map<String, IAlphaActionCallback> pendingActions = new ConcurrentHashMap<>();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService diagnosticWorker = Executors.newSingleThreadExecutor(task -> {
        Thread thread = new Thread(task, "AlphaThinAppDiag");
        thread.setDaemon(true);
        return thread;
    });

    private ContentObserver preferencesObserver;
    private InsetsState insets;
    private JSONObject bufferedIntent;
    private volatile boolean pageLoaded;
    private volatile boolean volumeShutterEnabled;
    private volatile boolean resumed;
    private volatile boolean windowFocused;

    private record InsetsState(int top, int bottom, boolean keyboard) {
        void publish(WebView page) {
            page.evaluateJavascript("(() => { const root = document.documentElement; if (!root) return;"
                + " const detail = { top:" + top + ", bottom:" + bottom + ", keyboard:" + keyboard + " };"
                + " root.style.setProperty('--alpha-native-inset-top', detail.top + 'px');"
                + " root.style.setProperty('--alpha-native-inset-bottom', detail.bottom + 'px');"
                + " root.dataset.alphaNativeKeyboard = String(detail.keyboard);"
                + " window.dispatchEvent(new CustomEvent('alpha-insets', { detail })); })()", null);
        }
    }

    /** Lowercase suite id from {@code apps.json}, e.g. {@code "notes"}. */
    protected abstract String alphaAppId();

    /** Capitalized Quint {@code View} name, e.g. {@code "Notes"}. */
    protected abstract String alphaViewName();

    /** Surface mode string for this host, typically {@code "app"}. */
    protected String alphaSurfaceMode() {
        return "app";
    }

    /** Hook for thin app subclasses to register additional app-specific Capacitor plugins. */
    protected void registerAppPlugins() {}

    @Override public void onCreate(Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this);
        registerPlugin(RemoteAgentPlugin.class);
        registerPlugin(RemoteCloudPlugin.class);
        registerPlugin(RemoteSignInPlugin.class);
        registerPlugin(RemoteSecureStorePlugin.class);
        registerPlugin(AlphaPreferencesPlugin.class);
        registerPlugin(AlphaContextPlugin.class);
        registerPlugin(RemoteDevicePlugin.class);
        registerPlugin(RemoteVoiceCloudPlugin.class);
        registerPlugin(RemoteCloudSpeechPlugin.class);
        registerPlugin(RemoteNotificationsPlugin.class);
        registerPlugin(RemotePasswordsPlugin.class);
        registerPlugin(RemoteActionJournalPlugin.class);
        registerPlugin(RemoteConnectionPlugin.class);
        registerPlugin(RemoteHostedDigestPlugin.class);
        registerPlugin(RemoteInboxNoticesPlugin.class);
        registerPlugin(RemoteResetPlugin.class);
        registerPlugin(RemoteLocalLlmPlugin.class);
        registerPlugin(RemoteAssistantDraftPlugin.class);
        registerPlugin(RemoteCallStatePlugin.class);
        registerPlugin(RemoteCarrierSetupPlugin.class);
        registerPlugin(RemoteNetworkPolicyPlugin.class);
        registerAppPlugins();
        super.onCreate(savedInstanceState);

        if (getBridge() == null) return;
        WebView page = getBridge().getWebView();
        if (page == null) return;

        boolean debuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        WebView.setWebContentsDebuggingEnabled(debuggable);
        page.setFilterTouchesWhenObscured(true);
        page.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        CookieManager.getInstance().setAcceptThirdPartyCookies(page, false);
        page.setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
            @Override public Bitmap getDefaultVideoPoster() {
                return Bitmap.createBitmap(new int[] { Color.BLACK }, 1, 1, Bitmap.Config.ARGB_8888);
            }
        });

        syncSharedAppearanceAndTextScale();
        registerPreferencesObserver();
        followWindowInsets();
        registerBackDispatcher();
        captureAgentIntent(getIntent());
        logLaunchDiagnostics(getIntent());
    }

    @Override public void onResume() {
        super.onResume();
        resumed = true;
        syncSharedAppearanceAndTextScale();
    }

    @Override public void onPause() {
        resumed = false;
        windowFocused = false;
        clearForegroundContext();
        super.onPause();
    }

    @Override public void onDestroy() {
        clearForegroundContext();
        unregisterPreferencesObserver();
        failPendingActions("ActivityDestroyed");
        diagnosticWorker.shutdownNow();
        super.onDestroy();
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        captureAgentIntent(intent);
        logLaunchDiagnostics(intent);
    }

    @Override public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        windowFocused = hasFocus;
        if (!hasFocus || !pageLoaded) return;
        var bridge = getBridge();
        WebView page = bridge == null ? null : bridge.getWebView();
        if (page != null) {
            page.evaluateJavascript("window.dispatchEvent(new Event('focus'))", null);
        }
    }

    /** True while this activity is resumed, focused, and the user device is unlocked. */
    public boolean isForegroundFocused() {
        return resumed && windowFocused && !isFinishing() && !isDestroyed();
    }

    /** Checks whether {@code activity} is foreground-focused on an unlocked device. */
    public static boolean shareForeground(Activity activity) {
        if (activity == null || activity.isFinishing() || activity.isDestroyed()) return false;
        if (activity instanceof AlphaBaseActivity alpha) {
            if (!alpha.isForegroundFocused()) return false;
        } else if (Looper.myLooper() == Looper.getMainLooper()) {
            if (!activity.hasWindowFocus()) return false;
        } else {
            return false;
        }
        KeyguardManager lock = activity.getSystemService(KeyguardManager.class);
        UserManager users = activity.getSystemService(UserManager.class);
        return lock != null && users != null && !lock.isDeviceLocked() && users.isUserUnlocked();
    }

    /** Enables or disables capturing hardware volume keys as Camera shutter triggers. */
    public void setVolumeShutter(boolean enabled) {
        volumeShutterEnabled = enabled;
    }

    @Override public boolean dispatchKeyEvent(KeyEvent event) {
        if (volumeShutterEnabled && event != null) {
            int code = event.getKeyCode();
            if (code == KeyEvent.KEYCODE_VOLUME_UP || code == KeyEvent.KEYCODE_VOLUME_DOWN) {
                if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
                    var bridge = getBridge();
                    WebView page = bridge == null ? null : bridge.getWebView();
                    if (page != null) {
                        page.evaluateJavascript("window.dispatchEvent(new Event('alpha:volume-shutter'))", null);
                    }
                }
                return true;
            }
        }
        return super.dispatchKeyEvent(event);
    }

    /** Resolves a pending signed cross-app agent action callback identified by {@code claimId}. */
    public boolean replyAction(String claimId, boolean switched, String resultJson, String errorCode) {
        if (claimId == null || claimId.isEmpty()) return false;
        IAlphaActionCallback callback = pendingActions.remove(claimId);
        if (callback == null) return false;
        try {
            callback.onResult(claimId, switched, resultJson, errorCode);
            return true;
        } catch (RemoteException dead) {
            return false;
        }
    }

    private void registerBackDispatcher() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                var bridge = getBridge();
                WebView view = bridge == null ? null : bridge.getWebView();
                if (view == null) {
                    moveTaskToBack(true);
                    return;
                }
                String script = "(() => { if (document.documentElement?.dataset.alphaCanGoBack === 'true') { "
                    + BACK_EVENT + "; return true; } return false; })()";
                view.evaluateJavascript(script, handled -> {
                    if (!"true".equals(handled) && !isFinishing() && !isDestroyed()) {
                        moveTaskToBack(true);
                    }
                });
            }
        });
    }

    private void followWindowInsets() {
        var bridge = getBridge();
        if (bridge == null) return;
        bridge.addWebViewListener(new WebViewListener() {
            @Override public void onPageStarted(WebView page) {
                pageLoaded = false;
            }

            @Override public void onPageLoaded(WebView page) {
                pageLoaded = true;
                if (insets != null) insets.publish(page);
                syncSharedAppearanceAndTextScale();
                JSONObject pending = bufferedIntent;
                if (pending != null) {
                    bufferedIntent = null;
                    dispatchIntentToPage(page, pending);
                }
            }
        });
        View decor = getWindow().getDecorView();
        ViewCompat.setOnApplyWindowInsetsListener(decor, (view, incoming) -> {
            var bars = incoming.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            float density = getResources().getDisplayMetrics().density;
            InsetsState measured = new InsetsState(
                Math.round(bars.top / density),
                Math.round(bars.bottom / density),
                incoming.isVisible(WindowInsetsCompat.Type.ime())
            );
            if (!measured.equals(insets)) {
                insets = measured;
                var currentBridge = getBridge();
                WebView webView = currentBridge == null ? null : currentBridge.getWebView();
                if (webView != null) measured.publish(webView);
            }
            return ViewCompat.onApplyWindowInsets(view, incoming);
        });
        ViewCompat.requestApplyInsets(decor);
    }

    private void registerPreferencesObserver() {
        if (preferencesObserver != null || !AlphaIpcContract.hasSameSignatureAsCore(this)) return;
        preferencesObserver = new ContentObserver(mainHandler) {
            @Override public void onChange(boolean selfChange, Uri uri) {
                syncSharedAppearanceAndTextScale();
            }
        };
        try {
            getContentResolver().registerContentObserver(
                Uri.parse(AlphaIpcContract.PREFERENCES_URI_STRING),
                true,
                preferencesObserver
            );
        } catch (SecurityException ignored) {
            preferencesObserver = null;
        }
    }

    private void unregisterPreferencesObserver() {
        if (preferencesObserver == null) return;
        try {
            getContentResolver().unregisterContentObserver(preferencesObserver);
        } catch (RuntimeException ignored) {
        }
        preferencesObserver = null;
    }

    private void syncSharedAppearanceAndTextScale() {
        if (!AlphaIpcContract.hasSameSignatureAsCore(this)) return;
        Bundle snapshot;
        try {
            snapshot = getContentResolver().call(
                Uri.parse(AlphaIpcContract.PREFERENCES_URI_STRING),
                AlphaIpcContract.PREF_METHOD_SNAPSHOT,
                null,
                null
            );
        } catch (RuntimeException unavailable) {
            return;
        }
        if (snapshot == null) return;
        Bundle values = snapshot.getBundle(AlphaIpcContract.PREF_RESULT_SNAPSHOT);
        if (values == null) values = snapshot;

        float fontScale = getResources().getConfiguration().fontScale;
        if (!Float.isFinite(fontScale) || fontScale <= 0f) fontScale = 1f;
        int zoom = Math.max(1, Math.round(100f * fontScale));
        var bridge = getBridge();
        WebView page = bridge == null ? null : bridge.getWebView();
        if (page != null) {
            page.getSettings().setTextZoom(zoom);
        }

        boolean dark = resolveDarkLook(values.getString(AlphaIpcContract.KEY_APPEARANCE));
        WindowInsetsControllerCompat controller = new WindowInsetsControllerCompat(getWindow(), getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(!dark);
        controller.setAppearanceLightNavigationBars(!dark);
    }

    private boolean resolveDarkLook(String rawAppearance) {
        boolean systemDark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
            == Configuration.UI_MODE_NIGHT_YES;
        if (rawAppearance == null || rawAppearance.isBlank()) return systemDark;
        try {
            String theme = new JSONObject(rawAppearance).optString("theme", "System");
            if ("Dark".equals(theme)) return true;
            if ("Light".equals(theme)) return false;
            return systemDark;
        } catch (JSONException ignored) {
            return systemDark;
        }
    }

    private void captureAgentIntent(Intent intent) {
        if (intent == null || !AlphaIpcContract.ACTION_AGENT_OPEN.equals(intent.getAction())) return;
        AlphaAgentOpenActivity.VerifiedOpen handoff = AlphaAgentOpenActivity.consumeHandoff(
            intent.getStringExtra(AlphaAgentOpenActivity.EXTRA_INTERNAL_HANDOFF)
        );
        String uriString;
        String claimId;
        int ticket;
        String nonce;
        String payload;
        IAlphaActionCallback callback;
        if (handoff != null) {
            uriString = handoff.uri();
            claimId = handoff.claimId();
            ticket = handoff.ticket();
            nonce = handoff.nonce();
            payload = handoff.payload();
            callback = handoff.callback();
        } else {
            if (!isVerifiedCoreCaller()) {
                Log.w(TAG, "event=agent_open_rejected app=" + alphaAppId() + " view=" + alphaViewName() + " reason=unverified_caller");
                rejectUnverifiedCallback(intent);
                return;
            }
            uriString = intent.getDataString();
            claimId = intent.getStringExtra(AlphaIpcContract.EXTRA_CLAIM_ID);
            ticket = intent.getIntExtra(AlphaIpcContract.EXTRA_TICKET, 0);
            nonce = intent.getStringExtra(AlphaIpcContract.EXTRA_NONCE);
            payload = intent.getStringExtra(AlphaIpcContract.EXTRA_PAYLOAD);
            if (payload != null && payload.getBytes(StandardCharsets.UTF_8).length > AlphaIpcContract.MAX_INTENT_PAYLOAD_BYTES) {
                Log.w(TAG, "event=agent_open_rejected app=" + alphaAppId() + " view=" + alphaViewName() + " reason=payload_too_large");
                rejectCallbackFromExtras(intent.getExtras(), claimId, AlphaIpcContract.FAIL_TOO_LARGE);
                return;
            }
            Bundle extras = intent.getExtras();
            IBinder binder = extras == null ? null : extras.getBinder(AlphaIpcContract.EXTRA_CALLBACK);
            callback = binder == null ? null : IAlphaActionCallback.Stub.asInterface(binder);
        }
        Log.i(TAG, "event=agent_open app=" + alphaAppId() + " view=" + alphaViewName() + " verified=true claimId=" + (claimId == null ? "" : claimId));
        if (callback != null && claimId != null && !claimId.isEmpty()) {
            pendingActions.put(claimId, callback);
        }
        JSONObject detail = new JSONObject();
        try {
            detail.put("action", AlphaIpcContract.ACTION_AGENT_OPEN);
            detail.put("appId", alphaAppId());
            detail.put("view", alphaViewName());
            detail.put("uri", uriString == null ? JSONObject.NULL : uriString);
            detail.put("claimId", claimId == null ? JSONObject.NULL : claimId);
            detail.put("ticket", ticket);
            detail.put("nonce", nonce == null ? JSONObject.NULL : nonce);
            detail.put("payload", payload == null ? JSONObject.NULL : payload);
        } catch (JSONException impossible) {
            return;
        }
        var bridge = getBridge();
        WebView page = bridge == null ? null : bridge.getWebView();
        if (page != null && pageLoaded) {
            dispatchIntentToPage(page, detail);
        } else {
            bufferedIntent = detail;
        }
    }

    private boolean isVerifiedCoreCaller() {
        if (!AlphaIpcContract.hasSameSignatureAsCore(this)) return false;
        if (Build.VERSION.SDK_INT >= 34) {
            return AlphaIpcContract.CORE_PACKAGE.equals(getLaunchedFromPackage());
        }
        return false;
    }

    private void rejectUnverifiedCallback(Intent intent) {
        rejectCallbackFromExtras(intent.getExtras(), intent.getStringExtra(AlphaIpcContract.EXTRA_CLAIM_ID), AlphaIpcContract.FAIL_UNAUTHORIZED);
    }

    private void rejectCallbackFromExtras(Bundle extras, String claimId, String errorCode) {
        if (extras == null) return;
        IBinder binder = extras.getBinder(AlphaIpcContract.EXTRA_CALLBACK);
        if (binder == null) return;
        IAlphaActionCallback callback = IAlphaActionCallback.Stub.asInterface(binder);
        if (callback == null) return;
        try {
            callback.onResult(claimId == null ? "" : claimId, false, null, errorCode);
        } catch (RemoteException ignored) {
        }
    }

    private void dispatchIntentToPage(WebView page, JSONObject detail) {
        String encoded = JSONObject.quote(detail.toString());
        page.evaluateJavascript(
            "(() => { window.dispatchEvent(new CustomEvent('alpha-intent', { detail: JSON.parse(" + encoded + ") })); })()",
            null
        );
    }

    private void clearForegroundContext() {
        var bridge = getBridge();
        if (bridge == null) return;
        PluginHandle handle = bridge.getPlugin("AlphaContext");
        if (handle != null && handle.getInstance() instanceof AlphaContextPlugin contextPlugin) {
            contextPlugin.clearViewContext(alphaViewName());
        }
    }

    private void logLaunchDiagnostics(Intent intent) {
        String action = intent == null || intent.getAction() == null ? "none" : intent.getAction();
        Uri data = intent == null ? null : intent.getData();
        String uriSummary = data == null ? "none" : (data.getScheme() + "://" + data.getHost() + (data.getPath() == null ? "" : data.getPath()));
        diagnosticWorker.execute(() -> {
            boolean coreSignature = AlphaIpcContract.hasSameSignatureAsCore(this);
            boolean prefsConnected = false;
            int prefsKeys = 0;
            if (coreSignature) {
                try {
                    Bundle snapshot = getContentResolver().call(
                        Uri.parse(AlphaIpcContract.PREFERENCES_URI_STRING),
                        AlphaIpcContract.PREF_METHOD_SNAPSHOT,
                        null,
                        null
                    );
                    if (snapshot != null) {
                        prefsConnected = true;
                        Bundle values = snapshot.getBundle(AlphaIpcContract.PREF_RESULT_SNAPSHOT);
                        prefsKeys = (values == null ? snapshot : values).keySet().size();
                    }
                } catch (RuntimeException ignored) {
                }
            }
            boolean brokerBound = false;
            String agentState = "unavailable";
            var bridge = getBridge();
            if (bridge != null) {
                PluginHandle handle = bridge.getPlugin("ElizaAgent");
                if (handle != null && handle.getInstance() instanceof RemoteAgentPlugin agentPlugin) {
                    RemoteAgentPlugin.BrokerProbe probe = agentPlugin.probeBroker();
                    brokerBound = probe.bound();
                    agentState = probe.state();
                }
            }
            Log.i(TAG, "event=launch app=" + alphaAppId()
                + " view=" + alphaViewName()
                + " surface=" + alphaSurfaceMode()
                + " action=" + action
                + " uri=" + uriSummary
                + " coreSignatureMatch=" + coreSignature
                + " prefsConnected=" + prefsConnected
                + " prefsKeys=" + prefsKeys
                + " agentBrokerBound=" + brokerBound
                + " agentState=" + agentState);
        });
    }

    private void failPendingActions(String errorCode) {
        for (Map.Entry<String, IAlphaActionCallback> entry : pendingActions.entrySet()) {
            IAlphaActionCallback callback = pendingActions.remove(entry.getKey());
            if (callback == null) continue;
            try {
                callback.onResult(entry.getKey(), false, null, errorCode);
            } catch (RemoteException ignored) {
            }
        }
    }
}
