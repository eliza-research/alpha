package ai.alphacompute.alphaphone;

import android.content.Context;
import org.json.*;

/** Source consent and Android data stay with Alpha; the runtime receives only reviewed fields. */
final class NativeDigestHost {
 private static final Object LOCK=new Object();
 private final Context context;
 private final NativeDigestSources sources;
 NativeDigestHost(Context context){this.context=context.getApplicationContext();AlphaCredentialStore store=new AlphaCredentialStore(this.context);sources=new NativeDigestSources(new NativeDigestSources.Storage(){public String read(String key)throws Exception{return store.readCredentialSlot(key);}public void write(String key,String value)throws Exception{store.writeCredentialSlot(key,value);}},LOCK);}
 JSONObject consent(String session,String sourceId,JSONObject scope,long expiresAt,boolean revoke,JSONObject expected,NativeDigestSources.Guard foreground)throws Exception {
  if(session==null||session.isEmpty()||expected==null)throw new SecurityException("Review exact native source binding");
  JSONObject reviewedScope=revoke?null:NativeDigestSources.scope(scope);
  return HostedDelivery.get(context).nativeSource(session,(binding,guard)->{for(String field:new String[]{"ownerId","agentId","installationId","enrollmentId"})if(!binding.getString(field).equals(expected.getString(field)))throw new SecurityException("Native source binding changed");NativeDigestSources.Guard consent=()->{foreground.check();guard.check();if(reviewedScope!=null)ai.eliza.plugins.calendar.read.SelectedCalendarReader.assertSourceIdentities(context.getContentResolver(),reviewedScope.getJSONArray("calendars"));};consent.check();if(revoke){sources.revoke(binding,sourceId,consent);return new JSONObject().put("revoked",true);}return sources.approve(binding,sourceId,reviewedScope,expiresAt,System.currentTimeMillis(),consent);});
 }
 JSONObject read(JSONObject request)throws Exception {
  String action=request.getString("action");java.util.Set<String> allowed=new java.util.HashSet<>(java.util.Arrays.asList("provider","ownerId","agentId","installationId","enrollmentId","sourceId","revision","action"));if("read".equals(action)){allowed.add("occurrence");if(request.has("template"))allowed.add("template");}else if(!"describe".equals(action))throw new SecurityException("Unsupported native source operation");
  if(!"native".equals(request.getString("provider"))||request.length()!=allowed.size())throw new SecurityException("Invalid native source request");for(java.util.Iterator<String> keys=request.keys();keys.hasNext();)if(!allowed.contains(keys.next()))throw new SecurityException("Unexpected native source request field");
  return HostedDelivery.get(context).nativeSource(null,(binding,guard)->{
   for(String field:new String[]{"ownerId","agentId","installationId","enrollmentId"})if(!binding.getString(field).equals(request.getString(field)))throw new NativeDigestSources.SourceChanged("Native source binding changed");
   String id=request.getString("sourceId"),revision=request.getString("revision");long now=System.currentTimeMillis();
   JSONObject grant=sources.current(binding,id,revision,now,guard);NativeDigestSources.Guard sourceGuard=()->{guard.check();ai.eliza.plugins.calendar.read.SelectedCalendarReader.assertSourceIdentities(context.getContentResolver(),grant.getJSONObject("scope").getJSONArray("calendars"));};sourceGuard.check();
   // Source identity verification can block while this exact grant is revoked or expires.
   if("describe".equals(action))return sources.current(binding,id,revision,System.currentTimeMillis(),guard);
   if(!"read".equals(request.getString("action")))throw new SecurityException("Unsupported native source operation");
   long occurrence=java.time.Instant.parse(request.getString("occurrence")).toEpochMilli();
   NativeDigestSources.checkOccurrence(occurrence,now);
   // Only the evening window is named; an absent template keeps the reviewed morning read.
   String template=request.has("template")?request.getString("template"):"morning";if(!"evening".equals(template)&&request.has("template"))throw new SecurityException("Unsupported native digest template");
   return sources.read(binding,id,revision,occurrence,now,template,new NativeDigestSources.Reader(){
    public JSONArray calendar(JSONArray ids,String start,String end,int maximum,String startDate,String endDateExclusive)throws Exception {
     if(androidx.core.content.ContextCompat.checkSelfPermission(context,android.Manifest.permission.READ_CALENDAR)!=android.content.pm.PackageManager.PERMISSION_GRANTED)throw new SecurityException("Calendar permission unavailable");
     JSONArray result=ai.eliza.plugins.calendar.read.SelectedCalendarReader.readOwnerDay(context.getContentResolver(),ids,start,end,maximum,startDate,endDateExclusive);
     if(androidx.core.content.ContextCompat.checkSelfPermission(context,android.Manifest.permission.READ_CALENDAR)!=android.content.pm.PackageManager.PERMISSION_GRANTED)throw new SecurityException("Calendar permission changed");return result;
    }
    public JSONArray reminders()throws Exception{return AlphaReminders.engine(context).list();}
   },sourceGuard);
  });
 }
}
