package ai.elizaresearch.alphaphone;
import org.json.*;
import java.util.*;

/** Synthetic owner records only. No Android credentials, pairing, network or notification effects. */
public final class NativeNotificationSessionTest {
 static final String OWNER="10000000-0000-4000-8000-000000000001",AGENT="20000000-0000-4000-8000-000000000002",INSTALL="30000000-0000-4000-8000-000000000003";
 static final long NOW=System.currentTimeMillis(),EXPIRY=NOW+3600000;
 static int checks;
 static void check(boolean value){if(!value)throw new AssertionError("Check "+checks);checks++;}
 interface Work{void run()throws Exception;}
 static void reject(Work work)throws Exception{try{work.run();}catch(SecurityException|NativeNotificationSession.Superseded expected){checks++;return;}throw new AssertionError("Untrusted restore accepted");}
 static final class Fixture implements NativeNotificationSession.Ports{
  String saved,provider="existing-provider-generation",installation=INSTALL,root="new-service-root";
  String responseOwner=OWNER,responseAgent=AGENT,sessionKind="machine";long responseExpiry=EXPIRY;boolean revoked,changedAfterOwner,retired;List<String> requests=new ArrayList<>();
  Fixture()throws Exception{
   JSONObject session=ResidentResultSession.snapshot(OWNER,"synthetic-existing-machine",EXPIRY,"previous-service-root");
   saved=NativeNotificationSession.record(session,new JSONObject().put("subjectUserId",OWNER).put("agentId",AGENT),INSTALL,provider).toString();
  }
  public String saved(){return saved;}public String provider(){return provider;}public String installation(){return installation;}public String root(){return root;}
  public void current()throws Exception{if(retired)throw new NativeNotificationSession.Superseded();}
  public JSONObject get(String path,String token)throws Exception{
   requests.add(path);check("synthetic-existing-machine".equals(token));
   if(revoked)throw new SecurityException("Synthetic revoked session");
   if("/api/auth/me".equals(path)){
    JSONObject out=new JSONObject().put("identity",new JSONObject().put("id",responseOwner).put("kind","owner"))
     .put("access",new JSONObject().put("role","OWNER").put("mode","session"))
     .put("session",new JSONObject().put("id",token).put("kind",sessionKind).put("expiresAt",responseExpiry));
    if(changedAfterOwner)root="rotated-again";return out;
   }
   if("/api/agents".equals(path))return new JSONObject().put("agents",new JSONArray().put(new JSONObject().put("id",responseAgent).put("status","running")));
   throw new AssertionError("Unexpected route: "+path);
  }
 }
 public static void main(String[] args)throws Exception{
  Fixture valid=new Fixture();JSONObject restored=NativeNotificationSession.restore(valid,NOW);
  check(restored.getJSONObject("session").getString("runtimeDigest").equals(HostedResultNotices.hash("new-service-root")));
  check(restored.getJSONObject("session").getString("token").equals("synthetic-existing-machine"));
  check(valid.requests.equals(List.of("/api/auth/me","/api/agents")));
  Fixture missing=new Fixture();missing.saved=null;check(NativeNotificationSession.restore(missing,NOW)==null);check(missing.requests.isEmpty());
  Fixture installation=new Fixture();installation.installation="40000000-0000-4000-8000-000000000004";reject(()->NativeNotificationSession.restore(installation,NOW));check(installation.requests.isEmpty());
  Fixture provider=new Fixture();provider.provider="other-provider";reject(()->NativeNotificationSession.restore(provider,NOW));check(provider.requests.isEmpty());
  Fixture expired=new Fixture();reject(()->NativeNotificationSession.restore(expired,EXPIRY));check(expired.requests.isEmpty());
  Fixture owner=new Fixture();owner.responseOwner="40000000-0000-4000-8000-000000000004";reject(()->NativeNotificationSession.restore(owner,NOW));check(owner.requests.size()==1);
  Fixture agent=new Fixture();agent.responseAgent="40000000-0000-4000-8000-000000000004";reject(()->NativeNotificationSession.restore(agent,NOW));
  Fixture kind=new Fixture();kind.sessionKind="browser";reject(()->NativeNotificationSession.restore(kind,NOW));
  Fixture expiry=new Fixture();expiry.responseExpiry++;reject(()->NativeNotificationSession.restore(expiry,NOW));
  Fixture revoked=new Fixture();revoked.revoked=true;reject(()->NativeNotificationSession.restore(revoked,NOW));
  Fixture raced=new Fixture();raced.changedAfterOwner=true;reject(()->NativeNotificationSession.restore(raced,NOW));check(raced.requests.size()==1);
  Fixture retired=new Fixture();retired.retired=true;reject(()->NativeNotificationSession.restore(retired,NOW));check(retired.requests.isEmpty());
  System.out.println("PASS NativeNotificationSession: "+checks+" checks; existing authority only, no pairing or effects");
 }
}
