// spec/app/control/index.md, "Story: Control a third-party app within an owner-approved lease"; spec/agent/index.md, "Only Android's native control executor can post UI observations, poll queued operations, submit receipts, or fire native interrupts"
package ai.alphacompute.control;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.os.SystemClock;
import android.util.Base64;
import android.view.Display;
import android.view.KeyEvent;
import android.view.MotionEvent;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BooleanSupplier;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Native non-WebView execution loop bridging AlphaAccessibilityService, optional Tier-2
 * AlphaControlBridgeClient, and Android 16+ AppFunctionManager directly to the resident
 * agent's native control routes.
 */
public final class AlphaUiControlExecutor implements AlphaAccessibilityService.ControlListener {
    /** Native HTTP-over-socket transport wired by AlphaCore to AgentService.request(CallerKind.NATIVE, ...). */
    public interface NativeAgentTransport {
        CompletableFuture<TransportResponse> request(String method, String path, byte[] body);
    }

    /** Minimal HTTP response returned by the native resident agent transport. */
    public static final class TransportResponse {
        public final int status;
        public final byte[] body;

        public TransportResponse(int status, byte[] body) {
            this.status = status;
            this.body = body == null ? new byte[0] : body;
        }
    }

    /** Execution outcome returned for a single dispatched operation. */
    public static final class StepOutcome {
        public final String outcome;
        public final String refusalCode;
        public final JSONObject result;
        public final int postSnapshotId;

        public StepOutcome(String outcome, String refusalCode, JSONObject result) {
            this(outcome, refusalCode, result, 0);
        }

        public StepOutcome(String outcome, String refusalCode, JSONObject result, int postSnapshotId) {
            this.outcome = outcome;
            this.refusalCode = refusalCode;
            this.result = result;
            this.postSnapshotId = postSnapshotId;
        }
    }

    interface OperationDispatcher {
        StepOutcome dispatch(JSONObject op, int boundSnapId, String expectedPackage);
    }

    interface ObservationPusher {
        int push(boolean includeNonInteractive, int maxNodes, AlphaAccessibilityService.ScreenshotCapture shot);
    }

    private static final String ROUTE_OBSERVE = "/api/alpha-control/observe";
    private static final String ROUTE_NEXT = "/api/alpha-control/next";
    private static final String ROUTE_RECEIPT = "/api/alpha-control/receipt";
    private static final String ROUTE_INTERRUPT = "/api/alpha-control/interrupt";
    private static final int MAX_TRACKED_OPS = 64;
    private static final long DEFAULT_POST_ACTUATION_SETTLE_MS = 180L;

    private final Context appContext;
    private final NativeAgentTransport transport;
    private final AlphaControlBridgeClient bridgeClient;
    private final OperationDispatcher dispatcher;
    private final ObservationPusher observationPusher;
    private final BooleanSupplier accessibilityLiveSupplier;
    private final long postActuationSettleMs;
    private final Object workerLock = new Object();
    private final Object opStateLock = new Object();
    private final Set<Integer> inFlightOpIds = new HashSet<>();
    private final Map<Integer, StepOutcome> completedOutcomes = new LinkedHashMap<Integer, StepOutcome>(32, 0.75f, false) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<Integer, StepOutcome> eldest) {
            return size() > MAX_TRACKED_OPS;
        }
    };
    private final AtomicBoolean running = new AtomicBoolean(false);
    private final AtomicInteger lastAgentSnapshotId = new AtomicInteger(0);
    private ScheduledExecutorService worker;
    private ExecutorService interruptWorker;
    private volatile String lastObservedPackage = "";
    private volatile ScheduledFuture<?> pollTask;

    /** Construct a native executor backed by the supplied resident-agent transport. */
    public AlphaUiControlExecutor(Context context, NativeAgentTransport transport) {
        this(context, transport, null);
    }

    AlphaUiControlExecutor(Context context, NativeAgentTransport transport, OperationDispatcher customDispatcher) {
        this(context, transport, customDispatcher, null, () -> AlphaAccessibilityService.live() != null, DEFAULT_POST_ACTUATION_SETTLE_MS);
    }

    AlphaUiControlExecutor(
        Context context,
        NativeAgentTransport transport,
        OperationDispatcher customDispatcher,
        ObservationPusher customObservationPusher,
        BooleanSupplier accessibilityLiveSupplier,
        long postActuationSettleMs
    ) {
        this.appContext = context == null ? null : context.getApplicationContext();
        this.transport = transport;
        this.bridgeClient = this.appContext == null ? null : new AlphaControlBridgeClient(this.appContext);
        this.dispatcher = customDispatcher != null ? customDispatcher : this::executeOperation;
        this.observationPusher = customObservationPusher != null ? customObservationPusher : this::pushObservation;
        this.accessibilityLiveSupplier = accessibilityLiveSupplier != null
            ? accessibilityLiveSupplier
            : () -> AlphaAccessibilityService.live() != null;
        this.postActuationSettleMs = Math.max(0L, postActuationSettleMs);
    }

    /** Start polling the resident agent and listening to AlphaAccessibilityService. */
    public void start() {
        if (!running.compareAndSet(false, true)) return;
        ScheduledExecutorService activeWorker;
        synchronized (workerLock) {
            if (worker == null || worker.isShutdown()) {
                worker = newDaemonWorker();
            }
            if (interruptWorker == null || interruptWorker.isShutdown()) {
                interruptWorker = newInterruptWorker();
            }
            activeWorker = worker;
        }
        AlphaAccessibilityService.setControlListener(this);
        if (accessibilityLiveSupplier.getAsBoolean()) {
            submitOn(activeWorker, () -> observationPusher.push(false, 80, null));
        }
        if (bridgeClient != null) {
            submitOn(activeWorker, () -> {
                if (bridgeClient.connect(500L) && accessibilityLiveSupplier.getAsBoolean()) {
                    observationPusher.push(false, 80, null);
                }
            });
        }
        try {
            pollTask = activeWorker.scheduleWithFixedDelay(this::pollOnceSafe, 250L, 400L, TimeUnit.MILLISECONDS);
        } catch (RejectedExecutionException ignored) {
            running.set(false);
        }
    }

    /** Stop polling, disconnect any bound Tier-2 platform bridge, and shut down daemon workers cleanly. */
    public void stop() {
        if (!running.compareAndSet(true, false)) return;
        ScheduledFuture<?> task = pollTask;
        pollTask = null;
        if (task != null) task.cancel(true);
        AlphaAccessibilityService.setControlListener(null);
        if (bridgeClient != null) {
            bridgeClient.disconnect();
        }
        ScheduledExecutorService toShutdown;
        ExecutorService interruptToShutdown;
        synchronized (workerLock) {
            toShutdown = worker;
            worker = null;
            interruptToShutdown = interruptWorker;
            interruptWorker = null;
        }
        if (toShutdown != null) {
            toShutdown.shutdownNow();
        }
        if (interruptToShutdown != null) {
            interruptToShutdown.shutdownNow();
        }
        synchronized (opStateLock) {
            inFlightOpIds.clear();
            completedOutcomes.clear();
        }
    }

    /** Permanently tear down the executor and its daemon worker thread. */
    public void shutdown() {
        stop();
    }

    /** Compute the current Tier-1 / Tier-2 control tier based on connected native services. */
    public AlphaControlPolicy.ControlTier currentTier() {
        if (AlphaAccessibilityService.live() == null) return AlphaControlPolicy.ControlTier.TierNone;
        if (bridgeClient != null && bridgeClient.isConnected()) {
            return AlphaControlPolicy.ControlTier.TierPrivileged;
        }
        return AlphaControlPolicy.ControlTier.TierAccessibility;
    }

    /** Compute the negotiated capability list for the current runtime tier and Android API level. */
    public List<String> currentCapabilities() {
        AlphaControlPolicy.ControlTier tier = currentTier();
        if (tier == AlphaControlPolicy.ControlTier.TierNone) return List.of();
        List<String> caps = new ArrayList<>();
        caps.add("ui.observe.v1");
        caps.add("ui.act.v1");
        caps.add("app.launch.v1");
        if (tier == AlphaControlPolicy.ControlTier.TierPrivileged && bridgeClient != null) {
            if (bridgeClient.supportsCaptureDisplay()) caps.add("ui.screenshot.v1");
            if (bridgeClient.supportsInjectEvents()) caps.add("ui.inject.v1");
        } else {
            caps.add("ui.screenshot.throttled.v1");
        }
        if (hasAppFunctionsManager()) {
            caps.add("app.functions.v1");
        }
        return caps;
    }

    @Override
    public void onServiceStateChanged(boolean connected) {
        if (!connected) {
            String pkg = lastObservedPackage;
            submitInterrupt(() -> postInterrupt("service_disabled", pkg));
            return;
        }
        submitWorker(() -> observationPusher.push(false, 80, null));
    }

    @Override
    public void onForegroundChanged(String packageName, String activityName) {
        lastObservedPackage = packageName == null ? "" : packageName;
        if (AlphaControlPolicy.isBlockedTarget(packageName, activityName)) {
            submitInterrupt(() -> postInterrupt("blocked_package", packageName));
            return;
        }
        submitWorker(() -> observationPusher.push(false, 80, null));
    }

    @Override
    public void onPhysicalPreemption(String packageName) {
        submitInterrupt(() -> postInterrupt("user_touch", packageName));
    }

    /** Push a fresh observation to the resident agent and return the assigned monotonic snapshotId. */
    public int pushObservation(boolean includeNonInteractive, int maxNodes, AlphaAccessibilityService.ScreenshotCapture shot) {
        AlphaAccessibilityService service = AlphaAccessibilityService.live();
        if (service == null) return 0;
        AlphaAccessibilityService.CapturedObservation obs = service.captureObservation(includeNonInteractive, maxNodes);
        lastObservedPackage = obs.packageName;
        try {
            JSONObject payload = new JSONObject();
            payload.put("tier", currentTier().name());
            payload.put("capabilities", new JSONArray(currentCapabilities()));
            payload.put("packageName", obs.packageName);
            payload.put("activityName", obs.activityName);
            if (obs.webUri != null) payload.put("webUri", obs.webUri);
            payload.put("protection", obs.protection.name());
            payload.put("windowCount", obs.windowCount);
            JSONArray nodes = new JSONArray();
            for (AlphaAccessibilityService.SerializedNode node : obs.nodes) {
                JSONObject item = new JSONObject();
                item.put("nodeId", node.nodeId);
                item.put("role", node.role);
                if (node.resourceId != null) item.put("resourceId", node.resourceId);
                if (node.text != null) item.put("text", node.text);
                if (node.contentDescription != null) item.put("contentDescription", node.contentDescription);
                if (node.hintText != null) item.put("hintText", node.hintText);
                JSONObject bounds = new JSONObject();
                bounds.put("left", node.bounds.left);
                bounds.put("top", node.bounds.top);
                bounds.put("right", node.bounds.right);
                bounds.put("bottom", node.bounds.bottom);
                item.put("bounds", bounds);
                item.put("clickable", node.clickable);
                item.put("editable", node.editable);
                item.put("scrollable", node.scrollable);
                item.put("sensitive", node.sensitive);
                nodes.put(item);
            }
            payload.put("nodes", nodes);
            if (shot != null && shot.base64Jpeg != null) {
                payload.put("screenshotBase64", shot.base64Jpeg);
                payload.put("screenshotWidth", shot.width);
                payload.put("screenshotHeight", shot.height);
            }
            TransportResponse response = sendJson("POST", ROUTE_OBSERVE, payload);
            if (response != null && response.status == 200) {
                JSONObject reply = new JSONObject(new String(response.body, StandardCharsets.UTF_8));
                int assigned = reply.optInt("snapshotId", 0);
                if (assigned > 0) lastAgentSnapshotId.set(assigned);
                return assigned;
            }
        } catch (JSONException ignored) {
            return 0;
        }
        return 0;
    }

    /** Poll `/api/alpha-control/next` once, execute each opId at most once, and post or retry its receipt. */
    public void pollOnce() {
        TransportResponse response = sendJson("GET", ROUTE_NEXT, null);
        if (response == null || response.status != 200 || response.body.length == 0) return;
        try {
            JSONObject envelope = new JSONObject(new String(response.body, StandardCharsets.UTF_8));
            if (envelope.isNull("op")) return;
            JSONObject pending = envelope.optJSONObject("op");
            if (pending == null) return;
            int opId = pending.optInt("opId", 0);
            int boundSnapId = pending.optInt("boundSnapId", 0);
            String expectedPackage = pending.optString("expectedPackage", "");
            JSONObject op = pending.optJSONObject("op");
            if (opId <= 0 || op == null) return;

            StepOutcome cachedOutcome;
            synchronized (opStateLock) {
                cachedOutcome = completedOutcomes.get(opId);
                if (cachedOutcome == null && !inFlightOpIds.add(opId)) {
                    return;
                }
            }
            if (cachedOutcome != null) {
                postReceipt(opId, cachedOutcome);
                return;
            }

            String opType = op.optString("type", "");
            StepOutcome outcome = null;
            try {
                AlphaAccessibilityService.setActuationInProgress(true);
                try {
                    outcome = dispatcher.dispatch(op, boundSnapId, expectedPackage);
                } catch (RuntimeException failed) {
                    outcome = new StepOutcome("refused", refusalCodeForException(failed), null);
                } finally {
                    AlphaAccessibilityService.setActuationInProgress(false);
                }
                if (outcome != null
                    && "done".equals(outcome.outcome)
                    && outcome.postSnapshotId <= 0
                    && shouldRefreshPostActuation(opType)
                    && accessibilityLiveSupplier.getAsBoolean()) {
                    if (postActuationSettleMs > 0L) {
                        try {
                            Thread.sleep(postActuationSettleMs);
                        } catch (InterruptedException interrupted) {
                            Thread.currentThread().interrupt();
                        }
                    }
                    int postSnap = observationPusher.push(false, 120, null);
                    if (postSnap > 0) {
                        outcome = new StepOutcome(outcome.outcome, outcome.refusalCode, outcome.result, postSnap);
                    }
                }
            } finally {
                synchronized (opStateLock) {
                    inFlightOpIds.remove(opId);
                    if (outcome != null) {
                        completedOutcomes.put(opId, outcome);
                    }
                }
            }
            postReceipt(opId, outcome);
        } catch (JSONException ignored) {
            return;
        }
    }

    /** Execute a validated typed control operation against Android APIs with strict safety checks. */
    public StepOutcome executeOperation(JSONObject op, int boundSnapId, String expectedPackage) {
        String type = op.optString("type", "");
        if (AlphaControlPolicy.isBlockedTarget(expectedPackage, null)) {
            return new StepOutcome("refused", "BLOCKED_PACKAGE", null);
        }
        if (AlphaControlPolicy.requiresSnapshot(type)) {
            int liveSnap = lastAgentSnapshotId.get();
            if (boundSnapId <= 0 || boundSnapId != liveSnap || !expectedPackage.equals(lastObservedPackage)) {
                return new StepOutcome("refused", "STALE_SNAPSHOT", null);
            }
        }
        switch (type) {
            case "app_launch_package":
                return executeLaunchPackage(op.optString("packageName", ""), expectedPackage);
            case "app_open_url":
                return executeOpenUrl(op.optString("url", ""), op.optString("packageName", ""), expectedPackage);
            case "ui_read_tree":
                return executeReadTree(op.optBoolean("includeNonInteractive", false), op.optInt("maxNodes", 120));
            case "ui_capture_screen":
                return executeCaptureScreen(op.optInt("maxWidth", 720), op.optInt("quality", 70));
            case "ui_click":
                return executeClick(op);
            case "ui_set_text":
                return executeSetText(op, expectedPackage);
            case "ui_scroll":
                return executeScroll(op);
            case "ui_key_event":
                return executeKeyEvent(op.optString("keyCode", ""));
            case "ui_gesture":
                return executeGesture(op);
            case "ui_global_action":
                return executeGlobalAction(op.optString("action", ""));
            case "app_functions_discover":
                return executeAppFunctionsDiscover(op.optString("packageName", ""));
            case "app_function_execute":
                return executeAppFunction(op);
            default:
                return new StepOutcome("refused", "UNKNOWN_OPERATION", null);
        }
    }

    /** Notify the resident agent immediately of a native interrupt condition. */
    public void postInterrupt(String reason, String packageName) {
        try {
            JSONObject body = new JSONObject();
            body.put("reason", reason);
            if (packageName != null && !packageName.isEmpty()) body.put("packageName", packageName);
            sendJson("POST", ROUTE_INTERRUPT, body);
        } catch (JSONException ignored) {
            return;
        }
    }

    private StepOutcome executeLaunchPackage(String packageName, String expectedPackage) {
        String explicitPkg = packageName == null ? "" : packageName.trim();
        String leasedPkg = expectedPackage == null ? "" : expectedPackage.trim();
        if (!explicitPkg.isEmpty() && !leasedPkg.isEmpty() && !explicitPkg.equals(leasedPkg)) {
            return new StepOutcome("refused", "PACKAGE_MISMATCH", null);
        }
        String targetPkg = !explicitPkg.isEmpty() ? explicitPkg : leasedPkg;
        if (!AlphaControlPolicy.isValidPackageName(targetPkg) || AlphaControlPolicy.isBlockedTarget(targetPkg, null)) {
            return new StepOutcome("refused", "BLOCKED_PACKAGE", null);
        }
        if (appContext == null) return new StepOutcome("refused", "CONTEXT_UNAVAILABLE", null);
        Intent intent = appContext.getPackageManager().getLaunchIntentForPackage(targetPkg);
        if (intent == null) return new StepOutcome("refused", "APP_NOT_FOUND", null);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            appContext.startActivity(intent);
            return new StepOutcome("done", null, null);
        } catch (ActivityNotFoundException missing) {
            return new StepOutcome("refused", "APP_NOT_FOUND", null);
        } catch (SecurityException denied) {
            return new StepOutcome("refused", "SECURITY_EXCEPTION", null);
        }
    }

    private StepOutcome executeOpenUrl(String url, String packageName, String expectedPackage) {
        if (!AlphaControlPolicy.isValidHttpsUrl(url)) return new StepOutcome("refused", "INVALID_URL", null);
        String explicitPkg = packageName == null ? "" : packageName.trim();
        String leasedPkg = expectedPackage == null ? "" : expectedPackage.trim();
        if (!explicitPkg.isEmpty() && !leasedPkg.isEmpty() && !explicitPkg.equals(leasedPkg)) {
            return new StepOutcome("refused", "PACKAGE_MISMATCH", null);
        }
        String targetPkg = !explicitPkg.isEmpty() ? explicitPkg : leasedPkg;
        if (targetPkg.isEmpty() || !AlphaControlPolicy.isValidPackageName(targetPkg) || AlphaControlPolicy.isBlockedTarget(targetPkg, null)) {
            return new StepOutcome("refused", "BLOCKED_PACKAGE", null);
        }
        if (appContext == null) return new StepOutcome("refused", "CONTEXT_UNAVAILABLE", null);
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        intent.setPackage(targetPkg);
        try {
            appContext.startActivity(intent);
            return new StepOutcome("done", null, null);
        } catch (ActivityNotFoundException missing) {
            return new StepOutcome("refused", "APP_NOT_FOUND", null);
        } catch (SecurityException denied) {
            return new StepOutcome("refused", "SECURITY_EXCEPTION", null);
        }
    }

    private StepOutcome executeReadTree(boolean includeNonInteractive, int maxNodes) {
        int snapId = observationPusher.push(includeNonInteractive, maxNodes, null);
        if (snapId <= 0) return new StepOutcome("refused", "OBSERVE_FAILED", null);
        try {
            return new StepOutcome("done", null, new JSONObject().put("snapshotId", snapId), snapId);
        } catch (JSONException failed) {
            return new StepOutcome("done", null, null, snapId);
        }
    }

    private StepOutcome executeCaptureScreen(int maxWidth, int quality) {
        if (bridgeClient != null && bridgeClient.supportsCaptureDisplay()) {
            byte[] jpeg = bridgeClient.captureDisplayBytes(Display.DEFAULT_DISPLAY, maxWidth, quality);
            if (jpeg != null && jpeg.length > 0) {
                int[] dims = decodeJpegDimensions(jpeg, maxWidth);
                String b64 = Base64.encodeToString(jpeg, Base64.NO_WRAP);
                int snapId = observationPusher.push(false, 120, new AlphaAccessibilityService.ScreenshotCapture(b64, dims[0], dims[1], null));
                return snapId > 0
                    ? new StepOutcome("done", null, null, snapId)
                    : new StepOutcome("refused", "OBSERVE_FAILED", null);
            }
        }
        AlphaAccessibilityService service = AlphaAccessibilityService.live();
        if (service == null) return new StepOutcome("refused", "SERVICE_DISCONNECTED", null);
        AlphaAccessibilityService.ScreenshotCapture shot = service.captureTier1Screenshot(maxWidth, quality);
        if (shot.errorCode != null) return new StepOutcome("refused", shot.errorCode, null);
        int snapId = observationPusher.push(false, 120, shot);
        return snapId > 0 ? new StepOutcome("done", null, null, snapId) : new StepOutcome("refused", "OBSERVE_FAILED", null);
    }

    private StepOutcome executeClick(JSONObject op) {
        AlphaAccessibilityService service = AlphaAccessibilityService.live();
        if (service == null) return new StepOutcome("refused", "SERVICE_DISCONNECTED", null);
        String nodeId = op.optString("nodeId", "");
        boolean longClick = op.optBoolean("longClick", false);
        if (!nodeId.isEmpty()) {
            return service.clickNode(nodeId, longClick)
                ? new StepOutcome("done", null, null)
                : new StepOutcome("refused", "NODE_CLICK_FAILED", null);
        }
        float x = (float) op.optDouble("x", -1.0);
        float y = (float) op.optDouble("y", -1.0);
        if (x < 0f || y < 0f) return new StepOutcome("refused", "INVALID_COORDINATES", null);
        if (bridgeClient != null && bridgeClient.supportsInjectEvents() && !longClick) {
            long down = SystemClock.uptimeMillis();
            boolean ok = bridgeClient.injectMotionEvent(MotionEvent.ACTION_DOWN, x, y, down, down)
                && bridgeClient.injectMotionEvent(MotionEvent.ACTION_UP, x, y, down, down + 40L);
            if (ok) return new StepOutcome("done", null, null);
        }
        return service.dispatchPointGesture(x, y, longClick ? 650L : 80L)
            ? new StepOutcome("done", null, null)
            : new StepOutcome("refused", "GESTURE_CLICK_FAILED", null);
    }

    private StepOutcome executeSetText(JSONObject op, String expectedPackage) {
        AlphaAccessibilityService service = AlphaAccessibilityService.live();
        if (service == null) return new StepOutcome("refused", "SERVICE_DISCONNECTED", null);
        String nodeId = op.optString("nodeId", "");
        String text = op.optString("text", "");
        boolean submit = op.optBoolean("submit", false);
        boolean ok = service.setNodeText(nodeId, text, AlphaControlPolicy.isFirefoxPackage(expectedPackage));
        if (!ok) return new StepOutcome("refused", "SET_TEXT_FAILED", null);
        boolean hasPrivilegedInject = bridgeClient != null && bridgeClient.supportsInjectEvents();
        if (submit && hasPrivilegedInject) {
            bridgeClient.injectKeyEvent(KeyEvent.KEYCODE_ENTER, 0, KeyEvent.ACTION_DOWN);
            bridgeClient.injectKeyEvent(KeyEvent.KEYCODE_ENTER, 0, KeyEvent.ACTION_UP);
        } else if (shouldUseTier1ImeEnter(submit, hasPrivilegedInject, Build.VERSION.SDK_INT)) {
            service.performImeEnter(nodeId);
        }
        return new StepOutcome("done", null, null);
    }

    private StepOutcome executeScroll(JSONObject op) {
        AlphaAccessibilityService service = AlphaAccessibilityService.live();
        if (service == null) return new StepOutcome("refused", "SERVICE_DISCONNECTED", null);
        String nodeId = op.has("nodeId") && !op.isNull("nodeId") ? op.optString("nodeId", null) : null;
        String direction = op.optString("direction", "down");
        if (service.scrollNode(nodeId, direction)) return new StepOutcome("done", null, null);
        return new StepOutcome("refused", "SCROLL_FAILED", null);
    }

    private StepOutcome executeKeyEvent(String keyCodeName) {
        int keyCode = AlphaControlPolicy.resolveAllowlistedKeyCode(keyCodeName);
        if (keyCode < 0) return new StepOutcome("refused", "KEYCODE_NOT_ALLOWED", null);
        if (bridgeClient == null || !bridgeClient.supportsInjectEvents()) {
            return new StepOutcome("refused", "TIER_PRIVILEGED_REQUIRED", null);
        }
        boolean ok = bridgeClient.injectKeyEvent(keyCode, 0, KeyEvent.ACTION_DOWN)
            && bridgeClient.injectKeyEvent(keyCode, 0, KeyEvent.ACTION_UP);
        return ok ? new StepOutcome("done", null, null) : new StepOutcome("refused", "KEY_INJECT_FAILED", null);
    }

    private StepOutcome executeGesture(JSONObject op) {
        AlphaAccessibilityService service = AlphaAccessibilityService.live();
        if (service == null) return new StepOutcome("refused", "SERVICE_DISCONNECTED", null);
        String kind = op.optString("kind", "");
        float startX = (float) op.optDouble("startX", -1.0);
        float startY = (float) op.optDouble("startY", -1.0);
        long durationMs = op.optLong("durationMs", 150L);
        if ("swipe".equals(kind)) {
            float endX = (float) op.optDouble("endX", -1.0);
            float endY = (float) op.optDouble("endY", -1.0);
            return service.dispatchSwipeGesture(startX, startY, endX, endY, durationMs)
                ? new StepOutcome("done", null, null)
                : new StepOutcome("refused", "GESTURE_FAILED", null);
        }
        return service.dispatchPointGesture(startX, startY, durationMs)
            ? new StepOutcome("done", null, null)
            : new StepOutcome("refused", "GESTURE_FAILED", null);
    }

    private StepOutcome executeGlobalAction(String action) {
        AlphaAccessibilityService service = AlphaAccessibilityService.live();
        if (service == null) return new StepOutcome("refused", "SERVICE_DISCONNECTED", null);
        return service.runGlobalAction(action)
            ? new StepOutcome("done", null, null)
            : new StepOutcome("refused", "GLOBAL_ACTION_FAILED", null);
    }

    private StepOutcome executeAppFunctionsDiscover(String packageName) {
        if (!hasAppFunctionsManager()) {
            return new StepOutcome("refused", "APP_FUNCTIONS_UNAVAILABLE", null);
        }
        try {
            JSONObject result = new JSONObject();
            result.put("apiLevel", Build.VERSION.SDK_INT);
            result.put("packageName", packageName == null ? "" : packageName);
            result.put("functions", new JSONArray());
            return new StepOutcome("done", null, result);
        } catch (JSONException failed) {
            return new StepOutcome("refused", "APP_FUNCTIONS_FAILED", null);
        }
    }

    private StepOutcome executeAppFunction(JSONObject op) {
        if (!hasAppFunctionsManager()) {
            return new StepOutcome("refused", "APP_FUNCTIONS_UNAVAILABLE", null);
        }
        String functionId = op.optString("functionId", "");
        if (functionId.isEmpty()) return new StepOutcome("refused", "INVALID_FUNCTION_ID", null);
        return new StepOutcome("refused", "APP_FUNCTION_NOT_REGISTERED", null);
    }

    private boolean hasAppFunctionsManager() {
        if (appContext == null || Build.VERSION.SDK_INT < 36) return false;
        try {
            Class<?> managerClass = Class.forName("android.app.appfunctions.AppFunctionManager");
            return appContext.getSystemService(managerClass) != null;
        } catch (ClassNotFoundException | SecurityException unavailable) {
            return false;
        }
    }

    private void postReceipt(int opId, StepOutcome outcome) {
        if (outcome == null) return;
        try {
            JSONObject receipt = new JSONObject();
            receipt.put("opId", opId);
            receipt.put("outcome", outcome.outcome);
            if (outcome.refusalCode != null) receipt.put("refusalCode", outcome.refusalCode);
            if (outcome.postSnapshotId > 0) receipt.put("postSnapshotId", outcome.postSnapshotId);
            if (outcome.result != null) receipt.put("result", outcome.result);
            sendJson("POST", ROUTE_RECEIPT, receipt);
        } catch (JSONException ignored) {
            return;
        }
    }

    static boolean shouldRefreshPostActuation(String opType) {
        if (opType == null) return false;
        switch (opType) {
            case "ui_click":
            case "ui_set_text":
            case "ui_scroll":
            case "ui_key_event":
            case "ui_gesture":
            case "ui_global_action":
            case "app_open_url":
            case "app_launch_package":
                return true;
            default:
                return false;
        }
    }

    static boolean shouldUseTier1ImeEnter(boolean submit, boolean hasPrivilegedInject, int sdkInt) {
        return submit && !hasPrivilegedInject && sdkInt >= Build.VERSION_CODES.R;
    }

    private static String refusalCodeForException(RuntimeException failed) {
        if (failed instanceof ActivityNotFoundException) return "APP_NOT_FOUND";
        if (failed instanceof SecurityException) return "SECURITY_EXCEPTION";
        return "EXECUTION_FAILED";
    }

    private static int[] decodeJpegDimensions(byte[] jpeg, int fallbackWidth) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(jpeg, 0, jpeg.length, bounds);
        int width = bounds.outWidth > 0 ? bounds.outWidth : fallbackWidth;
        int height = Math.max(0, bounds.outHeight);
        return new int[] { width, height };
    }

    private static ScheduledExecutorService newDaemonWorker() {
        return Executors.newSingleThreadScheduledExecutor((runnable) -> {
            Thread thread = new Thread(runnable, "alpha-control-worker");
            thread.setDaemon(true);
            return thread;
        });
    }

    private static ExecutorService newInterruptWorker() {
        return Executors.newSingleThreadExecutor((runnable) -> {
            Thread thread = new Thread(runnable, "alpha-control-interrupt");
            thread.setDaemon(true);
            return thread;
        });
    }

    private void submitWorker(Runnable task) {
        ScheduledExecutorService activeWorker;
        synchronized (workerLock) {
            activeWorker = worker;
        }
        if (activeWorker != null && !activeWorker.isShutdown()) {
            submitOn(activeWorker, task);
        }
    }

    private void submitInterrupt(Runnable task) {
        ExecutorService activeInterrupt;
        synchronized (workerLock) {
            activeInterrupt = interruptWorker;
        }
        if (activeInterrupt != null && !activeInterrupt.isShutdown()) {
            submitOn(activeInterrupt, task);
        }
    }

    private static void submitOn(ExecutorService target, Runnable task) {
        try {
            target.execute(task);
        } catch (RejectedExecutionException ignored) {
            return;
        }
    }

    private void pollOnceSafe() {
        if (!running.get()) return;
        try {
            pollOnce();
        } catch (RuntimeException ignored) {
            return;
        }
    }

    private TransportResponse sendJson(String method, String path, JSONObject body) {
        if (transport == null) return null;
        byte[] bytes = body == null ? null : body.toString().getBytes(StandardCharsets.UTF_8);
        try {
            return transport.request(method, path, bytes).get(5, TimeUnit.SECONDS);
        } catch (Exception unavailable) {
            return null;
        }
    }
}
