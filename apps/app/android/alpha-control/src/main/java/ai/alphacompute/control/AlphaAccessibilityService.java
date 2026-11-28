// spec/app/control/index.md, "Story: Control a third-party app within an owner-approved lease"; spec/app/control/index.md, "Story: Enforce formal safety guarantees over external app control"
package ai.alphacompute.control;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.app.KeyguardManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Path;
import android.graphics.Rect;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.os.UserManager;
import android.util.Base64;
import android.util.Log;
import android.view.Display;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;
import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

/**
 * AccessibilityService providing multi-window UI tree perception, Firefox/GeckoView URL and
 * Compose toolbar extraction, protected-screen detection, touch preemption, and semantic actuation.
 */
public final class AlphaAccessibilityService extends AccessibilityService {
    /** Listener notified when physical touch preemption, screen change, or lifecycle state occurs. */
    public interface ControlListener {
        void onServiceStateChanged(boolean connected);
        void onForegroundChanged(String packageName, String activityName);
        void onPhysicalPreemption(String packageName);
    }

    /** Immutable normalized UI node snapshot exported to the resident agent. */
    public static final class SerializedNode {
        public final String nodeId;
        public final String role;
        public final String resourceId;
        public final String text;
        public final String contentDescription;
        public final String hintText;
        public final Rect bounds;
        public final boolean clickable;
        public final boolean editable;
        public final boolean scrollable;
        public final boolean sensitive;

        public SerializedNode(
            String nodeId,
            String role,
            String resourceId,
            String text,
            String contentDescription,
            String hintText,
            Rect bounds,
            boolean clickable,
            boolean editable,
            boolean scrollable,
            boolean sensitive
        ) {
            this.nodeId = nodeId;
            this.role = role;
            this.resourceId = resourceId;
            this.text = text;
            this.contentDescription = contentDescription;
            this.hintText = hintText;
            this.bounds = bounds;
            this.clickable = clickable;
            this.editable = editable;
            this.scrollable = scrollable;
            this.sensitive = sensitive;
        }
    }

    /** Immutable foreground capture returned to AlphaUiControlExecutor. */
    public static final class CapturedObservation {
        public final int localRevision;
        public final String packageName;
        public final String activityName;
        public final String webUri;
        public final AlphaControlPolicy.ScreenProtection protection;
        public final int windowCount;
        public final List<SerializedNode> nodes;

        public CapturedObservation(
            int localRevision,
            String packageName,
            String activityName,
            String webUri,
            AlphaControlPolicy.ScreenProtection protection,
            int windowCount,
            List<SerializedNode> nodes
        ) {
            this.localRevision = localRevision;
            this.packageName = packageName;
            this.activityName = activityName;
            this.webUri = webUri;
            this.protection = protection;
            this.windowCount = windowCount;
            this.nodes = nodes;
        }
    }

    /** Result of a Tier-1 AccessibilityService screenshot capture. */
    public static final class ScreenshotCapture {
        public final String base64Jpeg;
        public final int width;
        public final int height;
        public final String errorCode;

        public ScreenshotCapture(String base64Jpeg, int width, int height, String errorCode) {
            this.base64Jpeg = base64Jpeg;
            this.width = width;
            this.height = height;
            this.errorCode = errorCode;
        }
    }

    private static final String TAG_SERVICE = "AlphaAccessibilityService";
    private static final String TAG_POLICY = "AlphaControlPolicy";
    private static final long RETRY_OBSERVE_INTERVAL_MS = 400L;
    private static final AtomicReference<AlphaAccessibilityService> LIVE = new AtomicReference<>();
    private static final AtomicReference<ControlListener> LISTENER = new AtomicReference<>();
    private static final Map<String, String> ASSIST_WEB_URIS = new ConcurrentHashMap<>();
    private static final AtomicBoolean ACTUATION_IN_PROGRESS = new AtomicBoolean(false);
    private static final Executor SCREENSHOT_EXECUTOR = Executors.newSingleThreadExecutor((runnable) -> {
        Thread thread = new Thread(runnable, "alpha-control-screenshot");
        thread.setDaemon(true);
        return thread;
    });

    private final AtomicInteger localRevision = new AtomicInteger(0);
    private final AtomicInteger lastObservedNodes = new AtomicInteger(0);
    private final AtomicLong lastRetryObserveElapsedMs = new AtomicLong(0L);
    private final AtomicLong lastScreenshotElapsedMs = new AtomicLong(0L);
    private final Object nodeCacheLock = new Object();
    private final Map<String, AccessibilityNodeInfo> liveNodes = new HashMap<>();
    private volatile String activePackage = "";
    private volatile String activeActivity = "";
    private volatile String lastObservedPackage = "";
    private volatile boolean activeWindowFlagSecure;

    /** Return the currently connected accessibility service instance, or null if disabled. */
    public static AlphaAccessibilityService live() {
        return LIVE.get();
    }

    /** Register the native executor listener for lifecycle, foreground, and touch-preemption callbacks. */
    public static void setControlListener(ControlListener listener) {
        LISTENER.set(listener);
    }

    /** Record a canonical URL supplied by VoiceInteractionSession AssistContent.getWebUri(). */
    public static void updateAssistWebUri(String packageName, String webUri) {
        if (packageName == null || packageName.isBlank()) return;
        if (webUri == null || !AlphaControlPolicy.isValidHttpsUrl(webUri)) {
            ASSIST_WEB_URIS.remove(packageName.trim());
            return;
        }
        ASSIST_WEB_URIS.put(packageName.trim(), webUri.trim());
    }

    /** Mark whether an automated actuation step is currently executing so user touch triggers preemption. */
    public static void setActuationInProgress(boolean active) {
        ACTUATION_IN_PROGRESS.set(active);
    }

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        LIVE.set(this);
        Log.i(TAG_SERVICE, "event=connected tier=TierAccessibility");
        ControlListener listener = LISTENER.get();
        if (listener != null) listener.onServiceStateChanged(true);
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null) return;
        int type = event.getEventType();
        if (type == AccessibilityEvent.TYPE_TOUCH_INTERACTION_START && ACTUATION_IN_PROGRESS.get()) {
            ControlListener listener = LISTENER.get();
            if (listener != null) listener.onPhysicalPreemption(activePackage);
            return;
        }
        if (type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED || type == AccessibilityEvent.TYPE_WINDOWS_CHANGED) {
            String previousPackage = activePackage;
            CharSequence pkg = event.getPackageName();
            CharSequence cls = event.getClassName();
            if (pkg != null && pkg.length() > 0) {
                activePackage = pkg.toString();
            }
            activeActivity = resolveNextActivity(
                previousPackage,
                activePackage,
                activeActivity,
                cls == null ? null : cls.toString()
            );
            boolean packageChanged = !activePackage.equals(previousPackage);
            if (packageChanged) {
                activeWindowFlagSecure = false;
                lastObservedNodes.set(0);
                lastRetryObserveElapsedMs.set(0L);
            }
            ControlListener listener = LISTENER.get();
            if (listener != null) {
                if (AlphaControlPolicy.isBlockedTarget(activePackage, activeActivity)) {
                    Log.i(TAG_POLICY, "event=refuse pkg=" + activePackage + " targetKind=BlockedApp protection=ScreenClear");
                }
                listener.onForegroundChanged(activePackage, activeActivity);
            } else if (!activePackage.isEmpty()) {
                long nowMs = SystemClock.elapsedRealtime();
                boolean shouldObserve = (type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED && packageChanged)
                    || shouldRetryEmptyObservation(
                        activePackage,
                        activeActivity,
                        lastObservedPackage,
                        lastObservedNodes.get(),
                        lastRetryObserveElapsedMs.get(),
                        nowMs
                    );
                if (shouldObserve) {
                    captureObservation(false, 80, event.getSource());
                }
            }
            return;
        }
        if (type == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) {
            CharSequence eventPkgSeq = event.getPackageName();
            String eventPkg = eventPkgSeq == null ? "" : eventPkgSeq.toString();
            if (activePackage.isEmpty() && !eventPkg.isEmpty() && !AlphaControlPolicy.isBlockedTarget(eventPkg, null)) {
                activePackage = eventPkg;
            }
            long nowMs = SystemClock.elapsedRealtime();
            if (shouldRetryEmptyObservation(
                activePackage,
                activeActivity,
                lastObservedPackage,
                lastObservedNodes.get(),
                lastRetryObserveElapsedMs.get(),
                nowMs
            )) {
                lastRetryObserveElapsedMs.set(nowMs);
                ControlListener listener = LISTENER.get();
                if (listener != null) {
                    listener.onForegroundChanged(activePackage, activeActivity);
                } else {
                    captureObservation(false, 80, event.getSource());
                }
            }
        }
    }

    @Override
    public void onInterrupt() {
        ControlListener listener = LISTENER.get();
        if (listener != null) listener.onPhysicalPreemption(activePackage);
    }

    @Override
    public void onDestroy() {
        LIVE.compareAndSet(this, null);
        clearNodeCache();
        lastObservedNodes.set(0);
        lastObservedPackage = "";
        lastRetryObserveElapsedMs.set(0L);
        ControlListener listener = LISTENER.get();
        if (listener != null) listener.onServiceStateChanged(false);
        super.onDestroy();
    }

    /** Capture the current multi-window observation while honoring lockscreen, FLAG_SECURE, and sensitive-node rules. */
    public CapturedObservation captureObservation(boolean includeNonInteractive, int maxNodes) {
        return captureObservation(includeNonInteractive, maxNodes, null);
    }

    private CapturedObservation captureObservation(
        boolean includeNonInteractive,
        int maxNodes,
        AccessibilityNodeInfo eventSource
    ) {
        int limit = Math.max(1, Math.min(maxNodes, AlphaControlPolicy.MAX_OBSERVED_NODES));
        KeyguardManager keyguard = getSystemService(KeyguardManager.class);
        UserManager users = getSystemService(UserManager.class);
        boolean keyguardLocked = keyguard != null && keyguard.isKeyguardLocked();
        boolean deviceLocked = keyguard != null && keyguard.isDeviceLocked();
        boolean userUnlocked = users == null || users.isUserUnlocked();

        List<AccessibilityWindowInfo> windows = getWindows();
        int windowCount = windows == null ? 0 : windows.size();
        AccessibilityWindowInfo primaryAppWindow = findPrimaryAppWindow(windows);
        AccessibilityNodeInfo activeWindowRoot = getRootInActiveWindow();
        AccessibilityNodeInfo sourceRoot = rootOf(eventSource);
        String pkg = activePackage;
        String windowTitle = "";
        boolean flagSecure = activeWindowFlagSecure;

        AccessibilityNodeInfo primaryRoot = primaryAppWindow != null ? primaryAppWindow.getRoot() : null;
        if (primaryRoot == null) {
            primaryRoot = activeWindowRoot;
        }
        if (primaryRoot == null) {
            primaryRoot = sourceRoot;
        }
        if (primaryAppWindow != null) {
            CharSequence title = primaryAppWindow.getTitle();
            if (title != null) windowTitle = title.toString();
        }
        if (primaryRoot != null && primaryRoot.getPackageName() != null) {
            pkg = primaryRoot.getPackageName().toString();
        }
        if (hasSystemSecurityOverlay(windows)) {
            pkg = "com.android.permissioncontroller";
        }
        boolean privateTab = AlphaControlPolicy.isPrivateBrowserWindow(pkg, windowTitle, flagSecure);
        boolean sensitiveFocused = isSensitiveViewActive(windows, primaryRoot);
        AlphaControlPolicy.ScreenProtection protection = AlphaControlPolicy.classifyScreenProtection(
            keyguardLocked, deviceLocked, userUnlocked, flagSecure, privateTab, sensitiveFocused
        );

        int revision = localRevision.incrementAndGet();
        String activity = pkg.equals(activePackage) ? activeActivity : "";
        boolean blocked = !pkg.isEmpty() && AlphaControlPolicy.isBlockedTarget(pkg, activity);
        String targetKind = pkg.isEmpty() ? "NoTarget" : (blocked ? "BlockedApp" : "AllowedApp");
        if (protection != AlphaControlPolicy.ScreenProtection.ScreenClear || blocked) {
            clearNodeCache();
            lastObservedPackage = pkg;
            lastObservedNodes.set(0);
            lastRetryObserveElapsedMs.set(SystemClock.elapsedRealtime());
            Log.i(TAG_POLICY, "event=refuse pkg=" + pkg + " targetKind=" + targetKind + " protection=" + protection.name());
            Log.i(TAG_SERVICE, "event=observe pkg=" + pkg + " targetKind=" + targetKind + " protection=" + protection.name() + " nodes=0 snapId=" + revision);
            return new CapturedObservation(revision, pkg, activity, null, protection, windowCount, Collections.emptyList());
        }

        List<SerializedNode> serialized = new ArrayList<>();
        Map<String, AccessibilityNodeInfo> nextCache = new HashMap<>();
        String detectedUrl = ASSIST_WEB_URIS.get(pkg);

        if (primaryAppWindow != null) {
            AccessibilityNodeInfo root = primaryAppWindow.getRoot();
            if (root != null && isAllowedRootPackage(root, pkg, activity)) {
                String candidateUrl = collectNodes(root, primaryAppWindow.getId(), includeNonInteractive, limit, serialized, nextCache, pkg);
                if (detectedUrl == null && candidateUrl != null) {
                    detectedUrl = candidateUrl;
                }
            }
        }
        if (windows != null && !windows.isEmpty()) {
            for (int w = 0; w < windows.size() && serialized.size() < limit; w++) {
                AccessibilityWindowInfo window = windows.get(w);
                if (window == primaryAppWindow || window.getType() != AccessibilityWindowInfo.TYPE_APPLICATION) continue;
                AccessibilityNodeInfo root = window.getRoot();
                if (root == null || !isAllowedRootPackage(root, pkg, activity)) continue;
                String candidateUrl = collectNodes(root, window.getId(), includeNonInteractive, limit, serialized, nextCache, pkg);
                if (detectedUrl == null && candidateUrl != null) {
                    detectedUrl = candidateUrl;
                }
            }
        }
        if (serialized.isEmpty() && activeWindowRoot != null && isAllowedRootPackage(activeWindowRoot, pkg, activity)) {
            if (pkg.isEmpty() && activeWindowRoot.getPackageName() != null) {
                pkg = activeWindowRoot.getPackageName().toString();
            }
            String candidateUrl = collectNodes(activeWindowRoot, 0, includeNonInteractive, limit, serialized, nextCache, pkg);
            if (detectedUrl == null && candidateUrl != null) {
                detectedUrl = candidateUrl;
            }
        }
        if (serialized.isEmpty() && sourceRoot != null && isAllowedRootPackage(sourceRoot, pkg, activity)) {
            if (pkg.isEmpty() && sourceRoot.getPackageName() != null) {
                pkg = sourceRoot.getPackageName().toString();
            }
            String candidateUrl = collectNodes(sourceRoot, 0, includeNonInteractive, limit, serialized, nextCache, pkg);
            if (detectedUrl == null && candidateUrl != null) {
                detectedUrl = candidateUrl;
            }
        }

        synchronized (nodeCacheLock) {
            liveNodes.clear();
            liveNodes.putAll(nextCache);
        }
        lastObservedPackage = pkg;
        lastObservedNodes.set(serialized.size());
        lastRetryObserveElapsedMs.set(SystemClock.elapsedRealtime());
        targetKind = pkg.isEmpty() ? "NoTarget" : "AllowedApp";
        Log.i(TAG_SERVICE, "event=observe pkg=" + pkg + " targetKind=" + targetKind + " protection=" + protection.name() + " nodes=" + serialized.size() + " snapId=" + revision);
        return new CapturedObservation(
            revision,
            pkg,
            activity,
            AlphaControlPolicy.isValidHttpsUrl(detectedUrl) ? detectedUrl : null,
            protection,
            windowCount,
            Collections.unmodifiableList(serialized)
        );
    }

    /** Perform semantic click or long-click on a cached non-sensitive node, falling back to its center bounds if needed. */
    public boolean clickNode(String nodeId, boolean longClick) {
        AccessibilityNodeInfo node = lookupNode(nodeId);
        if (node == null || isNodeSensitive(node)) return false;
        int action = longClick ? AccessibilityNodeInfo.ACTION_LONG_CLICK : AccessibilityNodeInfo.ACTION_CLICK;
        if (node.performAction(action)) return true;
        Rect bounds = new Rect();
        node.getBoundsInScreen(bounds);
        if (bounds.isEmpty()) return false;
        return dispatchPointGesture(bounds.exactCenterX(), bounds.exactCenterY(), longClick ? 650L : 80L);
    }

    /**
     * Set text on an editable non-sensitive node, verifying the refreshed node text across all
     * packages (including Chrome, Firefox/GeckoView, and React WebViews) before falling back to
     * clipboard paste.
     */
    public boolean setNodeText(String nodeId, String text, boolean isFirefox) {
        AccessibilityNodeInfo node = lookupNode(nodeId);
        if (node == null || isNodeSensitive(node)) return false;
        node.performAction(AccessibilityNodeInfo.ACTION_FOCUS);
        Bundle args = new Bundle();
        args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text);
        boolean direct = node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
        if (direct && node.refresh() && didDirectSetTextApply(true, text, node.getText())) {
            return true;
        }
        ClipboardManager clipboard = getSystemService(ClipboardManager.class);
        if (clipboard == null) return direct && !isFirefox;
        node.performAction(AccessibilityNodeInfo.ACTION_CLICK);
        clipboard.setPrimaryClip(ClipData.newPlainText("alpha_input", text));
        return node.performAction(AccessibilityNodeInfo.ACTION_PASTE) || direct;
    }

    /** Trigger the IME submit/enter action on a cached non-sensitive node on Android 11+. */
    public boolean performImeEnter(String nodeId) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return false;
        AccessibilityNodeInfo node = lookupNode(nodeId);
        if (node == null || isNodeSensitive(node)) return false;
        return node.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.getId());
    }

    static boolean didDirectSetTextApply(boolean directOk, String requestedText, CharSequence observedAfterRefresh) {
        if (!directOk || requestedText == null || observedAfterRefresh == null) return false;
        return requestedText.contentEquals(observedAfterRefresh);
    }

    /** Scroll a cached container node or the active viewport along the requested direction. */
    public boolean scrollNode(String nodeId, String direction) {
        AccessibilityNodeInfo node = nodeId == null ? getRootInActiveWindow() : lookupNode(nodeId);
        if (node != null && !isNodeSensitive(node)) {
            int action = ("up".equals(direction) || "left".equals(direction))
                ? AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
                : AccessibilityNodeInfo.ACTION_SCROLL_FORWARD;
            if (node.performAction(action)) return true;
        }
        return false;
    }

    /** Dispatch a single-stroke tap or long-press gesture at screen coordinates. */
    public boolean dispatchPointGesture(float x, float y, long durationMs) {
        Path path = new Path();
        path.moveTo(x, y);
        return dispatchStroke(path, Math.max(50L, Math.min(2_000L, durationMs)));
    }

    /** Dispatch a single-stroke swipe gesture between two screen coordinates. */
    public boolean dispatchSwipeGesture(float startX, float startY, float endX, float endY, long durationMs) {
        Path path = new Path();
        path.moveTo(startX, startY);
        path.lineTo(endX, endY);
        return dispatchStroke(path, Math.max(50L, Math.min(2_000L, durationMs)));
    }

    /** Perform an allowlisted global system action. */
    public boolean runGlobalAction(String action) {
        if ("back".equals(action)) return performGlobalAction(GLOBAL_ACTION_BACK);
        if ("home".equals(action)) return performGlobalAction(GLOBAL_ACTION_HOME);
        if ("recents".equals(action)) return performGlobalAction(GLOBAL_ACTION_RECENTS);
        if ("notifications".equals(action)) return performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS);
        if ("dismiss_shade".equals(action) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return performGlobalAction(GLOBAL_ACTION_DISMISS_NOTIFICATION_SHADE);
        }
        return false;
    }

    /** Capture a Tier-1 screenshot via AccessibilityService.takeScreenshot() honoring the 1-second OS throttle. */
    public ScreenshotCapture captureTier1Screenshot(int maxWidth, int jpegQuality) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            return new ScreenshotCapture(null, 0, 0, "SCREENSHOT_API_UNSUPPORTED");
        }
        long now = SystemClock.elapsedRealtime();
        if (!AlphaControlPolicy.isScreenshotAllowed(lastScreenshotElapsedMs.get(), now, false)) {
            return new ScreenshotCapture(null, 0, 0, "SCREENSHOT_THROTTLED");
        }
        CompletableFuture<ScreenshotCapture> future = new CompletableFuture<>();
        takeScreenshot(Display.DEFAULT_DISPLAY, SCREENSHOT_EXECUTOR, new TakeScreenshotCallback() {
            @Override
            public void onSuccess(ScreenshotResult result) {
                lastScreenshotElapsedMs.set(SystemClock.elapsedRealtime());
                Bitmap hardware = Bitmap.wrapHardwareBuffer(result.getHardwareBuffer(), result.getColorSpace());
                result.getHardwareBuffer().close();
                if (hardware == null) {
                    future.complete(new ScreenshotCapture(null, 0, 0, "SCREENSHOT_DECODE_FAILED"));
                    return;
                }
                Bitmap soft = hardware.copy(Bitmap.Config.ARGB_8888, false);
                hardware.recycle();
                if (soft == null) {
                    future.complete(new ScreenshotCapture(null, 0, 0, "SCREENSHOT_COPY_FAILED"));
                    return;
                }
                Bitmap scaled = scaleBitmap(soft, maxWidth);
                if (scaled != soft) soft.recycle();
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                scaled.compress(Bitmap.CompressFormat.JPEG, Math.max(40, Math.min(85, jpegQuality)), out);
                int width = scaled.getWidth();
                int height = scaled.getHeight();
                scaled.recycle();
                future.complete(new ScreenshotCapture(Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP), width, height, null));
            }

            @Override
            public void onFailure(int errorCode) {
                future.complete(new ScreenshotCapture(null, 0, 0, "SCREENSHOT_ERROR_" + errorCode));
            }
        });
        try {
            return future.get(3, TimeUnit.SECONDS);
        } catch (Exception failed) {
            return new ScreenshotCapture(null, 0, 0, "SCREENSHOT_TIMEOUT");
        }
    }

    /** Record whether WindowManager reported FLAG_SECURE on the foreground window. */
    public void setActiveWindowFlagSecure(boolean secure) {
        this.activeWindowFlagSecure = secure;
    }

    private AccessibilityNodeInfo lookupNode(String nodeId) {
        if (nodeId == null || nodeId.isBlank()) return null;
        synchronized (nodeCacheLock) {
            return liveNodes.get(nodeId);
        }
    }

    private void clearNodeCache() {
        synchronized (nodeCacheLock) {
            liveNodes.clear();
        }
    }

    private boolean dispatchStroke(Path path, long durationMs) {
        GestureDescription.Builder builder = new GestureDescription.Builder();
        builder.addStroke(new GestureDescription.StrokeDescription(path, 0L, durationMs));
        CompletableFuture<Boolean> done = new CompletableFuture<>();
        boolean accepted = dispatchGesture(builder.build(), new GestureResultCallback() {
            @Override
            public void onCompleted(GestureDescription gestureDescription) {
                done.complete(true);
            }

            @Override
            public void onCancelled(GestureDescription gestureDescription) {
                done.complete(false);
            }
        }, null);
        if (!accepted) return false;
        try {
            return done.get(durationMs + 1_500L, TimeUnit.MILLISECONDS);
        } catch (Exception failed) {
            return false;
        }
    }

    private static AccessibilityWindowInfo findPrimaryAppWindow(List<AccessibilityWindowInfo> windows) {
        if (windows == null) return null;
        for (AccessibilityWindowInfo window : windows) {
            if (window.getType() == AccessibilityWindowInfo.TYPE_APPLICATION && window.isActive()) {
                return window;
            }
        }
        for (AccessibilityWindowInfo window : windows) {
            if (window.getType() == AccessibilityWindowInfo.TYPE_APPLICATION) {
                return window;
            }
        }
        return null;
    }

    private static boolean hasSystemSecurityOverlay(List<AccessibilityWindowInfo> windows) {
        if (windows == null) return false;
        for (AccessibilityWindowInfo window : windows) {
            AccessibilityNodeInfo root = window.getRoot();
            if (root == null || root.getPackageName() == null) continue;
            String pkg = root.getPackageName().toString();
            if ("com.android.permissioncontroller".equals(pkg)
                || "com.google.android.permissioncontroller".equals(pkg)
                || "com.android.packageinstaller".equals(pkg)
                || "com.google.android.packageinstaller".equals(pkg)) {
                return true;
            }
        }
        return false;
    }

    static String resolveNextActivity(
        String previousPackage,
        String nextPackage,
        String currentActivity,
        String eventClass
    ) {
        if (eventClass != null && !eventClass.isEmpty()) {
            return eventClass;
        }
        String prev = previousPackage == null ? "" : previousPackage;
        String next = nextPackage == null ? "" : nextPackage;
        if (!next.equals(prev)) {
            return "";
        }
        return currentActivity == null ? "" : currentActivity;
    }

    static boolean shouldRetryEmptyObservation(
        String activePkg,
        String activeAct,
        String lastObsPkg,
        int lastObsNodes,
        long lastRetryMs,
        long nowMs
    ) {
        if (activePkg == null || activePkg.isEmpty()) return false;
        if (AlphaControlPolicy.isBlockedTarget(activePkg, activeAct)) return false;
        boolean needsSnapshot = lastObsNodes <= 0 || !activePkg.equals(lastObsPkg == null ? "" : lastObsPkg);
        if (!needsSnapshot) return false;
        return lastRetryMs <= 0L || (nowMs - lastRetryMs) >= RETRY_OBSERVE_INTERVAL_MS;
    }

    static boolean shouldEmitNode(
        boolean visible,
        boolean includeNonInteractive,
        boolean interactive,
        boolean hasContent
    ) {
        if (visible) {
            return includeNonInteractive || interactive || hasContent;
        }
        return interactive || hasContent;
    }

    private static AccessibilityNodeInfo rootOf(AccessibilityNodeInfo node) {
        if (node == null) return null;
        AccessibilityNodeInfo current = node;
        for (int depth = 0; depth < 32; depth++) {
            AccessibilityNodeInfo parent = current.getParent();
            if (parent == null || parent == current) break;
            current = parent;
        }
        return current;
    }

    private static boolean isAllowedRootPackage(AccessibilityNodeInfo root, String expectedPkg, String activity) {
        if (root == null) return false;
        CharSequence rawPkg = root.getPackageName();
        String rootPkg = rawPkg == null ? "" : rawPkg.toString();
        if (!rootPkg.isEmpty() && AlphaControlPolicy.isBlockedTarget(rootPkg, rootPkg.equals(expectedPkg) ? activity : null)) {
            return false;
        }
        return true;
    }

    private boolean isSensitiveViewActive(List<AccessibilityWindowInfo> windows, AccessibilityNodeInfo primaryRoot) {
        AccessibilityNodeInfo inputFocus = findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
        if (inputFocus != null && isNodeSensitive(inputFocus)) return true;
        AccessibilityNodeInfo a11yFocus = findFocus(AccessibilityNodeInfo.FOCUS_ACCESSIBILITY);
        if (a11yFocus != null && isNodeSensitive(a11yFocus)) return true;
        int maxVisited = AlphaControlPolicy.MAX_OBSERVED_NODES * 2;
        boolean scannedAnyWindow = false;
        if (windows != null && !windows.isEmpty()) {
            int remaining = maxVisited;
            for (AccessibilityWindowInfo window : windows) {
                if (remaining <= 0) break;
                if (window.getType() != AccessibilityWindowInfo.TYPE_APPLICATION) continue;
                AccessibilityNodeInfo root = window.getRoot();
                if (root == null) continue;
                scannedAnyWindow = true;
                int scanned = scanSensitiveNodes(root, remaining);
                if (scanned < 0) return true;
                remaining -= scanned;
            }
        }
        if (!scannedAnyWindow && primaryRoot != null) {
            return scanSensitiveNodes(primaryRoot, maxVisited) < 0;
        }
        return false;
    }

    private static int scanSensitiveNodes(AccessibilityNodeInfo root, int maxVisited) {
        if (root == null || maxVisited <= 0) return 0;
        if (isNodeSensitive(root)) return -1;
        List<AccessibilityNodeInfo> stack = new ArrayList<>();
        stack.add(root);
        int visited = 0;
        while (!stack.isEmpty() && visited < maxVisited) {
            AccessibilityNodeInfo current = stack.remove(stack.size() - 1);
            if (current == null) continue;
            visited++;
            if (isNodeAccessibilityDataSensitive(current)) return -1;
            if (current.isPassword() && (current.isFocused() || current.isAccessibilityFocused())) return -1;
            int childCount = current.getChildCount();
            for (int c = childCount - 1; c >= 0; c--) {
                AccessibilityNodeInfo child = current.getChild(c);
                if (child != null) stack.add(child);
            }
        }
        return visited;
    }

    private static boolean isNodeAccessibilityDataSensitive(AccessibilityNodeInfo node) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE && node.isAccessibilityDataSensitive();
    }

    private static boolean isNodeSensitive(AccessibilityNodeInfo node) {
        return node.isPassword() || isNodeAccessibilityDataSensitive(node);
    }

    private static String collectNodes(
        AccessibilityNodeInfo root,
        int windowId,
        boolean includeNonInteractive,
        int limit,
        List<SerializedNode> out,
        Map<String, AccessibilityNodeInfo> cache,
        String packageName
    ) {
        String detectedUrl = null;
        List<AccessibilityNodeInfo> stack = new ArrayList<>();
        stack.add(root);
        int index = 0;
        int visited = 0;
        int maxVisited = Math.max(limit * 16, 1024);
        while (!stack.isEmpty() && out.size() < limit && visited < maxVisited) {
            AccessibilityNodeInfo current = stack.remove(stack.size() - 1);
            if (current == null) continue;
            visited++;
            String resId = current.getViewIdResourceName();
            String rawText = current.getText() == null ? null : current.getText().toString();
            String rawDesc = current.getContentDescription() == null ? null : current.getContentDescription().toString();
            String rawHint = current.getHintText() == null ? null : current.getHintText().toString();
            if (detectedUrl == null && AlphaControlPolicy.isFirefoxPackage(packageName)) {
                detectedUrl = extractFirefoxUrl(resId, rawText, rawDesc);
            }
            boolean clickable = current.isClickable();
            boolean editable = current.isEditable();
            boolean scrollable = current.isScrollable();
            boolean interactive = clickable || editable || scrollable;
            boolean hasContent = (rawText != null && !rawText.isBlank()) || (rawDesc != null && !rawDesc.isBlank());
            if (shouldEmitNode(current.isVisibleToUser(), includeNonInteractive, interactive, hasContent)) {
                boolean sensitive = isNodeSensitive(current);
                Rect bounds = new Rect();
                current.getBoundsInScreen(bounds);
                String nodeId = "w" + windowId + "_n" + (index++);
                String role = simplifyClassName(current.getClassName());
                out.add(new SerializedNode(
                    nodeId,
                    role,
                    resId,
                    sensitive && rawText != null ? "[REDACTED]" : trimBounded(rawText, 256),
                    sensitive && rawDesc != null ? "[REDACTED]" : trimBounded(rawDesc, 256),
                    sensitive && rawHint != null ? "[REDACTED]" : trimBounded(rawHint, 128),
                    bounds,
                    clickable,
                    editable,
                    scrollable,
                    sensitive
                ));
                if (!sensitive) {
                    cache.put(nodeId, current);
                }
            }
            int childCount = current.getChildCount();
            for (int c = childCount - 1; c >= 0; c--) {
                AccessibilityNodeInfo child = current.getChild(c);
                if (child != null) stack.add(child);
            }
        }
        return detectedUrl;
    }

    private static String extractFirefoxUrl(String resourceId, String text, String desc) {
        boolean isToolbar = resourceId != null && (
            resourceId.endsWith(":id/mozac_browser_toolbar_url_view")
                || resourceId.endsWith(":id/mozac_browser_toolbar_edit_url_view")
        );
        String candidate = text != null ? text.trim() : (desc != null ? desc.trim() : "");
        if (candidate.isEmpty()) return null;
        if (AlphaControlPolicy.isValidHttpsUrl(candidate)) return candidate;
        if (isToolbar && !candidate.contains(" ") && candidate.contains(".")) {
            String prefixed = "https://" + candidate;
            return AlphaControlPolicy.isValidHttpsUrl(prefixed) ? prefixed : null;
        }
        return null;
    }

    private static String simplifyClassName(CharSequence className) {
        if (className == null || className.length() == 0) return "View";
        String full = className.toString();
        int dot = full.lastIndexOf('.');
        return dot >= 0 && dot + 1 < full.length() ? full.substring(dot + 1) : full;
    }

    private static String trimBounded(String value, int maxLen) {
        if (value == null) return null;
        String trimmed = value.trim();
        if (trimmed.isEmpty()) return null;
        return trimmed.length() <= maxLen ? trimmed : trimmed.substring(0, maxLen);
    }

    private static Bitmap scaleBitmap(Bitmap source, int maxWidth) {
        int clamped = Math.max(360, Math.min(1440, maxWidth));
        if (source.getWidth() <= clamped || source.getWidth() <= 0) return source;
        float ratio = (float) clamped / (float) source.getWidth();
        int targetHeight = Math.max(1, Math.round(source.getHeight() * ratio));
        return Bitmap.createScaledBitmap(source, clamped, targetHeight, true);
    }
}
