package ai.alphacompute.alphaphone;

/** Plain-JVM checks of the renderer transport route policy. Not an Android or device test. */
public final class ConnectionRoutesTest {
 private static void check(boolean condition,String name){if(!condition)throw new AssertionError(name);}
 private static boolean revoke(String scheme,String host,int port,String path,String query,String method,boolean body){
  return ConnectionRoutes.cloudSelfRevocation(scheme,host,port,path,query,method,body);
 }
 public static void main(String[] args){
  // Production builds never send a pairing code, whatever the spelling of the route.
  for(String path:new String[]{"/api/auth/pair","/api/auth/pair/","//api//auth/pair","/api/auth/pair//"})check(ConnectionRoutes.retiredPairing(path),"flag-off refuses "+path);
  // Session checks, pair-code display and unrelated routes are not the pairing mutation.
  for(String path:new String[]{"/api/auth/me","/api/auth/pair-code","/api/auth/status","/api/auth/logout","/api/auth/pairing","/api/v1/user","/",null})check(!ConnectionRoutes.retiredPairing(path),"flag-off keeps "+path);
  // #406: product builds declare nothing to a hosted or paired agent runtime over this transport.
  for(String name:new String[]{"accept","content-type","authorization"})check(ConnectionRoutes.admittedHeader(name),"flag-off admits "+name);
  for(String name:new String[]{"x-eliza-device-id","x-eliza-device-key","x-eliza-device-capabilities","x-eliza-phone-protocol"})check(!ConnectionRoutes.admittedHeader(name),"flag-off refuses "+name);
  for(String name:new String[]{"cookie","x-eliza-agent-id","Authorization","X-Eliza-Phone-Protocol","",null})check(!ConnectionRoutes.admittedHeader(name),"header "+name);

  for(String path:new String[]{"geocode","reverse","places/search","places/details","routes"})check(ConnectionRoutes.mapsRequestIdentity("idempotency-key","request_1","/api/v1/maps/"+path,"POST"),"Maps request identity "+path);
  for(String path:new String[]{"/api/v1/subscription/redeem","/api/v1/maps/capabilities","/api/v1/maps/routes/","//api/v1/maps/routes",null})check(!ConnectionRoutes.mapsRequestIdentity("idempotency-key","request_1",path,"POST"),"identity route refused "+path);
  for(String value:new String[]{"","bad id","query=location","line\r\nbreak",null,"x".repeat(129)})check(!ConnectionRoutes.mapsRequestIdentity("idempotency-key",value,"/api/v1/maps/routes","POST"),"invalid Maps identity");
  check(!ConnectionRoutes.mapsRequestIdentity("idempotency-key","request_1","/api/v1/maps/routes","GET"),"read does not carry request identity");
  check(!ConnectionRoutes.mapsRequestIdentity("authorization","request_1","/api/v1/maps/routes","POST"),"identity rule cannot admit credentials");
  check(revoke("https","api.eliza.app",-1,"/api/v1/api-keys/current",null,"DELETE",false),"production self-revocation");
  check(revoke("https","api.eliza.app",443,"/api/v1/api-keys/current",null,"DELETE",false),"explicit default port");
  check(!revoke("https","api-staging.eliza.app",-1,"/api/v1/api-keys/current",null,"DELETE",false),"staging refused");
  // DELETE is admitted for this one credential route only.
  check(!revoke("https","api.eliza.app",-1,"/api/v1/api-keys/current",null,"DELETE",true),"no body");
  check(!revoke("https","api.eliza.app",-1,"/api/v1/api-keys/current","all=1","DELETE",false),"no query");
  check(!revoke("https","api.eliza.app",-1,"/api/v1/api-keys/current","","DELETE",false),"no empty query");
  check(!revoke("http","api.eliza.app",-1,"/api/v1/api-keys/current",null,"DELETE",false),"HTTPS only");
  check(!revoke("https","api.eliza.app",8443,"/api/v1/api-keys/current",null,"DELETE",false),"default port only");
  for(String host:new String[]{"agent.example.test","api.eliza.app.example.test","evil-api.eliza.app","cloud.eliza.app","API.ELIZA.APP",null})check(!revoke("https",host,-1,"/api/v1/api-keys/current",null,"DELETE",false),"host "+host);
  for(String path:new String[]{"/api/v1/api-keys","/api/v1/api-keys/","/api/v1/api-keys/current/","/api/v1/api-keys/other","/api/v1/api-keys/%63urrent","/api/v1/api-keys/current/../other","/api/v1/user","/api/conversations/1",null})check(!revoke("https","api.eliza.app",-1,path,null,"DELETE",false),"path "+path);
  for(String method:new String[]{"GET","POST","PUT","PATCH","delete",null})check(!revoke("https","api.eliza.app",-1,"/api/v1/api-keys/current",null,method,false),"method "+method);
  // Flag-off builds contact only the fixed Cloud authority; a remote agent origin is refused from the URL alone.
  String agent="0f8fad5b-d9cb-469f-a165-70867728950e";
  for(String host:new String[]{"api.eliza.app"}){
   check(ConnectionRoutes.admittedOrigin("https",host,-1),"flag-off admits "+host);
   check(ConnectionRoutes.admittedOrigin("https",host,443),"flag-off admits the explicit default port of "+host);
   check(!ConnectionRoutes.admittedOrigin("http",host,-1),"flag-off HTTPS only for "+host);
   check(!ConnectionRoutes.admittedOrigin("https",host,8443),"flag-off default port only for "+host);
   check(!ConnectionRoutes.admittedOrigin(null,host,-1),"flag-off needs a scheme for "+host);
  }
  for(String host:new String[]{
   // A paired remote or development agent, and other public hosts.
   // Production Android connects no Cloud agent, so a dedicated agent runtime host is refused like any other.
   agent+".cloud.eliza.app",agent+".api.eliza.app","api.eliza.app:443","api.eliza.app@evil.example","evil.example#api.eliza.app","xn--pi-7ka.eliza.app","[2606:4700::1]",
   "agent.example.test","my-agent.example","192.168.1.20","10.0.2.2","127.0.0.1","localhost","[::1]","example.com",
   // The staging authority.
   "api-staging.eliza.app",agent+".cloud-staging.eliza.app",
   // Lookalikes, other Eliza hosts and spellings the renderer never produces.
   "eliza.app","www.eliza.app","cloud.eliza.app","evil.cloud.eliza.app","evil-api.eliza.app","xapi.eliza.app","api.eliza.app.example.test","api.eliza.app.",
   "API.ELIZA.APP","api.eliza.app\n","api.eliza.app\u200b","api.eliza.app%00","sub.api.eliza.app",
   agent+".cloud.eliza.app.example.test",agent+".cloud.eliza.app.",agent.toUpperCase(java.util.Locale.ROOT)+".cloud.eliza.app","x"+agent+".cloud.eliza.app",
   agent+".evil.cloud.eliza.app","a."+agent+".cloud.eliza.app",agent+"xcloud.eliza.app",agent+".cloud.eliza.app\n","0f8fad5b-d9cb-069f-a165-70867728950e.cloud.eliza.app",
   "0f8fad5bd9cb469fa16570867728950e.cloud.eliza.app","",null})
   check(!ConnectionRoutes.admittedOrigin("https",host,-1),"flag-off refuses "+host);
  check(!ConnectionRoutes.admittedOrigin("https",agent+".cloud.eliza.app",443),"flag-off refuses the agent runtime on its explicit port");
  // What java.net.URI hands the guard for spellings that try to smuggle another authority.
  for(String text:new String[]{"https://api.eliza.app@evil.example/api/v1/user","https://api.eliza.app:443@evil.example/","https://api.eliza.app.evil.example/","https://API.ELIZA.APP/","https://api.eliza.app./",
   "https://api.eliza.app%2eevil.example/","https://[::1]/","https://api.eliza.app:8443/","http://api.eliza.app/","https://evil.example/?https://api.eliza.app/","https://evil.example/api.eliza.app","https://api\u3002eliza\u3002app/"}){
   java.net.URI url;try{url=new java.net.URI(text);}catch(java.net.URISyntaxException error){continue;}
   check(!ConnectionRoutes.admittedOrigin(url.getScheme(),url.getHost(),url.getPort()),"flag-off refuses "+text);
  }
  java.net.URI plain=java.net.URI.create("https://api.eliza.app/api/v1/user?x=1");
  check(ConnectionRoutes.admittedOrigin(plain.getScheme(),plain.getHost(),plain.getPort()),"flag-off admits the parsed Cloud API URL");

  // openExternal: a flag-off build opens Cloud sign-in, top-up and account management, and Google consent only.
  for(String text:new String[]{"https://eliza.app/auth/cli-login?session=abc","https://cloud.eliza.app/cloud/billing","https://accounts.google.com/o/oauth2/v2/auth?client_id=x","https://ELIZA.APP/auth/cli-login","https://cloud.eliza.app:443/cloud/billing"}){
   java.net.URI url=java.net.URI.create(text);
   check(ConnectionRoutes.externalHost(url.getScheme(),url.getHost(),url.getPort()),"flag-off opens "+text);
  }
  for(String host:new String[]{"staging.eliza.app","cloud-staging.eliza.app","www.eliza.app","api.eliza.app","evil.eliza.app",agent+".cloud.eliza.app","a.b.eliza.app",
   "eliza.app.","cloud.eliza.app.","eliza.app.evil.example","evil-eliza.app","xeliza.app","accounts.google.com.evil.example","mail.google.com","google.com","example.com","",null})
   check(!ConnectionRoutes.externalHost("https",host,-1),"flag-off refuses to open "+host);
  check(!ConnectionRoutes.externalHost("http","eliza.app",-1),"openExternal is HTTPS only");
  check(!ConnectionRoutes.externalHost("https","eliza.app",8443),"openExternal uses the default port only");
  check(!ConnectionRoutes.externalHost(null,"eliza.app",-1),"openExternal needs a scheme");
  check(ConnectionRoutes.externalCliLogin("eliza.app","/auth/cli-login"),"production sign-in is a browser handoff");
  check(!ConnectionRoutes.externalCliLogin("staging.eliza.app","/auth/cli-login"),"staging sign-in refused");
  check(!ConnectionRoutes.externalCliLogin("cloud.eliza.app","/auth/cli-login"),"only the web authority hosts sign-in");
  check(!ConnectionRoutes.externalCliLogin("eliza.app","/auth/cli-login/")&&!ConnectionRoutes.externalCliLogin("eliza.app","/cloud/billing")&&!ConnectionRoutes.externalCliLogin(null,"/auth/cli-login"),"exact sign-in path only");
  for(String route:new String[]{"/api/v1/eliza/agents","/api/v1/eliza/agents/id/api/conversations","/api/auth/pair","/api/conversations","/api/v1/eliza/personal","/api/v1/eliza/google/../agents","/api/v1/%65liza/google/status","/api/v1/eliza/google/status/","/api/v1/eliza/google//status"})for(String method:new String[]{"GET","POST"})check(!ConnectionRoutes.managedService(route,null,method,false),"hosted/unreviewed path refused "+route);
  check(ConnectionRoutes.managedService("/api/v1/user",null,"GET",false),"owner identity allowed");
  for(String path:new String[]{"/api/v1/eliza/google/calendar/calendars","/api/v1/eliza/google/calendar/feed"}){
   check(ConnectionRoutes.managedService(path,"grantId=owned","GET",false),"owner Google Calendar read allowed");
   for(String method:new String[]{"POST","DELETE","PUT","PATCH"})check(!ConnectionRoutes.managedService(path,null,method,true),"Google Calendar mutation refused");
   check(!ConnectionRoutes.managedService(path,null,"GET",true),"Google Calendar GET body refused");
   check(!ConnectionRoutes.managedService(path+"/",null,"GET",false),"Google Calendar trailing slash refused");
  }
  String sync="/api/v1/eliza/google/calendar/sync-v1/event";
  for(String method:new String[]{"POST","PATCH"}){
   check(ConnectionRoutes.managedService(sync,null,method,true),"versioned sync write allowed");
   check(!ConnectionRoutes.managedService(sync,"grantId=owned",method,true),"sync writes forbid query");
   check(!ConnectionRoutes.managedService(sync,null,method,false),"sync writes need body");
  }
  for(String method:new String[]{"GET","DELETE"}){
   check(ConnectionRoutes.managedService(sync,"grantId=owned",method,false),"versioned sync query allowed");
   check(!ConnectionRoutes.managedService(sync,null,method,false),"sync needs query");
   check(!ConnectionRoutes.managedService(sync,"grantId=owned",method,true),"sync query forbids body");
  }
  check(!ConnectionRoutes.managedService(sync+"/",null,"PATCH",true),"sync slash refused");
  check(!ConnectionRoutes.managedService(sync,null,"PUT",true),"sync PUT refused");
  check(!ConnectionRoutes.managedService("/api/v1/eliza/google/calendar/events",null,"GET",false),"unreviewed Google Calendar route refused");
  // Subscription plan gate (#410): code redemption is one POST with a body; the billing snapshot is read-only; credits are retired.
  check(ConnectionRoutes.managedService("/api/v1/subscription/redeem",null,"POST",true),"subscription code redemption allowed");
  check(!ConnectionRoutes.managedService("/api/v1/subscription/redeem",null,"POST",false),"redemption needs a body");
  check(!ConnectionRoutes.managedService("/api/v1/subscription/redeem","code=x","POST",true),"redemption never carries a query");
  check(!ConnectionRoutes.managedService("/api/v1/subscription/redeem",null,"GET",false),"redemption is POST only");
  check(!ConnectionRoutes.managedService("/api/v1/subscription/redeem/",null,"POST",true)&&!ConnectionRoutes.managedService("/api/v1/subscription/redeem/x",null,"POST",true),"neighbouring redemption paths refused");
  check(ConnectionRoutes.managedService("/api/v1/billing/limits",null,"GET",false),"billing snapshot read allowed");
  check(!ConnectionRoutes.managedService("/api/v1/billing/limits",null,"POST",true),"billing snapshot write refused");
  check(!ConnectionRoutes.managedService("/api/v1/credits/balance",null,"GET",false),"credit balance retired");
  // The Cloud sign-in hand-off is refused; sign-in is the native host.
  check(!ConnectionRoutes.managedService("/api/auth/cli-session",null,"POST",true),"sign-in hand-off create refused flag-off");
  check(!ConnectionRoutes.managedService("/api/auth/cli-session/b7a2c1d0-5e4f-4a3b-8c2d-1e0f9a8b7c6d",null,"GET",false),"sign-in hand-off poll refused flag-off");
  // Reset Alpha data revokes only the presented key through the shared CloudKeyRevocation (tested with
  // the sign-in library upstream); this transport admits the same self-revocation DELETE checked above.
  check(ConnectionRoutes.managedService("/api/v1/subscription/entitlement",null,"GET",false)&&ConnectionRoutes.managedService("/api/v1/subscription/entitlement-keys",null,"GET",false),"subscription entitlement reads allowed");
  check(!ConnectionRoutes.managedService("/api/v1/subscription/entitlement",null,"POST",true)&&!ConnectionRoutes.managedService("/api/v1/subscription/checkout",null,"GET",false),"subscription writes and other subscription paths refused");
  check(ConnectionRoutes.managedService("/api/v1/eliza/google/gmail/inbox-v1/thread","grantId=owned", "GET",false),"owner Gmail route allowed");
  check(ConnectionRoutes.managedService("/api/v1/eliza/google/gmail/inbox-v1/operations/owned-id/dispatch",null,"POST",true),"reviewed Gmail dispatch allowed");
  check(!ConnectionRoutes.managedService("/api/v1/user",null,"POST",true),"identity write refused");
  check(!ConnectionRoutes.managedService("/api/v1/user",null,"GET",true),"GET body refused");
  // Eliza Cloud Maps (#412): exact routes; location only in a POST body, capabilities a bare GET.
  check(ConnectionRoutes.managedService("/api/v1/maps/capabilities",null,"GET",false),"Maps capabilities read allowed");
  for(String route:new String[]{"geocode","reverse","places/search","places/details","routes"}){
   String path="/api/v1/maps/"+route;
   check(ConnectionRoutes.managedService(path,null,"POST",true),"Maps "+route+" allowed");
   check(!ConnectionRoutes.managedService(path,null,"POST",false),"Maps "+route+" needs a body");
   check(!ConnectionRoutes.managedService(path,"lat=1","POST",true),"Maps "+route+" never carries a query");
   check(!ConnectionRoutes.managedService(path,"q=x","GET",false),"Maps "+route+" is POST only");
   check(!ConnectionRoutes.managedService(path+"/",null,"POST",true),"Maps "+route+" trailing slash refused");
  }
  check(!ConnectionRoutes.managedService("/api/v1/maps/capabilities","region=x","GET",false),"Maps capabilities query refused");
  check(!ConnectionRoutes.managedService("/api/v1/maps/capabilities",null,"POST",true),"Maps capabilities write refused");
  for(String path:new String[]{"/api/v1/maps","/api/v1/maps/tiles/1/2/3","/api/v1/maps/places","/api/v1/maps/navigation","/api/v1/maps/%72outes","/api/v1/maps//routes"})for(String method:new String[]{"GET","POST"})check(!ConnectionRoutes.managedService(path,null,method,"POST".equals(method)),"unreviewed Maps path refused "+path);
  // Declared device capabilities are bounded by syntax only; the agent decides which it honors.
  for(String value:new String[]{"camera.capture-photo.v1","calendar.local-event.v1,notes.local-record.v1,camera.capture-photo.v1,calendar.availability-read.v1,sms.send.v1,phone.dial.v1","reminders.local-record.v1, reminders.local-record.v2","clock.handoff.v1,clock.handoff.v2","future.capability.v9"})check(ConnectionRoutes.deviceCapabilities(value),"capabilities admitted "+value);
  for(String value:new String[]{null,"","a,,b","calendar.local-event.v1,","Camera.capture.v1","calendar local","notes;x","x\r\ny","-x","a".repeat(65),String.join(",",java.util.Collections.nCopies(33,"x"))})check(!ConnectionRoutes.deviceCapabilities(value),"capabilities refused "+value);
  System.out.println("PASS connection routes: retired pairing, exact Cloud self-revocation, the flag-off Cloud API origin, managed-service routes (Maps included), device capability syntax and openExternal hosts");
 }
}
