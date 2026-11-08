package ai.elizaresearch.alphaphone;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/** Debug source-set only. The limits scripts/dev-agent.mjs enforces, applied on the phone before a
 * request is queued, and the proposal checks applied to its reply. Capacitor-free for host tests. */
final class DevelopmentChatContract {
 static final int MAX_TEXT = 12000;
 static final int MAX_BODY = 32768;
 // The host answers only when the model or ASR turn ends: 45 s for /chat, 120 s for /transcribe.
 // Waiting slightly longer lets the host's own timeout reply be the one that ends the turn.
 static final int CHAT_READ_TIMEOUT_MS = 50000;
 static final int TRANSCRIBE_READ_TIMEOUT_MS = 125000;
 static final long MAX_PROPOSAL_TTL_MS = 300000;
 static final long UNKNOWN_CLOCK_SKEW_MS = 60000;
 // Mirrors DEVELOPMENT_PROPOSAL_VIEWS; parity is checked by the owning development scope flow.
 static final List<String> VIEWS = Arrays.asList("home","maps","camera","photos","notes","calendar","notifications","reminders","workflows","files","inbox","browser","settings");

 private DevelopmentChatContract() {}

 /** Encoded /chat body, or null when the host would refuse it for size. */
 static byte[] chatBody(JSONObject body) {
  if (body.optString("text", "").length() > MAX_TEXT) return null;
  byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
  return bytes.length > MAX_BODY ? null : bytes;
 }

 /** The proposals that pass, each re-stamped to expire on the phone clock. hostNow is the reply's
  * Date header (0 when absent). One invalid proposal is dropped; the reply text still shows. */
 static JSONArray proposals(JSONArray input, JSONObject requestContext, long hostNow, long phoneNow) throws Exception {
  JSONArray output = new JSONArray();
  if (input == null) return output;
  if (input.length() > 4 || requestContext == null) throw new IllegalArgumentException("invalid proposals");
  long revision = requestContext.getLong("revision");
  HashSet<String> ids = new HashSet<>();
  for (int i = 0; i < input.length(); i++) {
   JSONObject safe = proposal(input.optJSONObject(i), revision, hostNow, phoneNow, ids);
   if (safe != null) output.put(safe);
  }
  return output;
 }

 private static JSONObject proposal(JSONObject value, long contextRevision, long hostNow, long phoneNow, HashSet<String> ids) {
  try {
   JSONObject operation = value.getJSONObject("operation");
   String id = value.getString("id"), title = value.getString("title"), description = value.getString("description");
   long expiry = value.getLong("expiresAt"), revision = value.getLong("contextRevision");
   // expiresAt is on the host clock. The Date header (whole seconds, rounded down) gives the
   // host's now; without it allow a minute of skew between host and phone.
   long ttl = expiry - (hostNow > 0 ? hostNow : phoneNow), skew = hostNow > 0 ? 0 : UNKNOWN_CLOCK_SKEW_MS;
   if (!id.matches("[A-Za-z0-9_-]{1,100}") || !ids.add(id) || title.trim().isEmpty() || title.length() > 300 || description.length() > 64000
       || ttl <= -skew || ttl > MAX_PROPOSAL_TTL_MS + skew || revision != contextRevision) return null;
   JSONObject safeOperation = new JSONObject();
   String type = operation.getString("type");
   if ("create_note".equals(type)) {
    String noteTitle = operation.getString("title"), noteBody = operation.getString("body");
    if (noteTitle.trim().isEmpty() || noteTitle.length() > 256 || noteBody.length() > 32000) return null;
    safeOperation.put("type", type).put("title", noteTitle).put("body", noteBody);
   } else if ("reminder_create".equals(type)) {
    // Exact canonical fields are validated again by the shared renderer contract.
    operation.getJSONObject("fields").getJSONObject("schedule");
    safeOperation = operation;
   } else if ("open_view".equals(type)) {
    String view = operation.getString("view");
    if (!VIEWS.contains(view)) return null;
    safeOperation.put("type", type).put("view", view);
   } else return null;
   long expiresAt = phoneNow + Math.max(1000, Math.min(ttl, MAX_PROPOSAL_TTL_MS));
   JSONObject safe = new JSONObject().put("id",id).put("title",title).put("description",description).put("expiresAt",expiresAt).put("contextRevision",revision).put("operation",safeOperation);
   if (value.has("simulated")) safe.put("simulated",value.getBoolean("simulated"));
   if ("open_view".equals(type) && value.has("navigation")) safe.put("navigation",value.getJSONObject("navigation"));
   return safe;
  } catch (Exception invalid) { return null; }
 }
}
