package ai.elizaresearch.alphaphone;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/** Google Calendar sync writes need the native consent recorded by CalendarSyncBridge.
 * The renderer cannot write that slot, so a renderer fault cannot write Google without it.
 * Pure (org.json only) so it is tested without Android. */
final class CalendarSyncConsent {
 private CalendarSyncConsent() {}
 static final String EVENT_PATH="/api/v1/eliza/google/calendar/sync-v1/event";
 /** True when the request is a sync write (create, edit or delete of a Google event). */
 static boolean write(String path,String method){
  return EVENT_PATH.equals(path)&&("POST".equals(method)||"PATCH".equals(method)||"DELETE".equals(method));
 }
 /** Non-writes pass. A write passes only while sync is enabled for exactly this grant, account and calendar. */
 static boolean admits(String path,String query,String method,String body,String saved){
  if(!write(path,method))return true;
  try{
   if(saved==null)return false;
   JSONObject data=new JSONObject(saved);
   if(data.optInt("version")!=1||!Boolean.TRUE.equals(data.opt("enabled")))return false;
   JSONObject binding=data.optJSONObject("binding");if(binding==null)return false;
   JSONObject target="DELETE".equals(method)?query(query):new JSONObject(body==null?"":body);
   return same(target,"grantId",binding,"connectionId")&&same(target,"calendarId",binding,"calendarId")&&same(target,"accountId",binding,"providerAccountId");
  }catch(Exception invalid){return false;}
 }
 private static boolean same(JSONObject target,String key,JSONObject binding,String bound){
  Object value=target.opt(key),expected=binding.opt(bound);
  return value instanceof String&&expected instanceof String&&!((String)value).isEmpty()&&value.equals(expected);
 }
 private static JSONObject query(String raw)throws Exception{
  JSONObject out=new JSONObject();if(raw==null)return out;
  for(String part:raw.split("&")){
   int split=part.indexOf('=');if(split<=0)continue;
   String key=URLDecoder.decode(part.substring(0,split),StandardCharsets.UTF_8.name()),value=URLDecoder.decode(part.substring(split+1),StandardCharsets.UTF_8.name());
   if(out.has(key))throw new IllegalArgumentException("Repeated Calendar sync parameter");
   out.put(key,value);
  }
  return out;
 }
}
