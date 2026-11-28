package ai.alphacompute.ipc;

import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Least-privilege IPC authorization policy mapping each Alpha suite package to its allowed routes, slots, and capabilities. */
public final class AlphaSuitePolicy {
    private static final Set<String> READ_ONLY_SIGN_IN_METHODS = Set.of("status", "serviceInfo");
    private static final Set<String> MAIL_LEASE_SIGN_IN_METHODS = Set.of("upgradeMailLease", "cancelMailLeaseUpgrade");
    private static final Set<String> PRIV_PREFERENCE_WRITERS = Set.of(AlphaIpcContract.CORE_PACKAGE, "ai.alphacompute.settings");
    private static final Set<String> MAIL_LEASE_PACKAGES = Set.of(
        AlphaIpcContract.CORE_PACKAGE,
        "ai.alphacompute.settings",
        "ai.alphacompute.inbox",
        "ai.alphacompute.calendar"
    );

    /** Per-package authorization rule parsed from the suite registry. */
    public record AppRule(
        String id,
        String view,
        String surface,
        String applicationId,
        Set<String> agentRoutePrefixes,
        Set<String> cloudRoutePrefixes,
        Set<String> secureStoreSlots,
        boolean imageOnly
    ) {
        public AppRule {
            Objects.requireNonNull(id, "id");
            Objects.requireNonNull(surface, "surface");
            Objects.requireNonNull(applicationId, "applicationId");
            agentRoutePrefixes = Collections.unmodifiableSet(new HashSet<>(agentRoutePrefixes));
            cloudRoutePrefixes = Collections.unmodifiableSet(new HashSet<>(cloudRoutePrefixes));
            secureStoreSlots = Collections.unmodifiableSet(new HashSet<>(secureStoreSlots));
        }
    }

    private static final AlphaSuitePolicy DEFAULTS = buildDefaults();

    private final Map<String, AppRule> byPackage;
    private final Map<String, AppRule> byView;
    private final Map<String, AppRule> byId;

    private AlphaSuitePolicy(Map<String, AppRule> rulesByPackage) {
        Map<String, AppRule> pkgMap = new HashMap<>(rulesByPackage);
        Map<String, AppRule> viewMap = new HashMap<>();
        Map<String, AppRule> idMap = new HashMap<>();
        for (AppRule rule : pkgMap.values()) {
            idMap.put(rule.id(), rule);
            if (rule.view() != null && !rule.view().isEmpty()) {
                viewMap.put(rule.view(), rule);
            }
        }
        this.byPackage = Collections.unmodifiableMap(pkgMap);
        this.byView = Collections.unmodifiableMap(viewMap);
        this.byId = Collections.unmodifiableMap(idMap);
    }

    /** Built-in authoritative policy matching {@code apps/app/android/suite/apps.json}. */
    public static AlphaSuitePolicy defaults() {
        return DEFAULTS;
    }

    /** Parses a suite registry JSON document into an immutable policy table. */
    public static AlphaSuitePolicy fromJson(String json) {
        if (json == null || json.isBlank()) throw new IllegalArgumentException("Suite policy JSON is empty");
        try {
            JSONObject root = new JSONObject(json);
            if (root.optInt("schemaVersion", -1) != 1) {
                throw new IllegalArgumentException("Unsupported suite policy schemaVersion");
            }
            JSONArray apps = root.getJSONArray("apps");
            Map<String, AppRule> rules = new HashMap<>();
            for (int index = 0; index < apps.length(); index++) {
                JSONObject item = apps.getJSONObject(index);
                String id = requireNonEmpty(item, "id");
                String applicationId = requireNonEmpty(item, "applicationId");
                String surface = requireNonEmpty(item, "surface");
                String view = item.isNull("view") ? null : item.optString("view", null);
                Set<String> agentPrefixes = stringSet(item.optJSONArray("allowedAgentRoutePrefixes"));
                Set<String> cloudPrefixes = stringSet(item.optJSONArray("allowedCloudRoutePrefixes"));
                Set<String> slots = stringSet(item.optJSONArray("allowedSecureStoreSlots"));
                boolean imageOnly = item.optBoolean("imageOnly", false);
                if (rules.containsKey(applicationId)) {
                    throw new IllegalArgumentException("Duplicate applicationId: " + applicationId);
                }
                rules.put(applicationId, new AppRule(id, view, surface, applicationId, agentPrefixes, cloudPrefixes, slots, imageOnly));
            }
            if (!rules.containsKey(AlphaIpcContract.CORE_PACKAGE)) {
                throw new IllegalArgumentException("Suite policy must include " + AlphaIpcContract.CORE_PACKAGE);
            }
            return new AlphaSuitePolicy(rules);
        } catch (JSONException malformed) {
            throw new IllegalArgumentException("Malformed suite policy JSON", malformed);
        }
    }

    public boolean isKnownPackage(String packageName) {
        return packageName != null && byPackage.containsKey(packageName);
    }

    public AppRule ruleForPackage(String packageName) {
        return packageName == null ? null : byPackage.get(packageName);
    }

    public AppRule ruleForView(String view) {
        return view == null ? null : byView.get(view);
    }

    public AppRule ruleForId(String id) {
        return id == null ? null : byId.get(id);
    }

    public Map<String, AppRule> allRules() {
        return byPackage;
    }

    /** Whether {@code packageName} may invoke the resident agent route {@code rawPath}. */
    public boolean isAgentRouteAllowed(String packageName, String rawPath) {
        AppRule rule = ruleForPackage(packageName);
        String normalized = normalizePath(rawPath);
        return rule != null && normalized != null && matchesPrefix(normalized, rule.agentRoutePrefixes());
    }

    /** Whether {@code packageName} may invoke the Alpha Cloud route {@code rawPath}. */
    public boolean isCloudRouteAllowed(String packageName, String rawPath) {
        AppRule rule = ruleForPackage(packageName);
        String normalized = normalizePath(rawPath);
        return rule != null && normalized != null && matchesPrefix(normalized, rule.cloudRoutePrefixes());
    }

    /** Whether {@code packageName} may access {@code slot} in {@code ElizaSecureStore}. */
    public boolean isSecureStoreSlotAllowed(String packageName, String slot) {
        AppRule rule = ruleForPackage(packageName);
        if (rule == null || slot == null || slot.isEmpty() || slot.length() > 256 || hasUnsafeChars(slot)) {
            return false;
        }
        for (String pattern : rule.secureStoreSlots()) {
            if ("*".equals(pattern)) return true;
            if (pattern.endsWith("*")) {
                String prefix = pattern.substring(0, pattern.length() - 1);
                if (slot.startsWith(prefix) && slot.length() > prefix.length()) return true;
            } else if (pattern.equals(slot)) {
                return true;
            }
        }
        return false;
    }

    /** Whether {@code packageName} may execute agent lifecycle commands (start, stop, restart, recovery). */
    public boolean isLifecycleCommandAllowed(String packageName) {
        return packageName != null && PRIV_PREFERENCE_WRITERS.contains(packageName);
    }

    /** Whether {@code packageName} may update the agent's Google consent preferences. */
    public boolean isGoogleConsentAllowed(String packageName) {
        return packageName != null && PRIV_PREFERENCE_WRITERS.contains(packageName);
    }

    /** Whether {@code packageName} may read the currently active foreground app context snapshot. */
    public boolean isActiveContextReadAllowed(String packageName) {
        return AlphaIpcContract.CORE_PACKAGE.equals(packageName);
    }

    /** Whether {@code packageName} may invoke the named {@code ElizaSignIn} broker method. */
    public boolean isSignInMethodAllowed(String packageName, String method) {
        if (!isKnownPackage(packageName) || method == null || method.isEmpty()) return false;
        if (PRIV_PREFERENCE_WRITERS.contains(packageName)) return true;
        if (READ_ONLY_SIGN_IN_METHODS.contains(method)) return true;
        return MAIL_LEASE_SIGN_IN_METHODS.contains(method) && MAIL_LEASE_PACKAGES.contains(packageName);
    }

    /** Whether {@code packageName} may write or remove {@code key} in {@code AlphaPreferencesProvider}. */
    public boolean isSharedPreferenceWriteAllowed(String packageName, String key) {
        if (!isKnownPackage(packageName) || !AlphaIpcContract.isSharedPreferenceKey(key)) return false;
        if (AlphaIpcContract.KEY_INSTALL.equals(key)) return AlphaIpcContract.CORE_PACKAGE.equals(packageName);
        return PRIV_PREFERENCE_WRITERS.contains(packageName);
    }

    /** Validates and strips query/fragment from a request path, rejecting traversal or control characters anywhere in {@code rawPath}. */
    public static String normalizePath(String rawPath) {
        if (rawPath == null || rawPath.isEmpty() || rawPath.length() > 2048 || hasUnsafeChars(rawPath)) return null;
        int cut = rawPath.length();
        int query = rawPath.indexOf('?');
        if (query >= 0 && query < cut) cut = query;
        int hash = rawPath.indexOf('#');
        if (hash >= 0 && hash < cut) cut = hash;
        String path = rawPath.substring(0, cut);
        if (!path.startsWith("/") || path.contains("\\") || path.contains("//")) {
            return null;
        }
        String lower = path.toLowerCase(Locale.ROOT);
        if (lower.contains("%2e") || lower.contains("%2f") || lower.contains("%5c")) {
            return null;
        }
        for (String segment : path.split("/")) {
            if (".".equals(segment) || "..".equals(segment)) return null;
        }
        return path;
    }

    private static boolean matchesPrefix(String normalizedPath, Set<String> prefixes) {
        for (String prefix : prefixes) {
            if ("*".equals(prefix)) return true;
            if (prefix.endsWith("/")) {
                if (normalizedPath.startsWith(prefix)) return true;
            } else if (normalizedPath.equals(prefix) || normalizedPath.startsWith(prefix + "/")) {
                return true;
            }
        }
        return false;
    }

    private static boolean hasUnsafeChars(String value) {
        for (int index = 0; index < value.length(); index++) {
            char ch = value.charAt(index);
            if (ch < 0x20 || ch == 0x7f) return true;
        }
        return false;
    }

    private static String requireNonEmpty(JSONObject obj, String key) throws JSONException {
        String value = obj.getString(key);
        if (value == null || value.isBlank()) throw new IllegalArgumentException("Missing required field: " + key);
        return value;
    }

    private static Set<String> stringSet(JSONArray array) throws JSONException {
        if (array == null) return Set.of();
        Set<String> result = new HashSet<>();
        for (int index = 0; index < array.length(); index++) {
            result.add(array.getString(index));
        }
        return result;
    }

    private static AlphaSuitePolicy buildDefaults() {
        Map<String, AppRule> rules = new HashMap<>();
        put(rules, "core", null, "overlay", AlphaIpcContract.CORE_PACKAGE,
            Set.of("*"), Set.of("*"), Set.of("*"), false);
        put(rules, "phone", "Phone", "app", "ai.alphacompute.phone",
            Set.of("/api/health", "/api/status", "/api/views/", "/api/client-devices/"), Set.of(), Set.of(), true);
        put(rules, "messages", "Messages", "app", "ai.alphacompute.messages",
            Set.of("/api/health", "/api/status", "/api/messages/reply-draft", "/api/views/", "/api/client-devices/"),
            Set.of(), Set.of("sms-draft:v2:*", "sms-outgoing:v2:device"), true);
        put(rules, "contacts", "Contacts", "app", "ai.alphacompute.contacts",
            Set.of("/api/health", "/api/status", "/api/views/", "/api/client-devices/"), Set.of(), Set.of(), true);
        put(rules, "browser", "Browser", "app", "ai.alphacompute.browser",
            Set.of("/api/health", "/api/status", "/api/auth/me", "/api/views/", "/api/client-devices/"), Set.of(), Set.of(), false);
        put(rules, "inbox", "Inbox", "app", "ai.alphacompute.inbox",
            Set.of("/api/health", "/api/status", "/api/views/", "/api/client-devices/"),
            Set.of("/api/v1/user", "/api/v1/eliza/google/status", "/api/v1/eliza/google/accounts", "/api/v1/eliza/google/connect/initiate", "/api/v1/eliza/google/disconnect", "/api/v1/eliza/google/gmail/"),
            Set.of("inbox-saved-bodies"), false);
        put(rules, "telegram", "Telegram", "app", "ai.alphacompute.telegram",
            Set.of("/api/health", "/api/status", "/api/messages/reply-draft", "/api/views/", "/api/client-devices/"), Set.of(), Set.of("messaging-sessions:telegram:v2"), false);
        put(rules, "slack", "Slack", "app", "ai.alphacompute.slack",
            Set.of("/api/health", "/api/status", "/api/messages/reply-draft", "/api/views/", "/api/client-devices/"), Set.of(), Set.of("messaging-sessions:slack:v2"), false);
        put(rules, "calendar", "Calendar", "app", "ai.alphacompute.calendar",
            Set.of("/api/health", "/api/status", "/api/auth/me", "/api/lifeops/calendar", "/api/approvals", "/api/notes/", "/api/views/", "/api/client-devices/"),
            Set.of("/api/v1/user", "/api/v1/eliza/google/status", "/api/v1/eliza/google/accounts", "/api/v1/eliza/google/calendar/"), Set.of(), false);
        put(rules, "clock", "Clock", "app", "ai.alphacompute.clock",
            Set.of("/api/health", "/api/status", "/api/alpha/clock", "/api/views/", "/api/client-devices/"), Set.of(), Set.of(), false);
        put(rules, "reminders", "Reminders", "app", "ai.alphacompute.reminders",
            Set.of("/api/health", "/api/status", "/api/alpha/reminders", "/api/scheduled-tasks", "/api/views/", "/api/client-devices/"), Set.of(), Set.of(), false);
        put(rules, "camera", "Camera", "app", "ai.alphacompute.camera",
            Set.of("/api/health", "/api/status", "/api/views/", "/api/client-devices/"), Set.of(), Set.of(), false);
        put(rules, "photos", "Photos", "app", "ai.alphacompute.photos",
            Set.of("/api/health", "/api/status", "/api/views/", "/api/client-devices/"), Set.of(), Set.of(), false);
        put(rules, "maps", "Maps", "app", "ai.alphacompute.maps",
            Set.of("/api/health", "/api/status", "/api/views/", "/api/client-devices/"),
            Set.of("/api/v1/user", "/api/v1/maps/"), Set.of(), false);
        put(rules, "notes", "Notes", "app", "ai.alphacompute.notes",
            Set.of("/api/health", "/api/status", "/api/auth/me", "/api/notes/", "/api/alpha/notes/", "/api/views/", "/api/client-devices/"),
            Set.of(), Set.of("notes-draft:*", "notes-folders:*"), false);
        put(rules, "files", "Files", "app", "ai.alphacompute.files",
            Set.of("/api/health", "/api/status", "/api/notes/", "/api/views/", "/api/client-devices/"), Set.of(), Set.of(), false);
        put(rules, "workflows", "Workflows", "app", "ai.alphacompute.workflows",
            Set.of("/api/health", "/api/status", "/api/auth/me", "/api/workflow/", "/api/triggers", "/api/scheduled-tasks", "/api/notifications", "/api/approvals", "/api/notes/", "/api/lifeops/calendar", "/api/alpha/reminders", "/api/views/", "/api/client-devices/"),
            Set.of(), Set.of(), false);
        put(rules, "wallet", "Wallet", "app", "ai.alphacompute.wallet",
            Set.of("/api/health", "/api/status", "/api/wallet", "/api/approvals", "/api/views/", "/api/client-devices/"), Set.of(), Set.of(), false);
        put(rules, "settings", "Settings", "app", "ai.alphacompute.settings",
            Set.of("/api/health", "/api/status", "/api/auth/me", "/api/approvals", "/api/notifications", "/api/conversations", "/api/agents", "/api/turns/", "/api/lifeops/calendar", "/api/alpha/local-llm", "/api/views/", "/api/client-devices/"),
            Set.of("/api/v1/user", "/api/v1/referrals", "/api/v1/subscriptions/", "/api/v1/subscription/", "/api/v1/billing/", "/api/v1/eliza/google/"),
            Set.of(), false);
        return new AlphaSuitePolicy(rules);
    }

    private static void put(
        Map<String, AppRule> map,
        String id,
        String view,
        String surface,
        String applicationId,
        Set<String> agent,
        Set<String> cloud,
        Set<String> slots,
        boolean imageOnly
    ) {
        map.put(applicationId, new AppRule(id, view, surface, applicationId, agent, cloud, slots, imageOnly));
    }
}
