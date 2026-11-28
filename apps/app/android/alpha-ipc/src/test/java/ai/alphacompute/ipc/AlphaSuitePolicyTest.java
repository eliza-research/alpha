package ai.alphacompute.ipc;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.content.pm.PackageManager;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.Test;

/** Unit tests for least-privilege package authorization in {@link AlphaSuitePolicy}. */
public final class AlphaSuitePolicyTest {
    @Test public void defaultsContainCoreAndAllEighteenViews() {
        AlphaSuitePolicy policy = AlphaSuitePolicy.defaults();
        assertEquals(19, policy.allRules().size());
        assertTrue(policy.isKnownPackage(AlphaIpcContract.CORE_PACKAGE));
        assertNotNull(policy.ruleForView("Notes"));
        assertNotNull(policy.ruleForView("Browser"));
        assertNotNull(policy.ruleForView("Wallet"));
        assertNotNull(policy.ruleForView("Settings"));
    }

    @Test public void enforcesLeastPrivilegeAgentRoutes() {
        AlphaSuitePolicy policy = AlphaSuitePolicy.defaults();
        assertTrue(policy.isAgentRouteAllowed(AlphaIpcContract.CORE_PACKAGE, "/api/wallet/requests"));
        assertTrue(policy.isAgentRouteAllowed("ai.alphacompute.notes", "/api/notes/state"));
        assertTrue(policy.isAgentRouteAllowed("ai.alphacompute.notes", "/api/alpha/notes/transcription?format=wav"));
        assertFalse(policy.isAgentRouteAllowed("ai.alphacompute.notes", "/api/wallet"));
        assertFalse(policy.isAgentRouteAllowed("ai.alphacompute.notes", "/api/conversations"));
        assertTrue(policy.isAgentRouteAllowed("ai.alphacompute.wallet", "/api/wallet"));
        assertTrue(policy.isAgentRouteAllowed("ai.alphacompute.wallet", "/api/wallet/holdings"));
        assertTrue(policy.isAgentRouteAllowed("ai.alphacompute.wallet", "/api/client-devices/alpha"));
        assertFalse(policy.isAgentRouteAllowed("ai.alphacompute.wallet", "/api/wallet-other"));
        assertTrue(policy.isAgentRouteAllowed("ai.alphacompute.calendar", "/api/lifeops/calendar"));
        assertTrue(policy.isAgentRouteAllowed("ai.alphacompute.calendar", "/api/lifeops/calendar/events"));
        assertTrue(policy.isAgentRouteAllowed("ai.alphacompute.calendar", "/api/auth/me"));
        assertTrue(policy.isAgentRouteAllowed("ai.alphacompute.calendar", "/api/approvals"));
        assertTrue(policy.isAgentRouteAllowed("ai.alphacompute.calendar", "/api/notes/list"));
        assertTrue(policy.isAgentRouteAllowed("ai.alphacompute.browser", "/api/auth/me"));
        assertTrue(policy.isAgentRouteAllowed("ai.alphacompute.notes", "/api/auth/me"));
        assertTrue(policy.isAgentRouteAllowed("ai.alphacompute.files", "/api/notes/state"));
        assertTrue(policy.isAgentRouteAllowed("ai.alphacompute.clock", "/api/client-devices/alpha"));
        assertTrue(policy.isAgentRouteAllowed("ai.alphacompute.reminders", "/api/client-devices/alpha"));
        assertTrue(policy.isAgentRouteAllowed("ai.alphacompute.workflows", "/api/lifeops/calendar"));
        assertTrue(policy.isAgentRouteAllowed("ai.alphacompute.workflows", "/api/alpha/reminders"));
        assertTrue(policy.isAgentRouteAllowed("ai.alphacompute.workflows", "/api/notes/state"));
        assertTrue(policy.isAgentRouteAllowed("ai.alphacompute.workflows", "/api/auth/me"));
        assertTrue(policy.isAgentRouteAllowed("ai.alphacompute.settings", "/api/conversations"));
        assertTrue(policy.isAgentRouteAllowed("ai.alphacompute.settings", "/api/agents"));
        assertTrue(policy.isAgentRouteAllowed("ai.alphacompute.settings", "/api/turns/123"));
        assertTrue(policy.isAgentRouteAllowed("ai.alphacompute.settings", "/api/lifeops/calendar"));
        assertTrue(policy.isAgentRouteAllowed("ai.alphacompute.settings", "/api/alpha/local-llm/status"));
        assertTrue(policy.isAgentRouteAllowed("ai.alphacompute.settings", "/api/alpha/local-llm/catalog"));
        assertTrue(policy.isAgentRouteAllowed(AlphaIpcContract.CORE_PACKAGE, "/api/alpha/local-llm/download"));
        assertFalse(policy.isAgentRouteAllowed("ai.alphacompute.notes", "/api/alpha/local-llm/status"));
        assertFalse(policy.isAgentRouteAllowed("com.example.untrusted", "/api/health"));
    }

    @Test public void rejectsPathTraversalAndUnsafeCharacters() {
        AlphaSuitePolicy policy = AlphaSuitePolicy.defaults();
        assertNull(AlphaSuitePolicy.normalizePath("/api/notes/../wallet"));
        assertNull(AlphaSuitePolicy.normalizePath("/api/notes/%2e%2e/wallet"));
        assertNull(AlphaSuitePolicy.normalizePath("/api//notes/state"));
        assertNull(AlphaSuitePolicy.normalizePath("api/notes/state"));
        assertNull(AlphaSuitePolicy.normalizePath("/api/notes/state\u0000"));
        assertNull(AlphaSuitePolicy.normalizePath("/api/notes/state?q=ok\r\nX-Injected: 1"));
        assertNull(AlphaSuitePolicy.normalizePath("/api/notes/state?q=\u0000"));
        assertNull(AlphaSuitePolicy.normalizePath("/api/notes/state#frag\u007f"));
        assertFalse(policy.isAgentRouteAllowed("ai.alphacompute.notes", "/api/notes/../wallet"));
        assertFalse(policy.isAgentRouteAllowed("ai.alphacompute.notes", "/api/notes/%2e%2e/wallet"));
        assertFalse(policy.isAgentRouteAllowed("ai.alphacompute.notes", "/api/notes/state?q=ok\r\nInjected: 1"));
        assertFalse(policy.isCloudRouteAllowed("ai.alphacompute.maps", "/api/v1/maps/routes?q=ok\n"));
    }

    @Test public void signatureMatchHelperEnforcesNonEmptyAndMatchResult() {
        assertTrue(AlphaIpcContract.isSignatureMatchForCore(
            "ai.alphacompute.notes",
            AlphaIpcContract.CORE_PACKAGE,
            PackageManager.SIGNATURE_MATCH
        ));
        assertFalse(AlphaIpcContract.isSignatureMatchForCore(
            "ai.alphacompute.notes",
            AlphaIpcContract.CORE_PACKAGE,
            PackageManager.SIGNATURE_NO_MATCH
        ));
        assertFalse(AlphaIpcContract.isSignatureMatchForCore(
            "",
            AlphaIpcContract.CORE_PACKAGE,
            PackageManager.SIGNATURE_MATCH
        ));
        assertFalse(AlphaIpcContract.isSignatureMatchForCore(
            null,
            AlphaIpcContract.CORE_PACKAGE,
            PackageManager.SIGNATURE_MATCH
        ));
    }

    @Test public void enforcesCloudRoutesAndSecureStoreSlots() {
        AlphaSuitePolicy policy = AlphaSuitePolicy.defaults();
        assertTrue(policy.isCloudRouteAllowed("ai.alphacompute.maps", "/api/v1/maps/routes"));
        assertTrue(policy.isCloudRouteAllowed("ai.alphacompute.maps", "/api/v1/user"));
        assertFalse(policy.isCloudRouteAllowed("ai.alphacompute.maps", "/api/v1/eliza/google/gmail/read"));
        assertTrue(policy.isCloudRouteAllowed("ai.alphacompute.inbox", "/api/v1/user"));
        assertTrue(policy.isCloudRouteAllowed("ai.alphacompute.inbox", "/api/v1/eliza/google/gmail/search?q=test"));
        assertTrue(policy.isCloudRouteAllowed("ai.alphacompute.calendar", "/api/v1/user"));
        assertFalse(policy.isCloudRouteAllowed("ai.alphacompute.notes", "/api/v1/user"));

        assertTrue(policy.isSecureStoreSlotAllowed("ai.alphacompute.slack", "messaging-sessions:slack:v2"));
        assertTrue(policy.isSecureStoreSlotAllowed("ai.alphacompute.telegram", "messaging-sessions:telegram:v2"));
        assertFalse(policy.isSecureStoreSlotAllowed("ai.alphacompute.slack", "messaging-sessions:telegram:v2"));
        assertFalse(policy.isSecureStoreSlotAllowed("ai.alphacompute.telegram", "messaging-sessions:slack:v2"));
        assertFalse(policy.isSecureStoreSlotAllowed("ai.alphacompute.slack", "messaging-sessions:v1"));
        assertFalse(policy.isSecureStoreSlotAllowed("ai.alphacompute.wallet", "messaging-sessions:slack:v2"));
        assertTrue(policy.isSecureStoreSlotAllowed("ai.alphacompute.notes", "notes-draft:42"));
        assertFalse(policy.isSecureStoreSlotAllowed("ai.alphacompute.notes", "notes-draft:"));
        assertFalse(policy.isSecureStoreSlotAllowed("ai.alphacompute.notes", "inbox-saved-bodies"));
        assertTrue(policy.isSecureStoreSlotAllowed("ai.alphacompute.messages", "sms-draft:v2:new"));
        assertTrue(policy.isSecureStoreSlotAllowed("ai.alphacompute.messages", "sms-outgoing:v2:device"));
        assertFalse(policy.isSecureStoreSlotAllowed("ai.alphacompute.browser", "sms-draft:v2:new"));
    }

    @Test public void enforcesPrivilegeCapabilitiesAndPreferences() {
        AlphaSuitePolicy policy = AlphaSuitePolicy.defaults();
        assertTrue(policy.isLifecycleCommandAllowed(AlphaIpcContract.CORE_PACKAGE));
        assertTrue(policy.isLifecycleCommandAllowed("ai.alphacompute.settings"));
        assertFalse(policy.isLifecycleCommandAllowed("ai.alphacompute.notes"));

        assertTrue(policy.isActiveContextReadAllowed(AlphaIpcContract.CORE_PACKAGE));
        assertFalse(policy.isActiveContextReadAllowed("ai.alphacompute.settings"));
        assertFalse(policy.isActiveContextReadAllowed("ai.alphacompute.notes"));

        assertTrue(policy.isSignInMethodAllowed("ai.alphacompute.notes", "status"));
        assertFalse(policy.isSignInMethodAllowed("ai.alphacompute.notes", "signOut"));
        assertTrue(policy.isSignInMethodAllowed("ai.alphacompute.inbox", "upgradeMailLease"));
        assertFalse(policy.isSignInMethodAllowed("ai.alphacompute.maps", "upgradeMailLease"));
        for (String method : new String[] {
            "startEmail", "startPhone", "verify", "resend", "sendFactorCode", "cancel",
            "signOut", "reauthenticate", "startGoogle", "upgradeMailLease", "cancelMailLeaseUpgrade"
        }) {
            assertTrue(policy.isSignInMethodAllowed("ai.alphacompute.settings", method));
        }

        assertTrue(policy.isSharedPreferenceWriteAllowed("ai.alphacompute.settings", AlphaIpcContract.KEY_APPEARANCE));
        assertTrue(policy.isSharedPreferenceWriteAllowed("ai.alphacompute.settings", AlphaIpcContract.KEY_AI_MODE));
        assertTrue(policy.isSharedPreferenceWriteAllowed("ai.alphacompute.settings", AlphaIpcContract.KEY_LOCAL_MODEL));
        assertTrue(AlphaIpcContract.isReadablePreferenceKey(AlphaIpcContract.KEY_AI_MODE));
        assertTrue(AlphaIpcContract.isReadablePreferenceKey(AlphaIpcContract.KEY_LOCAL_MODEL));
        assertFalse(policy.isSharedPreferenceWriteAllowed("ai.alphacompute.settings", AlphaIpcContract.KEY_INSTALL));
        assertTrue(policy.isSharedPreferenceWriteAllowed(AlphaIpcContract.CORE_PACKAGE, AlphaIpcContract.KEY_INSTALL));
        assertFalse(policy.isSharedPreferenceWriteAllowed("ai.alphacompute.notes", AlphaIpcContract.KEY_APPEARANCE));
        assertFalse(policy.isSharedPreferenceWriteAllowed("ai.alphacompute.notes", AlphaIpcContract.KEY_AI_MODE));
    }

    @Test public void parsesSuiteRegistryJsonMatchingDefaults() throws Exception {
        Path registry = Path.of("../suite/apps.json");
        if (!Files.exists(registry)) return;
        AlphaSuitePolicy parsed = AlphaSuitePolicy.fromJson(new String(Files.readAllBytes(registry), StandardCharsets.UTF_8));
        assertEquals(AlphaSuitePolicy.defaults().allRules(), parsed.allRules());
    }
}
