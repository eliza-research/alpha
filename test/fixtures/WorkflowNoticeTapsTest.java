package ai.alphacompute.alphaphone;
import org.json.*;
import java.util.*;
public final class WorkflowNoticeTapsTest {
 static void check(boolean value){if(!value)throw new AssertionError();}
 static void rejects(Throwing action)throws Exception{try{action.run();throw new AssertionError("Expected refusal");}catch(IllegalStateException|IllegalArgumentException expected){}}
 interface Throwing{void run()throws Exception;}
 static class Store implements WorkflowNoticeDelivery.Storage {Map<String,String> values=new HashMap<>();boolean fail;public String read(String key){return values.get(key);}public void write(String key,String value){if(fail)throw new IllegalStateException("disk");values.put(key,value);}}
 static JSONObject route(String run)throws Exception{return new JSONObject().put("scope","a".repeat(64)).put("origin","https://agent.invalid").put("ownerId","owner").put("agentId","agent").put("workflowId","workflow").put("runId",run).put("versionId","v1");}
 static void receipt(Store s,String id,String status)throws Exception{JSONObject ledger=new JSONObject(s.values.getOrDefault(WorkflowNoticeDelivery.SLOT,"{}"));ledger.put(id,new JSONObject().put("binding","b".repeat(64)).put("digest","c".repeat(64)).put("status",status));s.values.put(WorkflowNoticeDelivery.SLOT,ledger.toString());}
 public static void main(String[] ignored)throws Exception{
  Store s=new Store();WorkflowNoticeTaps taps=new WorkflowNoticeTaps(s);String first=taps.prepare("op1","b".repeat(64),route("run1")),second=taps.prepare("op2","b".repeat(64),route("run2"));check(!first.equals(second));check(taps.prepare("op1","b".repeat(64),route("run1")).equals(first));
  rejects(()->taps.prepare("op1","b".repeat(64),route("changed")));
  receipt(s,"op1","unknown");rejects(()->taps.capture(first));check(taps.pending().length()==0);
  receipt(s,"op1","succeeded");s.fail=true;rejects(()->taps.capture(first));s.fail=false;check(taps.pending().length()==0);
  taps.capture(first);receipt(s,"op2","succeeded");taps.capture(second);WorkflowNoticeTaps current=new WorkflowNoticeTaps(s);check(current.pending().getString("runId").equals("run2"));check(current.pending().getBoolean("retained"));
  receipt(s,"op2","unknown");check(!current.pending().getBoolean("retained"));rejects(()->current.consume(second));receipt(s,"op2","succeeded");
  s.fail=true;rejects(()->current.consume(second));s.fail=false;check(current.pending().getString("token").equals(second));current.consume(second);current.capture(second);check(current.pending().getString("runId").equals("run1"));current.consume(first);check(current.pending().length()==0);
  // Old ledgers need no migration; Ask is a durable purpose on the same exact owner route.
  Store questionStore=new Store();WorkflowNoticeTaps questionTaps=new WorkflowNoticeTaps(questionStore);
  String questionToken=questionTaps.prepare("question","b".repeat(64),route("question-run"));receipt(questionStore,"question","succeeded");
  questionTaps.capture(questionToken,true);check(new WorkflowNoticeTaps(questionStore).pending().getBoolean("question"));
  check(questionTaps.pending().getString("runId").equals("question-run"));
  questionTaps.capture(questionToken);check(!questionTaps.pending().has("question"));
  questionTaps.capture(questionToken,true);questionTaps.consume(questionToken);questionTaps.capture(questionToken,true);check(questionTaps.pending().length()==0);
  // A reposted notice rotates its route; a stale Ask purpose never survives into the fresh route.
  questionTaps.fresh("question");String rotated=questionTaps.token("question");check(!rotated.equals(questionToken));check(!new JSONObject(questionStore.values.get(WorkflowNoticeTaps.SLOT)).getJSONObject("question").has("question"));
  questionTaps.capture(rotated,true);questionTaps.fresh("question");String reposted=questionTaps.token("question");check(questionTaps.pending().length()==0);
  questionTaps.capture(reposted,false);check(!questionTaps.pending().has("question"));check(questionTaps.pending().getString("token").equals(reposted));
  rejects(()->questionTaps.settleQuestion(reposted,true));questionTaps.consume(reposted);
  // Explicit Cancel returns an Ask tap to untapped; a gone notice keeps it as a plain open tap.
  questionTaps.fresh("question");String canceled=questionTaps.token("question");questionTaps.capture(canceled,true);questionTaps.settleQuestion(canceled,true);check(questionTaps.pending().length()==0);
  rejects(()->questionTaps.settleQuestion(canceled,true));questionTaps.capture(canceled,true);questionTaps.settleQuestion(canceled,false);check(questionTaps.pending().getString("token").equals(canceled));check(!questionTaps.pending().has("question"));
  questionTaps.consume(canceled);check(questionTaps.pending().length()==0);
  // Approval Ask retains only its existing owner route, never changes the approval receipt.
  Store approvals=new Store();WorkflowNoticeTaps approvalTaps=new WorkflowNoticeTaps(approvals);
  String approvalId="approval-"+"d".repeat(64),approvalToken=approvalTaps.prepare(approvalId,"b".repeat(64),route("approval-run"));
  JSONObject approvedReceipt=new JSONObject().put("binding","b".repeat(64)).put("digest","c".repeat(64)).put("status","succeeded").put("expiresAt",System.currentTimeMillis()+600000);
  approvals.values.put(WorkflowNoticeDelivery.APPROVAL_SLOT,new JSONObject().put(approvalId,approvedReceipt).toString());
  String unchanged=approvals.values.get(WorkflowNoticeDelivery.APPROVAL_SLOT);
  approvalTaps.capture(approvalToken,true);check(new WorkflowNoticeTaps(approvals).pending().getBoolean("question"));check(approvalTaps.pending().getBoolean("retained"));
  check(unchanged.equals(approvals.values.get(WorkflowNoticeDelivery.APPROVAL_SLOT)));
  approvalTaps.owner(new JSONObject().put("origin","https://agent.invalid").put("ownerId","other").put("agentId","agent"));
  check(approvalTaps.pending().length()==0);rejects(()->approvalTaps.capture(approvalToken,true));rejects(()->approvalTaps.consume(approvalToken));
  approvalTaps.owner(new JSONObject().put("origin","https://agent.invalid").put("ownerId","owner").put("agentId","agent"));
  approvedReceipt.put("expiresAt",System.currentTimeMillis()-1);approvals.values.put(WorkflowNoticeDelivery.APPROVAL_SLOT,new JSONObject().put(approvalId,approvedReceipt).toString());
  check(!approvalTaps.pending().getBoolean("retained"));rejects(()->approvalTaps.capture(approvalToken,true));rejects(()->approvalTaps.consume(approvalToken));
  approvedReceipt.put("expiresAt",System.currentTimeMillis()+600000).put("status","withdrawn");approvals.values.put(WorkflowNoticeDelivery.APPROVAL_SLOT,new JSONObject().put(approvalId,approvedReceipt).toString());
  check(!approvalTaps.pending().getBoolean("retained"));rejects(()->approvalTaps.capture(approvalToken,true));
  approvedReceipt.put("status","succeeded");approvals.values.put(WorkflowNoticeDelivery.APPROVAL_SLOT,new JSONObject().put(approvalId,approvedReceipt).toString());
  approvedReceipt.put("expiresAt",System.currentTimeMillis()-1);approvals.values.put(WorkflowNoticeDelivery.APPROVAL_SLOT,new JSONObject().put(approvalId,approvedReceipt).toString());
  rejects(()->approvalTaps.releaseApprovalQuestion(approvalToken));
  approvedReceipt.put("expiresAt",System.currentTimeMillis()+600000);approvals.values.put(WorkflowNoticeDelivery.APPROVAL_SLOT,new JSONObject().put(approvalId,approvedReceipt).toString());
  // A completed Ask keeps the approval route untapped and reusable; the receipt is untouched.
  approvalTaps.releaseApprovalQuestion(approvalToken);check(approvalTaps.pending().length()==0);rejects(()->approvalTaps.releaseApprovalQuestion(approvalToken));
  approvalTaps.capture(approvalToken,false);check(approvalTaps.pending().getString("token").equals(approvalToken));check(!approvalTaps.pending().has("question"));rejects(()->approvalTaps.releaseApprovalQuestion(approvalToken));
  approvalTaps.consume(approvalToken);approvalTaps.fresh(approvalId);String askToken=approvalTaps.token(approvalId);approvalTaps.capture(askToken,true);
  approvalTaps.settleQuestion(askToken,true);check(approvalTaps.pending().length()==0);approvalTaps.capture(askToken,true);approvalTaps.consume(askToken);approvalTaps.capture(askToken,true);check(approvalTaps.pending().length()==0);
  check(new JSONObject().put(approvalId,approvedReceipt).toString().equals(approvals.values.get(WorkflowNoticeDelivery.APPROVAL_SLOT)));
  // Seed prior durable rows once; exercise both sides of the capacity boundary
  // through production prepare without quadratically revalidating setup rows.
  JSONObject full=new JSONObject(s.values.get(WorkflowNoticeTaps.SLOT));
  for(int i=2;i<511;i++)full.put("op"+(i+1),new JSONObject().put("binding","b".repeat(64)).put("route",route("run"+(i+1))).put("token",UUID.randomUUID().toString()).put("state","new").put("order",0));
  s.values.put(WorkflowNoticeTaps.SLOT,full.toString());
  check(new JSONObject(s.values.get(WorkflowNoticeTaps.SLOT)).length()==511);
  current.prepare("op512","b".repeat(64),route("run512"));
  check(new JSONObject(s.values.get(WorkflowNoticeTaps.SLOT)).length()==512);
  rejects(()->current.prepare("full","b".repeat(64),route("full")));check(current.token("op1").equals(first));
  System.out.println("PASS workflow tap durable queue, canonical receipts, failed writes, recreation, no replay and bounded retention");
 }
}
