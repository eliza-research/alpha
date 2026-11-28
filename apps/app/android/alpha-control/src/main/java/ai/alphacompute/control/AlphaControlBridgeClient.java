// spec/app/control/index.md, "The phone reports its native control tier, and losing access immediately revokes any active lease and halts pending work"
package ai.alphacompute.control;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.IBinder;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.os.RemoteException;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Verifies and binds the optional platform-signed AOSP AlphaControlBridge service (Tier 2).
 * Falls back cleanly to disconnected state on stock Android (Tier 1).
 */
public final class AlphaControlBridgeClient {
    /** Package name of the platform-signed AOSP control bridge. */
    public static final String BRIDGE_PACKAGE = "ai.alphacompute.controlbridge";

    /** Component class name of the platform-signed AOSP control bridge service. */
    public static final String BRIDGE_CLASS = "ai.alphacompute.control.AlphaControlBridgeService";

    /** Supported AIDL wire protocol version. */
    public static final int EXPECTED_PROTOCOL_VERSION = 1;

    /** Capability bitmask for unthrottled display capture with captureSecureLayers=false. */
    public static final int CAP_CAPTURE_DISPLAY = 1;

    /** Capability bitmask for privileged INJECT_EVENTS key/motion injection. */
    public static final int CAP_INJECT_EVENTS = 2;

    /** Capability bitmask for owner-initiated AccessibilityService enable/disable toggle. */
    public static final int CAP_TOGGLE_ACCESSIBILITY = 4;

    private static final int MAX_CAPTURE_BYTES = 1_400_000;

    private final Context appContext;
    private final AtomicReference<IAlphaControlBridge> binderRef = new AtomicReference<>();
    private final AtomicReference<Integer> capabilitiesRef = new AtomicReference<>(0);
    private volatile boolean bound;
    private volatile CountDownLatch connectLatch = new CountDownLatch(1);

    private final ServiceConnection connection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder service) {
            IAlphaControlBridge proxy = IAlphaControlBridge.Stub.asInterface(service);
            try {
                if (proxy != null && proxy.getProtocolVersion() == EXPECTED_PROTOCOL_VERSION) {
                    capabilitiesRef.set(proxy.getCapabilities());
                    binderRef.set(proxy);
                } else {
                    binderRef.set(null);
                    capabilitiesRef.set(0);
                }
            } catch (RemoteException | SecurityException unavailable) {
                binderRef.set(null);
                capabilitiesRef.set(0);
            } finally {
                connectLatch.countDown();
            }
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            binderRef.set(null);
            capabilitiesRef.set(0);
        }

        @Override
        public void onBindingDied(ComponentName name) {
            binderRef.set(null);
            capabilitiesRef.set(0);
            connectLatch.countDown();
        }

        @Override
        public void onNullBinding(ComponentName name) {
            binderRef.set(null);
            capabilitiesRef.set(0);
            connectLatch.countDown();
        }
    };

    /** Create a bridge client scoped to the application context. */
    public AlphaControlBridgeClient(Context context) {
        this.appContext = context.getApplicationContext();
    }

    /** Verify that the installed bridge APK is a system package signed with the platform certificate. */
    public static boolean isVerifiedPlatformBridgeInstalled(PackageManager pm) {
        if (pm == null) return false;
        try {
            PackageInfo info = pm.getPackageInfo(BRIDGE_PACKAGE, PackageManager.MATCH_SYSTEM_ONLY);
            if (info == null || info.applicationInfo == null) return false;
            int flags = info.applicationInfo.flags;
            boolean isSystem = (flags & (ApplicationInfo.FLAG_SYSTEM | ApplicationInfo.FLAG_UPDATED_SYSTEM_APP)) != 0;
            if (!isSystem || !info.applicationInfo.enabled) return false;
            return pm.checkSignatures("android", BRIDGE_PACKAGE) == PackageManager.SIGNATURE_MATCH;
        } catch (PackageManager.NameNotFoundException | SecurityException unavailable) {
            return false;
        }
    }

    /** Attempt to verify and bind the Tier-2 bridge, skipping blocking await if called on the main thread. */
    public synchronized boolean connect(long timeoutMs) {
        if (isConnected()) return true;
        if (!isVerifiedPlatformBridgeInstalled(appContext.getPackageManager())) return false;
        if (!bound) {
            connectLatch = new CountDownLatch(1);
            Intent intent = new Intent();
            intent.setComponent(new ComponentName(BRIDGE_PACKAGE, BRIDGE_CLASS));
            try {
                bound = appContext.bindService(intent, connection, Context.BIND_AUTO_CREATE);
            } catch (SecurityException refused) {
                bound = false;
                return false;
            }
            if (!bound) return false;
        }
        if (isMainThread()) return isConnected();
        try {
            connectLatch.await(Math.max(50L, timeoutMs), TimeUnit.MILLISECONDS);
            return isConnected();
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return false;
        }
    }

    private static boolean isMainThread() {
        Looper main = Looper.getMainLooper();
        return main != null && Looper.myLooper() == main;
    }

    /** Disconnect from the bridge if bound. */
    public synchronized void disconnect() {
        if (bound) {
            try {
                appContext.unbindService(connection);
            } catch (IllegalArgumentException ignored) {
                bound = false;
            }
            bound = false;
        }
        binderRef.set(null);
        capabilitiesRef.set(0);
    }

    /** Whether a protocol-verified platform bridge is currently connected. */
    public boolean isConnected() {
        IAlphaControlBridge proxy = binderRef.get();
        return proxy != null && proxy.asBinder().isBinderAlive();
    }

    /** Return the cached capability bitmask reported by the verified bridge. */
    public int capabilities() {
        return isConnected() ? capabilitiesRef.get() : 0;
    }

    /** Whether the connected bridge supports unthrottled display capture. */
    public boolean supportsCaptureDisplay() {
        return (capabilities() & CAP_CAPTURE_DISPLAY) != 0;
    }

    /** Whether the connected bridge supports privileged input injection. */
    public boolean supportsInjectEvents() {
        return (capabilities() & CAP_INJECT_EVENTS) != 0;
    }

    /** Capture display image bytes via the platform bridge (always non-secure layers only). */
    public byte[] captureDisplayBytes(int displayId, int maxWidth, int jpegQuality) {
        IAlphaControlBridge proxy = binderRef.get();
        if (proxy == null || !supportsCaptureDisplay()) return null;
        try (ParcelFileDescriptor pfd = proxy.captureDisplay(displayId, maxWidth, jpegQuality)) {
            if (pfd == null) return null;
            try (InputStream in = new ParcelFileDescriptor.AutoCloseInputStream(pfd);
                 ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buf = new byte[16_384];
                int read;
                int total = 0;
                while ((read = in.read(buf)) >= 0) {
                    total += read;
                    if (total > MAX_CAPTURE_BYTES) return null;
                    out.write(buf, 0, read);
                }
                return out.toByteArray();
            }
        } catch (RemoteException | IOException | SecurityException failed) {
            return null;
        }
    }

    /** Inject an allowlisted key event via the platform bridge. */
    public boolean injectKeyEvent(int keyCode, int metaState, int action) {
        IAlphaControlBridge proxy = binderRef.get();
        if (proxy == null || !supportsInjectEvents()) return false;
        try {
            return proxy.injectKeyEvent(keyCode, metaState, action);
        } catch (RemoteException | SecurityException failed) {
            return false;
        }
    }

    /** Inject a raw motion event via the platform bridge. */
    public boolean injectMotionEvent(int action, float x, float y, long downTime, long eventTime) {
        IAlphaControlBridge proxy = binderRef.get();
        if (proxy == null || !supportsInjectEvents()) return false;
        try {
            return proxy.injectMotionEvent(action, x, y, downTime, eventTime);
        } catch (RemoteException | SecurityException failed) {
            return false;
        }
    }

    /** Toggle Alpha's own AccessibilityService on or off after explicit owner consent. */
    public boolean setAlphaAccessibilityEnabled(boolean enabled) {
        IAlphaControlBridge proxy = binderRef.get();
        if (proxy == null || (capabilities() & CAP_TOGGLE_ACCESSIBILITY) == 0) return false;
        try {
            return proxy.setAlphaAccessibilityEnabled(enabled);
        } catch (RemoteException | SecurityException failed) {
            return false;
        }
    }
}
