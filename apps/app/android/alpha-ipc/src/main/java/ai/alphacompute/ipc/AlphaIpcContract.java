package ai.alphacompute.ipc;

import android.content.Context;
import android.content.pm.PackageManager;
import android.net.Uri;
import java.util.Set;

/** Shared IPC constants, authorities, actions, size limits, and signature verification for the Alpha NEXT app suite. */
public final class AlphaIpcContract {
    public static final String CORE_PACKAGE = "ai.alphacompute.alphaphone";
    public static final String PERMISSION_AGENT_IPC = "ai.alphacompute.permission.AGENT_IPC";

    public static final String ACTION_AGENT_BROKER = "ai.alphacompute.ipc.ACTION_AGENT_BROKER";
    public static final String ACTION_PLATFORM_BROKER = "ai.alphacompute.ipc.ACTION_PLATFORM_BROKER";
    public static final String ACTION_CONTEXT_REGISTRY = "ai.alphacompute.ipc.ACTION_CONTEXT_REGISTRY";

    public static final String ACTION_AGENT_OPEN = "ai.alphacompute.action.AGENT_OPEN";
    public static final String ACTION_STAGE_ATTACHMENT = "ai.alphacompute.action.STAGE_ATTACHMENT";
    public static final String ACTION_SETTINGS = "ai.alphacompute.action.SETTINGS";
    public static final String SCHEME_ALPHA = "alpha";

    public static final String EXTRA_CLAIM_ID = "alpha.claimId";
    public static final String EXTRA_TICKET = "alpha.ticket";
    public static final String EXTRA_NONCE = "alpha.nonce";
    public static final String EXTRA_PAYLOAD = "alpha.payload";
    public static final String EXTRA_CALLBACK = "alpha.callback";
    public static final String EXTRA_ATTACHMENT_KIND = "alpha.kind";
    public static final String EXTRA_ATTACHMENT_META = "alpha.meta";

    public static final String PREFERENCES_AUTHORITY = "ai.alphacompute.alphaphone.preferences";
    public static final String PREFERENCES_URI_STRING = "content://" + PREFERENCES_AUTHORITY;
    public static final String PREF_METHOD_GET = "get";
    public static final String PREF_METHOD_SET = "set";
    public static final String PREF_METHOD_REMOVE = "remove";
    public static final String PREF_METHOD_SNAPSHOT = "snapshot";
    public static final String PREF_ARG_VALUE = "value";
    public static final String PREF_RESULT_FOUND = "found";
    public static final String PREF_RESULT_OK = "ok";
    public static final String PREF_RESULT_SNAPSHOT = "snapshot";

    public static final String KEY_APPEARANCE = "alpha.appearance";
    public static final String KEY_PREFERENCES = "alpha.preferences";
    public static final String KEY_TEXT_SCALE = "alpha.textScale";
    public static final String KEY_INSTALL = "alpha.install";
    public static final String KEY_AI_MODE = "alpha.aiMode";
    public static final String KEY_LOCAL_MODEL = "alpha.localModel";
    public static final String KEY_LEGACY_APPEARANCE = "alpha.appearance.v1";
    public static final String KEY_LEGACY_PREFERENCES = "alpha.browser.device.v1";

    public static final Set<String> SHARED_PREFERENCE_KEYS = Set.of(
        KEY_APPEARANCE,
        KEY_PREFERENCES,
        KEY_TEXT_SCALE,
        KEY_INSTALL,
        KEY_AI_MODE,
        KEY_LOCAL_MODEL
    );

    public static final Set<String> READABLE_PREFERENCE_KEYS = Set.of(
        KEY_APPEARANCE,
        KEY_PREFERENCES,
        KEY_TEXT_SCALE,
        KEY_INSTALL,
        KEY_AI_MODE,
        KEY_LOCAL_MODEL,
        KEY_LEGACY_APPEARANCE,
        KEY_LEGACY_PREFERENCES
    );

    public static final int INLINE_BODY_LIMIT_BYTES = 65_536;
    public static final int MAX_STREAM_CHUNK_BYTES = 32_768;
    public static final int MAX_CONTEXT_SNAPSHOT_BYTES = 32_768;
    public static final int MAX_INTENT_PAYLOAD_BYTES = 32_768;
    public static final int MAX_PFD_BODY_BYTES = 16 * 1024 * 1024;
    public static final long DEFAULT_CONTEXT_LEASE_MS = 30_000L;
    public static final long MAX_CONTEXT_LEASE_MS = 300_000L;

    public static final String FAIL_ROUTE_REFUSED = "RouteRefused";
    public static final String FAIL_TOO_LARGE = "TooLarge";
    public static final String FAIL_NOT_READY = "NotReady";
    public static final String FAIL_BROKEN = "Broken";
    public static final String FAIL_UNAUTHORIZED = "Unauthorized";

    public static final String CLOUD_NOT_LISTED = "not-listed";
    public static final String CLOUD_NOT_CONFIGURED = "not-configured";
    public static final String CLOUD_INVALID_REQUEST = "invalid-request";

    public static final String SECURE_DENIED = "denied";
    public static final String SECURE_UNAVAILABLE = "unavailable";

    private AlphaIpcContract() {}

    /** Whether {@code key} is one of the writable shared cross-app preference keys. */
    public static boolean isSharedPreferenceKey(String key) {
        return key != null && SHARED_PREFERENCE_KEYS.contains(key);
    }

    /** Whether {@code key} may be read from {@code AlphaPreferencesProvider}, including legacy migration keys. */
    public static boolean isReadablePreferenceKey(String key) {
        return key != null && READABLE_PREFERENCE_KEYS.contains(key);
    }

    /** Content URI for observing or addressing a specific shared preference key. */
    public static Uri preferenceKeyUri(String key) {
        return Uri.parse(PREFERENCES_URI_STRING).buildUpon().appendPath("kv").appendPath(key).build();
    }

    /** Resolves and signature-verifies the calling package for {@code callingUid} against {@code AlphaCore}. */
    public static String verifySameSignaturePackage(Context context, int callingUid, AlphaSuitePolicy policy) {
        if (context == null || policy == null || callingUid < 0) return null;
        PackageManager packages = context.getPackageManager();
        if (packages == null) return null;
        String[] names = packages.getPackagesForUid(callingUid);
        if (names == null || names.length == 0) return null;
        for (String name : names) {
            if (!policy.isKnownPackage(name)) continue;
            if (packages.checkSignatures(CORE_PACKAGE, name) == PackageManager.SIGNATURE_MATCH) {
                return name;
            }
        }
        return null;
    }

    /** Verifies that the calling app package itself shares the signing certificate of {@code AlphaCore}. */
    public static boolean hasSameSignatureAsCore(Context context) {
        if (context == null) return false;
        String ownPackage = context.getPackageName();
        PackageManager packages = context.getPackageManager();
        if (packages == null || ownPackage == null || ownPackage.isEmpty()) return false;
        return isSignatureMatchForCore(ownPackage, CORE_PACKAGE, packages.checkSignatures(ownPackage, CORE_PACKAGE));
    }

    /** Verifies that both the current app and {@code packageName} match the signing certificate of {@code AlphaCore}. */
    public static boolean hasCoreSignature(Context context, String packageName) {
        if (context == null || packageName == null || packageName.isEmpty()) return false;
        if (!hasSameSignatureAsCore(context)) return false;
        PackageManager packages = context.getPackageManager();
        return packages != null && packages.checkSignatures(CORE_PACKAGE, packageName) == PackageManager.SIGNATURE_MATCH;
    }

    /** Evaluates a {@link PackageManager#checkSignatures} result between {@code ownPackage} and {@code corePackage}. */
    public static boolean isSignatureMatchForCore(String ownPackage, String corePackage, int signatureResult) {
        if (ownPackage == null || ownPackage.isEmpty() || corePackage == null || corePackage.isEmpty()) {
            return false;
        }
        return signatureResult == PackageManager.SIGNATURE_MATCH;
    }
}
