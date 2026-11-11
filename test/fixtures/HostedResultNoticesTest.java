package ai.alphacompute.alphaphone;
import org.json.*;
import java.util.*;
public final class HostedResultNoticesTest {
 static void require(boolean value,String message){if(!value)throw new AssertionError(message);}
 static void rejects(Runnable work,String message){try{work.run();}catch(IllegalArgumentException expected){return;}throw new AssertionError(message);}
 public static void main(String[] args)throws Exception {
  Map<String,String> slots=new HashMap<>(),titles=new HashMap<>(),active=new HashMap<>();List<String> posted=new ArrayList<>(),cancelled=new ArrayList<>();
  boolean[] delayCancel={false},stopBeforePost={false};
  HostedResultNotices.Storage storage=new HostedResultNotices.Storage(){public String read(String slot){return slots.get(slot);}public void write(String slot,String value){slots.put(slot,value);}};
  HostedResultNotices.Poster poster=new HostedResultNotices.Poster(){public boolean allowed(){return true;}public boolean active(String key,String dispatchId){return dispatchId.equals(active.get(key));}public void post(String key,String dispatchId,String title,boolean silent){if(stopBeforePost[0])throw new IllegalStateException("Synthetic interruption before Android post");titles.put(key,title);posted.add(key);active.put(key,dispatchId);}public void cancel(String key){cancelled.add(key);if(!delayCancel[0])active.remove(key);}};
  HostedResultNotices notices=new HostedResultNotices(storage,poster);
  String origin="https://agent.invalid",owner="owner",agent="agent",scope=HostedResultNotices.hash(new JSONArray().put(origin).put(owner).put(agent).toString()),slot="hosted-digests:v1:"+scope;
  JSONArray ids=new JSONArray();
  java.util.function.BiFunction<String,String,JSONObject> retain=(run,workflow)->{try{ids.put(run);slots.put(slot,new JSONObject().put("ids",ids).toString());slots.put(slot+":"+run,new JSONObject().put("runId",run).put("workflowId",workflow).put("workflowVersionId","v1").toString());return new JSONObject().put("scope",scope).put("origin",origin).put("ownerId",owner).put("agentId",agent).put("runId",run).put("workflowId",workflow).put("workflowVersionId","v1");}catch(JSONException e){throw new RuntimeException(e);}};
  String monday=HostedResultNotices.hash(scope+":run-monday"),tuesday=HostedResultNotices.hash(scope+":run-tuesday"),evening=HostedResultNotices.hash(scope+":run-evening");
  require("posted".equals(notices.publish(retain.apply("run-monday","morning-loop"))),"first brief posts");
  require("posted".equals(notices.publish(retain.apply("run-evening","evening-loop"))),"other loop posts");
  require(cancelled.isEmpty(),"a different loop never supersedes");
  require("posted".equals(notices.publish(retain.apply("run-tuesday","morning-loop"))),"next brief posts");
  require(cancelled.equals(List.of(monday))&&!active.containsKey(monday)&&active.containsKey(tuesday)&&active.containsKey(evening),"the newer brief withdraws only its loop's earlier notice");
  require(new JSONObject(slots.get(HostedResultNotices.LEDGER)).getJSONObject(monday).getString("phase").equals("superseded"),"superseded phase is durable");
  require("superseded".equals(notices.publish(retain.apply("run-monday","morning-loop")))&&posted.size()==3,"a superseded notice is never reposted");
  notices.capture(tuesday,true);require(notices.peek().getBoolean("question"),"Ask survives ledger recreation");
  notices=new HostedResultNotices(storage,poster);String question=notices.peek().getString("token");notices.releaseQuestion(question);require(notices.peek().length()==0&&active.containsKey(tuesday),"Cancel releases only Ask, preserving notice");
  notices.capture(tuesday,true);String stale=notices.peek().getString("token");notices.capture(tuesday,false);require(!notices.peek().getBoolean("question")&&!stale.equals(notices.peek().getString("token")),"ordinary tap supersedes pending question with a new token");
  try{notices.releaseQuestion(stale);throw new AssertionError("stale release accepted");}catch(IllegalStateException expected){}
  notices.capture(tuesday);String token=notices.peek().getString("token");notices.consume(token);require(!active.containsKey(tuesday)&&cancelled.contains(tuesday),"acknowledgement cancels the notice");
  notices.withdrawOtherOwners(new JSONObject().put("origin",origin).put("ownerId",owner).put("agentId",agent));require(active.containsKey(evening),"exact result owner stays visible");
  notices.capture(evening);require(notices.peek().length()>0,"owner's result tap pending");
  notices.withdrawOtherOwners(new JSONObject().put("origin","https://other.invalid").put("ownerId",owner).put("agentId",agent));require(active.isEmpty()&&notices.peek().length()==0,"owner change cancels result notices and captured taps");
  notices.capture(evening);require(notices.peek().length()==0,"stale result PendingIntent cannot disclose prior owner");
  require("owner-changed".equals(notices.publish(retain.apply("run-evening","evening-loop"))),"queued prior-owner result refuses to post");
  notices=new HostedResultNotices(storage,poster);notices.withdrawOtherOwners(new JSONObject().put("origin",origin).put("ownerId",owner).put("agentId",agent));
  require("owner-withdrawn".equals(notices.publish(retain.apply("run-evening","evening-loop")))&&posted.size()==3,"return retains result history without resurrecting its notice");
  JSONObject another=retain.apply("run-agent-collision","other-loop");require("posted".equals(notices.publish(another)),"new matching-owner result posts");
  notices.withdrawOtherOwners(new JSONObject().put("origin",origin).put("ownerId",owner).put("agentId","other-agent"));require(active.isEmpty(),"same owner and origin with a different agent is private");
  notices.withdrawOtherOwners(new JSONObject().put("origin",origin).put("ownerId",owner).put("agentId",agent));
  Map<String,String> expectedTitles=Map.of(
   "finished","Your brief is ready","missed","Your brief was missed","overlap","Your brief was skipped",
   "skipped","Your brief was skipped","unavailable","Brief source unavailable","failed","Your brief failed",
   "cancelled","Your brief was cancelled","continued","Brief update","unknown","Brief update");
  for(Map.Entry<String,String> outcome:expectedTitles.entrySet()){
   String run="run-"+outcome.getKey(),resultSlot=slot+":"+run;
   JSONObject route=retain.apply(run,"workflow-"+outcome.getKey()).put("status","finished");
   slots.put(resultSlot,new JSONObject(slots.get(resultSlot)).put("status",outcome.getKey()).toString());
   require("posted".equals(notices.publish(route)),"a retained outcome is posted");
   require(outcome.getValue().equals(titles.get(HostedResultNotices.hash(scope+":"+run))),"title follows the retained "+outcome.getKey()+" outcome");
  }
  String run="run-cancelled",tag=HostedResultNotices.hash(scope+":"+run);
  String oldDispatch=active.get(tag);
  notices.capture(tag,true);
  String captured=notices.peek().getString("token");
  JSONObject route=retain.apply(run,"workflow-cancelled");
  slots.put(slot+":"+run,new JSONObject(slots.get(slot+":"+run)).put("status","failed").toString());
  int before=posted.size();
  delayCancel[0]=true;
  stopBeforePost[0]=true;
  try{notices.publish(route);throw new AssertionError("Expected the replacement to be interrupted");}
  catch(IllegalStateException expected){require(expected.getMessage().startsWith("Synthetic interruption"),"expected post boundary");}
  stopBeforePost[0]=false;
  notices=new HostedResultNotices(storage,poster);
  require(oldDispatch.equals(active.get(tag))&&cancelled.contains(tag),"the old cancellation may still be visible while Android processes its withdrawal");
  require("uncertain".equals(notices.publish(route))&&posted.size()==before,"an older active notice cannot confirm a replacement or cause a replay");
  require(notices.peek().getBoolean("retained")&&captured.equals(notices.peek().getString("token")),"the captured same-run question retains its token");
  JSONObject legacyRoute=retain.apply("legacy-notice","legacy-workflow");
  require("posted".equals(notices.publish(legacyRoute)),"legacy test notice posts");
  String legacyTag=HostedResultNotices.hash(scope+":legacy-notice");
  JSONObject legacyLedger=new JSONObject(slots.get(HostedResultNotices.LEDGER));
  JSONObject legacyRow=legacyLedger.getJSONObject(legacyTag).put("phase","dispatching");
  legacyRow.remove("dispatchId");
  slots.put(HostedResultNotices.LEDGER,legacyLedger.toString());
  require("uncertain".equals(notices.publish(legacyRoute)),"a legacy interrupted dispatch cannot confirm an unmarked notice");
  // Renewal notice timing: within the final 24h, withdrawn at expiry, never for an expired or over-long source.
  long now=1_760_000_000_000L,hour=3600000L;
  require(HostedResultNotices.renewalDelay(now+7*24*hour,now)==6*24*hour,"7-day source notifies after 6 days");
  require(HostedResultNotices.renewalDelay(now+5*hour,now)==0,"inside the window notifies now");
  require(HostedResultNotices.renewalDelay(now-1,now)==-1,"expired source has nothing to renew in place");
  require(HostedResultNotices.renewalTimeout(now+5*hour,now)==5*hour,"notice withdraws itself at expiry");
  require(HostedResultNotices.SUPERSEDE_AFTER_MS==24*hour,"result notices time out after a day");
  rejects(()->HostedResultNotices.renewalDelay(now+9*24*hour,now),"over-long source rejected");
  rejects(()->HostedResultNotices.sourceId("../bad"),"source identity bounded");
  System.out.println("PASS hosted result notices: same-loop supersession, acknowledgement cancel, renewal window and timeouts");
 }
}
