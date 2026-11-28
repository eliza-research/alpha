// spec/app/slack/auth.md, "Story: Connect and manage my Slack workspaces with user tokens only"; spec/app/telegram/auth.md, "Story: Sign in to my Telegram user account"
package ai.alphacompute.alphaphone;

import ai.eliza.plugins.securestore.nativeonly.SecureSlotPolicy.Caller;
import ai.eliza.plugins.securestore.nativeonly.SecureSlotPolicy.ExchangeOutcome;
import ai.eliza.plugins.securestore.nativeonly.SecureSlots;
import android.content.Context;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashSet;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

final class LegacyMessagingGrants {
 private static final String LEGACY = "messaging-sessions:v1";

 private LegacyMessagingGrants() {}

 static void migrate(Context context) {
  try {
   SecureSlots slots = SecureSlots.forHost(context);
   if (!(slots.read(Caller.RendererCaller, LEGACY) instanceof SecureSlots.Present previous)) return;
   if (!(new JSONTokener(previous.value()).nextValue() instanceof String json)) return;
   JSONArray grants = new JSONArray(json);
   JSONArray slack = new JSONArray();
   JSONArray telegram = new JSONArray();
   for (int i = 0; i < grants.length(); i++) {
    JSONObject grant = grants.getJSONObject(i);
    String key = grant.getString("key");
    if (key.startsWith("slack:")) slack.put(grant);
    else if ("telegram:user".equals(key)) telegram.put(grant);
    else return;
   }
   byte[] digest = MessageDigest.getInstance("SHA-256").digest(previous.value().getBytes(StandardCharsets.UTF_8));
   String revision = Base64.encodeToString(digest, Base64.NO_WRAP);
   if (publish(slots, "messaging-sessions:slack:v2", slack, revision) && publish(slots, "messaging-sessions:telegram:v2", telegram, revision)) {
    slots.compareAndExchange(Caller.RendererCaller, LEGACY, previous.value(), null);
   }
  } catch (JSONException | NoSuchAlgorithmException | RuntimeException unavailable) {
   return;
  }
 }

 private static boolean publish(SecureSlots slots, String key, JSONArray grants, String revision) throws JSONException {
  if (grants.length() == 0) return true;
  for (;;) {
   SecureSlots.Reading reading = slots.read(Caller.RendererCaller, key);
   String before = null;
   JSONObject record;
   if (reading instanceof SecureSlots.Present present) {
    before = present.value();
    if (!(new JSONTokener(before).nextValue() instanceof String json)) return false;
    record = new JSONObject(json);
    if (revision.equals(record.optString("migratedFrom"))) return true;
    JSONArray current = record.getJSONArray("grants");
    var contained = new HashSet<String>();
    for (int i = 0; i < current.length(); i++) contained.add(current.getJSONObject(i).toString());
    for (int i = 0; i < grants.length(); i++) {
     if (!contained.contains(grants.getJSONObject(i).toString())) return false;
    }
   } else if (reading instanceof SecureSlots.Absent) {
    record = new JSONObject().put("grants", grants);
   } else return false;
   String after = JSONObject.quote(record.put("migratedFrom", revision).toString());
   ExchangeOutcome outcome = slots.compareAndExchange(Caller.RendererCaller, key, before, after);
   if (outcome != ExchangeOutcome.Conflict) return outcome == ExchangeOutcome.Written;
  }
 }
}
