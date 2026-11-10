package ai.elizaresearch.alphaphone;

import org.json.JSONObject;

/** Matches JSON.stringify for string-only device-enrollment tuples, not native inbox keys. */
final class NativeDeviceEnrollmentKey {
 private NativeDeviceEnrollmentKey(){}
 static String local(String origin,String owner,String agent)throws Exception{
  return "device:"+digest(origin,HostedInbox.id(owner),HostedInbox.id(agent));
 }
 static String cloud(String origin,String user,String agent)throws Exception{
  return "device:"+digest("cloud",origin,HostedInbox.id(user),HostedInbox.id(agent));
 }
 private static String digest(String... fields)throws Exception{
  StringBuilder value=new StringBuilder("[");
  for(int i=0;i<fields.length;i++){
   if(fields[i]==null)throw new SecurityException("Missing device key field");
   if(i>0)value.append(',');
   // Android alone escapes solidus. Keep all quote/backslash/control escaping.
   value.append(JSONObject.quote(fields[i]).replace("\\/","/"));
  }
  return HostedResultNotices.hash(value.append(']').toString());
 }
}
