package ai.elizaresearch.alphaphone;

import android.content.Context;
import java.util.*;
import org.json.*;

/** Application lifetime owner. No Activity/bridge retained. */
final class HostedDelivery {
 static final String ACTIVE="hosted-background:v1:active";
 private static HostedDelivery instance;
 static synchronized HostedDelivery get(Context context){if(instance==null)instance=new HostedDelivery(context);return instance;}
 final Object gate=new Object();private final java.util.concurrent.locks.ReentrantLock operation=new java.util.concurrent.locks.ReentrantLock();
 final HostedInbox.Store store;final HostedResultNotices notices;private final HostedInbox inbox;private final Context context;
 private volatile HostedInbox.DeliveryTransport transport;
 private HostedDelivery(Context context){this.context=context.getApplicationContext();AlphaCredentialStore storage=new AlphaCredentialStore(this.context);store=new HostedInbox.Store(){public String read(String key)throws Exception{try{return storage.readCredentialSlot(key);}catch(Exception e){throw new HostedStorageFault(e);}}public void write(String key,String value)throws Exception{try{storage.writeCredentialSlot(key,value);}catch(Exception e){throw new HostedStorageFault(e);}}public void remove(String key)throws Exception{try{storage.removeCredentialSlot(key);}catch(Exception e){throw new HostedStorageFault(e);}}};notices=new HostedResultNotices(new HostedResultNotices.Storage(){public String read(String key)throws Exception{return store.read(key);}public void write(String key,String value)throws Exception{store.write(key,value);}},new HostedNoticePoster(this.context));inbox=new HostedInbox(store,gate,notices);}
 private HostedInbox.DeliveryTransport openTransport(JSONObject binding,HostedTransport.Guard guard)throws Exception {
  if(!"resident".equals(binding.getString("mode")))return new HostedTransport(store,binding,guard);
  return ResidentResultSession.open(store,binding,new ResidentResultSession.Runtime(){
   public String rootToken(){return ElizaAgentService.localAgentToken();}
   public JSONObject exchange(JSONObject request)throws Exception{return new JSONObject(ElizaAgentService.requestLocalAgent(request.toString()));}
  },guard::check);
 }
 interface NativeSourceWork {JSONObject run(JSONObject binding,NativeDigestSources.Guard guard)throws Exception;}
 JSONObject nativeSource(String expectedSession,NativeSourceWork work)throws Exception {
  JSONObject b; synchronized(gate){b=active();if(!"resident".equals(b.optString("mode"))||!b.optBoolean("enabled")||expectedSession!=null&&!expectedSession.equals(b.optString("sessionId")))throw new SecurityException("Native source connection unavailable");}
  String generation=b.getString("generation");
  try(HostedInbox.DeliveryTransport t=openTransport(b,()->check(generation))){
   t.verify();JSONObject device=new JSONObject(store.read(b.getString("deviceSlot")));
   JSONObject binding=new JSONObject().put("ownerId",b.getString("ownerId")).put("agentId",b.getString("agentId")).put("installationId",device.getString("installationId")).put("enrollmentId",device.getString("enrollmentId"));
   NativeDigestSources.Guard guard=()->{check(generation);t.check();};guard.check();JSONObject result=work.run(binding,guard);guard.check();return result;
  }
 }
 private JSONObject active()throws Exception {String raw=store.read(ACTIVE);return raw==null?new JSONObject():new JSONObject(raw);}
 void check(String generation)throws Exception {synchronized(gate){JSONObject a=active();if(!generation.equals(a.optString("generation"))||!a.optBoolean("enabled"))throw new HostedDeliveryCancelled();}}
 private String reserve(String attemptId)throws Exception {String generation=UUID.randomUUID().toString();synchronized(gate){store.write(ACTIVE,new JSONObject().put("generation",generation).put("enabled",false).put("status","paused").put("attemptId",attemptId).toString());HostedInbox.DeliveryTransport t=transport;if(t!=null)t.close();store.remove("resident-results:v1:credential");}HostedDeliveryWorker.cancel(context);return generation;}
 void disable()throws Exception {reserve("");}
 void disableSession(String sessionId)throws Exception {synchronized(gate){if(sessionId==null||sessionId.equals(active().optString("sessionId")))reserve("");}}
 void begin(String attemptId)throws Exception {if(attemptId==null||!attemptId.matches("[a-f0-9-]{36}"))throw new IllegalArgumentException("Invalid attempt");reserve(attemptId);}
 void cancel(String attemptId)throws Exception {synchronized(gate){if(attemptId!=null&&attemptId.equals(active().optString("attemptId")))reserve("");}}
 JSONObject configure(JSONObject requested)throws Exception {
  String attemptId=requested.getString("attemptId"),reserved;synchronized(gate){JSONObject current=active();if(!attemptId.equals(current.optString("attemptId")))throw new HostedDeliveryCancelled();reserved=current.getString("generation");} String mode=requested.getString("mode"),origin=requested.getString("origin"),owner=HostedInbox.id(requested.getString("ownerId")),agent=HostedInbox.id(requested.getString("agentId"));if(!Arrays.asList("cloud","remote","local","resident").contains(mode))throw new SecurityException("Invalid delivery mode");if(mode.equals("resident")){if(!origin.equals("https://device.alpha.invalid"))throw new SecurityException("Invalid resident origin");}else HostedTransport.origin(origin,mode.equals("local"));
  String scope=HostedResultNotices.hash(new JSONArray().put(origin).put(owner).put(agent).toString());JSONObject b=new JSONObject().put("version",1).put("mode",mode).put("origin",origin).put("ownerId",owner).put("agentId",agent).put("scope",scope).put("sessionId",requested.getString("sessionId")).put("generation",reserved).put("attemptId",attemptId).put("enabled",true).put("status","verifying").put("polling",pollingPreference());
  String deviceSlot=NativeDeviceEnrollmentKey.local(origin,owner,agent),credentialSlot="remote:"+origin;
  if(mode.equals("cloud")){for(String field:new String[]{"environment","credentialId","userId","organizationId"})b.put(field,requested.getString(field));String env=b.getString("environment");if(!env.equals("production")&&!env.equals("staging"))throw new SecurityException("Invalid environment");deviceSlot=NativeDeviceEnrollmentKey.cloud(origin,b.getString("userId"),agent);credentialSlot="cloud:"+env;}
  if(mode.equals("resident")){
   JSONObject credential=AlphaLocalAgentPlugin.captureResultSession(owner);
   credentialSlot="resident-results:v1:credential";
   synchronized(gate){if(!reserved.equals(active().optString("generation")))throw new HostedDeliveryCancelled();store.write(credentialSlot,credential.toString());}
  }
  String auth=store.read(credentialSlot),device=store.read(deviceSlot);if(auth==null||device==null)throw new SecurityException("Reconnect required");JSONObject d=new JSONObject(device);if(!d.getString("key").matches("[a-f0-9]{64}")||!d.getString("installationId").matches("[a-f0-9-]{36}"))throw new SecurityException("Invalid device binding");HostedInbox.id(d.getString("enrollmentId"));b.put("credentialSlot",credentialSlot).put("credentialDigest",HostedResultNotices.hash(auth)).put("deviceSlot",deviceSlot).put("deviceDigest",HostedResultNotices.hash(d.toString()));
  synchronized(gate){if(!reserved.equals(active().optString("generation")))throw new SecurityException("Binding cancelled");store.write(ACTIVE,b.toString());}
  String generation=b.getString("generation");try(HostedInbox.DeliveryTransport t=openTransport(b,()->check(generation))){t.verify();synchronized(gate){check(generation);b.put("status","waiting");store.write(ACTIVE,b.toString());}synchronized(gate){check(generation);if(b.optBoolean("polling"))HostedDeliveryWorker.schedule(context,generation,"resident".equals(b.optString("mode")));}return new JSONObject().put("generation",generation).put("scope",scope);}catch(Exception failure){mark(generation,"reconnect-required");throw failure;}
 }
 private void mark(String generation,String status)throws Exception {synchronized(gate){JSONObject b=active();if(generation.equals(b.optString("generation"))){b.put("status",status);if(status.equals("reconnect-required")||status.equals("storage-error"))b.put("enabled",false);store.write(ACTIVE,b.toString());}}}
 JSONArray sync(String generation)throws Exception{return sync(generation,false);}
 JSONArray syncBackground(String generation)throws Exception{return sync(generation,true);}
 private void checkRun(String generation,boolean background)throws Exception {if(background)checkBackground(generation);else check(generation);}
 private JSONArray sync(String generation,boolean background)throws Exception {if(!operation.tryLock())throw new java.io.IOException("Delivery already active");try{JSONObject b;synchronized(gate){checkRun(generation,background);b=active();}try(HostedInbox.DeliveryTransport t=openTransport(b,()->checkRun(generation,background))){transport=t;t.verify();JSONArray results=inbox.sync(b,t,()->checkRun(generation,background));synchronized(gate){check(generation);b=active();b.put("status","current").put("lastSuccess",System.currentTimeMillis());store.write(ACTIVE,b.toString());}return results;}catch(HostedDeliveryCancelled cancelled){throw cancelled;}catch(SecurityException revoked){mark(generation,"reconnect-required");throw revoked;}catch(HostedStorageFault failure){mark(generation,"storage-error");throw failure;}catch(Exception failure){mark(generation,"retry");throw failure;}finally{transport=null;}}finally{operation.unlock();}}
 void stop(String generation){synchronized(gate){try{if(generation.equals(active().optString("generation"))&&transport!=null)transport.close();}catch(Exception ignored){if(transport!=null)transport.close();}}}
 JSONArray history(String session)throws Exception {synchronized(gate){JSONObject b=active();if(!session.equals(b.optString("sessionId")))throw new SecurityException("Account changed");return inbox.history("hosted-digests:v1:"+b.getString("scope"));}}
 private boolean pollingPreference()throws Exception{String raw=store.read("hosted-background:v1:preference");return raw==null||new JSONObject(raw).getBoolean("enabled");}
 void polling(boolean enabled)throws Exception{synchronized(gate){JSONObject b=active();store.write("hosted-background:v1:preference",new JSONObject().put("enabled",enabled).toString());b.put("polling",enabled);store.write(ACTIVE,b.toString());if(!enabled){if(transport!=null)transport.close();HostedDeliveryWorker.cancel(context);}else if(b.optBoolean("enabled"))HostedDeliveryWorker.schedule(context,b.getString("generation"),"resident".equals(b.optString("mode")));}}
 void checkBackground(String generation)throws Exception{synchronized(gate){check(generation);if(!active().optBoolean("polling"))throw new HostedDeliveryCancelled();}}
 JSONObject status()throws Exception {synchronized(gate){JSONObject b=active();JSONObject out=new JSONObject().put("backgroundEnabled",b.optBoolean("enabled")&&b.optBoolean("polling")).put("backgroundStatus",b.optBoolean("polling")?b.optString("status","paused"):"paused");if(b.has("lastSuccess"))out.put("lastSuccess",b.getLong("lastSuccess"));return out;}}
 String generation(String session)throws Exception{synchronized(gate){JSONObject b=active();if(!session.equals(b.optString("sessionId")))throw new SecurityException("Account changed");return b.getString("generation");}}
}
