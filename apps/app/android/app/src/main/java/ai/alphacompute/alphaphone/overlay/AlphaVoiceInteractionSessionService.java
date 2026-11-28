package ai.alphacompute.alphaphone.overlay;

import ai.alphacompute.alphaphone.BuildConfig;
import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Rect;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.service.voice.VoiceInteractionSession;
import android.service.voice.VoiceInteractionSessionService;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.webkit.WebViewAssetLoader;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Session factory maintaining a warm transparent WebView hosting the {@code overlay} surface for sub-50ms Ask Alpha opens. */
public final class AlphaVoiceInteractionSessionService extends VoiceInteractionSessionService {
    private static final String ASSET_DOMAIN = WebViewAssetLoader.DEFAULT_DOMAIN;
    private static final String OVERLAY_URL = "https://" + ASSET_DOMAIN + "/?surface=overlay";
    private static final int MAX_PENDING_SCRIPTS = 128;

    /** Reusable warm WebView pool shared across {@link AlphaVoiceInteractionSession} activations. */
    static final class WarmOverlayWebViewPool {
        private final Context appContext;
        private final Handler mainHandler = new Handler(Looper.getMainLooper());
        private final List<String> pendingScripts = new ArrayList<>();
        private WebView warmView;
        private AlphaOverlayCapacitorBridge capacitorBridge;
        private boolean pageReady;

        WarmOverlayWebViewPool(Context context) {
            this.appContext = context.getApplicationContext();
        }

        void warmUp() {
            if (Looper.myLooper() == Looper.getMainLooper()) {
                ensureCreated();
            } else {
                mainHandler.post(this::ensureCreated);
            }
        }

        WebView acquire() {
            WebView view = ensureCreated();
            if (view.getParent() instanceof ViewGroup parent) {
                parent.removeView(view);
            }
            return view;
        }

        void release(WebView view) {
            if (view != null && view.getParent() instanceof ViewGroup parent) {
                parent.removeView(view);
            }
        }

        void destroy() {
            Runnable teardown = () -> {
                pageReady = false;
                pendingScripts.clear();
                AlphaOverlayCapacitorBridge bridge = capacitorBridge;
                capacitorBridge = null;
                if (bridge != null) {
                    bridge.close();
                }
                WebView view = warmView;
                warmView = null;
                if (view == null) return;
                if (view.getParent() instanceof ViewGroup parent) {
                    parent.removeView(view);
                }
                view.stopLoading();
                view.destroy();
            };
            if (Looper.myLooper() == Looper.getMainLooper()) {
                teardown.run();
            } else {
                mainHandler.post(teardown);
            }
        }

        void dispatchWindowEvent(String eventName, JSONObject detail) {
            if (eventName == null || eventName.isEmpty()) return;
            String encodedName = JSONObject.quote(eventName);
            String encodedDetail = JSONObject.quote(detail == null ? "{}" : detail.toString());
            String script = "(() => { window.dispatchEvent(new CustomEvent(" + encodedName
                + ", { detail: JSON.parse(" + encodedDetail + ") })); })()";
            evaluateScript(script);
        }

        void emitAssistContext(JSONObject payload) {
            AlphaOverlayCapacitorBridge bridge = capacitorBridge;
            if (bridge != null) {
                bridge.emitPluginEvent("AlphaOverlayHost", "assistContext", payload);
            }
        }

        void emitActionResult(JSONObject payload) {
            AlphaOverlayCapacitorBridge bridge = capacitorBridge;
            if (bridge != null) {
                bridge.emitPluginEvent("AlphaOverlayHost", "actionResult", payload);
            }
            dispatchWindowEvent("alpha-action-result", payload);
        }

        void publishInsets(int top, int bottom, boolean keyboard) {
            evaluateScript("(() => { const root = document.documentElement; if (!root) return;"
                + " const detail = { top:" + top + ", bottom:" + bottom + ", keyboard:" + keyboard + " };"
                + " root.style.setProperty('--alpha-native-inset-top', detail.top + 'px');"
                + " root.style.setProperty('--alpha-native-inset-bottom', detail.bottom + 'px');"
                + " root.dataset.alphaNativeKeyboard = String(detail.keyboard);"
                + " window.dispatchEvent(new CustomEvent('alpha-insets', { detail })); })()");
        }

        void onSessionShow() {
            AlphaOverlayCapacitorBridge bridge = capacitorBridge;
            if (bridge != null) {
                bridge.onSessionShow();
            }
        }

        void onSessionHide() {
            AlphaOverlayCapacitorBridge bridge = capacitorBridge;
            if (bridge != null) {
                bridge.onSessionHide();
            }
        }

        private void evaluateScript(String script) {
            if (script == null || script.isEmpty()) return;
            mainHandler.post(() -> {
                if (warmView != null && pageReady) {
                    warmView.evaluateJavascript(script, null);
                } else if (pendingScripts.size() < MAX_PENDING_SCRIPTS) {
                    pendingScripts.add(script);
                }
            });
        }

        private void flushPendingScripts(WebView view) {
            if (pendingScripts.isEmpty()) return;
            List<String> queued = new ArrayList<>(pendingScripts);
            pendingScripts.clear();
            for (String script : queued) {
                view.evaluateJavascript(script, null);
            }
        }

        private static boolean isOverlayOrigin(Uri url) {
            return url != null
                && "https".equalsIgnoreCase(url.getScheme())
                && ASSET_DOMAIN.equalsIgnoreCase(url.getHost());
        }

        @SuppressLint("SetJavaScriptEnabled")
        private WebView ensureCreated() {
            if (warmView != null) return warmView;
            WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
            WebView webView = new WebView(appContext);
            webView.setBackgroundColor(Color.TRANSPARENT);
            webView.setOverScrollMode(WebView.OVER_SCROLL_NEVER);
            WebSettings settings = webView.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
            settings.setAllowFileAccess(false);
            settings.setAllowContentAccess(false);
            CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);

            webView.setWebChromeClient(new WebChromeClient() {
                @Override public void onPermissionRequest(PermissionRequest request) {
                    if (request == null || !isOverlayOrigin(request.getOrigin())) {
                        if (request != null) request.deny();
                        return;
                    }
                    List<String> granted = new ArrayList<>();
                    for (String resource : request.getResources()) {
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)
                            && appContext.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                            granted.add(resource);
                        }
                    }
                    if (granted.isEmpty()) request.deny();
                    else request.grant(granted.toArray(new String[0]));
                }
            });

            capacitorBridge = AlphaOverlayCapacitorBridge.attach(
                appContext,
                webView,
                ASSET_DOMAIN,
                this::evaluateScript
            );

            WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .setDomain(ASSET_DOMAIN)
                .addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(appContext))
                .build();
            webView.setWebViewClient(new WebViewClient() {
                @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    Uri url = request == null ? null : request.getUrl();
                    return !isOverlayOrigin(url);
                }

                @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    Uri url = request.getUrl();
                    if (isOverlayOrigin(url)) {
                        String path = url.getPath();
                        if (path == null || path.isEmpty() || "/".equals(path)) {
                            url = url.buildUpon().path("/public/index.html").build();
                        } else if (!path.startsWith("/public/")) {
                            url = url.buildUpon().path("/public" + path).build();
                        }
                        return assetLoader.shouldInterceptRequest(url);
                    }
                    return null;
                }

                @Override public void onPageStarted(WebView view, String url, Bitmap favicon) {
                    pageReady = false;
                    if (url != null && isOverlayOrigin(Uri.parse(url))) {
                        view.evaluateJavascript(AlphaOverlayCapacitorBridge.bootstrapScript(), null);
                    }
                }

                @Override public void onPageFinished(WebView view, String url) {
                    if (url != null && isOverlayOrigin(Uri.parse(url))) {
                        view.evaluateJavascript(AlphaOverlayCapacitorBridge.bootstrapScript(), null);
                        pageReady = true;
                        flushPendingScripts(view);
                    }
                }
            });
            webView.addJavascriptInterface(new OverlayJsBridge(), "AlphaOverlayNative");
            webView.loadUrl(OVERLAY_URL);
            warmView = webView;
            return webView;
        }
    }

    /** JavaScript interface bridging overlay region, focus, and intent commands from the warm WebView to the active session. */
    static final class OverlayJsBridge {
        @JavascriptInterface public void setTouchableRegions(String rectsJson, float density) {
            AlphaOverlayHostPlugin.HostDelegate host = AlphaOverlayHostPlugin.currentHost();
            if (host == null) return;
            float scale = Float.isFinite(density) && density > 0f ? density : 1f;
            List<Rect> rects = new ArrayList<>();
            if (rectsJson != null && !rectsJson.isBlank()) {
                try {
                    JSONArray array = new JSONArray(rectsJson);
                    for (int index = 0; index < array.length(); index++) {
                        JSONObject item = array.optJSONObject(index);
                        if (item == null) continue;
                        int left = Math.round((float) item.optDouble("left", 0) * scale);
                        int top = Math.round((float) item.optDouble("top", 0) * scale);
                        int right = Math.round((float) item.optDouble("right", 0) * scale);
                        int bottom = Math.round((float) item.optDouble("bottom", 0) * scale);
                        if (right > left && bottom > top) {
                            rects.add(new Rect(left, top, right, bottom));
                        }
                    }
                } catch (JSONException ignored) {
                }
            }
            host.setTouchableRegions(rects);
        }

        @JavascriptInterface public void setFocusable(boolean focusable) {
            AlphaOverlayHostPlugin.HostDelegate host = AlphaOverlayHostPlugin.currentHost();
            if (host != null) host.setFocusable(focusable);
        }

        @JavascriptInterface public void dismiss() {
            AlphaOverlayHostPlugin.HostDelegate host = AlphaOverlayHostPlugin.currentHost();
            if (host != null) host.dismiss();
        }

        @JavascriptInterface public boolean openAppIntent(String uri, String claimId, String payloadJson) {
            AlphaOverlayHostPlugin.HostDelegate host = AlphaOverlayHostPlugin.currentHost();
            return host != null && host.openAppIntent(uri, claimId, payloadJson);
        }
    }

    private WarmOverlayWebViewPool webViewPool;

    @Override public void onCreate() {
        super.onCreate();
        webViewPool = new WarmOverlayWebViewPool(this);
        webViewPool.warmUp();
    }

    @Override public VoiceInteractionSession onNewSession(Bundle args) {
        if (webViewPool == null) {
            webViewPool = new WarmOverlayWebViewPool(this);
        }
        return new AlphaVoiceInteractionSession(this, webViewPool);
    }

    @Override public void onDestroy() {
        if (webViewPool != null) {
            webViewPool.destroy();
            webViewPool = null;
        }
        super.onDestroy();
    }
}
