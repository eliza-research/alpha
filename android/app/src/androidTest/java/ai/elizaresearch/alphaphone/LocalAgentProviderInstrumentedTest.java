package ai.elizaresearch.alphaphone;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Provider key validation, pinning and removal against the installed Keystore-backed store.
 * The Cerebras check is replaced by a synthetic checker; no key reaches the network. */
@RunWith(AndroidJUnit4.class)
public class LocalAgentProviderInstrumentedTest {
 private static final String SLOT = "local-agent-provider:v1";
 private AlphaCredentialStore store() {
  Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
  return new AlphaCredentialStore(context);
 }
 /** A device or shared emulator may hold a real provider binding; keep it byte-for-byte. */
 private String saved;
 @Before public void keep() throws Exception { saved = store().readCredentialSlot(SLOT); store().removeCredentialSlot(SLOT); }
 @After public void restore() throws Exception {
  AlphaCredentialStore store = store();
  if (saved == null) store.removeCredentialSlot(SLOT); else store.writeCredentialSlot(SLOT, saved);
 }

 @Test public void cerebrasResponsesAreInterpretedWithoutEchoingTheBody() {
  String listed = "{\"object\":\"list\",\"data\":[{\"id\":\"llama-4\"},{\"id\":\"qwen-3.8-27b\"}]}";
  assertNull(AlphaLocalAgentPlugin.providerCheckFailure(200, listed, "qwen-3.8-27b"));
  assertTrue(AlphaLocalAgentPlugin.providerCheckFailure(200, "{\"data\":[{\"id\":\"llama-4\"}]}", "qwen-3.8-27b").contains("does not offer"));
  assertTrue(AlphaLocalAgentPlugin.providerCheckFailure(401, "secret-echo", "qwen-3.8-27b").contains("did not accept"));
  assertTrue(AlphaLocalAgentPlugin.providerCheckFailure(403, "", "qwen-3.8-27b").contains("did not accept"));
  assertTrue(AlphaLocalAgentPlugin.providerCheckFailure(429, "", "qwen-3.8-27b").contains("rate-limiting"));
  assertTrue(AlphaLocalAgentPlugin.providerCheckFailure(503, "", "qwen-3.8-27b").contains("could not confirm"));
  String malformed = AlphaLocalAgentPlugin.providerCheckFailure(200, "secret-echo", "qwen-3.8-27b");
  assertTrue(malformed.contains("unexpected"));
  assertFalse(malformed.contains("secret-echo"));
 }

 @Test public void saveRequiresTheCheckAndThePinnedModel() throws Exception {
  AlphaCredentialStore store = store();
  AtomicInteger checks = new AtomicInteger();
  assertEquals("Alpha Phone uses qwen-3.8-27b on Cerebras.", AlphaLocalAgentPlugin.saveVerifiedProvider(store, "synthetic-provider-key", "llama-4", (key, model) -> { checks.incrementAndGet(); return null; }));
  assertEquals(0, checks.get());
  assertNull(store.readCredentialSlot(SLOT));
  String refused = AlphaLocalAgentPlugin.saveVerifiedProvider(store, "synthetic-provider-key", "qwen-3.8-27b", (key, model) -> { checks.incrementAndGet(); return "Cerebras did not accept this key. It was not saved."; });
  assertTrue(refused.contains("did not accept"));
  assertNull("A refused key is never stored", store.readCredentialSlot(SLOT));
  assertNull(AlphaLocalAgentPlugin.saveVerifiedProvider(store, "synthetic-provider-key", "qwen-3.8-27b", (key, model) -> { checks.incrementAndGet(); return null; }));
  assertEquals(2, checks.get());
  JSONObject status = AlphaLocalAgentPlugin.providerIdentity(store.readCredentialSlot(SLOT));
  assertTrue(status.getBoolean("configured"));
  assertEquals("cerebras", status.getString("provider"));
  assertEquals("qwen-3.8-27b", status.getString("model"));
  assertFalse("Status never carries the key", status.toString().contains("synthetic-provider-key"));
 }

 @Test public void removeDeletesTheSlotAndReadsBackUnconfigured() throws Exception {
  AlphaCredentialStore store = store();
  assertNull(AlphaLocalAgentPlugin.saveVerifiedProvider(store, "synthetic-provider-key", "qwen-3.8-27b", (key, model) -> null));
  JSONObject cleared = AlphaLocalAgentPlugin.clearProviderSlot(store,false);
  assertFalse(cleared.getBoolean("configured"));
  assertNull(store.readCredentialSlot(SLOT));
  assertFalse(AlphaLocalAgentPlugin.providerIdentity(store.readCredentialSlot(SLOT)).getBoolean("configured"));
 }

 @Test public void launchAlwaysUsesThePinnedModel() throws Exception {
  Map<String, String> env = new HashMap<>();
  // An older build could store another model name; launch still selects qwen-3.8-27b.
  AlphaLocalAgentPlugin.applyProviderEnvironment(new JSONObject().put("provider", "cerebras").put("key", "synthetic-provider-key").put("model", "older-model"), null, env, System.currentTimeMillis());
  assertEquals("qwen-3.8-27b", env.get("CEREBRAS_MODEL"));
  assertEquals("qwen-3.8-27b", env.get("CEREBRAS_SMALL_MODEL"));
  assertEquals("qwen-3.8-27b", env.get("CEREBRAS_LARGE_MODEL"));
 }
}
