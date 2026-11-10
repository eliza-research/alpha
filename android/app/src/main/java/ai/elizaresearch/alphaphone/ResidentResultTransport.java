package ai.elizaresearch.alphaphone;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;
import java.util.function.LongSupplier;
import org.json.*;

/** Resident result reads use an existing native-owned session. Never enrolls or starts an agent. */
final class ResidentResultTransport implements HostedInbox.DeliveryTransport {
 interface Channel {
  // The channel supplies credentials and generation checks; none come from result data.
  JSONObject exchange(String path, String method, JSONObject body, int timeoutMs) throws Exception;
  void check() throws Exception;
 }
 private final Channel channel;
 private final String owner,agent,session;
 private final LongSupplier clock;
 private final long deadline;
 private volatile boolean closed;
 ResidentResultTransport(Channel channel,String owner,String agent,String session) {
  this(channel,owner,agent,session,System::nanoTime);
 }
 ResidentResultTransport(Channel channel,String owner,String agent,String session,LongSupplier clock) {
  if(owner==null||owner.isEmpty()||agent==null||agent.isEmpty()||session==null||session.isEmpty())throw new IllegalArgumentException("Missing resident binding");
  this.channel=channel;this.owner=owner;this.agent=agent;this.session=session;this.clock=clock;
  deadline=clock.getAsLong()+TimeUnit.SECONDS.toNanos(60);
 }
 public void close(){closed=true;}
 public void check()throws Exception {
  if(closed||clock.getAsLong()>=deadline)throw new IOException("Resident delivery stopped");
  channel.check();
 }
 private JSONObject call(String path,JSONObject body)throws Exception {
  check();int timeout=(int)Math.max(1,Math.min(15000,TimeUnit.NANOSECONDS.toMillis(deadline-clock.getAsLong())));
  JSONObject response=channel.exchange(path,body==null?"GET":"POST",body,timeout);
  check();int status=response.getInt("status");
  if(status==401||status==403)throw new SecurityException("Resident session revoked");
  if(status<200||status>=300)throw new IOException("Resident delivery HTTP "+status);
  String raw=response.getString("body");
  if(raw.getBytes(StandardCharsets.UTF_8).length>1100000)throw new IOException("Resident result response too large");
  return new JSONObject(raw);
 }
 public void verify()throws Exception {
  JSONObject me=call("/api/auth/me",null),identity=me.getJSONObject("identity"),access=me.getJSONObject("access"),auth=me.getJSONObject("session");
  if(!owner.equals(identity.getString("id"))||!"owner".equals(identity.getString("kind"))||
     !"OWNER".equals(access.getString("role"))||!"session".equals(access.getString("mode"))||
     !"machine".equals(auth.getString("kind"))||!session.equals(auth.getString("id"))||
     auth.getDouble("expiresAt")<=System.currentTimeMillis())throw new SecurityException("Resident owner changed");
  JSONArray agents=call("/api/agents",null).getJSONArray("agents");
  if(agents.length()!=1||!agent.equals(agents.getJSONObject(0).getString("id"))||
     !"running".equals(agents.getJSONObject(0).getString("status")))throw new SecurityException("Resident agent changed");
  if(call("/api/workflow/status",null).getInt("hostedDigestProtocol")!=1)throw new SecurityException("Resident results unavailable");
  check();
 }
 public JSONObject request(String path,JSONObject body)throws Exception {
  boolean read=body==null&&path!=null&&path.matches("/api/workflow/hosted/results\\?clientId=[A-Za-z0-9_-]{1,128}");
  boolean ack=body!=null&&"/api/workflow/hosted/results/ack".equals(path);
  if(!read&&!ack)throw new SecurityException("Resident delivery route denied");
  if(ack){
   if(body.length()!=3||!body.has("clientId")||!body.has("cursor")||!body.has("runId"))throw new SecurityException("Invalid result acknowledgement");
   HostedInbox.id(body.getString("clientId"));HostedInbox.id(body.getString("runId"));
   Object cursor=body.get("cursor");if(!(cursor instanceof Number)||((Number)cursor).doubleValue()!=((Number)cursor).longValue()||((Number)cursor).longValue()<1||((Number)cursor).longValue()>9007199254740991L)throw new SecurityException("Invalid result cursor");
  }
  verify();return call(path,body);
 }
}
