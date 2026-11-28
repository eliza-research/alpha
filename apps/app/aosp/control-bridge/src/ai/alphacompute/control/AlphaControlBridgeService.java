package ai.alphacompute.control;

import android.app.KeyguardManager;
import android.app.Service;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.hardware.HardwareBuffer;
import android.hardware.input.InputManagerGlobal;
import android.os.Binder;
import android.os.Build;
import android.os.IBinder;
import android.os.InputEventInjectionSync;
import android.os.ParcelFileDescriptor;
import android.os.RemoteException;
import android.os.SystemClock;
import android.os.UserManager;
import android.provider.Settings;
import android.view.Display;
import android.view.IWindowManager;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.WindowManagerGlobal;
import android.window.ScreenCapture;
import android.window.ScreenCaptureInternal;
import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Platform-signed privileged bridge exposing narrowly scoped display capture,
 * input injection, and Alpha accessibility toggling solely to the verified
 * preinstalled Alpha system package.
 */
public final class AlphaControlBridgeService extends Service {
    /** Wire protocol version negotiated by AlphaControlBridgeClient. */
    public static final int PROTOCOL_VERSION = 1;

    /** Bitmask capability for unthrottled non-secure display capture. */
    public static final int CAPABILITY_CAPTURE_DISPLAY = 1;

    /** Bitmask capability for low-level key and motion injection. */
    public static final int CAPABILITY_INJECT_EVENTS = 2;

    /** Bitmask capability for toggling Alpha's accessibility service. */
    public static final int CAPABILITY_TOGGLE_ACCESSIBILITY = 4;

    /** Sole authorized client package name. */
    public static final String ALPHA_PACKAGE = "ai.alphacompute.alphaphone";

    /** Sole accessibility component that this bridge may toggle. */
    public static final String ALPHA_ACCESSIBILITY_COMPONENT =
            "ai.alphacompute.alphaphone/ai.alphacompute.control.AlphaAccessibilityService";

    /** Legacy shorthand form normalized away when toggling accessibility. */
    private static final String ALPHA_ACCESSIBILITY_SHORTHAND =
            "ai.alphacompute.alphaphone/.control.AlphaAccessibilityService";

    /** SHA-256 certificate digest of Alpha's canonical release signer. */
    static final byte[] ALPHA_SIGNER_SHA256 = new byte[] {
        (byte) 0xed, (byte) 0xbf, (byte) 0xca, (byte) 0xcb,
        (byte) 0x1d, (byte) 0xa6, (byte) 0x89, (byte) 0x00,
        (byte) 0x8b, (byte) 0xf4, (byte) 0xe7, (byte) 0xd6,
        (byte) 0x75, (byte) 0x17, (byte) 0x6c, (byte) 0x30,
        (byte) 0x2d, (byte) 0xec, (byte) 0xf8, (byte) 0x31,
        (byte) 0x61, (byte) 0xa8, (byte) 0x77, (byte) 0xeb,
        (byte) 0x8b, (byte) 0x1d, (byte) 0xe4, (byte) 0xff,
        (byte) 0xae, (byte) 0x04, (byte) 0x45, (byte) 0xed,
    };

    /**
     * SHA-256 certificate digest of the development signer permitted exclusively on
     * {@code userdebug}/{@code eng} builds ({@code Build.IS_DEBUGGABLE}).
     */
    static final String ALPHA_DEBUG_SIGNER_HEX =
            "227ddd0bf51116a69fb6f8f8ceb32ee2df9ed086471bceec4f9a26f48f31d5d5";

    /** Hardcoded guarantee that FLAG_SECURE and DRM layers are never captured. */
    static final boolean CAPTURE_SECURE_LAYERS = false;

    static final int MIN_CAPTURE_WIDTH = 360;
    static final int MAX_CAPTURE_WIDTH = 1440;
    static final int MIN_JPEG_QUALITY = 40;
    static final int MAX_JPEG_QUALITY = 85;

    private final ExecutorService pipeWriter = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable, "alpha-bridge-capture");
        thread.setDaemon(true);
        return thread;
    });

    private final IAlphaControlBridge.Stub binder = new IAlphaControlBridge.Stub() {
        @Override
        public int getProtocolVersion() {
            enforceAlphaCaller();
            return PROTOCOL_VERSION;
        }

        @Override
        public int getCapabilities() {
            enforceAlphaCaller();
            return CAPABILITY_CAPTURE_DISPLAY
                    | CAPABILITY_INJECT_EVENTS
                    | CAPABILITY_TOGGLE_ACCESSIBILITY;
        }

        @Override
        public ParcelFileDescriptor captureDisplay(int displayId, int maxWidth, int jpegQuality) {
            enforceAlphaCaller();
            if (displayId != Display.DEFAULT_DISPLAY || maxWidth <= 0 || jpegQuality <= 0) {
                return null;
            }
            final int boundedWidth = clampMaxWidth(maxWidth);
            final int boundedQuality = clampJpegQuality(jpegQuality);
            final long token = Binder.clearCallingIdentity();
            try {
                if (!isDeviceUnlocked()) {
                    return null;
                }
                return captureDisplayUnlocked(displayId, boundedWidth, boundedQuality);
            } finally {
                Binder.restoreCallingIdentity(token);
            }
        }

        @Override
        public boolean injectKeyEvent(int keyCode, int metaState, int action) {
            enforceAlphaCaller();
            if (!isAllowedKeyCode(keyCode) || !isAllowedKeyAction(action)) {
                return false;
            }
            final int normalizedMeta = KeyEvent.normalizeMetaState(metaState);
            final long token = Binder.clearCallingIdentity();
            try {
                if (!isDeviceUnlocked()) {
                    return false;
                }
                final InputManagerGlobal inputManager = InputManagerGlobal.getInstance();
                if (inputManager == null) {
                    return false;
                }
                final long now = SystemClock.uptimeMillis();
                final KeyEvent event = new KeyEvent(
                        now,
                        now,
                        action,
                        keyCode,
                        0,
                        normalizedMeta,
                        KeyCharacterMapCompat.VIRTUAL_KEYBOARD,
                        0,
                        0,
                        InputDevice.SOURCE_KEYBOARD);
                return inputManager.injectInputEvent(
                        event, InputEventInjectionSync.WAIT_FOR_FINISHED);
            } finally {
                Binder.restoreCallingIdentity(token);
            }
        }

        @Override
        public boolean injectMotionEvent(
                int action, float x, float y, long downTime, long eventTime) {
            enforceAlphaCaller();
            if (!isAllowedMotionAction(action)
                    || !isValidCoordinate(x, y)
                    || downTime <= 0L
                    || eventTime < downTime) {
                return false;
            }
            final long token = Binder.clearCallingIdentity();
            try {
                if (!isDeviceUnlocked()) {
                    return false;
                }
                final InputManagerGlobal inputManager = InputManagerGlobal.getInstance();
                if (inputManager == null) {
                    return false;
                }
                final MotionEvent event = MotionEvent.obtain(downTime, eventTime, action, x, y, 0);
                try {
                    event.setSource(InputDevice.SOURCE_TOUCHSCREEN);
                    return inputManager.injectInputEvent(
                            event, InputEventInjectionSync.WAIT_FOR_FINISHED);
                } finally {
                    event.recycle();
                }
            } finally {
                Binder.restoreCallingIdentity(token);
            }
        }

        @Override
        public boolean setAlphaAccessibilityEnabled(boolean enabled) {
            enforceAlphaCaller();
            final long token = Binder.clearCallingIdentity();
            try {
                final ContentResolver resolver = getContentResolver();
                final String current = Settings.Secure.getString(
                        resolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
                final String updated = updateEnabledAccessibilityServices(current, enabled);
                final boolean wroteServices = Settings.Secure.putString(
                        resolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES, updated);
                if (!wroteServices) {
                    return false;
                }
                final int accessibilityEnabled = updated.isEmpty() ? 0 : 1;
                return Settings.Secure.putInt(
                        resolver, Settings.Secure.ACCESSIBILITY_ENABLED, accessibilityEnabled);
            } finally {
                Binder.restoreCallingIdentity(token);
            }
        }
    };

    private static final class KeyCharacterMapCompat {
        static final int VIRTUAL_KEYBOARD = -1;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return binder;
    }

    @Override
    public void onDestroy() {
        pipeWriter.shutdownNow();
        super.onDestroy();
    }

    /**
     * Enforces that the IPC caller is exclusively the preinstalled system copy of
     * Alpha signed by Alpha's canonical release certificate.
     */
    private void enforceAlphaCaller() {
        final int callingUid = Binder.getCallingUid();
        if (callingUid <= 0) {
            throw new SecurityException("Invalid calling UID");
        }
        final PackageManager pm = getPackageManager();
        final String[] callerPackages = pm.getPackagesForUid(callingUid);
        if (callerPackages == null || callerPackages.length != 1
                || !ALPHA_PACKAGE.equals(callerPackages[0])) {
            throw new SecurityException("Caller UID does not belong exclusively to Alpha");
        }
        final PackageInfo pkgInfo;
        try {
            pkgInfo = pm.getPackageInfo(
                    ALPHA_PACKAGE,
                    PackageManager.MATCH_SYSTEM_ONLY | PackageManager.GET_SIGNING_CERTIFICATES);
        } catch (PackageManager.NameNotFoundException missing) {
            throw new SecurityException("Preinstalled Alpha package not found", missing);
        }
        if (pkgInfo == null || pkgInfo.applicationInfo == null
                || pkgInfo.applicationInfo.uid != callingUid
                || !pkgInfo.applicationInfo.enabled) {
            throw new SecurityException("Alpha package UID or enabled state mismatch");
        }
        final int flags = pkgInfo.applicationInfo.flags;
        final boolean isSystem =
                (flags & (ApplicationInfo.FLAG_SYSTEM | ApplicationInfo.FLAG_UPDATED_SYSTEM_APP))
                        != 0;
        final boolean isSuspended = (flags & ApplicationInfo.FLAG_SUSPENDED) != 0;
        if (!isSystem || isSuspended) {
            throw new SecurityException("Alpha package must be an active system app");
        }
        final boolean matchesReleaseCert = pm.hasSigningCertificate(
                ALPHA_PACKAGE, ALPHA_SIGNER_SHA256, PackageManager.CERT_INPUT_SHA256);
        final boolean isDebuggableBuild = isDebuggableBuild();
        final boolean matchesDebugCert = isDebuggableBuild
                && pm.hasSigningCertificate(
                        ALPHA_PACKAGE,
                        decodeHexDigest(ALPHA_DEBUG_SIGNER_HEX),
                        PackageManager.CERT_INPUT_SHA256);
        if (pkgInfo.signingInfo == null
                || pkgInfo.signingInfo.hasMultipleSigners()
                || !isAuthorizedSigner(isDebuggableBuild, matchesReleaseCert, matchesDebugCert)) {
            throw new SecurityException("Alpha signing certificate verification failed");
        }
    }

    /**
     * Returns true only when the running OS build is a debuggable {@code userdebug} or
     * {@code eng} image and {@code Build.IS_DEBUGGABLE} is true (fails closed on {@code user}
     * builds or if the hidden field is unavailable).
     */
    static boolean isDebuggableBuild() {
        if (!"userdebug".equals(Build.TYPE) && !"eng".equals(Build.TYPE)) {
            return false;
        }
        try {
            return Build.class.getField("IS_DEBUGGABLE").getBoolean(null);
        } catch (ReflectiveOperationException ignored) {
            return false;
        }
    }

    /**
     * Authorizes the release signer unconditionally and the debug signer solely when
     * {@code isDebuggableBuild} is true; {@code user} builds accept only the release signer.
     */
    static boolean isAuthorizedSigner(
            boolean isDebuggableBuild, boolean matchesReleaseCert, boolean matchesDebugCert) {
        return matchesReleaseCert || (isDebuggableBuild && matchesDebugCert);
    }

    /** Decodes a 64-character lowercase hexadecimal SHA-256 digest into 32 bytes. */
    static byte[] decodeHexDigest(String hex) {
        if (hex == null || hex.length() != 64) {
            throw new IllegalArgumentException("Expected 64-char SHA-256 hex digest");
        }
        final byte[] out = new byte[32];
        for (int index = 0; index < 32; index++) {
            final int hi = Character.digit(hex.charAt(index * 2), 16);
            final int lo = Character.digit(hex.charAt(index * 2 + 1), 16);
            if (hi < 0 || lo < 0) {
                throw new IllegalArgumentException("Invalid hex digit in SHA-256 digest");
            }
            out[index] = (byte) ((hi << 4) | lo);
        }
        return out;
    }

    /** Returns true only when keyguard is dismissed and the user storage is unlocked. */
    private boolean isDeviceUnlocked() {
        final KeyguardManager keyguard = getSystemService(KeyguardManager.class);
        final UserManager userManager = getSystemService(UserManager.class);
        return keyguard != null
                && userManager != null
                && !keyguard.isKeyguardLocked()
                && !keyguard.isDeviceLocked()
                && userManager.isUserUnlocked();
    }

    /** Captures a display frame with secure and protected layers redacted into a JPEG pipe. */
    private ParcelFileDescriptor captureDisplayUnlocked(
            int displayId, int boundedWidth, int boundedQuality) {
        final IWindowManager windowManager = WindowManagerGlobal.getWindowManagerService();
        if (windowManager == null) {
            return null;
        }
        final int securePolicy = CAPTURE_SECURE_LAYERS
                ? ScreenCapture.ScreenCaptureParams.SECURE_CONTENT_POLICY_CAPTURE
                : ScreenCapture.ScreenCaptureParams.SECURE_CONTENT_POLICY_REDACT;
        final ScreenCaptureInternal.CaptureArgs captureArgs =
                new ScreenCaptureInternal.CaptureArgs.Builder<>()
                        .setSecureContentPolicy(securePolicy)
                        .setProtectedContentPolicy(
                                ScreenCapture.ScreenCaptureParams.PROTECTED_CONTENT_POLICY_REDACT)
                        .build();
        final ScreenCaptureInternal.SynchronousScreenCaptureListener listener =
                ScreenCaptureInternal.createSyncCaptureListener();
        try {
            windowManager.captureDisplay(displayId, captureArgs, listener);
        } catch (RemoteException remoteFailure) {
            return null;
        }
        final ScreenCaptureInternal.ScreenshotHardwareBuffer screenshot = listener.getBuffer();
        if (screenshot == null) {
            return null;
        }
        final HardwareBuffer hardwareBuffer = screenshot.getHardwareBuffer();
        if (hardwareBuffer == null) {
            return null;
        }
        if (screenshot.containsSecureLayers()) {
            hardwareBuffer.close();
            return null;
        }
        final Bitmap captured = screenshot.asBitmap();
        hardwareBuffer.close();
        if (captured == null) {
            return null;
        }
        final Bitmap software = captured.copy(Bitmap.Config.ARGB_8888, false);
        captured.recycle();
        if (software == null) {
            return null;
        }
        final Bitmap outputBitmap = scaleBitmapToMaxWidth(software, boundedWidth);
        if (outputBitmap != software) {
            software.recycle();
        }
        final ParcelFileDescriptor[] pipe;
        try {
            pipe = ParcelFileDescriptor.createPipe();
        } catch (IOException ioFailure) {
            outputBitmap.recycle();
            return null;
        }
        final ParcelFileDescriptor readEnd = pipe[0];
        final ParcelFileDescriptor writeEnd = pipe[1];
        pipeWriter.execute(() -> {
            try (OutputStream stream = new ParcelFileDescriptor.AutoCloseOutputStream(writeEnd)) {
                outputBitmap.compress(Bitmap.CompressFormat.JPEG, boundedQuality, stream);
                stream.flush();
            } catch (IOException ignored) {
            } finally {
                outputBitmap.recycle();
            }
        });
        return readEnd;
    }

    /** Scales a bitmap down proportionally when wider than {@code maxWidth}. */
    private static Bitmap scaleBitmapToMaxWidth(Bitmap source, int maxWidth) {
        final int width = source.getWidth();
        final int height = source.getHeight();
        if (width <= 0 || height <= 0 || width <= maxWidth) {
            return source;
        }
        final int targetHeight = Math.max(1, Math.round((float) height * maxWidth / width));
        return Bitmap.createScaledBitmap(source, maxWidth, targetHeight, true);
    }

    /** Clamps requested capture width to the permitted range. */
    static int clampMaxWidth(int maxWidth) {
        return Math.max(MIN_CAPTURE_WIDTH, Math.min(MAX_CAPTURE_WIDTH, maxWidth));
    }

    /** Clamps requested JPEG quality to the permitted range. */
    static int clampJpegQuality(int jpegQuality) {
        return Math.max(MIN_JPEG_QUALITY, Math.min(MAX_JPEG_QUALITY, jpegQuality));
    }

    /** Returns true only for explicitly allowlisted navigation and editing keycodes. */
    static boolean isAllowedKeyCode(int keyCode) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_ENTER:
            case KeyEvent.KEYCODE_DEL:
            case KeyEvent.KEYCODE_TAB:
            case KeyEvent.KEYCODE_ESCAPE:
            case KeyEvent.KEYCODE_SPACE:
            case KeyEvent.KEYCODE_BACK:
            case KeyEvent.KEYCODE_SEARCH:
            case KeyEvent.KEYCODE_DPAD_UP:
            case KeyEvent.KEYCODE_DPAD_DOWN:
            case KeyEvent.KEYCODE_DPAD_LEFT:
            case KeyEvent.KEYCODE_DPAD_RIGHT:
            case KeyEvent.KEYCODE_DPAD_CENTER:
                return true;
            default:
                return false;
        }
    }

    /** Returns true only for key down and key up actions. */
    static boolean isAllowedKeyAction(int action) {
        return action == KeyEvent.ACTION_DOWN || action == KeyEvent.ACTION_UP;
    }

    /** Returns true only for primary touch down, move, up, and cancel actions. */
    static boolean isAllowedMotionAction(int action) {
        return action == MotionEvent.ACTION_DOWN
                || action == MotionEvent.ACTION_MOVE
                || action == MotionEvent.ACTION_UP
                || action == MotionEvent.ACTION_CANCEL;
    }

    /** Returns true when touch coordinates are finite and non-negative. */
    static boolean isValidCoordinate(float x, float y) {
        return Float.isFinite(x) && Float.isFinite(y) && x >= 0.0f && y >= 0.0f;
    }

    /**
     * Adds or removes strictly Alpha's accessibility component from a colon-delimited
     * {@code enabled_accessibility_services} value without modifying any other service.
     */
    static String updateEnabledAccessibilityServices(String currentValue, boolean enabled) {
        final List<String> entries = new ArrayList<>();
        if (currentValue != null && !currentValue.isEmpty()) {
            for (String raw : currentValue.split(":")) {
                final String entry = raw.trim();
                if (entry.isEmpty()) {
                    continue;
                }
                if (ALPHA_ACCESSIBILITY_COMPONENT.equals(entry)
                        || ALPHA_ACCESSIBILITY_SHORTHAND.equals(entry)) {
                    continue;
                }
                if (!entries.contains(entry)) {
                    entries.add(entry);
                }
            }
        }
        if (enabled) {
            entries.add(ALPHA_ACCESSIBILITY_COMPONENT);
        }
        return String.join(":", entries);
    }
}
