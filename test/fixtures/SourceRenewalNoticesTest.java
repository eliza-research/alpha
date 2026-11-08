package ai.elizaresearch.alphaphone;
import org.json.*;
final class SourceRenewalNoticesTest {
 static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
 interface Run{void run()throws Exception;}
 static void rejected(String pattern,Run run)throws Exception{try{run.run();}catch(SecurityException expected){if(expected.getMessage()!=null&&java.util.regex.Pattern.compile(pattern).matcher(expected.getMessage()).find())return;throw new AssertionError("Expected /"+pattern+"/ but got "+expected,expected);}throw new AssertionError("Expected rejection /"+pattern+"/");}
 static final class Fixture implements SourceRenewalNotices.Store,SourceRenewalNotices.Guard,SourceRenewalNotices.Poster{
  String stored;boolean revoked,failWrite,offline,paused,failPost;int posted,cancelled;String revision="r1",owner="owner";long expiry=200000;
  public String read(){return stored;}public void write(String value)throws Exception{if(failWrite)throw new IllegalStateException("disk unavailable");stored=value;}
  public JSONObject describe(JSONObject selection)throws Exception{if(offline)throw new java.io.IOException("resident starting");if(paused)throw new SecurityException("Native source connection unavailable");if(!owner.equals(selection.optString("ownerId"))||!"enrollment".equals(selection.optString("enrollmentId")))throw new SourceRenewalNotices.RenewalStale("Native source binding changed");return new JSONObject().put("revision",revision).put("expiresAt",java.time.Instant.ofEpochMilli(expiry).toString()).put("revoked",revoked);}
  public void post(String key,long expiry,long now){if(failPost)throw new IllegalStateException("notifications disabled");posted++;}public void cancel(String key){cancelled++;}
  SourceRenewalNotices core(){return new SourceRenewalNotices(this,this,this);}
  JSONObject selection(){return new JSONObject().put("provider","native").put("ownerId",owner).put("agentId","agent").put("installationId","install").put("enrollmentId","enrollment").put("sourceId","source").put("revision",revision);}
 }
 public static void main(String[]args)throws Exception{
  Fixture f=new Fixture();SourceRenewalNotices n=f.core();String key=n.arm(f.selection(),f.expiry,1000);check(!key.contains("source")&&key.length()==64,"opaque route");
  n.capture(key,true,1000);check(!n.pending(1000).has("token"),"cannot tap before post");n.post(key,1000);f.core().post(key,1001);check(f.posted==1,"durable no replay");
  n.capture(key,true,1001);JSONObject tap=f.core().pending(1002);check(tap.getBoolean("question")&&tap.getJSONObject("selection").getString("revision").equals("r1"),"durable binding");
  f.offline=true;try{n.pending(1002);throw new AssertionError();}catch(java.io.IOException expected){}f.offline=false;check(n.pending(1002).getString("token").equals(tap.getString("token")),"transient transport preserves pending route");rejected("Renewal tap changed",()->n.settle("wrong",true,1002));n.settle(tap.getString("token"),true,1002);check(!n.pending(1002).has("token"),"cancel clears pending only");n.capture(key,true,1003);check(n.pending(1003).has("token"),"cancel preserves Ask route");
  n.settle(n.pending(1003).getString("token"),false,1003);n.capture(key,false,1004);check(!n.pending(1004).getBoolean("question"),"Renew route remains available");rejected("Renewal purpose changed",()->n.settle(n.pending(1004).getString("token"),true,1004));n.settle(n.pending(1004).getString("token"),false,1004);
  f.revision="r2";n.capture(key,true,1005);check(!n.pending(1005).has("token")&&f.cancelled==1,"old source revision cancels stale PI");String newer=n.arm(f.selection(),f.expiry,1005);check(!newer.equals(key),"revision rotates opaque route");n.post(newer,1005);n.capture(newer,true,1005);f.revoked=true;check(!n.pending(1006).has("token"),"revocation fences pending");f.revoked=false;
  // A tap taken before the source changes is fenced inside settle itself: the row is removed and its notice cancelled.
  for(String change:new String[]{"owner","revision","revoked","expiry"}){String fenced=n.arm(f.selection(),f.expiry,1007);n.post(fenced,1007);n.capture(fenced,true,1007);String token=n.pending(1007).getString("token");int cancelled=f.cancelled;String revision=f.revision;
   if(change.equals("owner"))f.owner="other";if(change.equals("revision"))f.revision="r3";if(change.equals("revoked"))f.revoked=true;long at=change.equals("expiry")?f.expiry:1007;
   rejected(change.equals("owner")?"binding changed":change.equals("expiry")?"Renewal source expired":"Renewal source changed",()->n.settle(token,false,at));check(!new JSONObject(f.stored).has(fenced)&&f.cancelled==cancelled+1,change+" change fences settle");f.owner="owner";f.revision=revision;f.revoked=false;}
  String active=n.arm(f.selection(),f.expiry,1008);n.post(active,1008);n.capture(active,true,1008);check(!n.pending(f.expiry).has("token"),"expiry fences pending");
  Fixture disk=new Fixture();SourceRenewalNotices d=disk.core();String diskKey=d.arm(disk.selection(),disk.expiry,1000);disk.failWrite=true;try{d.post(diskKey,1001);throw new AssertionError();}catch(IllegalStateException expected){}check(disk.posted==0,"must persist before effect");
  Fixture owner=new Fixture();SourceRenewalNotices o=owner.core();String ownerKey=o.arm(owner.selection(),owner.expiry,1000);o.post(ownerKey,1000);o.clear(new JSONObject(owner.selection().toString()).put("revision","other"));o.capture(ownerKey,true,1001);check(o.pending(1001).has("token"),"stale clear cannot cancel current revision");o.withdrawOtherOwners(new JSONObject().put("origin","https://device.alpha.invalid").put("ownerId","wrong").put("agentId","agent"));o.capture(ownerKey,true,1001);check(!o.pending(1001).has("token"),"withdraw owner cancels routes");
  Fixture blocked=new Fixture();SourceRenewalNotices b=blocked.core();String blockedKey=b.arm(blocked.selection(),blocked.expiry,1000);blocked.failPost=true;try{b.post(blockedKey,1000);throw new AssertionError();}catch(IllegalStateException expected){}check(blocked.posted==0,"failed post has no effect");blocked.failPost=false;b.arm(blocked.selection(),blocked.expiry,1001);b.post(blockedKey,1001);check(blocked.posted==1,"failed post can be retried once notifications return");blocked.core().post(blockedKey,1002);check(blocked.posted==1,"successful retry stays at most once");
  Fixture down=new Fixture();SourceRenewalNotices r=down.core();String downKey=r.arm(down.selection(),down.expiry,1000);
  down.offline=true;try{r.post(downKey,1001);throw new AssertionError();}catch(SourceRenewalNotices.RenewalUnverifiable expected){}
  down.offline=false;down.paused=true;try{r.post(downKey,1002);throw new AssertionError();}catch(SourceRenewalNotices.RenewalUnverifiable expected){}
  check(down.posted==0&&down.cancelled==0&&new JSONObject(down.stored).has(downKey),"unverifiable source keeps its row");down.paused=false;r.post(downKey,1003);check(down.posted==1,"kept row posts once the resident answers");
  Fixture gone=new Fixture();SourceRenewalNotices g=gone.core();String goneKey=g.arm(gone.selection(),gone.expiry,1000);gone.revoked=true;g.post(goneKey,1001);check(gone.posted==0&&gone.cancelled==1&&!new JSONObject(gone.stored).has(goneKey),"revoked grant removes its row");
  Fixture crashed=new Fixture();SourceRenewalNotices c=crashed.core();String crashedKey=c.arm(crashed.selection(),crashed.expiry,1000);
  JSONObject rows=new JSONObject(crashed.stored);rows.getJSONObject(crashedKey).put("phase","dispatching");crashed.stored=rows.toString();
  crashed.core().arm(crashed.selection(),crashed.expiry,1001);check("armed".equals(new JSONObject(crashed.stored).getJSONObject(crashedKey).getString("phase")),"re-arm resets an interrupted post");
  rows=new JSONObject(crashed.stored);rows.getJSONObject(crashedKey).put("phase","dispatching");crashed.stored=rows.toString();
  crashed.core().post(crashedKey,1002);check(crashed.posted==1&&"posted".equals(new JSONObject(crashed.stored).getJSONObject(crashedKey).getString("phase")),"interrupted post retries");
  System.out.println("PASS source renewal notices");
 }
}
