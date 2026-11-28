// spec/app/assistant/composer.md
package ai.alphacompute.alphaphone;

import ai.eliza.os.agent.AgentService;
import ai.eliza.plugins.securestore.nativeonly.SecureSlotPolicy.Caller;
import ai.eliza.plugins.securestore.nativeonly.SecureSlots;
import ai.eliza.plugins.signin.DeviceCredentialStore;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

/** The renderer may name a conversation and assert its current seat. Native custody derives the key. */
@CapacitorPlugin(name = "AlphaAssistantDraft")
public final class AlphaAssistantDraftPlugin extends Plugin {
 private static final Pattern ID = Pattern.compile("[A-Za-z0-9][A-Za-z0-9_-]{0,127}");
 private static final int RAW_LIMIT = 256 * 1024;
 private final ExecutorService drafts = Executors.newSingleThreadExecutor();

 @PluginMethod public void read(PluginCall call) { drafts.execute(() -> perform(call, false)); }

 @PluginMethod public void exchange(PluginCall call) { drafts.execute(() -> perform(call, true)); }

 @Override protected void handleOnDestroy() {
  drafts.shutdown();
  super.handleOnDestroy();
 }

 private void perform(PluginCall call, boolean exchange) {
  call.resolve(execute(getContext(), call.getData(), exchange));
 }

 /** Executes a bound assistant draft read or compare-and-exchange against native custody. */
 public static JSObject execute(android.content.Context context, JSONObject data, boolean exchange) {
  try {
   var reader = new AlphaAgentCredentials(context).reader();
   if (!(reader instanceof DeviceCredentialStore store)) {
    return result("unavailable");
   }
   var session = new ResidentDigestChannel(store, store::generation).openAccount();
   long epoch = data.optLong("epoch", 0L);
   String owner = data.has("owner") && !data.isNull("owner") ? data.optString("owner", null) : null;
   String agent = data.has("agent") && !data.isNull("agent") ? data.optString("agent", null) : null;
   if (session.epoch() != epoch
     || !session.scope().ownerId().equals(owner)
     || !session.scope().agentId().equals(agent)) {
    return result("denied");
   }

   String conversation = data.has("conversation") && !data.isNull("conversation") ? data.optString("conversation", null) : null;
   String room = data.has("room") && !data.isNull("room") ? data.optString("room", null) : null;
   if (data.has("conversation") != (conversation != null)
     || data.has("room") != (room != null)
     || (conversation == null) != (room == null)
     || conversation != null && (!ID.matcher(conversation).matches() || !ID.matcher(room).matches())) {
    return result("denied");
   }
   String slot = slot(session, conversation, room);
   synchronized (AgentService.channel().policy()) {
    session.check();
    SecureSlots slots = SecureSlots.forHost(context);
    JSObject answer = exchange ? exchange(slots, slot, data) : read(slots, slot);
    session.check();
    return answer;
   }
  } catch (SecurityException denied) {
   return result("denied");
  } catch (Exception unavailable) {
   return result(exchange ? "failure" : "unavailable");
  }
 }

 private static String slot(ResidentDigestChannel.Session session, String conversation, String room) throws Exception {
  byte[] identity = new JSONArray().put(session.scope().ownerId()).put(session.organizationId())
   .put(session.scope().agentId()).put(conversation).put(room).toString().getBytes(StandardCharsets.UTF_8);
  StringBuilder key = new StringBuilder("assistant-draft:v2:");
  for (byte value : MessageDigest.getInstance("SHA-256").digest(identity)) {
   key.append(Character.forDigit((value >> 4) & 15, 16)).append(Character.forDigit(value & 15, 16));
  }
  return key.toString();
 }

 private static JSObject read(SecureSlots slots, String slot) {
  return switch (slots.read(Caller.NativeCaller, slot)) {
   case SecureSlots.Present present -> result("read").put("raw", present.value());
   case SecureSlots.Absent ignored -> result("read");
   case SecureSlots.Unreadable ignored -> result("failure");
   case SecureSlots.Refused ignored -> result("denied");
  };
 }

 private static JSObject exchange(SecureSlots slots, String slot, JSONObject data) throws Exception {
  String expected = data.has("expected") && !data.isNull("expected") ? data.optString("expected", null) : null;
  String next = data.has("next") && !data.isNull("next") ? data.optString("next", null) : null;
  if (data.has("expected") != (expected != null)
    || data.has("next") != (next != null)) return result("denied");
  if (expected != null && expected.getBytes(StandardCharsets.UTF_8).length > RAW_LIMIT) return result("denied");
  if (next != null && (next.getBytes(StandardCharsets.UTF_8).length > RAW_LIMIT || !AlphaDraftRow.admits(next))) return result("denied");
  return switch (slots.compareAndExchange(Caller.NativeCaller, slot, expected, next)) {
   case Written, Removed -> result("landed");
   case Conflict -> result("conflict");
   case Refused -> result("denied");
   case CapacityRefused, Failed, Unconfirmed -> result("failure");
  };
 }

 private static JSObject result(String status) { return new JSObject().put("status", status); }
}
