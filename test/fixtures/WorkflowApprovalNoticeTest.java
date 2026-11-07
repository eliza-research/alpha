package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.notifications.NoticeOwner;
import org.json.*;
import java.util.*;
public final class WorkflowApprovalNoticeTest {
 static void require(boolean value,String message){if(!value)throw new AssertionError(message);}
 interface Work {void run()throws Exception;}
 static void rejects(Work work,String message)throws Exception{try{work.run();}catch(Exception expected){return;}throw new AssertionError(message);}
 static class Store implements WorkflowNoticeDelivery.Storage {Map<String,String> values=new HashMap<>();public String read(String slot){return values.get(slot);}public void write(String slot,String value){values.put(slot,value);}}
 static class Poster implements WorkflowNoticeDelivery.Poster {
  int quiet=0;boolean steps=true,approvals=true;List<String> posted=new ArrayList<>(),cancelled=new ArrayList<>();Map<String,String> active=new HashMap<>();Map<String,Long> timeouts=new HashMap<>();
  public boolean allowed(){return steps;}public boolean approvalsAllowed(){return approvals;}
  public void post(String id,String title,String body){throw new AssertionError("Approval notices never use the step channel");}
  public void postApproval(String id,String title,String body,long timeout){posted.add(id);active.put(id,title+"\n"+body);timeouts.put(id,timeout);}
  public void postApprovalQuiet(String id,String title,String body,long timeout){quiet++;postApproval(id,title,body,timeout);}
  public void cancel(String id){cancelled.add(id);active.remove(id);}
  public boolean matches(String id,String title,String body){return Objects.equals(active.get(id),title+"\n"+body);}
 }
 static JSONObject route(String run)throws Exception{return new JSONObject().put("scope","a".repeat(64)).put("origin","https://agent.invalid").put("ownerId","owner").put("agentId","agent").put("workflowId","workflow").put("runId",run).put("versionId","v1");}
 static JSONObject owner(String id)throws Exception{return NoticeOwner.fromRoute(route("owner").put("ownerId",id));}
 public static void main(String[] args)throws Exception{
  long now=1_760_000_000_000L,minute=60000L;String binding="b".repeat(64),first="approval-"+"1".repeat(64),second="approval-"+"2".repeat(64);
  Store store=new Store();Poster poster=new Poster();WorkflowNoticeDelivery delivery=new WorkflowNoticeDelivery(store,poster);WorkflowNoticeTaps taps=new WorkflowNoticeTaps(store);
  // One notice per pending approval ID, timed out at the approval's expiry, never reposted.
  String token=taps.prepare(first,binding,route("run1"));
  require("succeeded".equals(delivery.publishApproval(first,binding,now+10*minute,now)),"first approval posts");
  require(poster.timeouts.get(first)==10*minute,"notice times out when the approval expires");
  require("succeeded".equals(delivery.publishApproval(first,binding,now+10*minute,now+minute))&&poster.posted.size()==1,"same approval never posts twice");
  rejects(()->delivery.publishApproval(first,"c".repeat(64),now+10*minute,now),"binding change refused");
  rejects(()->delivery.publishApproval(first,binding,now+20*minute,now),"expiry change refused");
  String raw=store.values.get(WorkflowNoticeDelivery.APPROVAL_SLOT);require(!raw.contains("run1")&&!raw.contains(WorkflowNoticeDelivery.APPROVAL_TITLE),"receipt holds no route or text");
  // A well-shaped but different persisted digest must not count as the original receipt.
  JSONObject damaged=new JSONObject(raw);damaged.getJSONObject(first).put("digest","0".repeat(64));
  store.values.put(WorkflowNoticeDelivery.APPROVAL_SLOT,damaged.toString());
  rejects(()->new WorkflowNoticeDelivery(store,poster).publishApproval(first,binding,now+10*minute,now),"changed receipt digest refused");
  require(poster.posted.size()==1,"corrupt receipt never reposts");store.values.put(WorkflowNoticeDelivery.APPROVAL_SLOT,raw);
  // Tap after process death: a fresh ledger instance still resolves the exact run.
  taps.capture(token);JSONObject pending=new WorkflowNoticeTaps(store).pending();require("run1".equals(pending.getString("runId"))&&pending.getBoolean("retained"),"tap opens that run");
  new WorkflowNoticeTaps(store).consume(token);require(new WorkflowNoticeTaps(store).pending().length()==0,"tap consumed once");
  // Decision withdraws the notice and frees its route; it is never reposted.
  delivery.withdrawApproval(first,now+minute);taps.forget(first);require(poster.cancelled.contains(first)&&!poster.active.containsKey(first),"decision cancels the notice");
  require("withdrawn".equals(delivery.publishApproval(first,binding,now+10*minute,now))&&poster.posted.size()==1,"withdrawn approval never reposts");
  require(taps.token(first)==null,"withdrawn route released");
  // The plugin's whole post prepares the route before the receipt answers; a repeated request for the
  // decided approval must not leave that route behind (found on the emulator: "Route released").
  require("withdrawn".equals(delivery.postApproval(taps,first,binding,route("run1"),now+10*minute,now))&&poster.posted.size()==1,"repeated post of a decided approval never reposts");
  require(taps.token(first)==null,"repeated post of a decided approval keeps no route");
  {Store s2=new Store();Poster p2=new Poster();WorkflowNoticeDelivery d2=new WorkflowNoticeDelivery(s2,p2);WorkflowNoticeTaps t2=new WorkflowNoticeTaps(s2);
   String fifth="approval-"+"5".repeat(64),sixth="approval-"+"6".repeat(64),seventh="approval-"+"7".repeat(64);
   require("succeeded".equals(d2.postApproval(t2,fifth,binding,route("run5"),now+10*minute,now))&&t2.token(fifth)!=null,"a live approval keeps its route");
   require("succeeded".equals(d2.postApproval(t2,fifth,binding,route("run5"),now+10*minute,now))&&p2.posted.size()==1,"whole post is at most once");
   require("expired".equals(d2.postApproval(t2,sixth,binding,route("run6"),now,now))&&t2.token(sixth)==null,"an expired approval prepares no route");
   p2.approvals=false;require("failed".equals(d2.postApproval(t2,seventh,binding,route("run7"),now+minute,now))&&t2.token(seventh)==null&&p2.posted.size()==1,"a muted channel keeps no route");}
  // A captured tap whose approval was decided elsewhere is released instead of blocking later taps.
  String secondToken=taps.prepare(second,binding,route("run2"));require("succeeded".equals(delivery.publishApproval(second,binding,now+5*minute,now)),"second approval posts");
  taps.capture(secondToken);delivery.withdrawApproval(second,now+minute);require(!new WorkflowNoticeTaps(store).pending().getBoolean("retained"),"withdrawn tap is not retained");taps.forget(second);require(taps.pending().length()==0,"stale captured tap released");
  // Expiry: nothing posts for an expired approval and expired receipts are pruned.
  String third="approval-"+"3".repeat(64);require("expired".equals(delivery.publishApproval(third,binding,now,now))&&!poster.posted.contains(third),"expired approval posts nothing");
  taps.prepare(third,binding,route("run3"));require("succeeded".equals(delivery.publishApproval(third,binding,now+minute,now)),"third posts");
  List<String> expired=delivery.expireApprovals(now+10*minute);require(expired.containsAll(List.of(first,second,third))&&expired.size()==3,"expired receipts pruned");for(String id:expired)taps.forget(id);
  require(new JSONObject(store.values.get(WorkflowNoticeDelivery.APPROVAL_SLOT)).length()==0&&taps.token(third)==null,"ledgers bounded after expiry");
  // A muted approval channel records failure without posting; step notices are unaffected.
  Poster muted=new Poster();muted.approvals=false;String fourth="approval-"+"4".repeat(64);require("failed".equals(new WorkflowNoticeDelivery(new Store(),muted).publishApproval(fourth,binding,now+minute,now))&&muted.posted.isEmpty(),"muted channel posts nothing");
  // Receipts written before the shared ledger was adopted still read. The two literals below are bytes the
  // retired in-app ledger wrote (generated from its source at dfacccb3 with this binding, this expiry and,
  // for the steps, "Exact title"/"Exact body"); nothing in them is output of the code under test. A shared
  // ledger that derived another digest or expected another record shape would refuse them as a mismatch.
  {Store old=new Store();Poster quiet=new Poster();
   String posted="approval-"+"8".repeat(64),decided="approval-"+"9".repeat(64),uncertain="approval-"+"7".repeat(64),muted6="approval-"+"6".repeat(64);
   String storedApprovals="{\"approval-6666666666666666666666666666666666666666666666666666666666666666\":{\"digest\":\"374b7f013c957e10f18b9d08e29ed707f2eb956fe1496cd77087908d98fb249c\",\"binding\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"expiresAt\":1760000300000,\"status\":\"failed\"},\"approval-8888888888888888888888888888888888888888888888888888888888888888\":{\"digest\":\"374b7f013c957e10f18b9d08e29ed707f2eb956fe1496cd77087908d98fb249c\",\"binding\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"expiresAt\":1760000300000,\"status\":\"succeeded\"},\"approval-7777777777777777777777777777777777777777777777777777777777777777\":{\"digest\":\"374b7f013c957e10f18b9d08e29ed707f2eb956fe1496cd77087908d98fb249c\",\"binding\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"expiresAt\":1760000300000,\"status\":\"unknown\"},\"approval-9999999999999999999999999999999999999999999999999999999999999999\":{\"digest\":\"374b7f013c957e10f18b9d08e29ed707f2eb956fe1496cd77087908d98fb249c\",\"binding\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"expiresAt\":1760000300000,\"status\":\"withdrawn\"}}";
   String storedSteps="{\"op-posted\":{\"digest\":\"c2bab42876959c49ccb08681278ca0b2e3a50a01f2d06bb5b736eccba554b1aa\",\"binding\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"status\":\"succeeded\"},\"op-denied\":{\"digest\":\"c2bab42876959c49ccb08681278ca0b2e3a50a01f2d06bb5b736eccba554b1aa\",\"binding\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"status\":\"failed\"},\"op-uncertain\":{\"digest\":\"c2bab42876959c49ccb08681278ca0b2e3a50a01f2d06bb5b736eccba554b1aa\",\"binding\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"status\":\"unknown\"}}";
   require(now+5*minute==1760000300000L&&binding.equals("b".repeat(64)),"stored fixtures match this test's binding and expiry");
   old.values.put("workflow-approval-notices:v1",storedApprovals);old.values.put("workflow-notice-delivery:v1",storedSteps);
   WorkflowNoticeDelivery upgraded=new WorkflowNoticeDelivery(old,quiet);
   // Approvals: every stored status answers as stored, nothing is posted and nothing is rewritten.
   require("succeeded".equals(upgraded.publishApproval(posted,binding,now+5*minute,now))&&"withdrawn".equals(upgraded.publishApproval(decided,binding,now+5*minute,now))&&"failed".equals(upgraded.publishApproval(muted6,binding,now+5*minute,now))&&"unknown".equals(upgraded.publishApproval(uncertain,binding,now+5*minute,now)),"stored approval receipts answer as stored");
   require(quiet.posted.isEmpty()&&storedApprovals.equals(old.values.get("workflow-approval-notices:v1")),"stored approval receipts read without reposting or rewriting");
   rejects(()->upgraded.publishApproval(posted,"c".repeat(64),now+5*minute,now),"stored approval receipt keeps its binding check");
   rejects(()->upgraded.publishApproval(posted,binding,now+6*minute,now),"stored approval receipt keeps its expiry check");
   {WorkflowNoticeTaps routes=new WorkflowNoticeTaps(old);String stored=routes.prepare(posted,binding,route("run8"));routes.capture(stored);require(routes.pending().getBoolean("retained"),"a stored posted approval still opens its run");routes.consume(stored);}
   quiet.active.put(uncertain,WorkflowNoticeDelivery.APPROVAL_TITLE+"\n"+WorkflowNoticeDelivery.APPROVAL_BODY);
   require("succeeded".equals(upgraded.publishApproval(uncertain,binding,now+5*minute,now))&&quiet.posted.isEmpty(),"a stored uncertain approval is confirmed from the live notice, never reposted");
   // Steps: the Poster above fails the test on any step post, so a repost cannot pass unnoticed.
   require("succeeded".equals(upgraded.publish("op-posted",binding,"Exact title","Exact body"))&&"succeeded".equals(upgraded.receipt("op-posted",binding,"Exact title","Exact body"))&&"failed".equals(upgraded.publish("op-denied",binding,"Exact title","Exact body"))&&"unknown".equals(upgraded.publish("op-uncertain",binding,"Exact title","Exact body")),"stored step receipts answer as stored");
   require(storedSteps.equals(old.values.get("workflow-notice-delivery:v1")),"stored step receipts are not rewritten");
   rejects(()->upgraded.publish("op-posted",binding,"Other title","Exact body"),"stored step receipt keeps its digest check");
   rejects(()->upgraded.publish("op-posted","c".repeat(64),"Exact title","Exact body"),"stored step receipt keeps its binding check");
   require(WorkflowNoticeDelivery.SLOT.equals("workflow-notice-delivery:v1")&&WorkflowNoticeDelivery.APPROVAL_SLOT.equals("workflow-approval-notices:v1"),"deployed slot names unchanged");
   require(upgraded.expireApprovals(now+5*minute).size()==4&&new JSONObject(old.values.get("workflow-approval-notices:v1")).length()==0,"stored approval receipts expire");}
  // Receipts the retired ledger left at "applying" (the process died between its intent and its result
  // write) are literal bytes too. The shared ledger must settle them as unknown and never post them.
  {Store cut=new Store();Poster silent=new Poster();String interrupted="approval-"+"5".repeat(64);
   cut.values.put("workflow-notice-delivery:v1","{\"op-interrupted\":{\"digest\":\"c2bab42876959c49ccb08681278ca0b2e3a50a01f2d06bb5b736eccba554b1aa\",\"binding\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"status\":\"applying\"}}");
   cut.values.put("workflow-approval-notices:v1","{\"approval-5555555555555555555555555555555555555555555555555555555555555555\":{\"digest\":\"374b7f013c957e10f18b9d08e29ed707f2eb956fe1496cd77087908d98fb249c\",\"binding\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"expiresAt\":1760000300000,\"status\":\"applying\"}}");
   WorkflowNoticeDelivery resumed=new WorkflowNoticeDelivery(cut,silent);
   require("unknown".equals(resumed.publish("op-interrupted",binding,"Exact title","Exact body"))&&"unknown".equals(resumed.publish("op-interrupted",binding,"Exact title","Exact body")),"an interrupted stored step receipt settles as unknown");
   require("unknown".equals(resumed.publishApproval(interrupted,binding,now+5*minute,now))&&"unknown".equals(resumed.publishApproval(interrupted,binding,now+5*minute,now))&&silent.posted.isEmpty(),"an interrupted stored approval receipt settles as unknown and is never posted");
   require("unknown".equals(new JSONObject(cut.values.get("workflow-notice-delivery:v1")).getJSONObject("op-interrupted").getString("status"))&&"unknown".equals(new JSONObject(cut.values.get("workflow-approval-notices:v1")).getJSONObject(interrupted).getString("status")),"the settled status is stored");}
  // A decision that reaches the phone before any publish is retained: the late publish never posts,
  // the prepared route is released, an unpublished withdrawal cannot open a tap, and expiry prunes it.
  {Store s3=new Store();Poster p3=new Poster();WorkflowNoticeDelivery d3=new WorkflowNoticeDelivery(s3,p3);WorkflowNoticeTaps t3=new WorkflowNoticeTaps(s3);String early="approval-"+"a".repeat(64);
   d3.withdrawApproval(early,now);require(p3.cancelled.contains(early),"early decision cancels");
   JSONObject kept=new JSONObject(s3.values.get(WorkflowNoticeDelivery.APPROVAL_SLOT)).getJSONObject(early);
   require(kept.length()==2&&"withdrawn".equals(kept.getString("status"))&&kept.getLong("expiresAt")==now+WorkflowNoticeDelivery.MAXIMUM_APPROVAL_MS,"early withdrawal holds only the opaque ID for the approval bound");
   require("withdrawn".equals(d3.postApproval(t3,early,binding,route("run9"),now+10*minute,now+minute))&&p3.posted.isEmpty()&&t3.token(early)==null,"late publish after an early decision posts nothing and keeps no route");
   d3.withdrawApproval(early,now+2*minute);require(new JSONObject(s3.values.get(WorkflowNoticeDelivery.APPROVAL_SLOT)).getJSONObject(early).getLong("expiresAt")==now+WorkflowNoticeDelivery.MAXIMUM_APPROVAL_MS,"repeated withdrawal keeps the first expiry");
   require(d3.expireApprovals(now+WorkflowNoticeDelivery.MAXIMUM_APPROVAL_MS).equals(List.of(early))&&"expired".equals(d3.postApproval(t3,early,binding,route("run9"),now+10*minute,now+WorkflowNoticeDelivery.MAXIMUM_APPROVAL_MS)),"early withdrawal is pruned at its bound");}
  // The plugin's whole withdrawal. A full ledger refuses to record a withdrawal for an approval it has no
  // receipt for; the route a refused post left behind is released all the same, and a posted one is kept.
  {Store s4=new Store();Poster p4=new Poster();WorkflowNoticeDelivery d4=new WorkflowNoticeDelivery(s4,p4);WorkflowNoticeTaps t4=new WorkflowNoticeTaps(s4);String live="approval-"+"c".repeat(64),refused="approval-"+"d".repeat(64);
   require("succeeded".equals(d4.postApproval(t4,live,binding,route("run4"),now+10*minute,now)),"live approval posts");
   for(int i=0;i<255;i++)d4.withdrawApproval("approval-"+String.format("%064x",i),now);
   require(new JSONObject(s4.values.get(WorkflowNoticeDelivery.APPROVAL_SLOT)).length()==256,"approval ledger at capacity");
   rejects(()->d4.postApproval(t4,refused,binding,route("run5"),now+10*minute,now),"a full ledger refuses a new approval");require(t4.token(refused)!=null&&p4.posted.size()==1,"the refused post leaves its prepared route and posts nothing");
   String before=s4.values.get(WorkflowNoticeDelivery.APPROVAL_SLOT);
   rejects(()->d4.withdrawApproval(t4,refused,now),"a full ledger cannot record the withdrawal");require(t4.token(refused)==null&&before.equals(s4.values.get(WorkflowNoticeDelivery.APPROVAL_SLOT)),"the refused withdrawal still releases the route and changes no receipt");
   d4.withdrawApproval(t4,live,now+minute);require(t4.token(live)==null&&p4.cancelled.contains(live)&&"withdrawn".equals(d4.publishApproval(live,binding,now+10*minute,now+minute)),"a recorded withdrawal cancels, releases and never reposts");
   // A receipt that could not be marked withdrawn is still posted, so its route stays openable.
   boolean[] deny={false};Store s5=new Store(){public void write(String slot,String value){if(deny[0]&&WorkflowNoticeDelivery.APPROVAL_SLOT.equals(slot))throw new IllegalStateException("Disk");super.write(slot,value);}};
   Poster p5=new Poster();WorkflowNoticeDelivery d5=new WorkflowNoticeDelivery(s5,p5);WorkflowNoticeTaps t5=new WorkflowNoticeTaps(s5);
   require("succeeded".equals(d5.postApproval(t5,live,binding,route("run4"),now+10*minute,now)),"posted before the storage fault");
   deny[0]=true;rejects(()->d5.withdrawApproval(t5,live,now+minute),"a storage fault refuses the withdrawal");
   require(t5.token(live)!=null&&p5.active.containsKey(live)&&!p5.cancelled.contains(live),"an unrecorded withdrawal keeps the posted notice and its route");
   deny[0]=false;d5.withdrawApproval(t5,live,now+minute);require(t5.token(live)==null&&p5.cancelled.contains(live)&&"withdrawn".equals(d5.publishApproval(live,binding,now+10*minute,now+minute))&&p5.posted.size()==1,"the repeated withdrawal is recorded, cancels and releases");}
  // A -> B -> A keeps encrypted metadata, fences old taps, and only an explicit revalidation can resume quietly.
  {Store s6=new Store();Poster p6=new Poster(){public void post(String id,String title,String body){posted.add(id);active.put(id,title+"\n"+body);}};
   WorkflowNoticeDelivery d6=new WorkflowNoticeDelivery(s6,p6);WorkflowNoticeTaps t6=new WorkflowNoticeTaps(s6);String id="approval-"+"1".repeat(64);JSONObject own=route("run1");
   d6.withdrawOtherOwners(t6,owner("owner"),now);require("succeeded".equals(d6.postApproval(t6,id,binding,own,now+10*minute,now)),"owner A posts");
   t6.prepare("step1",binding,own);d6.publish("step1",binding,"Private","Body");String oldTap=t6.token(id);t6.capture(oldTap);
   require(d6.withdrawOtherOwners(t6,owner("B"),now+minute)==2,"approval and result withdrawn on owner change");
   require(p6.active.isEmpty()&&t6.pending().length()==0,"no cross-owner notice or pending tap");final WorkflowNoticeTaps beforeRestart=t6;rejects(()->beforeRestart.capture(oldTap),"old tap rejected under B");
   require("owner-changed".equals(d6.postApproval(t6,id,binding,own,now+10*minute,now+minute)),"queued A post refused under B");
   require(t6.suspendedApprovals(owner("owner"),now+minute).length()==1,"suspended route survives");
   d6=new WorkflowNoticeDelivery(s6,p6);t6=new WorkflowNoticeTaps(s6);d6.withdrawOtherOwners(t6,owner("owner"),now+2*minute);
   require(p6.posted.size()==2,"return alone does not post without revalidation");
   require("succeeded".equals(d6.resumeApproval(t6,id,binding,own,now+10*minute,now+2*minute))&&p6.quiet==1,"explicit exact return posts quietly");
   String fresh=t6.token(id);require(!fresh.equals(oldTap),"fresh tap binding after restart");final WorkflowNoticeTaps current=t6;rejects(()->current.capture(oldTap),"old PendingIntent oldTap remains invalid");t6.capture(fresh);require(t6.pending().getBoolean("retained"),"fresh tap opens matching owner");
   require("not-suspended".equals(d6.resumeApproval(t6,id,binding,own,now+10*minute,now+2*minute))&&p6.quiet==1,"duplicate resume does not repost or rotate");
   d6.withdrawOtherOwners(t6,owner("B"),now+3*minute);d6.withdrawApproval(t6,id,now+3*minute);d6.withdrawOtherOwners(t6,owner("owner"),now+4*minute);
   require(t6.suspendedApprovals(owner("owner"),now+4*minute).length()==0&&"not-suspended".equals(d6.resumeApproval(t6,id,binding,own,now+10*minute,now+4*minute)),"decided while away never resumes");
   String expiredApproval="approval-"+"2".repeat(64);d6.postApproval(t6,expiredApproval,binding,route("run2"),now+5*minute,now+4*minute);d6.withdrawOtherOwners(t6,owner("B"),now+4*minute);d6.withdrawOtherOwners(t6,owner("owner"),now+6*minute);require(t6.suspendedApprovals(owner("owner"),now+6*minute).length()==0,"expiredApproval approval never resumes");
   String dismissed="approval-"+"3".repeat(64);d6.postApproval(t6,dismissed,binding,route("run3"),now+10*minute,now+6*minute);p6.active.remove(dismissed);d6.withdrawOtherOwners(t6,owner("B"),now+6*minute);require(t6.suspendedApprovals(owner("owner"),now+6*minute).length()==0,"dismissed approval remains terminal");
  }
  // A failed receipt write does not cancel that notice, but the persisted fence blocks its tap and
  // other old-owner notices are still attempted. Retry completes without touching the matching owner.
  {boolean[] failReceipt={false},failFence={false};Store fault=new Store(){public void write(String slot,String value){if(failFence[0]&&WorkflowNoticeTaps.OWNER_SLOT.equals(slot))throw new IllegalStateException("Fence disk fault");if(failReceipt[0]&&WorkflowNoticeDelivery.APPROVAL_SLOT.equals(slot)&&value.contains("suspended")){failReceipt[0]=false;throw new IllegalStateException("Receipt disk fault");}super.write(slot,value);}};
   Poster p=new Poster();WorkflowNoticeDelivery d=new WorkflowNoticeDelivery(fault,p);WorkflowNoticeTaps t=new WorkflowNoticeTaps(fault);
   String a1="approval-"+"4".repeat(64),a2="approval-"+"5".repeat(64),b="approval-"+"6".repeat(64);JSONObject ar=route("fault-a"),br=route("fault-b").put("ownerId","B");
   d.postApproval(t,a1,binding,ar,now+10*minute,now);d.postApproval(t,a2,binding,ar,now+10*minute,now);d.postApproval(t,b,binding,br,now+10*minute,now);String prior=t.token(a1),matching=t.token(b);
   failFence[0]=true;rejects(()->d.withdrawOtherOwners(t,owner("B"),now+minute),"fence write failure reported");require(p.active.size()==3,"uncommitted fence cancels no notice");failFence[0]=false;
   failReceipt[0]=true;rejects(()->d.withdrawOtherOwners(t,owner("B"),now+minute),"one receipt write failure reported");
   require(p.active.containsKey(a1)&&!p.active.containsKey(a2)&&p.active.containsKey(b),"other old-owner notice still attempted, matching owner untouched");rejects(()->t.capture(prior),"persisted fence refuses tap even if OS cancellation failed");
   d.withdrawOtherOwners(t,owner("B"),now+2*minute);require(!p.active.containsKey(a1)&&p.active.containsKey(b)&&matching.equals(t.token(b))&&p.posted.size()==3,"retry completes without repost or matching-owner token changes");
   d.withdrawOtherOwners(t,owner("B"),now+2*minute);require(p.active.containsKey(b)&&matching.equals(t.token(b))&&p.posted.size()==3,"repeated fence preserves unrelated owner's notice");
   d.withdrawOtherOwners(t,owner("owner"),now+3*minute);d.resumeApproval(t,a1,binding,ar,now+10*minute,now+3*minute);d.resumeApproval(t,a2,binding,ar,now+10*minute,now+3*minute);require(p.quiet==2,"both successfully suspended approvals resume once quietly");
   d.resumeApproval(t,a1,binding,ar,now+10*minute,now+3*minute);require(p.quiet==2,"retry never duplicates quiet posts");
  }
  // Owner IDs are not globally unique across servers or agents. All three identity fields matter.
  {Store collision=new Store();Poster p=new Poster();WorkflowNoticeDelivery d=new WorkflowNoticeDelivery(collision,p);WorkflowNoticeTaps t=new WorkflowNoticeTaps(collision);
   String aId="approval-"+"7".repeat(64),originId="approval-"+"8".repeat(64),agentId="approval-"+"9".repeat(64);JSONObject aRoute=route("a"),otherOrigin=route("b").put("origin","https://other.invalid"),otherAgent=route("c").put("agentId","other-agent");
   d.postApproval(t,aId,binding,aRoute,now+10*minute,now);d.postApproval(t,originId,binding,otherOrigin,now+10*minute,now);d.postApproval(t,agentId,binding,otherAgent,now+10*minute,now);String oldOrigin=t.token(originId),oldAgent=t.token(agentId),matching=t.token(aId);
   require(d.withdrawOtherOwners(t,NoticeOwner.fromRoute(aRoute),now+minute)==2,"same ownerId on other origin or agent is withdrawn");
   require(p.active.size()==1&&p.active.containsKey(aId)&&matching.equals(t.token(aId)),"full matching tuple remains untouched");rejects(()->t.capture(oldOrigin),"other-origin token fenced");rejects(()->t.capture(oldAgent),"other-agent token fenced");
   require("owner-changed".equals(d.postApproval(t,originId,binding,otherOrigin,now+10*minute,now+minute)),"stale colliding-origin post refused");
   collision.values.put(WorkflowNoticeTaps.OWNER_SLOT,new JSONObject().put("ownerId","owner").toString());rejects(()->t.capture(matching),"old ownerId-only fence fails closed");require("owner-changed".equals(d.postApproval(t,aId,binding,aRoute,now+10*minute,now+minute)),"old fence refuses fresh posts");
   d.withdrawOtherOwners(t,NoticeOwner.fromRoute(aRoute),now+minute);t.capture(matching);require(t.pending().getBoolean("retained"),"validated tuple replaces legacy fence");
   d.withdrawOtherOwners(t,null,now+2*minute);require(p.active.isEmpty()&&t.pending().length()==0&&t.suspendedApprovals(null,now).length()==0,"explicit sign-out hides every owner and exposes no suspended routes");
  }
  // Bounds.
  rejects(()->delivery.publishApproval("op1",binding,now+minute,now),"only approval IDs");
  rejects(()->delivery.publishApproval(fourth,binding,now+8*86400000L,now),"over-long approval refused");
  rejects(()->taps.forget("op1"),"step routes are never released here");
  require(delivery.approvalTimeout(now+minute,now)==minute&&delivery.approvalTimeout(now,now)==-1,"timeout policy");
  require(WorkflowNoticeDelivery.STEP_NOTICE_TIMEOUT_MS==24L*3600000,"step notices time out after a day");
  System.out.println("PASS workflow approval notices: one per approval ID, expiry timeout, tap after restart, withdrawal on decision (also before publish and when refused) and on an owner change, stored receipts, pruning and bounds");
 }
}
