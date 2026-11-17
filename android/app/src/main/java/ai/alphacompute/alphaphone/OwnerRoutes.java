package ai.alphacompute.alphaphone;

import ai.eliza.plugins.agent.connection.OwnerRoutePolicy;

/** Alpha's generated owner-routes.json asset, from the same owner-route table the renderer uses. The interpreter is the shared plugin-native-agent OwnerRoutePolicy. */
final class OwnerRoutes {
 interface Assets extends OwnerRoutePolicy.Assets {}
 static final String ASSET="owner-routes.json";
 private static final OwnerRoutePolicy.Shipped SHIPPED=new OwnerRoutePolicy.Shipped(ASSET);
 private final OwnerRoutePolicy policy;
 private OwnerRoutes(OwnerRoutePolicy policy){this.policy=policy;}
 /** The packaged table, read once per process. A load failure is an IllegalStateException, which callers refuse on; it is not cached. */
 static OwnerRoutes shipped(OwnerRoutePolicy.Assets assets){return new OwnerRoutes(SHIPPED.get(assets));}
 String group(String path,String... among){return policy.group(path,among);}
 boolean allowed(String name,String path,String method){return policy.allowed(name,path,method);}

 /** Local conversation reads remain owner-bound and accept no method or path aliases. */
 private static boolean conversationReadAllowed(String path,String method,String owner){
  return "GET".equals(method)&&owner!=null&&!owner.trim().isEmpty()&&path.length()<=2048&&(
   path.matches("^/api/conversations/messages/search\\?q=(?:[A-Za-z0-9_.*+~-]|%[0-9A-Fa-f]{2})+&limit=50&offset=[0-9]{1,9}$")||
   path.matches("^/api/conversations/[A-Za-z0-9_-]+/messages\\?around=[0-9a-fA-F-]{36}$"));
 }
 /** The existing server chat cap applies only to message submission, never other routes. */
 static int requestBodyLimit(String path,String method){
  return "POST".equals(method)&&path!=null&&path.matches("^/api/conversations/[A-Za-z0-9_-]+/messages(/stream)?$")?20*1024*1024:2*1024*1024;
 }
 /** Whole native request gate. Enrollment and the live owner/epoch check remain with the transport. */
 boolean requestAllowed(String path,String method,String body,String owner){
  if(path==null||method==null)return false;
  String expectedOwner=owner,group=group(path);
  boolean read=group==null&&conversationReadAllowed(path,method,owner);
  return !((!read&&(group!=null? !allowed(group,path,method)||expectedOwner==null||expectedOwner.trim().isEmpty() : ((path.startsWith("/api/views/")||path.endsWith("/messages/truncate")||path.endsWith("/fork")||path.endsWith("/heard"))&&(!method.equals("POST")||expectedOwner==null||expectedOwner.trim().isEmpty()))||(path.equals("/api/asr/local-inference/end-of-turn")&&!method.equals("POST"))||(path.contains("?before=")&&!method.equals("GET"))||(path.startsWith("/api/turns/")&&!method.equals("POST"))||path.contains("..")||path.contains("%")||path.contains("\\")||!path.matches("^/api/(auth/me|agents|status|cloud/warm|conversations(/[A-Za-z0-9_-]+(/fork|/messages(/truncate|/[0-9a-fA-F-]{36}/heard|\\?before=[0-9]{1,16}(&beforeId=[0-9a-fA-F-]{36})?(&limit=[0-9]{1,3})?)?)?)?|turns/[0-9a-fA-F-]{36}/abort|views/(interact-(claim|result)|[A-Za-z0-9_-]+/navigate)|client-devices/[A-Za-z0-9_/-]+|workflow(/[A-Za-z0-9_/?=&-]+)?|asr/local-inference/(live(/status)?|end-of-turn))$")||!(method.equals("GET")||method.equals("POST"))))||((method.equals("GET")||method.equals("DELETE"))&&body!=null)||(body!=null&&body.getBytes(java.nio.charset.StandardCharsets.UTF_8).length>requestBodyLimit(path,method)));
 }
}
