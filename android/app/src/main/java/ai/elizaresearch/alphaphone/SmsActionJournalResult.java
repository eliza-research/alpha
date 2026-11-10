package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.messages.SmsSendJournal;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.Set;

/** Durable action result policy: exact proposal key, payload hash, SIM and per-part evidence. */
final class SmsActionJournalResult {
 static void check(JSONObject entry,String status,JSONObject result)throws Exception {
  JSONObject operation=entry.getJSONObject("record").getJSONObject("operation");
  String id=entry.getString("operationId");
  if(!id.equals(entry.getString("proposalId"))||operation.length()!=4||!"sms_send".equals(operation.getString("type")))throw new IllegalArgumentException();
  JSONArray rawRecipients=operation.getJSONArray("recipients");String[] recipients=new String[rawRecipients.length()];
  for(int i=0;i<recipients.length;i++)recipients[i]=rawRecipients.getString(i);
  Object sub=operation.get("subscriptionId");if(!(sub instanceof Integer))throw new IllegalArgumentException();
  int subscription=(Integer)sub;String body=operation.getString("body");SmsSendJournal.validate(id,recipients,body,subscription);
  if(result==null){if(!"unknown".equals(status))throw new IllegalArgumentException();return;}
  if(!id.equals(result.optString("operationId"))||result.length()!=(result.has("smsResult")?2:1))throw new IllegalArgumentException();
  JSONObject sms=result.optJSONObject("smsResult");if(sms==null){if(!"unknown".equals(status))throw new IllegalArgumentException();return;}
  if(sms.length()!=7||!"sms-send".equals(sms.getString("kind"))||!id.equals(sms.getString("operationId"))||!(sms.get("subscriptionId") instanceof Integer)||subscription!=sms.getInt("subscriptionId")||!SmsSendJournal.sha256(SmsSendJournal.bindingText(recipients,body,subscription)).equals(sms.getString("bindingHash"))||sms.getLong("createdAt")<=0)throw new IllegalArgumentException();
  Object created=sms.get("createdAt");if(!(created instanceof Number)||((Number)created).doubleValue()!=Math.rint(((Number)created).doubleValue())||((Number)created).doubleValue()>9007199254740991d)throw new IllegalArgumentException();
  String outcome=sms.getString("status");if(!Set.of("submitted","sent","delivered","failed","unknown","cancelled","denied").contains(outcome))throw new IllegalArgumentException();
  String expected=Set.of("submitted","sent","delivered").contains(outcome)?"succeeded":Set.of("cancelled","denied").contains(outcome)?"failed":"unknown";
  if(!expected.equals(status))throw new IllegalArgumentException();
  JSONArray parts=sms.getJSONArray("parts");if(parts.length()>50)throw new IllegalArgumentException();int[] counts=new int[recipients.length];int previous=0;
  for(int i=0;i<parts.length();i++){
   JSONObject p=parts.getJSONObject(i);if(p.length()!=5||!(p.get("index") instanceof Integer)||p.getInt("index")!=i||!(p.get("recipientIndex") instanceof Integer)||!(p.get("partIndex") instanceof Integer))throw new IllegalArgumentException();
   int recipient=p.getInt("recipientIndex"),part=p.getInt("partIndex");String sent=p.getString("sent"),delivery=p.getString("delivery");
   if(recipient<previous||recipient>previous+1||recipient>=counts.length||(i==0&&recipient!=0)||part!=counts[recipient]||counts[recipient]>=10||!Set.of("unknown","success","failed").contains(sent)||!Set.of("unknown","success","failed").contains(delivery)||("success".equals(delivery)&&!"success".equals(sent)))throw new IllegalArgumentException();
   counts[recipient]++;previous=recipient;
   if(Set.of("sent","delivered").contains(outcome)&&!"success".equals(sent)||"delivered".equals(outcome)&&!"success".equals(delivery))throw new IllegalArgumentException();
  }
  if(Set.of("cancelled","denied").contains(outcome)&&parts.length()!=0)throw new IllegalArgumentException();
  if(Set.of("submitted","sent","delivered").contains(outcome))for(int count:counts)if(count==0)throw new IllegalArgumentException();
 }
}
