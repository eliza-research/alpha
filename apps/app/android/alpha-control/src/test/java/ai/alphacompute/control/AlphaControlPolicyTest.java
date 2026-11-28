// spec/app/control/index.md, "Story: Enforce formal safety guarantees over external app control"
package ai.alphacompute.control;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONObject;
import org.junit.Test;

/** Pure JVM verification tests for AlphaControlPolicy and AlphaUiControlExecutor safety rules. */
public final class AlphaControlPolicyTest {
    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    /** Verify blocked packages, Play Store billing activities, HTTPS URLs, screen protection, and keycode allowlists. */
    @Test
    public void testPolicyRules() {
        check(AlphaControlPolicy.isBlockedTarget("com.android.permissioncontroller", null), "permissioncontroller must be blocked");
        check(AlphaControlPolicy.isBlockedTarget("com.android.packageinstaller", null), "packageinstaller must be blocked");
        check(AlphaControlPolicy.isBlockedTarget("com.android.settings", null), "settings must be blocked");
        check(AlphaControlPolicy.isBlockedTarget("proton.android.pass", null), "password managers must be blocked");
        check(AlphaControlPolicy.isBlockedTarget("ai.alphacompute.alphaphone", null), "Alpha approval host must be blocked");
        check(AlphaControlPolicy.isBlockedTarget("ai.alphacompute.wallet", null), "Alpha wallet must be blocked");
        check(AlphaControlPolicy.isBlockedTarget("com.android.vending", "com.google.android.finsky.billing.PurchaseActivity"), "Play billing must be blocked");
        check(!AlphaControlPolicy.isBlockedTarget("com.android.vending", "com.google.android.finsky.activities.MainActivity"), "Play browse allowed");
        check(!AlphaControlPolicy.isBlockedTarget("org.mozilla.firefox", "org.mozilla.fenix.HomeActivity"), "Firefox allowed");

        check(AlphaControlPolicy.isValidHttpsUrl("https://example.org/docs"), "HTTPS URL allowed");
        check(!AlphaControlPolicy.isValidHttpsUrl("http://example.org"), "HTTP URL refused");
        check(!AlphaControlPolicy.isValidHttpsUrl("javascript:alert(1)"), "javascript scheme refused");
        check(!AlphaControlPolicy.isValidHttpsUrl("https://user:pass@example.org"), "userinfo URL refused");

        check(AlphaControlPolicy.isFirefoxPackage("org.mozilla.firefox"), "Firefox detected");
        check(AlphaControlPolicy.isPrivateBrowserWindow("org.mozilla.firefox", "Private Browsing", false), "Firefox private title detected");
        check(AlphaControlPolicy.isPrivateBrowserWindow("org.mozilla.firefox", "Firefox", true), "Firefox FLAG_SECURE private detected");

        check(
            AlphaControlPolicy.classifyScreenProtection(true, false, true, false, false, false)
                == AlphaControlPolicy.ScreenProtection.ScreenLocked,
            "keyguard lock must classify ScreenLocked"
        );
        check(
            AlphaControlPolicy.classifyScreenProtection(false, false, true, true, false, false)
                == AlphaControlPolicy.ScreenProtection.SecureFlag,
            "FLAG_SECURE must classify SecureFlag"
        );
        check(
            AlphaControlPolicy.classifyScreenProtection(false, false, true, false, true, false)
                == AlphaControlPolicy.ScreenProtection.PrivateTab,
            "private tab must classify PrivateTab"
        );
        check(
            AlphaControlPolicy.classifyScreenProtection(false, false, true, false, false, true)
                == AlphaControlPolicy.ScreenProtection.SensitiveView,
            "sensitive focused input must classify SensitiveView"
        );
        check(
            AlphaControlPolicy.classifyScreenProtection(false, false, true, false, false, false)
                == AlphaControlPolicy.ScreenProtection.ScreenClear,
            "clear unlocked screen must classify ScreenClear"
        );
        check(
            "".equals(AlphaAccessibilityService.resolveNextActivity("com.android.vending", "org.mozilla.firefox", "PurchaseActivity", null)),
            "package transition without class name must clear stale activeActivity"
        );
        check(
            "HomeActivity".equals(AlphaAccessibilityService.resolveNextActivity("org.mozilla.firefox", "org.mozilla.firefox", "HomeActivity", null)),
            "same-package event without class name preserves activeActivity"
        );
        check(
            "SettingsActivity".equals(AlphaAccessibilityService.resolveNextActivity("org.mozilla.firefox", "com.android.settings", "HomeActivity", "SettingsActivity")),
            "explicit class name updates activeActivity"
        );
        check(
            AlphaAccessibilityService.shouldEmitNode(false, false, true, false),
            "interactive descendants must emit even if visibility lags during window transition"
        );
        check(
            AlphaAccessibilityService.shouldEmitNode(false, false, false, true),
            "text descendants must emit even if visibility lags during window transition"
        );
        check(
            !AlphaAccessibilityService.shouldEmitNode(false, true, false, false),
            "invisible empty containers must not emit noise while remaining traversable"
        );
        check(
            AlphaAccessibilityService.shouldRetryEmptyObservation("com.android.chrome", "FirstRunActivity", "com.android.chrome", 0, 1_000L, 1_450L),
            "empty observation for AllowedApp must retry after 400ms"
        );
        check(
            !AlphaAccessibilityService.shouldRetryEmptyObservation("com.android.chrome", "FirstRunActivity", "com.android.chrome", 0, 1_000L, 1_200L),
            "empty observation retry must stay rate-limited under 400ms"
        );
        check(
            !AlphaAccessibilityService.shouldRetryEmptyObservation("com.android.chrome", "FirstRunActivity", "com.android.chrome", 8, 1_000L, 2_000L),
            "populated observation for current package must not retry"
        );
        check(
            AlphaAccessibilityService.shouldRetryEmptyObservation("com.android.chrome", "FirstRunActivity", "com.google.android.apps.nexuslauncher", 12, 1_000L, 1_500L),
            "stale package observation must retry once activePackage switches to AllowedApp"
        );
        check(
            !AlphaAccessibilityService.shouldRetryEmptyObservation("com.android.settings", "Settings", "com.android.settings", 0, 1_000L, 2_000L),
            "blocked packages must not trigger content-change retry captures"
        );

        check(!AlphaControlPolicy.isScreenshotAllowed(1_000L, 1_500L, false), "Tier-1 screenshot must throttle under 1100ms");
        check(AlphaControlPolicy.isScreenshotAllowed(1_000L, 2_200L, false), "Tier-1 screenshot allowed after 1100ms");
        check(AlphaControlPolicy.isScreenshotAllowed(1_000L, 1_050L, true), "Tier-2 screenshot unthrottled");

        check(AlphaControlPolicy.resolveAllowlistedKeyCode("ENTER") > 0, "ENTER allowlisted");
        check(AlphaControlPolicy.resolveAllowlistedKeyCode("POWER") < 0, "POWER refused");
        check(!AlphaControlPolicy.requiresSnapshot("app_open_url"), "app_open_url needs no prior snapshot");
        check(AlphaControlPolicy.requiresSnapshot("ui_click"), "ui_click requires live snapshot");

        check(AlphaAccessibilityService.didDirectSetTextApply(true, "hello", "hello"), "matching refreshed text accepts direct ACTION_SET_TEXT");
        check(!AlphaAccessibilityService.didDirectSetTextApply(true, "hello", "stale"), "mismatched refreshed text triggers clipboard fallback on all packages");
        check(!AlphaAccessibilityService.didDirectSetTextApply(true, "hello", null), "null refreshed text triggers clipboard fallback");
        check(!AlphaAccessibilityService.didDirectSetTextApply(false, "hello", "hello"), "failed direct ACTION_SET_TEXT triggers clipboard fallback");

        check(AlphaUiControlExecutor.shouldUseTier1ImeEnter(true, false, 35), "Tier-1 submit uses ACTION_IME_ENTER on API 30+");
        check(!AlphaUiControlExecutor.shouldUseTier1ImeEnter(true, true, 35), "Tier-2 privileged inject bypasses Tier-1 IME enter");
        check(!AlphaUiControlExecutor.shouldUseTier1ImeEnter(false, false, 35), "non-submit does not invoke IME enter");
        check(!AlphaUiControlExecutor.shouldUseTier1ImeEnter(true, false, 29), "pre-API-30 skips ACTION_IME_ENTER");

        check(AlphaUiControlExecutor.shouldRefreshPostActuation("ui_click"), "ui_click triggers post-actuation observation");
        check(AlphaUiControlExecutor.shouldRefreshPostActuation("ui_set_text"), "ui_set_text triggers post-actuation observation");
        check(AlphaUiControlExecutor.shouldRefreshPostActuation("app_open_url"), "app_open_url triggers post-actuation observation");
        check(AlphaUiControlExecutor.shouldRefreshPostActuation("app_launch_package"), "app_launch_package triggers post-actuation observation");
        check(!AlphaUiControlExecutor.shouldRefreshPostActuation("ui_read_tree"), "ui_read_tree already observes and skips duplicate refresh");
        check(!AlphaUiControlExecutor.shouldRefreshPostActuation("ui_capture_screen"), "ui_capture_screen already observes and skips duplicate refresh");
        check(!AlphaUiControlExecutor.shouldRefreshPostActuation("app_functions_discover"), "app_functions_discover skips UI refresh");
    }

    /** Verify executor refuses blocked packages, stale snapshots, and non-privileged key injection cleanly. */
    @Test
    public void testExecutorRefusals() throws Exception {
        List<String> postedPaths = new ArrayList<>();
        AlphaUiControlExecutor.NativeAgentTransport transport = (method, path, body) -> {
            postedPaths.add(method + " " + path);
            if ("GET".equals(method) && "/api/alpha-control/next".equals(path)) {
                String json = "{\"op\":{\"opId\":7,\"boundSnapId\":1,\"expectedPackage\":\"org.mozilla.firefox\",\"op\":{\"type\":\"ui_click\",\"snapshotId\":1,\"expectedPackage\":\"org.mozilla.firefox\",\"nodeId\":\"n1\"}}}";
                return CompletableFuture.completedFuture(new AlphaUiControlExecutor.TransportResponse(200, json.getBytes(StandardCharsets.UTF_8)));
            }
            return CompletableFuture.completedFuture(new AlphaUiControlExecutor.TransportResponse(200, "{}".getBytes(StandardCharsets.UTF_8)));
        };
        AlphaUiControlExecutor executor = new AlphaUiControlExecutor(null, transport);
        check(executor.currentTier() == AlphaControlPolicy.ControlTier.TierNone, "disconnected service is TierNone");

        AlphaUiControlExecutor.StepOutcome blocked = executor.executeOperation(
            new JSONObject().put("type", "app_launch_package").put("packageName", "com.android.settings"),
            0,
            "com.android.settings"
        );
        check("refused".equals(blocked.outcome) && "BLOCKED_PACKAGE".equals(blocked.refusalCode), "blocked package refused");

        AlphaUiControlExecutor.StepOutcome stale = executor.executeOperation(
            new JSONObject().put("type", "ui_click").put("snapshotId", 1).put("expectedPackage", "org.mozilla.firefox").put("nodeId", "n1"),
            1,
            "org.mozilla.firefox"
        );
        check("refused".equals(stale.outcome) && "STALE_SNAPSHOT".equals(stale.refusalCode), "stale snapshot refused");

        AlphaUiControlExecutor.StepOutcome openUrlUnleased = executor.executeOperation(
            new JSONObject().put("type", "app_open_url").put("url", "https://example.org"),
            0,
            ""
        );
        check("refused".equals(openUrlUnleased.outcome) && "BLOCKED_PACKAGE".equals(openUrlUnleased.refusalCode), "open_url without leased package refused");

        AlphaUiControlExecutor.StepOutcome openUrlMismatch = executor.executeOperation(
            new JSONObject().put("type", "app_open_url").put("url", "https://example.org").put("packageName", "com.android.chrome"),
            0,
            "org.mozilla.firefox"
        );
        check("refused".equals(openUrlMismatch.outcome) && "PACKAGE_MISMATCH".equals(openUrlMismatch.refusalCode), "open_url mismatched package refused");

        AlphaUiControlExecutor.StepOutcome openUrlDefaultedNoContext = executor.executeOperation(
            new JSONObject().put("type", "app_open_url").put("url", "https://example.org"),
            0,
            "org.mozilla.firefox"
        );
        check("refused".equals(openUrlDefaultedNoContext.outcome) && "CONTEXT_UNAVAILABLE".equals(openUrlDefaultedNoContext.refusalCode), "open_url defaults targetPkg to expectedPackage");

        executor.pollOnce();
        check(postedPaths.contains("GET /api/alpha-control/next"), "executor polled next route");
        check(postedPaths.contains("POST /api/alpha-control/receipt"), "executor posted refusal receipt");
    }

    /** Verify runtime exceptions always emit a refused receipt, opIds never execute twice, and worker shuts down cleanly. */
    @Test
    public void testExecutorExceptionReceiptDeduplicationAndLifecycle() throws Exception {
        List<JSONObject> receipts = new ArrayList<>();
        AtomicInteger receiptAttempts = new AtomicInteger(0);
        AtomicInteger execCount = new AtomicInteger(0);

        AlphaUiControlExecutor.NativeAgentTransport retryTransport = (method, path, body) -> {
            if ("GET".equals(method) && "/api/alpha-control/next".equals(path)) {
                String json = "{\"op\":{\"opId\":99,\"boundSnapId\":0,\"expectedPackage\":\"org.mozilla.firefox\",\"op\":{\"type\":\"app_open_url\",\"url\":\"https://example.org\"}}}";
                return CompletableFuture.completedFuture(new AlphaUiControlExecutor.TransportResponse(200, json.getBytes(StandardCharsets.UTF_8)));
            }
            if ("POST".equals(method) && "/api/alpha-control/receipt".equals(path)) {
                int attempt = receiptAttempts.incrementAndGet();
                try {
                    receipts.add(new JSONObject(new String(body, StandardCharsets.UTF_8)));
                } catch (Exception failed) {
                    throw new RuntimeException(failed);
                }
                int status = attempt == 1 ? 503 : 200;
                return CompletableFuture.completedFuture(new AlphaUiControlExecutor.TransportResponse(status, "{}".getBytes(StandardCharsets.UTF_8)));
            }
            return CompletableFuture.completedFuture(new AlphaUiControlExecutor.TransportResponse(200, "{}".getBytes(StandardCharsets.UTF_8)));
        };

        AlphaUiControlExecutor dedupExecutor = new AlphaUiControlExecutor(null, retryTransport, (op, snapId, expectedPkg) -> {
            execCount.incrementAndGet();
            return new AlphaUiControlExecutor.StepOutcome("done", null, null);
        });
        dedupExecutor.pollOnce();
        dedupExecutor.pollOnce();
        check(execCount.get() == 1, "transient receipt failure must not execute the same opId twice");
        check(receipts.size() == 2, "second poll must retry posting the cached receipt");
        check(receipts.get(0).getInt("opId") == 99 && "done".equals(receipts.get(0).getString("outcome")), "first receipt carries opId and outcome");
        check(receipts.get(1).getInt("opId") == 99 && "done".equals(receipts.get(1).getString("outcome")), "retried receipt matches cached outcome");

        List<JSONObject> errorReceipts = new ArrayList<>();
        AlphaUiControlExecutor.NativeAgentTransport crashTransport = (method, path, body) -> {
            if ("GET".equals(method) && "/api/alpha-control/next".equals(path)) {
                String json = "{\"op\":{\"opId\":100,\"boundSnapId\":0,\"expectedPackage\":\"org.mozilla.firefox\",\"op\":{\"type\":\"app_launch_package\",\"packageName\":\"org.mozilla.firefox\"}}}";
                return CompletableFuture.completedFuture(new AlphaUiControlExecutor.TransportResponse(200, json.getBytes(StandardCharsets.UTF_8)));
            }
            if ("POST".equals(method) && "/api/alpha-control/receipt".equals(path)) {
                try {
                    errorReceipts.add(new JSONObject(new String(body, StandardCharsets.UTF_8)));
                } catch (Exception failed) {
                    throw new RuntimeException(failed);
                }
            }
            return CompletableFuture.completedFuture(new AlphaUiControlExecutor.TransportResponse(200, "{}".getBytes(StandardCharsets.UTF_8)));
        };

        AlphaUiControlExecutor crashExecutor = new AlphaUiControlExecutor(null, crashTransport, (op, snapId, expectedPkg) -> {
            throw new SecurityException("denied");
        });
        crashExecutor.pollOnce();
        check(errorReceipts.size() == 1, "uncaught RuntimeException must still emit a refused receipt");
        check("refused".equals(errorReceipts.get(0).getString("outcome")), "exception receipt outcome must be refused");
        check("SECURITY_EXCEPTION".equals(errorReceipts.get(0).getString("refusalCode")), "SecurityException maps to SECURITY_EXCEPTION refusalCode");

        List<JSONObject> genericErrorReceipts = new ArrayList<>();
        AlphaUiControlExecutor.NativeAgentTransport genericCrashTransport = (method, path, body) -> {
            if ("GET".equals(method) && "/api/alpha-control/next".equals(path)) {
                String json = "{\"op\":{\"opId\":101,\"boundSnapId\":0,\"expectedPackage\":\"org.mozilla.firefox\",\"op\":{\"type\":\"app_launch_package\",\"packageName\":\"org.mozilla.firefox\"}}}";
                return CompletableFuture.completedFuture(new AlphaUiControlExecutor.TransportResponse(200, json.getBytes(StandardCharsets.UTF_8)));
            }
            if ("POST".equals(method) && "/api/alpha-control/receipt".equals(path)) {
                try {
                    genericErrorReceipts.add(new JSONObject(new String(body, StandardCharsets.UTF_8)));
                } catch (Exception failed) {
                    throw new RuntimeException(failed);
                }
            }
            return CompletableFuture.completedFuture(new AlphaUiControlExecutor.TransportResponse(200, "{}".getBytes(StandardCharsets.UTF_8)));
        };
        AlphaUiControlExecutor genericCrashExecutor = new AlphaUiControlExecutor(null, genericCrashTransport, (op, snapId, expectedPkg) -> {
            throw new IllegalStateException("boom");
        });
        genericCrashExecutor.pollOnce();
        check(genericErrorReceipts.size() == 1, "generic RuntimeException emits refused receipt");
        check("EXECUTION_FAILED".equals(genericErrorReceipts.get(0).getString("refusalCode")), "generic RuntimeException maps to EXECUTION_FAILED");

        dedupExecutor.start();
        dedupExecutor.stop();
        dedupExecutor.pollOnce();
        check(execCount.get() == 2, "stopping executor clears opId dedup cache for a fresh session");
        dedupExecutor.start();
        dedupExecutor.shutdown();
    }

    /** Verify startup observation push, post-actuation snapshot receipts, and non-blocking interrupt dispatch. */
    @Test
    public void testStartupPushPostActuationSnapshotAndDedicatedInterruptWorker() throws Exception {
        CountDownLatch startupObserved = new CountDownLatch(1);
        AlphaUiControlExecutor startupExecutor = new AlphaUiControlExecutor(
            null,
            (method, path, body) -> CompletableFuture.completedFuture(
                new AlphaUiControlExecutor.TransportResponse(200, "{\"op\":null}".getBytes(StandardCharsets.UTF_8))
            ),
            (op, snapId, expectedPkg) -> new AlphaUiControlExecutor.StepOutcome("done", null, null),
            (includeNonInteractive, maxNodes, shot) -> {
                startupObserved.countDown();
                return 1;
            },
            () -> true,
            0L
        );
        try {
            startupExecutor.start();
            check(startupObserved.await(2, TimeUnit.SECONDS), "start() must immediately push an observation when accessibility is already live");
        } finally {
            startupExecutor.stop();
        }

        List<JSONObject> postSnapReceipts = new ArrayList<>();
        AtomicInteger pushCount = new AtomicInteger(0);
        AtomicInteger nextSnap = new AtomicInteger(10);
        AlphaUiControlExecutor.NativeAgentTransport clickTransport = (method, path, body) -> {
            if ("GET".equals(method) && "/api/alpha-control/next".equals(path)) {
                String json = "{\"op\":{\"opId\":201,\"boundSnapId\":10,\"expectedPackage\":\"org.mozilla.firefox\",\"op\":{\"type\":\"ui_click\",\"snapshotId\":10,\"expectedPackage\":\"org.mozilla.firefox\",\"nodeId\":\"w1_n0\"}}}";
                return CompletableFuture.completedFuture(new AlphaUiControlExecutor.TransportResponse(200, json.getBytes(StandardCharsets.UTF_8)));
            }
            if ("POST".equals(method) && "/api/alpha-control/receipt".equals(path)) {
                try {
                    postSnapReceipts.add(new JSONObject(new String(body, StandardCharsets.UTF_8)));
                } catch (Exception failed) {
                    throw new RuntimeException(failed);
                }
            }
            return CompletableFuture.completedFuture(new AlphaUiControlExecutor.TransportResponse(200, "{}".getBytes(StandardCharsets.UTF_8)));
        };
        AlphaUiControlExecutor postSnapExecutor = new AlphaUiControlExecutor(
            null,
            clickTransport,
            (op, snapId, expectedPkg) -> new AlphaUiControlExecutor.StepOutcome("done", null, null),
            (includeNonInteractive, maxNodes, shot) -> {
                pushCount.incrementAndGet();
                return nextSnap.incrementAndGet();
            },
            () -> true,
            0L
        );
        postSnapExecutor.pollOnce();
        check(pushCount.get() == 1, "completed ui_click must trigger one post-actuation observation");
        check(postSnapReceipts.size() == 1, "completed ui_click must post receipt");
        check(postSnapReceipts.get(0).getInt("postSnapshotId") == 11, "receipt must include refreshed postSnapshotId");

        List<JSONObject> refusedReceipts = new ArrayList<>();
        AtomicInteger refusedPushCount = new AtomicInteger(0);
        AlphaUiControlExecutor refusedExecutor = new AlphaUiControlExecutor(
            null,
            (method, path, body) -> {
                if ("GET".equals(method) && "/api/alpha-control/next".equals(path)) {
                    String json = "{\"op\":{\"opId\":202,\"boundSnapId\":10,\"expectedPackage\":\"org.mozilla.firefox\",\"op\":{\"type\":\"ui_click\",\"snapshotId\":10,\"expectedPackage\":\"org.mozilla.firefox\",\"nodeId\":\"w1_n0\"}}}";
                    return CompletableFuture.completedFuture(new AlphaUiControlExecutor.TransportResponse(200, json.getBytes(StandardCharsets.UTF_8)));
                }
                if ("POST".equals(method) && "/api/alpha-control/receipt".equals(path)) {
                    try {
                        refusedReceipts.add(new JSONObject(new String(body, StandardCharsets.UTF_8)));
                    } catch (Exception failed) {
                        throw new RuntimeException(failed);
                    }
                }
                return CompletableFuture.completedFuture(new AlphaUiControlExecutor.TransportResponse(200, "{}".getBytes(StandardCharsets.UTF_8)));
            },
            (op, snapId, expectedPkg) -> new AlphaUiControlExecutor.StepOutcome("refused", "NODE_CLICK_FAILED", null),
            (includeNonInteractive, maxNodes, shot) -> {
                refusedPushCount.incrementAndGet();
                return 99;
            },
            () -> true,
            0L
        );
        refusedExecutor.pollOnce();
        check(refusedPushCount.get() == 0, "refused ui_click must not run post-actuation observation");
        check(refusedReceipts.size() == 1 && !refusedReceipts.get(0).has("postSnapshotId"), "refused receipt omits postSnapshotId");

        CountDownLatch workerBlocked = new CountDownLatch(1);
        CountDownLatch releaseWorker = new CountDownLatch(1);
        CountDownLatch interruptPosted = new CountDownLatch(1);
        AlphaUiControlExecutor interruptExecutor = new AlphaUiControlExecutor(
            null,
            (method, path, body) -> {
                if ("GET".equals(method) && "/api/alpha-control/next".equals(path)) {
                    workerBlocked.countDown();
                    return CompletableFuture.supplyAsync(() -> {
                        try {
                            releaseWorker.await(3, TimeUnit.SECONDS);
                        } catch (InterruptedException ignored) {
                            Thread.currentThread().interrupt();
                        }
                        return new AlphaUiControlExecutor.TransportResponse(200, "{\"op\":null}".getBytes(StandardCharsets.UTF_8));
                    });
                }
                if ("POST".equals(method) && "/api/alpha-control/interrupt".equals(path)) {
                    interruptPosted.countDown();
                }
                return CompletableFuture.completedFuture(new AlphaUiControlExecutor.TransportResponse(200, "{}".getBytes(StandardCharsets.UTF_8)));
            },
            null,
            null,
            () -> false,
            0L
        );
        try {
            interruptExecutor.start();
            check(workerBlocked.await(2, TimeUnit.SECONDS), "poll worker entered blocked transport request");
            interruptExecutor.onPhysicalPreemption("org.mozilla.firefox");
            check(interruptPosted.await(500, TimeUnit.MILLISECONDS), "interrupt must fire immediately on dedicated thread while poll worker is blocked");
        } finally {
            releaseWorker.countDown();
            interruptExecutor.stop();
        }
    }

    /** Standalone JVM entry point for fast verification without Gradle overhead. */
    public static void main(String[] args) throws Exception {
        AlphaControlPolicyTest suite = new AlphaControlPolicyTest();
        suite.testPolicyRules();
        suite.testExecutorRefusals();
        suite.testExecutorExceptionReceiptDeduplicationAndLifecycle();
        suite.testStartupPushPostActuationSnapshotAndDedicatedInterruptWorker();
    }
}
