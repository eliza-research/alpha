// spec/app/control/index.md, "Story: Control a third-party app within an owner-approved lease"; spec/app/control/index.md, "Story: Enforce formal safety guarantees over external app control"
package ai.alphacompute.control;

import android.view.KeyEvent;
import java.net.URI;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/** Pure policy checks mirroring spec/app/control/index.md and apps/agent/src/plugins/control.ts. */
public final class AlphaControlPolicy {
    /** Minimum interval between Tier-1 AccessibilityService.takeScreenshot() calls to avoid OS throttling. */
    public static final long TIER1_SCREENSHOT_MIN_INTERVAL_MS = 1_100L;

    /** Maximum operations allowed under one owner-approved lease. */
    public static final int MAX_LEASE_OPS = 12;

    /** Maximum nodes serialized per observation snapshot. */
    public static final int MAX_OBSERVED_NODES = 250;

    /** Foreground screen protection states matching spec/app/control/index.md. */
    public enum ScreenProtection {
        ScreenClear,
        ScreenLocked,
        SecureFlag,
        PrivateTab,
        SensitiveView
    }

    /** Capability tiers matching spec/app/control/index.md. */
    public enum ControlTier {
        TierNone,
        TierAccessibility,
        TierPrivileged
    }

    /** Hard-blocked packages that the agent may never observe or actuate. */
    public static final Set<String> BLOCKED_PACKAGES;

    /** Activity substring markers blocked inside packages such as Play Store and GMS. */
    public static final Map<String, List<String>> BLOCKED_ACTIVITY_SUBSTRINGS;

    /** Allowlisted keycode names mapped to Android KeyEvent constants. */
    public static final Map<String, Integer> ALLOWLISTED_KEY_CODES;

    private static final Pattern PACKAGE_PATTERN = Pattern.compile("^[a-zA-Z][a-zA-Z0-9_]*(\\.[a-zA-Z][a-zA-Z0-9_]*)+$");
    private static final Set<String> FIREFOX_PACKAGES;

    static {
        Set<String> blocked = new HashSet<>();
        blocked.add("com.android.permissioncontroller");
        blocked.add("com.google.android.permissioncontroller");
        blocked.add("com.android.packageinstaller");
        blocked.add("com.google.android.packageinstaller");
        blocked.add("com.android.systemui");
        blocked.add("com.android.settings");
        blocked.add("com.google.android.apps.walletnfcrel");
        blocked.add("proton.android.pass");
        blocked.add("com.x8bit.bitwarden");
        blocked.add("com.onepassword.android");
        blocked.add("com.agilebits.onepassword");
        blocked.add("keepass2android.keepass2android");
        blocked.add("com.google.android.apps.authenticator2");
        blocked.add("com.authy.authy");
        blocked.add("ai.alphacompute.alphaphone");
        blocked.add("ai.alphacompute.settings");
        blocked.add("ai.alphacompute.wallet");
        blocked.add("ai.alphacompute.passwords");
        BLOCKED_PACKAGES = Collections.unmodifiableSet(blocked);

        Map<String, List<String>> activities = new HashMap<>();
        activities.put("com.android.vending", List.of("PurchaseActivity", "BillingActivity", "FinskyBilling", "AuthActivity", "VerifyApps"));
        activities.put("com.google.android.gms", List.of("Auth", "Account", "Credential", "Wallet", "TapAndPay", "Fido", "Security", "Lockscreen"));
        BLOCKED_ACTIVITY_SUBSTRINGS = Collections.unmodifiableMap(activities);

        Map<String, Integer> keys = new HashMap<>();
        keys.put("ENTER", KeyEvent.KEYCODE_ENTER);
        keys.put("DEL", KeyEvent.KEYCODE_DEL);
        keys.put("TAB", KeyEvent.KEYCODE_TAB);
        keys.put("ESCAPE", KeyEvent.KEYCODE_ESCAPE);
        keys.put("SPACE", KeyEvent.KEYCODE_SPACE);
        keys.put("BACK", KeyEvent.KEYCODE_BACK);
        keys.put("SEARCH", KeyEvent.KEYCODE_SEARCH);
        keys.put("DPAD_UP", KeyEvent.KEYCODE_DPAD_UP);
        keys.put("DPAD_DOWN", KeyEvent.KEYCODE_DPAD_DOWN);
        keys.put("DPAD_LEFT", KeyEvent.KEYCODE_DPAD_LEFT);
        keys.put("DPAD_RIGHT", KeyEvent.KEYCODE_DPAD_RIGHT);
        keys.put("DPAD_CENTER", KeyEvent.KEYCODE_DPAD_CENTER);
        ALLOWLISTED_KEY_CODES = Collections.unmodifiableMap(keys);

        Set<String> firefox = new HashSet<>();
        firefox.add("org.mozilla.firefox");
        firefox.add("org.mozilla.firefox_beta");
        firefox.add("org.mozilla.fenix");
        firefox.add("org.mozilla.focus");
        FIREFOX_PACKAGES = Collections.unmodifiableSet(firefox);
    }

    private AlphaControlPolicy() {}

    /** Whether {@code packageName} is a syntactically valid Android application package name. */
    public static boolean isValidPackageName(String packageName) {
        if (packageName == null) return false;
        String trimmed = packageName.trim();
        return trimmed.length() <= 160 && PACKAGE_PATTERN.matcher(trimmed).matches();
    }

    /** Whether {@code packageName} (with optional {@code activityName}) is hard-blocked from agent actuation. */
    public static boolean isBlockedTarget(String packageName, String activityName) {
        if (packageName == null) return true;
        String pkg = packageName.trim();
        if (pkg.isEmpty() || BLOCKED_PACKAGES.contains(pkg)) return true;
        List<String> restricted = BLOCKED_ACTIVITY_SUBSTRINGS.get(pkg);
        if (restricted == null || activityName == null) return false;
        String activity = activityName.trim();
        if (activity.isEmpty()) return false;
        for (String marker : restricted) {
            if (activity.contains(marker)) return true;
        }
        return false;
    }

    /** Whether {@code rawUrl} is a valid HTTPS URL without embedded userinfo or control bytes. */
    public static boolean isValidHttpsUrl(String rawUrl) {
        if (rawUrl == null) return false;
        String trimmed = rawUrl.trim();
        if (trimmed.isEmpty() || trimmed.length() > 4_096 || trimmed.indexOf('\0') >= 0) return false;
        try {
            URI uri = URI.create(trimmed);
            return "https".equalsIgnoreCase(uri.getScheme())
                && uri.getHost() != null
                && !uri.getHost().isEmpty()
                && uri.getUserInfo() == null;
        } catch (IllegalArgumentException invalid) {
            return false;
        }
    }

    /** Resolve an allowlisted keycode name to its Android KeyEvent integer code, or -1 if refused. */
    public static int resolveAllowlistedKeyCode(String name) {
        if (name == null) return -1;
        Integer code = ALLOWLISTED_KEY_CODES.get(name.trim().toUpperCase(Locale.ROOT));
        return code == null ? -1 : code;
    }

    /** Whether {@code packageName} is a GeckoView-based Firefox browser. */
    public static boolean isFirefoxPackage(String packageName) {
        return packageName != null && FIREFOX_PACKAGES.contains(packageName.trim());
    }

    /** Detect private browsing windows in Firefox or similar browsers. */
    public static boolean isPrivateBrowserWindow(String packageName, String windowTitle, boolean flagSecure) {
        if (!isFirefoxPackage(packageName)) return false;
        if (flagSecure) return true;
        if (windowTitle == null) return false;
        String lower = windowTitle.toLowerCase(Locale.ROOT);
        return lower.contains("private browsing") || lower.contains("private tab");
    }

    /** Classify overall foreground screen protection in strict priority order. */
    public static ScreenProtection classifyScreenProtection(
        boolean keyguardLocked,
        boolean deviceLocked,
        boolean userUnlocked,
        boolean flagSecure,
        boolean privateTab,
        boolean sensitiveFocused
    ) {
        if (keyguardLocked || deviceLocked || !userUnlocked) return ScreenProtection.ScreenLocked;
        if (privateTab) return ScreenProtection.PrivateTab;
        if (flagSecure) return ScreenProtection.SecureFlag;
        if (sensitiveFocused) return ScreenProtection.SensitiveView;
        return ScreenProtection.ScreenClear;
    }

    /** Whether a screen capture is permitted at {@code nowElapsedMs} given the last capture timestamp and tier. */
    public static boolean isScreenshotAllowed(long lastShotElapsedMs, long nowElapsedMs, boolean privileged) {
        if (privileged) return true;
        if (lastShotElapsedMs <= 0L) return true;
        return nowElapsedMs - lastShotElapsedMs >= TIER1_SCREENSHOT_MIN_INTERVAL_MS;
    }

    /** Whether {@code opType} requires a live foreground snapshot match prior to dispatch. */
    public static boolean requiresSnapshot(String opType) {
        return opType != null
            && !"app_launch_package".equals(opType)
            && !"app_open_url".equals(opType)
            && !"app_functions_discover".equals(opType);
    }
}
