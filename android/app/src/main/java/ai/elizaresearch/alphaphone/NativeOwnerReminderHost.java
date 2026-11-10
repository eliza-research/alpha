package ai.elizaresearch.alphaphone;

import android.content.Context;
import org.json.*;

/** Private identity projection only. No enrollment, permission request, scheduler or notification effect. */
final class NativeOwnerReminderHost {
 interface Ports {
  JSONObject provider()throws Exception;
  JSONObject ownerSession()throws Exception;
  String device(String slot)throws Exception;
  JSONObject exchange(JSONObject session,String path,JSONObject deviceHeaders)throws Exception;
 }
 private final Ports ports;
 NativeOwnerReminderHost(Ports ports){this.ports=ports;}
 NativeOwnerReminderHost(Context context){
  AlphaCredentialStore store=new AlphaCredentialStore(context.getApplicationContext());
  ports=new Ports(){
   public JSONObject provider()throws Exception{return store.providerAdmissionSnapshot();}
   public JSONObject ownerSession()throws Exception{return AlphaLocalAgentPlugin.captureReminderOwnerSession();}
   public String device(String slot)throws Exception{return store.readCredentialSlot(slot);}
   public JSONObject exchange(JSONObject session,String path,JSONObject headers)throws Exception{return AlphaLocalAgentPlugin.readReminderOwnerRoute(session,path,headers);}
  };
 }
 JSONObject read()throws Exception{return read(ports);}
 /** Fast confirmation fence for an owner previously authenticated by read().
  * No HTTP on the UI thread; delayed dispatch still requires a fresh full read(). */
 String reviewFence(JSONObject expected)throws Exception{
  JSONObject provider=ports.provider(),session=ports.ownerSession();String subject=expected.getString("subjectUserId"),agent=expected.getString("agentId");
  if(!subject.equals(session.getString("ownerId"))||session.getLong("expiresAt")<=System.currentTimeMillis()+30000)throw new SecurityException("Native review authority changed");
  String account=provider.getString("accountRef");if("native-local".equals(account))account+=":"+subject;
  if(!account.equals(expected.getString("accountRef"))||!provider.getString("environment").equals(expected.getString("environment"))||!provider.getString("sessionGeneration").equals(expected.getString("sessionGeneration")))throw new SecurityException("Native review authority changed");
  String slot=deviceSlot(subject,agent),raw=ports.device(slot);
  if(raw==null)throw new SecurityException("Native review authority changed");JSONObject device=new JSONObject(raw);
  if(!expected.getString("installationId").equals(device.getString("installationId"))||!expected.getString("enrollmentId").equals(device.getString("enrollmentId")))throw new SecurityException("Native review enrollment changed");
  if(!provider.toString().equals(ports.provider().toString())||!session.toString().equals(ports.ownerSession().toString())||!raw.equals(ports.device(slot)))throw new SecurityException("Native review authority changed");
  return HostedResultNotices.hash(new JSONArray().put(provider).put(session).put(device).toString());
 }

 /** Exact JSON.stringify bytes used by the renderer's device enrollment key.
  * Android JSONArray escapes slashes, so it cannot define this shared key. */
 static String deviceSlot(String owner,String agent)throws Exception{
  return NativeDeviceEnrollmentKey.local("https://device.alpha.invalid",owner,agent);
 }

 static JSONObject read(Ports ports)throws Exception{
  JSONObject provider=new JSONObject(ports.provider().toString()),session=new JSONObject(ports.ownerSession().toString());
  String subject=HostedInbox.id(session.getString("ownerId"));
  class Current {
   String deviceSlot;JSONObject device;
   final long deadline=System.nanoTime()+java.util.concurrent.TimeUnit.SECONDS.toNanos(12);
   void check()throws Exception{
    if(System.nanoTime()>=deadline||session.getLong("expiresAt")<=System.currentTimeMillis()+30000
       ||!session.toString().equals(ports.ownerSession().toString())
       ||!provider.toString().equals(ports.provider().toString()))throw new SecurityException("Native owner binding changed");
    if(device!=null){
     String raw=ports.device(deviceSlot);if(raw==null)throw new SecurityException("Native enrollment missing");
     JSONObject current=new JSONObject(raw);
     for(String field:new String[]{"installationId","enrollmentId","key"})if(!device.getString(field).equals(current.getString(field)))throw new SecurityException("Native enrollment changed");
    }
   }
   JSONObject get(String path,JSONObject headers)throws Exception{
    check();JSONObject response;
    try{response=ports.exchange(new JSONObject(session.toString()),path,headers);}catch(Exception failure){NativeNotificationDiagnostics.ownerRead(path,0);throw failure;}
    check();
    if(response.getInt("status")!=200){NativeNotificationDiagnostics.ownerRead(path,response.getInt("status"));throw new SecurityException("Native owner context unavailable");}
    String body=response.getString("body");if(body.length()>65536)throw new SecurityException("Native owner response too large");return new JSONObject(body);
   }
   void owner()throws Exception{
    JSONObject me=get("/api/auth/me",null),identity=me.getJSONObject("identity"),access=me.getJSONObject("access"),machine=me.getJSONObject("session");
    if(!subject.equals(identity.getString("id"))||!"owner".equals(identity.getString("kind"))
       ||!"OWNER".equals(access.getString("role"))||!"session".equals(access.getString("mode"))
       ||!"machine".equals(machine.getString("kind"))||!session.getString("token").equals(machine.getString("id"))
       ||machine.getLong("expiresAt")!=session.getLong("expiresAt"))throw new SecurityException("Native owner session unavailable");
   }
  }
  Current current=new Current();current.owner();
  JSONArray agents=current.get("/api/agents",null).getJSONArray("agents");
  if(agents.length()!=1||!"running".equals(agents.getJSONObject(0).getString("status")))throw new SecurityException("Native agent unavailable");
  String agent=HostedInbox.id(agents.getJSONObject(0).getString("id"));
  current.deviceSlot=deviceSlot(subject,agent);
  String raw=ports.device(current.deviceSlot);if(raw==null)throw new SecurityException("Native device enrollment unavailable");
  current.device=new JSONObject(raw);String installation=current.device.getString("installationId"),enrollment=current.device.getString("enrollmentId"),key=current.device.getString("key");
  if(!installation.matches("[a-f0-9-]{36}")||!key.matches("[a-f0-9]{64}"))throw new SecurityException("Native device enrollment unavailable");
  HostedInbox.id(enrollment);current.check();
  JSONObject device=current.get("/api/client-devices/context",new JSONObject().put("X-Eliza-Device-Id",installation).put("X-Eliza-Device-Key",key));
  for(String field:new String[]{"subjectUserId","agentId","installationId","enrollmentId"}){
   String expected=field.equals("subjectUserId")?subject:field.equals("agentId")?agent:field.equals("installationId")?installation:enrollment;
   if(!expected.equals(device.getString(field)))throw new SecurityException("Native enrolled device changed");
  }
  current.owner();current.check();
  String account=provider.getString("accountRef");if("native-local".equals(account))account+=":"+subject;
  return new JSONObject().put("protocol",1).put("subjectUserId",subject).put("agentId",agent).put("installationId",installation).put("enrollmentId",enrollment)
   .put("accountRef",account).put("environment",provider.getString("environment")).put("sessionGeneration",provider.getString("sessionGeneration"));
 }
}
