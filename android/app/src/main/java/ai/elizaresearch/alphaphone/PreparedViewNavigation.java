package ai.elizaresearch.alphaphone;

import org.json.JSONObject;

/** Narrow preparation route; the existing bridge still requires its current owner. */
final class PreparedViewNavigation {
 private static boolean identifier(Object value,String pattern) {
  return value instanceof String&&((String)value).chars().allMatch(c->c>=0x21&&c<=0x7e)&&((String)value).matches(pattern);
 }
 static boolean allowed(String path,String method,String body) {
  if(!"POST".equals(method)||path==null||path.chars().anyMatch(c->c<=0x20||c==0x7f||c==0x2028||c==0x2029||c=='%'||c=='?'||c=='#'||c=='\\')||!path.matches("^/api/views/[A-Za-z0-9_-]+/navigate$")||body==null||body.length()>4096)return false;
  try {
   JSONObject value=new JSONObject(body);
   if(value.length()!=5)return false;
   for(String key:new String[]{"clientId","delivery","prepareOnly","viewType","completedActionHandoffId"})if(!value.has(key))return false;
   return "completed-action".equals(value.opt("delivery"))&&Boolean.TRUE.equals(value.opt("prepareOnly"))&&"gui".equals(value.opt("viewType"))&&
    identifier(value.opt("clientId"),"[A-Za-z0-9._-]{1,128}")&&
    identifier(value.opt("completedActionHandoffId"),"[A-Za-z0-9._:-]{1,128}");
  }catch(Exception invalid){return false;}
 }
}
