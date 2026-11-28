package ai.alphacompute.alphaphone.overlay;

import ai.alphacompute.control.AlphaAccessibilityService;
import ai.alphacompute.control.AlphaUiControlExecutor;
import ai.eliza.os.agent.AgentChannel;
import ai.eliza.os.agent.AgentService;
import android.content.Context;
import android.net.Uri;
import android.util.Log;
import java.util.concurrent.CompletableFuture;

/** Connects {@link AlphaUiControlExecutor} to {@link AgentService} and relays {@code AssistContent.webUri} into {@link AlphaAccessibilityService}. */
public final class AlphaControlRuntimeBridge {
    private static final String TAG = "AlphaControlBridge";
    private static final Object LOCK = new Object();

    private static AlphaUiControlExecutor executor;
    private static AutoCloseable statusObserver;
    private static AutoCloseable readyObserver;

    private AlphaControlRuntimeBridge() {}

    /** Attaches the native external-app control executor to the running resident agent lifecycle. */
    public static void attach(Context context) {
        if (context == null) return;
        Context appContext = context.getApplicationContext();
        synchronized (LOCK) {
            if (executor != null) return;
            AlphaUiControlExecutor created = new AlphaUiControlExecutor(appContext, AlphaControlRuntimeBridge::dispatchNativeRequest);
            executor = created;
            readyObserver = AgentService.onReady(() -> startIfAttached(created));
            statusObserver = AgentService.observe(() -> {
                String state = AgentService.status(appContext).optString("state", "");
                if ("running".equals(state)) {
                    startIfAttached(created);
                } else if ("stopped".equals(state) || "failed".equals(state) || "unavailable".equals(state)) {
                    created.stop();
                }
            });
            if ("running".equals(AgentService.status(appContext).optString("state", ""))) {
                startIfAttached(created);
            }
        }
    }

    /** Stops the native external-app control executor and detaches lifecycle observers. */
    public static void detach() {
        AlphaUiControlExecutor stopped;
        AutoCloseable status;
        AutoCloseable ready;
        synchronized (LOCK) {
            stopped = executor;
            status = statusObserver;
            ready = readyObserver;
            executor = null;
            statusObserver = null;
            readyObserver = null;
        }
        closeQuietly(ready);
        closeQuietly(status);
        if (stopped != null) {
            stopped.stop();
        }
    }

    /** Relays a verified HTTPS {@code AssistContent.webUri} captured by {@link AlphaVoiceInteractionSession} into {@link AlphaAccessibilityService}. */
    public static void forwardAssistWebUri(String packageName, Uri webUri) {
        if (packageName == null || packageName.isBlank()) return;
        AlphaAccessibilityService.updateAssistWebUri(packageName, webUri == null ? null : webUri.toString());
    }

    private static void startIfAttached(AlphaUiControlExecutor target) {
        synchronized (LOCK) {
            if (executor != target) return;
        }
        Log.i(TAG, "Starting AlphaUiControlExecutor on resident agent channel");
        target.start();
    }

    private static CompletableFuture<AlphaUiControlExecutor.TransportResponse> dispatchNativeRequest(
        String method,
        String path,
        byte[] body
    ) {
        return AgentService.request(method, path, body)
            .handle((AgentChannel.Response response, Throwable error) -> {
                if (error != null || response == null) {
                    return new AlphaUiControlExecutor.TransportResponse(503, new byte[0]);
                }
                return new AlphaUiControlExecutor.TransportResponse(response.status(), response.body());
            });
    }

    private static void closeQuietly(AutoCloseable closeable) {
        if (closeable == null) return;
        try {
            closeable.close();
        } catch (Exception ignored) {
        }
    }
}
