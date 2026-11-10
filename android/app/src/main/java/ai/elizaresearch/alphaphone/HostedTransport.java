package ai.elizaresearch.alphaphone;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;
import org.json.*;

/** Bounded read/receipt transport. No login, refresh, registration, execution or provider grants. */
final class HostedTransport implements HostedInbox.DeliveryTransport {
 interface Guard {void check()throws Exception;}
 interface Connections {HttpURLConnection open(URL url)throws Exception;}
 private final Connections connections;
 private final HostedInbox.Store store;private final JSONObject binding;private final Guard guard;
 private final long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(60);
 private volatile boolean stopped;private volatile HttpURLConnection connection;
 private final ScheduledExecutorService timer=Executors.newSingleThreadScheduledExecutor();
 HostedTransport(HostedInbox.Store store,JSONObject binding,Guard guard){this(store,binding,guard,url->(HttpURLConnection)url.openConnection());}
 HostedTransport(HostedInbox.Store store,JSONObject binding,Guard guard,Connections connections){this.connections=connections;this.store=store;this.binding=binding;this.guard=guard;timer.schedule(this::close,60,TimeUnit.SECONDS);}
 public void close(){stopped=true;HttpURLConnection c=connection;if(c!=null)c.disconnect();timer.shutdownNow();}
 public void check()throws Exception {if(stopped||System.nanoTime()>=deadline)throw new IOException("Delivery stopped");guard.check();String value=store.read(binding.getString("credentialSlot"));if(value==null||!HostedResultNotices.hash(value).equals(binding.getString("credentialDigest")))throw new SecurityException("Reconnect required");}
 private JSONObject credential()throws Exception {check();JSONObject c=new JSONObject(store.read(binding.getString("credentialSlot")));if(c.has("expiresAt")&&c.getDouble("expiresAt")<=System.currentTimeMillis())throw new SecurityException("Reconnect required");return c;}
 static URI origin(String value,boolean local)throws Exception {URI u=new URI(value);if(u.getHost()==null||u.getRawUserInfo()!=null||u.getRawQuery()!=null||u.getRawFragment()!=null||!(u.getRawPath().isEmpty()||u.getRawPath().equals("/"))||u.getPort()==0||u.getPort()>65535)throw new SecurityException("Invalid origin");boolean debug=BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS&&local&&"http".equals(u.getScheme())&&("127.0.0.1".equals(u.getHost())||"10.0.2.2".equals(u.getHost()));if(!"https".equals(u.getScheme())&&!debug)throw new SecurityException("HTTPS required");return u;}
 private JSONObject call(String base,String path,JSONObject body,boolean device)throws Exception {
  check();JSONObject auth=credential();HttpURLConnection c=connections.open(new URL(base+path));connection=c;
  try{c.setInstanceFollowRedirects(false);c.setUseCaches(false);int timeout=(int)Math.max(1,Math.min(15000,TimeUnit.NANOSECONDS.toMillis(deadline-System.nanoTime())));c.setConnectTimeout(timeout);c.setReadTimeout(timeout);c.setRequestMethod(body==null?"GET":"POST");c.setRequestProperty("Accept","application/json");c.setRequestProperty("Authorization","Bearer "+auth.getString("token"));
   if(device){JSONObject d=new JSONObject(store.read(binding.getString("deviceSlot")));if(!HostedResultNotices.hash(d.toString()).equals(binding.getString("deviceDigest")))throw new SecurityException("Device binding changed");c.setRequestProperty("X-Eliza-Device-Id",d.getString("installationId"));c.setRequestProperty("X-Eliza-Device-Key",d.getString("key"));c.setRequestProperty("X-Eliza-Device-Capabilities","calendar.local-event.v1,notes.local-record.v1");if(binding.getString("mode").equals("cloud"))c.setRequestProperty("X-Eliza-Phone-Protocol","1");}
   if(body!=null){byte[] bytes=body.toString().getBytes(StandardCharsets.UTF_8);c.setRequestProperty("Content-Type","application/json");c.setDoOutput(true);c.setFixedLengthStreamingMode(bytes.length);check();try(OutputStream out=c.getOutputStream()){out.write(bytes);}}
   check();int status=c.getResponseCode();if(status==401||status==403)throw new SecurityException("Reconnect required");if(status<200||status>=300)throw new IOException("Delivery HTTP "+status);
   ByteArrayOutputStream out=new ByteArrayOutputStream();try(InputStream in=c.getInputStream()){byte[] buf=new byte[8192];for(int n;(n=in.read(buf))!=-1;){check();if(out.size()+n>1100000)throw new IOException("Result response too large");out.write(buf,0,n);}}check();return new JSONObject(out.toString(StandardCharsets.UTF_8.name()));
  }finally{c.disconnect();if(connection==c)connection=null;}
 }
 private static JSONObject success(JSONObject value)throws Exception {if(!value.getBoolean("success"))throw new SecurityException("Cloud identity unavailable");return value.getJSONObject("data");}
 public void verify()throws Exception {
  String base=binding.getString("origin");origin(base,binding.getString("mode").equals("local"));JSONObject auth=credential();String owner=binding.getString("ownerId"),agent=binding.getString("agentId");
  if(binding.getString("mode").equals("cloud")){
   String env=binding.getString("environment"),api=env.equals("production")?CloudDeployment.PRODUCTION_API:env.equals("staging")?CloudDeployment.STAGING_API:null;if(api==null)throw new SecurityException("Invalid Cloud environment");if(!auth.getString("credentialId").equals(binding.getString("credentialId")))throw new SecurityException("Cloud account changed");
   JSONObject user=success(call(api,"/api/v1/user",null,false));if(!user.getString("id").equals(binding.getString("userId"))||!user.getString("organization_id").equals(binding.getString("organizationId")))throw new SecurityException("Cloud owner changed");
   JSONObject a=success(call(api,"/api/v1/eliza/agents/"+HostedInbox.id(agent),null,false));String aid=a.optString("id",a.optString("agentId"));String tier=a.getString("executionTier");if(!aid.equals(agent)||!(tier.equals("dedicated-lazy")||tier.equals("dedicated-always")||tier.equals("custom")))throw new SecurityException("Dedicated runtime required");
   String expected="https://"+agent+"."+(env.equals("production")?CloudDeployment.PRODUCTION_SERVICES_HOST:CloudDeployment.STAGING_SERVICES_HOST);String reported=a.getString("webUiUrl");if(!(reported.equals(expected)||reported.equals(expected+"/"))||!base.equals(expected))throw new SecurityException("Cloud runtime changed");
   JSONObject cap=call(base,"/api/client-devices/capabilities",null,true),external=cap.getJSONObject("externalIdentity"),device=cap.getJSONObject("deviceActions");if(cap.getInt("protocol")!=1||!cap.getString("agentId").equals(agent)||!cap.getString("identityId").equals(owner)||!external.getString("subject").equals(binding.getString("userId"))||!external.getString("organizationId").equals(binding.getString("organizationId"))||!external.getString("issuer").startsWith("https://")||device.getInt("protocol")!=1)throw new SecurityException("Runtime owner changed");boolean supported=false;JSONArray caps=device.getJSONArray("capabilities");for(int i=0;i<caps.length();i++)if(caps.getString(i).equals("calendar.local-event.v1"))supported=true;if(!supported)throw new SecurityException("Runtime capability changed");
  }else{
   if(!auth.getString("origin").equals(base)||!auth.getString("identityId").equals(owner)||!auth.getString("sessionId").equals(auth.getString("token")))throw new SecurityException("Pairing changed");JSONObject me=call(base,"/api/auth/me",null,false),who=me.getJSONObject("identity"),session=me.getJSONObject("session"),access=me.getJSONObject("access");if(!who.getString("id").equals(owner)||!who.getString("kind").equals("owner")||!access.getString("role").equals("OWNER")||!access.getString("mode").equals("session")||!session.getString("kind").equals("machine")||!session.getString("id").equals(auth.getString("token"))||session.getDouble("expiresAt")<=System.currentTimeMillis())throw new SecurityException("Pairing revoked");JSONArray agents=call(base,"/api/agents",null,false).getJSONArray("agents");if(agents.length()!=1||!agents.getJSONObject(0).getString("id").equals(agent)||!agents.getJSONObject(0).getString("status").equals("running"))throw new SecurityException("Agent changed");
  }
  if(call(base,"/api/workflow/status",null,true).getInt("hostedDigestProtocol")!=1)throw new SecurityException("Hosted results unavailable");check();
 }
 public JSONObject request(String path,JSONObject body)throws Exception {if(!(body==null&&path.matches("/api/workflow/hosted/results\\?clientId=[A-Za-z0-9_-]{1,128}"))&&!(body!=null&&path.equals("/api/workflow/hosted/results/ack")))throw new SecurityException("Delivery route denied");verify();return call(binding.getString("origin"),path,body,true);}
}
