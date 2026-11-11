package ai.alphacompute.alphaphone;
import org.json.*;
import java.util.*;
public final class HostedNoticeWithdrawTest {
 static void require(boolean value,String message){if(!value)throw new AssertionError(message);}
 public static void main(String[] args)throws Exception {
  Map<String,String> slots=new HashMap<>();List<String> cancelled=new ArrayList<>();Map<String,Boolean> posted=new HashMap<>();Set<String> active=new HashSet<>();
  HostedResultNotices.Storage storage=new HostedResultNotices.Storage(){public String read(String slot){return slots.get(slot);}public void write(String slot,String value){slots.put(slot,value);}};
  HostedResultNotices.Poster poster=new HostedResultNotices.Poster(){public boolean allowed(){return true;}public boolean active(String key,String dispatchId){return active.contains(key);}public void post(String key,String dispatchId,String title,boolean silent){posted.put(key,silent);active.add(key);}public void cancel(String key){cancelled.add(key);active.remove(key);}};
  HostedResultNotices notices=new HostedResultNotices(storage,poster);
  String origin="https://agent.invalid",owner="owner",agent="agent",scope=HostedResultNotices.hash(new JSONArray().put(origin).put(owner).put(agent).toString()),slot="hosted-digests:v1:"+scope;
  JSONArray ids=new JSONArray();
  java.util.function.BiFunction<String,String,JSONObject> retain=(run,workflow)->{try{ids.put(run);slots.put(slot,new JSONObject().put("ids",ids).toString());slots.put(slot+":"+run,new JSONObject().put("runId",run).put("workflowId",workflow).put("workflowVersionId","v1").toString());return new JSONObject().put("scope",scope).put("origin",origin).put("ownerId",owner).put("agentId",agent).put("runId",run).put("workflowId",workflow).put("workflowVersionId","v1");}catch(JSONException e){throw new RuntimeException(e);}};
  String morning=HostedResultNotices.hash(scope+":run-morning"),evening=HostedResultNotices.hash(scope+":run-evening"),night=HostedResultNotices.hash(scope+":run-night");
  String other=HostedResultNotices.hash(new JSONArray().put(origin).put(owner).put("other-agent").toString());

  // Panel closed: alerts. Panel open for another scope: still alerts. Panel open for this scope: silent.
  require("posted".equals(notices.publish(retain.apply("run-morning","morning-loop")))&&!posted.get(morning),"closed panel alerts");
  notices.showing(other);require("posted".equals(notices.publish(retain.apply("run-evening","evening-loop")))&&!posted.get(evening),"another account's open panel does not silence");
  notices.showing(scope);require("posted".equals(notices.publish(retain.apply("run-night","night-loop")))&&posted.get(night),"open panel for this scope posts silently");
  notices.showing(null);

  // A tap on the morning notice is captured, then the panel shows every run.
  notices.capture(morning);String token=notices.peek().getString("token");
  require(notices.withdraw(scope,List.of("run-morning","run-evening","run-unknown"))==2,"shown runs withdraw");
  require(cancelled.containsAll(List.of(morning,evening))&&!active.contains(morning)&&!active.contains(evening)&&active.contains(night),"withdraw cancels by key only the shown runs");
  JSONObject ledger=new JSONObject(slots.get(HostedResultNotices.LEDGER));
  require("opened".equals(ledger.getJSONObject(morning).getString("phase"))&&"opened".equals(ledger.getJSONObject(evening).getString("phase")),"ledger marks the runs seen");
  require(token.equals(notices.peek().getString("token")),"a pending tap survives withdrawal");
  notices.consume(token);require(notices.peek().length()==0,"the pending tap is still consumable");
  require("opened".equals(notices.publish(retain.apply("run-evening","evening-loop")))&&posted.size()==3,"a withdrawn notice is never reposted");
  require(notices.withdraw(scope,List.of("run-evening"))==0,"a repeat withdrawal does nothing");

  // Another account's scope cannot withdraw this one's notice.
  require(notices.withdraw(other,List.of("run-night"))==0&&active.contains(night),"withdraw is bound to the scope");
  try{notices.withdraw("not-a-scope",List.of("run-night"));throw new AssertionError("invalid scope accepted");}catch(IllegalArgumentException expected){}
  try{notices.withdraw(scope,List.of("../run"));throw new AssertionError("invalid run accepted");}catch(IllegalArgumentException expected){}
  try{notices.showing("../scope");throw new AssertionError("invalid showing scope accepted");}catch(IllegalArgumentException expected){}
  System.out.println("PASS hosted notice withdraw: shown runs withdraw by key, pending taps survive, open panel posts silently");
 }
}
