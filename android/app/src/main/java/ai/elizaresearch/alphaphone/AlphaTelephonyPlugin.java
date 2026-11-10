package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.contacts.ContactsCatalog;
import ai.eliza.plugins.messages.SmsTelephonyConfiguration;
import ai.eliza.plugins.messages.TelephonyPlugin;
import android.Manifest;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

/**
 * Contacts, Telecom and SMS on the Alpha AOSP image only (issues #420 and #421). The behaviour is the
 * shared {@link TelephonyPlugin}: roles and SIMs, dialer and SMS handoffs, bounded SMS/MMS provider
 * reads and reviewed native sends journaled by the shared core. Alpha supplies its installed identity
 * ({@link AlphaTelephony}) and the bounded contact search over {@link ContactsCatalog} (shared plugin-native-contacts).
 *
 * MainActivity registers this plugin only when {@link AlphaImageCapability} verifies the image, so a
 * standalone APK or a sideloaded launcher APK has no such plugin; each method checks the capability
 * again. Emergency numbers go to the system dialer like any other number.
 */
@CapacitorPlugin(name = "AlphaTelephony", permissions = {
 @Permission(alias = "contacts", strings = { Manifest.permission.READ_CONTACTS }),
 @Permission(alias = "phoneState", strings = { Manifest.permission.READ_PHONE_STATE }),
 @Permission(alias = "sms", strings = { Manifest.permission.READ_SMS }),
 @Permission(alias = "sendSms", strings = { Manifest.permission.SEND_SMS }),
 // Bounded recent calls for the image Phone view (shared TelephonyPlugin.listRecentCalls). Only the
 // launcher manifest declares READ_CALL_LOG; the standalone manifest removes it.
 @Permission(alias = "callLog", strings = { Manifest.permission.READ_CALL_LOG })
})
public class AlphaTelephonyPlugin extends TelephonyPlugin {
 @Override protected SmsTelephonyConfiguration configuration() { return AlphaTelephony.CONFIGURATION; }
 @Override protected String unavailableMessage() { return AlphaImageCapability.UNAVAILABLE; }

 /** Bounded same-profile reads, cancelled on background and checked again before publication. */
 @PluginMethod public void searchContacts(PluginCall call) {
  if (refused(call)) return;
  String query = call.getString("query", ""); Integer limit = call.getInt("limit", 25);
  if (query == null || query.length() > 128 || limit == null || limit < 1 || limit > 100) { call.reject("Invalid contact search", "invalid"); return; }
  fencedRead(call, "contacts", "Contacts", cancel -> {
   JSObject bounded = new ContactsCatalog(getContext()).list(query, limit, cancel);
   JSArray records = new JSArray(); org.json.JSONArray rows = bounded.getJSONArray("contacts");
   for (int i = 0; i < rows.length(); i++) {
    org.json.JSONObject row = rows.getJSONObject(i); JSObject item = new JSObject();
    item.put("id", row.getString("id")); item.put("lookupKey", row.getString("lookup").length() > 512 ? "" : row.getString("lookup"));
    item.put("displayName", clip(row.getString("name"))); item.put("starred", row.getBoolean("starred"));
    JSArray phones = new JSArray(), emails = new JSArray();
    for (int j = 0; j < row.getJSONArray("phones").length(); j++) phones.put(clip(row.getJSONArray("phones").getString(j)));
    for (int j = 0; j < row.getJSONArray("emails").length(); j++) emails.put(clip(row.getJSONArray("emails").getString(j)));
    item.put("phoneNumbers", phones); item.put("emailAddresses", emails); records.put(item);
   }
   JSObject value = new JSObject(); value.put("contacts", records);
   return value;
  });
 }
}
