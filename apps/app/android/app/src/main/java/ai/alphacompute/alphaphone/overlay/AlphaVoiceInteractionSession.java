package ai.alphacompute.alphaphone.overlay;

import ai.alphacompute.alphaphone.ipc.AlphaContextRegistryService;
import ai.alphacompute.alphaphone.ipc.AlphaSuitePolicyLoader;
import ai.alphacompute.control.AlphaControlPolicy;
import ai.alphacompute.ipc.AlphaIpcContract;
import ai.alphacompute.ipc.AlphaSuitePolicy;
import ai.alphacompute.ipc.IAlphaActionCallback;
import android.app.ActivityOptions;
import android.app.KeyguardManager;
import android.app.assist.AssistContent;
import android.app.assist.AssistStructure;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Rect;
import android.graphics.Region;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.service.voice.VoiceInteractionSession;
import android.text.InputType;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebView;
import android.widget.FrameLayout;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

/** System-wide Ask Alpha {@link VoiceInteractionSession} providing region-based touch passthrough, IME focus control, and Assist capture. */
public final class AlphaVoiceInteractionSession extends VoiceInteractionSession implements AlphaOverlayHostPlugin.HostDelegate {
    private static final int MAX_ASSIST_TEXT_CHARS = 4_096;
    private static final int MAX_ASSIST_NODES = 256;
    private static final int FALLBACK_BAR_HEIGHT_DP = 88;

    private final AlphaVoiceInteractionSessionService.WarmOverlayWebViewPool webViewPool;
    private final AlphaSuitePolicy suitePolicy;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Object regionsLock = new Object();
    private final List<Rect> touchableRects = new ArrayList<>();

    private record InsetsSnapshot(int top, int bottom, boolean keyboard) {}

    private FrameLayout container;
    private WebView attachedWebView;
    private volatile InsetsSnapshot lastInsets;
    private volatile boolean overlayFocusable;

    public AlphaVoiceInteractionSession(Context context, AlphaVoiceInteractionSessionService.WarmOverlayWebViewPool webViewPool) {
        super(context);
        this.webViewPool = webViewPool;
        this.suitePolicy = AlphaSuitePolicyLoader.load(context);
    }

    @Override public View onCreateContentView() {
        FrameLayout root = new FrameLayout(getContext());
        root.setBackgroundColor(Color.TRANSPARENT);
        root.setLayoutParams(new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));
        attachedWebView = webViewPool.acquire();
        root.addView(attachedWebView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));
        container = root;
        configureOverlayWindow();
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, incoming) -> {
            var bars = incoming.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            float density = getContext().getResources().getDisplayMetrics().density;
            if (!Float.isFinite(density) || density <= 0f) density = 1f;
            InsetsSnapshot measured = new InsetsSnapshot(
                Math.round(bars.top / density),
                Math.round(bars.bottom / density),
                incoming.isVisible(WindowInsetsCompat.Type.ime())
            );
            if (!measured.equals(lastInsets)) {
                lastInsets = measured;
                webViewPool.publishInsets(measured.top(), measured.bottom(), measured.keyboard());
            }
            return ViewCompat.onApplyWindowInsets(view, incoming);
        });
        ViewCompat.requestApplyInsets(root);
        return root;
    }

    @Override public void onShow(Bundle args, int showFlags) {
        super.onShow(args, showFlags);
        AlphaOverlayHostPlugin.attachHost(this);
        configureOverlayWindow();
        applyFocusableFlag(overlayFocusable);
        webViewPool.onSessionShow();
        InsetsSnapshot snapshot = lastInsets;
        if (snapshot != null) {
            webViewPool.publishInsets(snapshot.top(), snapshot.bottom(), snapshot.keyboard());
        }

        JSONObject showDetail = new JSONObject();
        try {
            showDetail.put("showFlags", showFlags);
            if (args != null) {
                String source = args.getString(AlphaVoiceInteractionService.EXTRA_ENTRY_SOURCE);
                String query = args.getString(AlphaVoiceInteractionService.EXTRA_INITIAL_QUERY);
                if (source != null) showDetail.put("entrySource", source);
                if (query != null) showDetail.put("initialQuery", query);
                showDetail.put("startVoice", args.getBoolean(AlphaVoiceInteractionService.EXTRA_START_VOICE, false));
            }
            String activeContext = AlphaContextRegistryService.currentActiveContextJson();
            if (activeContext != null) {
                showDetail.put("activeContext", new JSONTokener(activeContext).nextValue());
            }
            AlphaOverlayIntakeActivity.StagedAttachment staged = AlphaOverlayIntakeActivity.takePendingAttachment();
            if (staged != null) {
                showDetail.put("stagedAttachment", staged.toJson());
            }
        } catch (JSONException ignored) {
        }
        webViewPool.dispatchWindowEvent("alpha-overlay-show", showDetail);
    }

    @Override public void onHide() {
        overlayFocusable = false;
        applyFocusableFlag(false);
        AlphaOverlayHostPlugin.detachHost(this);
        webViewPool.onSessionHide();
        webViewPool.dispatchWindowEvent("alpha-overlay-hide", new JSONObject());
        super.onHide();
    }

    @Override public void onDestroy() {
        AlphaOverlayHostPlugin.detachHost(this);
        if (attachedWebView != null) {
            webViewPool.release(attachedWebView);
            attachedWebView = null;
        }
        container = null;
        super.onDestroy();
    }

    @Override public void onComputeInsets(Insets outInsets) {
        super.onComputeInsets(outInsets);
        outInsets.touchableInsets = Insets.TOUCHABLE_INSETS_REGION;
        outInsets.touchableRegion.setEmpty();
        synchronized (regionsLock) {
            if (!touchableRects.isEmpty()) {
                for (Rect rect : touchableRects) {
                    outInsets.touchableRegion.op(rect, Region.Op.UNION);
                }
                return;
            }
        }
        View root = container;
        if (root != null && root.getWidth() > 0 && root.getHeight() > 0) {
            float density = getContext().getResources().getDisplayMetrics().density;
            int barPx = Math.round(FALLBACK_BAR_HEIGHT_DP * density);
            int top = Math.max(0, root.getHeight() - barPx);
            outInsets.touchableRegion.set(0, top, root.getWidth(), root.getHeight());
        }
    }

    @Override public void onHandleAssist(AssistState state) {
        super.onHandleAssist(state);
        if (isDeviceLocked()) return;
        AssistStructure structure = state.getAssistStructure();
        ComponentName component = structure == null ? null : structure.getActivityComponent();
        String packageName = component == null ? null : component.getPackageName();
        String activityName = component == null ? null : component.getClassName();
        if (packageName != null && AlphaControlPolicy.isBlockedTarget(packageName, activityName)) {
            return;
        }
        JSONObject payload = new JSONObject();
        Uri webUri = null;
        try {
            AssistContent content = state.getAssistContent();
            if (content != null) {
                webUri = content.getWebUri();
                if (webUri != null) {
                    payload.put("webUri", webUri.toString());
                }
                String structured = content.getStructuredData();
                if (structured != null && structured.length() <= MAX_ASSIST_TEXT_CHARS) {
                    payload.put("structuredData", structured);
                }
            }
            if (structure != null && component != null) {
                payload.put("packageName", packageName);
                payload.put("activityName", activityName);
                StringBuilder summary = new StringBuilder();
                int[] visited = new int[] { 0 };
                String title = extractAssistSummary(structure, summary, visited);
                if (title != null && !title.isBlank()) {
                    payload.put("title", title);
                }
                if (summary.length() > 0) {
                    payload.put("text", summary.toString());
                }
            }
            if (packageName != null && webUri != null) {
                AlphaControlRuntimeBridge.forwardAssistWebUri(packageName, webUri);
            }
            String activeContext = AlphaContextRegistryService.currentActiveContextJson();
            if (activeContext != null) {
                payload.put("activeContextJson", activeContext);
            }
        } catch (JSONException ignored) {
        }
        AlphaOverlayHostPlugin.emitAssistContext(payload);
        webViewPool.emitAssistContext(payload);
        webViewPool.dispatchWindowEvent("alpha-assist-context", payload);
    }

    @Override public void setTouchableRegions(List<Rect> rects) {
        synchronized (regionsLock) {
            touchableRects.clear();
            if (rects != null) {
                for (Rect rect : rects) {
                    if (rect != null && rect.width() > 0 && rect.height() > 0) {
                        touchableRects.add(new Rect(rect));
                    }
                }
            }
        }
        mainHandler.post(() -> {
            if (container != null) {
                container.requestLayout();
                container.invalidate();
            }
        });
    }

    @Override public void setFocusable(boolean focusable) {
        overlayFocusable = focusable;
        mainHandler.post(() -> applyFocusableFlag(focusable));
    }

    @Override public void dismiss() {
        mainHandler.post(this::hide);
    }

    @Override public boolean openAppIntent(String rawUri, String claimId, String payloadJson) {
        if (rawUri == null || rawUri.isBlank()) return false;
        Uri uri = Uri.parse(rawUri);
        if (!AlphaIpcContract.SCHEME_ALPHA.equals(uri.getScheme())) return false;
        String appId = uri.getHost();
        AlphaSuitePolicy.AppRule rule = suitePolicy.ruleForId(appId);
        if (rule == null) return false;
        if (payloadJson != null && payloadJson.getBytes(StandardCharsets.UTF_8).length > AlphaIpcContract.MAX_INTENT_PAYLOAD_BYTES) {
            return false;
        }
        Intent intent = new Intent(AlphaIpcContract.ACTION_AGENT_OPEN, uri)
            .setPackage(rule.applicationId())
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            .putExtra(AlphaIpcContract.EXTRA_NONCE, UUID.randomUUID().toString());
        if (claimId != null && !claimId.isEmpty()) {
            intent.putExtra(AlphaIpcContract.EXTRA_CLAIM_ID, claimId);
            IAlphaActionCallback.Stub callback = new IAlphaActionCallback.Stub() {
                @Override public void onResult(String id, boolean switched, String resultJson, String errorCode) {
                    JSONObject receipt = new JSONObject();
                    try {
                        receipt.put("claimId", id == null ? claimId : id)
                            .put("switched", switched)
                            .put("resultJson", resultJson == null ? JSONObject.NULL : resultJson)
                            .put("errorCode", errorCode == null ? "" : errorCode);
                    } catch (JSONException ignored) {
                        return;
                    }
                    AlphaOverlayHostPlugin.emitActionResult(receipt);
                    webViewPool.emitActionResult(receipt);
                }
            };
            Bundle callbackExtras = new Bundle();
            callbackExtras.putBinder(AlphaIpcContract.EXTRA_CALLBACK, callback.asBinder());
            intent.putExtras(callbackExtras);
        }
        if (payloadJson != null && !payloadJson.isEmpty()) {
            intent.putExtra(AlphaIpcContract.EXTRA_PAYLOAD, payloadJson);
        }
        try {
            Bundle options = null;
            if (Build.VERSION.SDK_INT >= 34) {
                options = ActivityOptions.makeBasic().setShareIdentityEnabled(true).toBundle();
            }
            getContext().startActivity(intent, options);
            return true;
        } catch (RuntimeException unavailable) {
            return false;
        }
    }

    private void configureOverlayWindow() {
        if (getWindow() == null || getWindow().getWindow() == null) return;
        Window window = getWindow().getWindow();
        window.setBackgroundDrawableResource(android.R.color.transparent);
        window.setDimAmount(0f);
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
    }

    private void applyFocusableFlag(boolean focusable) {
        if (getWindow() == null || getWindow().getWindow() == null) return;
        Window window = getWindow().getWindow();
        if (focusable) {
            window.clearFlags(WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE);
        } else {
            window.addFlags(WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE);
        }
    }

    private boolean isDeviceLocked() {
        KeyguardManager keyguard = getContext().getSystemService(KeyguardManager.class);
        return keyguard != null && (keyguard.isDeviceLocked() || keyguard.isKeyguardLocked());
    }

    private static String extractAssistSummary(AssistStructure structure, StringBuilder out, int[] visited) {
        String title = null;
        int windows = structure.getWindowNodeCount();
        for (int index = 0; index < windows; index++) {
            AssistStructure.WindowNode window = structure.getWindowNodeAt(index);
            if (window == null) continue;
            if (title == null && window.getTitle() != null) {
                title = window.getTitle().toString();
            }
            AssistStructure.ViewNode root = window.getRootViewNode();
            if (root != null) {
                walkViewNode(root, out, visited);
            }
        }
        return title;
    }

    private static void walkViewNode(AssistStructure.ViewNode node, StringBuilder out, int[] visited) {
        if (node == null || visited[0] >= MAX_ASSIST_NODES || out.length() >= MAX_ASSIST_TEXT_CHARS) return;
        visited[0]++;
        if (node.getVisibility() != View.VISIBLE || isSensitiveInput(node)) return;
        CharSequence text = node.getText();
        if (text != null && text.length() > 0) {
            appendBounded(out, text.toString().trim());
        } else {
            CharSequence desc = node.getContentDescription();
            if (desc != null && desc.length() > 0) {
                appendBounded(out, desc.toString().trim());
            }
        }
        int children = node.getChildCount();
        for (int index = 0; index < children; index++) {
            walkViewNode(node.getChildAt(index), out, visited);
        }
    }

    private static boolean isSensitiveInput(AssistStructure.ViewNode node) {
        int inputType = node.getInputType();
        int variation = inputType & InputType.TYPE_MASK_VARIATION;
        int clazz = inputType & InputType.TYPE_MASK_CLASS;
        if (clazz == InputType.TYPE_CLASS_TEXT) {
            return variation == InputType.TYPE_TEXT_VARIATION_PASSWORD
                || variation == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
                || variation == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD;
        }
        if (clazz == InputType.TYPE_CLASS_NUMBER) {
            return variation == InputType.TYPE_NUMBER_VARIATION_PASSWORD;
        }
        return false;
    }

    private static void appendBounded(StringBuilder out, String segment) {
        if (segment.isEmpty() || out.length() >= MAX_ASSIST_TEXT_CHARS) return;
        if (out.length() > 0) out.append('\n');
        int remaining = MAX_ASSIST_TEXT_CHARS - out.length();
        out.append(segment.length() <= remaining ? segment : segment.substring(0, remaining));
    }
}
