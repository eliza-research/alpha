package ai.elizaresearch.alphaphone;
import org.json.*;
public final class ResidentDeliveryTest {
 static void require(boolean value){if(!value)throw new AssertionError();}
 interface Task{void run()throws Exception;}
 static void retries(Task task)throws Exception {try{task.run();}catch(java.io.IOException expected){return;}throw new AssertionError("expected a retryable failure");}
 static void rejects(Class<? extends Exception> type,String pattern,Task task)throws Exception{try{task.run();}catch(Exception thrown){if(type.isInstance(thrown)&&thrown.getMessage()!=null&&java.util.regex.Pattern.compile(pattern).matcher(thrown.getMessage()).find())return;throw new AssertionError("Expected "+type.getSimpleName()+" /"+pattern+"/ but got "+thrown,thrown);}throw new AssertionError("Expected "+type.getSimpleName()+" /"+pattern+"/");}
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
  delivery.polling(false);require(!delivery.status().getBoolean("backgroundEnabled"));rejects(HostedDeliveryCancelled.class,"cancelled",()->delivery.syncBackground(generation));
  require(delivery.sync(generation).length()==1);
  delivery.polling(true);require(HostedDeliveryWorker.resident&&HostedDeliveryWorker.scheduled==2);
  delivery.disableSession("other-session");require(delivery.status().getBoolean("backgroundEnabled"));
  delivery.disableSession("ui-session");require(!delivery.status().getBoolean("backgroundEnabled"));require(delivery.store.read("resident-results:v1:credential")==null);rejects(HostedDeliveryCancelled.class,"cancelled",()->delivery.sync(generation));
  delivery.begin(attempt);JSONObject next=delivery.configure(request);String nextGeneration=next.getString("generation");ResidentResultTransportTest.Channel resident=ElizaAgentService.channel;
  // A restart of the same resident is adopted and keeps the scheduled generation.
  ElizaAgentService.root="restarted";delivery.syncBackground(nextGeneration);require(delivery.status().getString("backgroundStatus").equals("current")&&delivery.status().getBoolean("backgroundEnabled"));
  require(new JSONObject(delivery.store.read("resident-results:v1:credential")).getString("runtimeDigest").equals(HostedResultNotices.hash("restarted")));
  ElizaAgentService.root=null;retries(()->delivery.syncBackground(nextGeneration));require(delivery.status().getString("backgroundStatus").equals("retry")&&delivery.status().getBoolean("backgroundEnabled"));
  ElizaAgentService.root="starting";resident.agentStatus="starting";retries(()->delivery.syncBackground(nextGeneration));require(delivery.status().getString("backgroundStatus").equals("retry")&&delivery.status().getBoolean("backgroundEnabled"));
  resident.agentStatus="running";delivery.syncBackground(nextGeneration);require(delivery.status().getString("backgroundStatus").equals("current"));
  // A real replacement runs another agent: the fence still disables delivery.
  ElizaAgentService.root="replacement";resident.agent="other";rejects(SecurityException.class,"agent changed",()->delivery.sync(nextGeneration));require(delivery.status().getString("backgroundStatus").equals("reconnect-required"));
  require(!delivery.status().getBoolean("backgroundEnabled"));require(delivery.history("ui-session").length()==1);
  System.out.println("PASS resident configure, shared inbox, polling, retirement, credential cleanup, restart adoption and runtime replacement");
 }
}
