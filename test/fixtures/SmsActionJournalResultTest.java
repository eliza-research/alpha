package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.messages.SmsSendJournal;
import org.json.*;
public final class SmsActionJournalResultTest {
 static void fails(JSONObject entry,String status,JSONObject result)throws Exception{try{SmsActionJournalResult.check(entry,status,result);}catch(Exception expected){return;}throw new AssertionError("accepted invalid evidence");}
 public static void main(String[] args)throws Exception{
  String id="approved-request",body="Exact text";String[] recipients={"+15555550100","+15555550101"};
  JSONObject op=new JSONObject().put("type","sms_send").put("recipients",new JSONArray(recipients)).put("body",body).put("subscriptionId",3);
  JSONObject entry=new JSONObject().put("proposalId",id).put("operationId",id).put("record",new JSONObject().put("operation",op));
  JSONArray parts=new JSONArray();for(int i=0;i<2;i++)parts.put(new JSONObject().put("index",i).put("recipientIndex",i).put("partIndex",0).put("sent","unknown").put("delivery","unknown"));
  JSONObject sms=new JSONObject().put("kind","sms-send").put("operationId",id).put("subscriptionId",3).put("bindingHash",SmsSendJournal.sha256(SmsSendJournal.bindingText(recipients,body,3))).put("status","submitted").put("parts",parts).put("createdAt",1);
  JSONObject result=new JSONObject().put("operationId",id).put("smsResult",sms);
  SmsActionJournalResult.check(entry,"succeeded",result);
  sms.put("status","delivered");fails(entry,"succeeded",result);
  sms.put("status","failed");parts.getJSONObject(0).put("sent","failed");SmsActionJournalResult.check(entry,"unknown",result);fails(entry,"failed",result);
  sms.put("bindingHash","0".repeat(64));fails(entry,"unknown",result);sms.put("bindingHash",SmsSendJournal.sha256(SmsSendJournal.bindingText(recipients,body,3)));
  sms.put("subscriptionId",4);fails(entry,"unknown",result);sms.put("subscriptionId",3);
  entry.put("operationId","fresh-random-id");fails(entry,"unknown",result);entry.put("operationId",id);
  SmsActionJournalResult.check(entry,"unknown",new JSONObject().put("operationId",id));fails(entry,"succeeded",new JSONObject().put("operationId",id));
  sms.put("status","denied").put("parts",new JSONArray());SmsActionJournalResult.check(entry,"failed",result);
  System.out.println("PASS exact SMS action journal");
 }
}
