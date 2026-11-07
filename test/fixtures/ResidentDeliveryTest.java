package ai.elizaresearch.alphaphone;
import org.json.*;
public final class ResidentDeliveryTest {
 static void require(boolean value){if(!value)throw new AssertionError();}
 interface Task{void run()throws Exception;}
 static void rejects(Task task)throws Exception {try{task.run();}catch(Exception expected){return;}throw new AssertionError("unexpected success");}
 public static void main(String[] args)throws Exception {
  android.content.Context context=new android.content.Context();HostedDelivery delivery=HostedDelivery.get(context);
  String origin="https://device.alpha.invalid",scope=HostedResultNotices.hash(new JSONArray().put(origin).put("owner").put("agent").toString());
  JSONObject device=new JSONObject().put("installationId","11111111-1111-1111-1111-111111111111").put("key","a".repeat(64)).put("enrollmentId","enrollment");delivery.store.write("device:a5a78b0a446c6c0f726b837ed0f98197dde5c367485e69860ca06e75081591d1",device.toString());
  String attempt="11111111-1111-1111-1111-111111111111";
  JSONObject request=new JSONObject().put("attemptId",attempt).put("mode","resident").put("origin",origin).put("ownerId","owner").put("agentId","agent").put("sessionId","ui-session");
  delivery.begin(attempt);JSONObject configured=delivery.configure(request);String generation=configured.getString("generation");
  require(configured.getString("scope").equals(scope));require(HostedDeliveryWorker.resident&&HostedDeliveryWorker.scheduled==1);
  require(delivery.status().getBoolean("backgroundEnabled"));
  require(delivery.syncBackground(generation).length()==1);require(ElizaAgentService.channel.acknowledged);
  require(delivery.history("ui-session").length()==1);
  delivery.polling(false);require(!delivery.status().getBoolean("backgroundEnabled"));rejects(()->delivery.syncBackground(generation));
  require(delivery.sync(generation).length()==1);
  delivery.polling(true);require(HostedDeliveryWorker.resident&&HostedDeliveryWorker.scheduled==2);
  delivery.disableSession("other-session");require(delivery.status().getBoolean("backgroundEnabled"));
  delivery.disableSession("ui-session");require(!delivery.status().getBoolean("backgroundEnabled"));require(delivery.store.read("resident-results:v1:credential")==null);rejects(()->delivery.sync(generation));
  delivery.begin(attempt);JSONObject next=delivery.configure(request);ElizaAgentService.root="replacement";rejects(()->delivery.sync(next.getString("generation")));require(delivery.status().getString("backgroundStatus").equals("reconnect-required"));
  require(!delivery.status().getBoolean("backgroundEnabled"));require(delivery.history("ui-session").length()==1);
  System.out.println("PASS resident configure, shared inbox, polling, retirement, credential cleanup and runtime replacement");
 }
}
