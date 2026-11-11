package ai.alphacompute.alphaphone;
import java.util.*;
import java.util.concurrent.atomic.AtomicLong;
import org.json.*;
public final class ResidentResultTransportTest {
 static final long EXPIRES=System.currentTimeMillis()+600000;
 static void require(boolean value){if(!value)throw new AssertionError();}
 interface Task {void run()throws Exception;}
 static void retries(Task task)throws Exception {try{task.run();}catch(java.io.IOException expected){return;}throw new AssertionError("expected a retryable failure");}
 static void revokes(Task task)throws Exception {try{task.run();}catch(SecurityException expected){return;}throw new AssertionError("expected a revocation");}
 static void rejects(Class<? extends Exception> type,String pattern,Task task)throws Exception{try{task.run();}catch(Exception thrown){if(type.isInstance(thrown)&&thrown.getMessage()!=null&&java.util.regex.Pattern.compile(pattern).matcher(thrown.getMessage()).find())return;throw new AssertionError("Expected "+type.getSimpleName()+" /"+pattern+"/ but got "+thrown,thrown);}throw new AssertionError("Expected "+type.getSimpleName()+" /"+pattern+"/");}
 static final class Channel implements ResidentResultTransport.Channel {
  final List<String> paths=new ArrayList<>();boolean cancelled,acknowledged,loseAck;String owner="owner",agent="agent",token="session",agentStatus="running";int status=200;AtomicLong clock=new AtomicLong();
  Runnable beforeAck=()->{};boolean cancelResult,expire;int bodyBytes;JSONObject entry;
  public void check(){if(cancelled)throw new SecurityException("cancelled");}
  public JSONObject exchange(String path,String method,JSONObject body,int timeout)throws Exception {
   require(timeout>0&&timeout<=15000);paths.add(method+" "+path);JSONObject value;
   if(path.equals("/api/auth/me"))value=new JSONObject().put("identity",new JSONObject().put("id",owner).put("kind","owner")).put("access",new JSONObject().put("role","OWNER").put("mode","session")).put("session",new JSONObject().put("kind","machine").put("id",token).put("expiresAt",expire?1:EXPIRES));
   else if(path.equals("/api/agents"))value=new JSONObject().put("agents",new JSONArray().put(new JSONObject().put("id",agent).put("status",agentStatus)));
   else if(path.equals("/api/workflow/status"))value=new JSONObject().put("hostedDigestProtocol",1);
   else if(path.startsWith("/api/workflow/hosted/results?")){value=new JSONObject().put("entries",acknowledged?new JSONArray():new JSONArray().put(entry!=null?entry:result()));if(cancelResult)cancelled=true;}
   else if(path.equals("/api/workflow/hosted/results/ack")){require(method.equals("POST"));beforeAck.run();if(loseAck){loseAck=false;throw new java.io.IOException("lost ack");}acknowledged=true;value=new JSONObject();}
   else throw new AssertionError("Unexpected route "+path);
   // Pads a valid reply to exactly bodyBytes so only the size bound can refuse it.
   if(bodyBytes>0){value.put("pad","");value.put("pad","x".repeat(bodyBytes-value.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length));}
   return new JSONObject().put("status",status).put("body",value.toString());
  }
  ResidentResultTransport transport(){return new ResidentResultTransport(this,"owner","agent","session",clock::get);}
 }
 static JSONObject result(){String now="2026-10-02T00:00:00Z";return new JSONObject().put("cursor",1).put("runId","run-one").put("workflowId","workflow").put("workflowVersionId","version").put("templateVersion","template").put("scheduledAt",now).put("startedAt",now).put("completedAt",now).put("source",new JSONObject().put("kind","tasks")).put("status","completed").put("output","Synthetic result").put("error",JSONObject.NULL);}
 static final class Store implements HostedInbox.Store,HostedResultNotices.Storage {final Map<String,String> values=new HashMap<>();public String read(String key){return values.get(key);}public void write(String key,String value){values.put(key,value);}public void remove(String key){values.remove(key);}}
 /** Syncs saved then next into a fresh inbox; returns the saved slot and the number of posted notices, or null when next was refused. */
 static Object[] replace(JSONObject saved,JSONObject next)throws Exception {
  Store store=new Store();int[] posts={0};HostedResultNotices notices=new HostedResultNotices(store,new HostedResultNotices.Poster(){public boolean allowed(){return true;}public boolean active(String key,String dispatchId){return true;}public void post(String key,String dispatchId,String title,boolean silent){posts[0]++;}public void cancel(String key){}});
  HostedInbox inbox=new HostedInbox(store,new Object(),notices);String origin="https://device.alpha.invalid",scope=HostedResultNotices.hash(new JSONArray().put(origin).put("owner").put("agent").toString());JSONObject binding=new JSONObject().put("scope",scope).put("origin",origin).put("ownerId","owner").put("agentId","agent");String key="hosted-digests:v1:"+scope+":run-one";
  Channel channel=new Channel();channel.entry=saved;inbox.sync(binding,channel.transport(),()->{});require(channel.acknowledged&&posts[0]==1);
  channel.acknowledged=false;channel.entry=next;String before=store.read(key);
  try{inbox.sync(binding,channel.transport(),()->{});}catch(IllegalStateException error){require("Saved result changed".equals(error.getMessage())&&!channel.acknowledged&&before.equals(store.read(key)));return null;}
  require(channel.acknowledged);JSONArray history=inbox.history("hosted-digests:v1:"+scope);require(history.length()==1);
  require(inbox.sync(binding,channel.transport(),()->{}).length()==1);
  return new Object[]{HostedInbox.parse(store.read(key)),posts[0],new JSONObject(store.read("hosted-digests:v1:"+scope)).optJSONArray("pendingNotices").length()};
 }
 public static void main(String[] args)throws Exception {
  for(String slot:new String[]{"reminder-taps:v1","reminder-taps:v2","workflow-notice-taps:v1","workflow-notice-delivery:v1","workflow-notice-owner:v1","workflow-approval-notices:v1","action-journal:v1:scope:entry:id","hosted-background:v1:active","hosted-background:v1:preference","hosted-digests:v1:scope:run","hosted-notices:pending:v1","note-audio-metadata:v1:record","resident-results:v1:credential","resident-results:future","local-agent-provider:v1",null,""})rejects(SecurityException.class,"Native-only credential slot|Invalid credential slot",()->RendererCredentialSlots.requireAllowed(slot));
  require(RendererCredentialSlots.requireAllowed("device:fixture").equals("device:fixture"));
  for(String slot:new String[]{"cloud:production","cloud-runtime:session","remote:https://agent.invalid","workflow-draft:v1:scope","notes-records:v1:device","notes-audio-deletions:v1:device","notes-trash:v1:device","reminder-deletions:v1:device","reminder-creations:v1:device","inbox-operation:v1:scope","inbox-drafts:v1:scope","cloud-delegation:v1:scope","renderer-hosted-digests:v1:scope"})require(RendererCredentialSlots.requireAllowed(slot).equals(slot));
  for(String namespace:new String[]{"native-calendar-sync", "native-delete-journal", "native-delete-installation", "native-digest-source","resident-results","local-agent-provider","workflow-notice-taps","workflow-notice-delivery","workflow-notice-owner","workflow-approval-notices","action-journal","hosted-background","hosted-digests","hosted-notices","note-audio-metadata","reminder-taps"})for(String suffix:new String[]{"",":",":v99:future"})rejects(SecurityException.class,"Native-only credential slot",()->RendererCredentialSlots.requireAllowed(namespace+suffix));
  Channel c=new Channel();ResidentResultTransport t=c.transport();
  for(String path:new String[]{"/api/auth/pair","/api/workflow/execute","/api/workflow/hosted/loops","https://other.invalid","/api/workflow/hosted/results?clientId=x&extra=y"})rejects(SecurityException.class,"route denied",()->t.request(path,null));require(c.paths.isEmpty());
  JSONObject ack=new JSONObject().put("clientId","client").put("runId","run-one").put("cursor",1);
  for(Object cursor:new Object[]{0,-1,1.5,9007199254740992L,"1"})rejects(SecurityException.class,"Invalid result cursor",()->t.request("/api/workflow/hosted/results/ack",new JSONObject(ack.toString()).put("cursor",cursor)));require(c.paths.isEmpty());
  rejects(SecurityException.class,"Invalid result acknowledgement",()->t.request("/api/workflow/hosted/results/ack",new JSONObject(ack.toString()).put("extra",true)));require(c.paths.isEmpty());
  require(t.request("/api/workflow/hosted/results?clientId=client",null).getJSONArray("entries").length()==1);
  Channel full=new Channel();full.bodyBytes=1100000;require(full.transport().request("/api/workflow/hosted/results?clientId=client",null).getJSONArray("entries").length()==1);
  for(String mismatch:new String[]{"owner","agent","session","expired","unauthorized","oversized"}){
   Channel bad=new Channel();if(mismatch.equals("owner"))bad.owner="other";if(mismatch.equals("agent"))bad.agent="other";if(mismatch.equals("session"))bad.token="other";if(mismatch.equals("expired"))bad.expire=true;if(mismatch.equals("unauthorized"))bad.status=401;if(mismatch.equals("oversized"))bad.bodyBytes=1100001;
   String reason=mismatch.equals("agent")?"agent changed":mismatch.equals("unauthorized")?"session revoked":mismatch.equals("oversized")?"too large":"owner changed";
   rejects(mismatch.equals("oversized")?java.io.IOException.class:SecurityException.class,reason,()->bad.transport().request("/api/workflow/hosted/results/ack",ack));require(!bad.acknowledged);
  }
  c=new Channel();ResidentResultTransport closed=c.transport();closed.close();rejects(java.io.IOException.class,"delivery stopped",closed::verify);require(c.paths.isEmpty());
  c=new Channel();ResidentResultTransport expired=c.transport();c.clock.set(java.util.concurrent.TimeUnit.SECONDS.toNanos(61));rejects(java.io.IOException.class,"delivery stopped",expired::verify);require(c.paths.isEmpty());
  Channel late=new Channel();late.cancelResult=true;rejects(SecurityException.class,"cancelled",()->late.transport().request("/api/workflow/hosted/results?clientId=client",null));require(!late.acknowledged);
  Store store=new Store();HostedResultNotices notices=new HostedResultNotices(store,new HostedResultNotices.Poster(){public boolean allowed(){return false;}public boolean active(String key,String dispatchId){return false;}public void post(String key,String dispatchId,String title,boolean silent){throw new AssertionError();}public void cancel(String key){}});
  HostedInbox inbox=new HostedInbox(store,new Object(),notices);String origin="https://device.alpha.invalid",scope=HostedResultNotices.hash(new JSONArray().put(origin).put("owner").put("agent").toString());JSONObject binding=new JSONObject().put("scope",scope).put("origin",origin).put("ownerId","owner").put("agentId","agent");String slot="hosted-digests:v1:"+scope;
  Channel recovery=new Channel();recovery.loseAck=true;recovery.beforeAck=()->{try{require(inbox.history(slot).length()==1);}catch(Exception error){throw new AssertionError(error);}};
  rejects(java.io.IOException.class,"lost ack",()->inbox.sync(binding,recovery.transport(),()->{}));String original=store.read(slot+":run-one");require(original!=null&&!recovery.acknowledged);
  require(inbox.sync(binding,recovery.transport(),()->{}).length()==1);require(recovery.acknowledged&&original.equals(store.read(slot+":run-one")));
  // The agent replaces a provisional cancellation with the native terminal under the same run; anything else is still refused.
  JSONObject cancelled=result().put("status","cancelled").put("output","").put("error","Cancelled"),failed=result().put("cursor",2).put("status","failed").put("output","").put("error","Native step failed");
  Object[] reconciled=replace(cancelled,failed);require(reconciled!=null&&((JSONObject)reconciled[0]).getString("status").equals("failed")&&((JSONObject)reconciled[0]).getLong("cursor")==2&&(int)reconciled[1]==2&&(int)reconciled[2]==0);
  for(JSONObject next:new JSONObject[]{new JSONObject(failed.toString()).put("cursor",1),new JSONObject(cancelled.toString()).put("cursor",2).put("error","Cancelled again"),new JSONObject(failed.toString()).put("workflowId","other"),new JSONObject(failed.toString()).put("workflowVersionId","other"),new JSONObject(failed.toString()).put("templateVersion","other"),new JSONObject(failed.toString()).put("scheduledAt","2026-10-03T00:00:00Z"),new JSONObject(failed.toString()).put("source",new JSONObject().put("kind","inbox"))})require(replace(cancelled,next)==null);
  // A lost ack redelivers the superseded cancellation; the saved terminal stays and no notice repeats.
  Object[] redelivered=replace(failed,cancelled);require(redelivered!=null&&((JSONObject)redelivered[0]).getString("status").equals("failed")&&(int)redelivered[1]==1&&(int)redelivered[2]==0);
  require(replace(result(),new JSONObject(failed.toString()))==null);require(replace(result(),result().put("cursor",2).put("output","Changed"))==null);
  Store credentials=new Store();String root="native-runtime-root";
  JSONObject snapshot=ResidentResultSession.snapshot("owner","session",EXPIRES,root);
  credentials.write("resident",snapshot.toString());JSONObject device=new JSONObject().put("installationId","11111111-1111-1111-1111-111111111111").put("key","a".repeat(64)).put("enrollmentId","enrollment");credentials.write("device",device.toString());
  JSONObject pinned=new JSONObject().put("ownerId","owner").put("agentId","agent").put("credentialSlot","resident").put("credentialDigest",HostedResultNotices.hash(snapshot.toString())).put("deviceSlot","device").put("deviceDigest",HostedResultNotices.hash(device.toString()));
  Channel service=new Channel();String[] currentRoot={root},activeDigest={HostedResultNotices.hash(snapshot.toString())};boolean[] current={true};
  ResidentResultSession.Runtime runtime=new ResidentResultSession.Runtime(){public String rootToken(){return currentRoot[0];}
  public String adopt(String previous,String replacement)throws Exception{if(!current[0])throw new SecurityException("Binding retired");if(replacement!=null&&previous.equals(activeDigest[0])){credentials.write("resident",replacement);activeDigest[0]=HostedResultNotices.hash(replacement);}return activeDigest[0];}
  public JSONObject exchange(JSONObject request)throws Exception{
   require(request.getJSONObject("headers").getString("Authorization").equals("Bearer session"));String path=request.getString("path");
   if(path.startsWith("/api/workflow/"))require(request.getJSONObject("headers").getString("X-Eliza-Device-Key").equals("a".repeat(64)));
   return service.exchange(path,request.getString("method"),request.has("body")?new JSONObject(request.getString("body")):null,request.getInt("timeoutMs"));
  }};
  ResidentResultSession.Guard guard=()->{if(!current[0])throw new SecurityException("Binding retired");};
  ResidentResultTransport bound=ResidentResultSession.open(credentials,pinned,runtime,guard);bound.verify();int verifiedCalls=service.paths.size();
  current[0]=false;rejects(SecurityException.class,"Binding retired",bound::verify);require(service.paths.size()==verifiedCalls);current[0]=true;
  credentials.write("resident",new JSONObject(snapshot.toString()).put("token","rotated").toString());rejects(SecurityException.class,"credential changed",bound::verify);require(service.paths.size()==verifiedCalls);credentials.write("resident",snapshot.toString());
  credentials.write("device",new JSONObject(device.toString()).put("enrollmentId","replaced").toString());rejects(SecurityException.class,"device binding changed",bound::verify);require(service.paths.size()==verifiedCalls);credentials.write("device",device.toString());
  credentials.remove("resident");rejects(SecurityException.class,"credential changed",bound::verify);require(service.paths.size()==verifiedCalls);
  // A resident restart mints a new root; the same machine session on the same agent is adopted.
  credentials.write("resident",snapshot.toString());service.paths.clear();currentRoot[0]="restarted-runtime";
  ResidentResultTransport restarted=ResidentResultSession.open(credentials,pinned,runtime,guard);restarted.verify();
  require(service.paths.subList(0,2).equals(List.of("GET /api/auth/me","GET /api/agents")));
  require(new JSONObject(credentials.read("resident")).getString("runtimeDigest").equals(HostedResultNotices.hash("restarted-runtime")));
  require(new JSONObject(credentials.read("resident")).getString("token").equals("session")&&!activeDigest[0].equals(pinned.getString("credentialDigest")));
  ResidentResultSession.open(credentials,pinned,runtime,guard).verify();
  String adopted=credentials.read("resident");
  currentRoot[0]=null;retries(()->ResidentResultSession.open(credentials,pinned,runtime,guard));currentRoot[0]="";retries(restarted::verify);
  currentRoot[0]="starting-runtime";service.agentStatus="starting";retries(()->ResidentResultSession.open(credentials,pinned,runtime,guard));require(credentials.read("resident").equals(adopted));
  service.agentStatus="running";service.agent="00000000-0000-0000-0000-000000000000";retries(()->ResidentResultSession.open(credentials,pinned,runtime,guard));require(credentials.read("resident").equals(adopted));
  service.agent="other-agent";revokes(()->ResidentResultSession.open(credentials,pinned,runtime,guard));require(credentials.read("resident").equals(adopted));service.agent="agent";
  service.token="other-session";revokes(()->ResidentResultSession.open(credentials,pinned,runtime,guard));require(credentials.read("resident").equals(adopted));service.token="session";
  service.status=401;revokes(()->ResidentResultSession.open(credentials,pinned,runtime,guard));require(credentials.read("resident").equals(adopted));service.status=200;
  current[0]=false;revokes(()->ResidentResultSession.open(credentials,pinned,runtime,guard));require(credentials.read("resident").equals(adopted));current[0]=true;
  ResidentResultSession.open(credentials,pinned,runtime,guard).verify();require(!credentials.read("resident").equals(adopted));
  rejects(SecurityException.class,"session unavailable",()->ResidentResultSession.snapshot("owner","session",1,root));
  System.out.println("PASS resident owner/session/agent checks, bounded IPC, route denial, cancellation, commit-before-ack and lost-ack recovery");
 }
}
