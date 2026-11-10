package ai.elizaresearch.alphaphone;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.*;
import java.net.URI;
import java.util.concurrent.CopyOnWriteArrayList;
/** Test APK only. Closed synthetic protocol; never opens a network connection. */
@CapacitorPlugin(name="AlphaConnection")
public final class InboxFixtureConnection extends Plugin {
 static final String OWNER=InboxFixtureScope.runId,LOGIN="12345678-1234-4234-8234-123456789def";
 static final CopyOnWriteArrayList<String> routes=new CopyOnWriteArrayList<>();
 static int rejectedWrites;
 private final AlphaConnectionPlugin store=new AlphaConnectionPlugin();
 @Override public void load(){store.setBridge(getBridge());}
 @Override protected void handleOnDestroy(){store.handleOnDestroy();super.handleOnDestroy();}
 @PluginMethod public void secureRead(PluginCall call){store.secureRead(call);}
 @PluginMethod public void secureWrite(PluginCall call){store.secureWrite(call);}
 @PluginMethod public void secureRemove(PluginCall call){store.secureRemove(call);}
 @PluginMethod public void secureCompareExchange(PluginCall call){store.secureCompareExchange(call);}
 @PluginMethod public void cancel(PluginCall call){call.resolve();}
 static String token(){return "synthetic-inbox-only-"+InboxFixtureScope.runId;}
 @PluginMethod public void openExternal(PluginCall call){
  if(("https://eliza.app/auth/cli-login?session="+LOGIN).equals(call.getString("url")))call.resolve();else call.reject("Fixture rejects external navigation");
 }
 @PluginMethod public void request(PluginCall call){
  if("cleanup".equals(InboxFixtureScope.phase)){call.reject("Fixture cleanup closes all transport");return;}
  try{
   URI url=new URI(call.getString("url"));String path=url.getPath(),method=call.getString("method");
   if(!"https".equals(url.getScheme())||!"api.eliza.app".equals(url.getHost())||url.getPort()!=-1||url.getRawUserInfo()!=null||url.getFragment()!=null)throw new IllegalArgumentException();
   boolean login=path.equals("/api/auth/cli-session")||path.equals("/api/auth/cli-session/"+LOGIN);
   if(!login&&!(("Bearer "+token()).equals(call.getObject("headers",new JSObject()).optString("Authorization"))))throw new IllegalArgumentException();
   routes.add(method+" "+path);Object data;
   if(path.equals("/api/auth/cli-session")&&"POST".equals(method))data=new JSONObject().put("sessionId",LOGIN).put("expiresAt",java.time.Instant.now().plusSeconds(3600).toString());
   else if(path.equals("/api/auth/cli-session/"+LOGIN)&&"GET".equals(method))data=new JSONObject().put("status","authenticated").put("token",token());
   else if(!"GET".equals(method)){rejectedWrites++;throw new IllegalArgumentException();}
   else if(path.equals("/api/v1/user"))data=new JSONObject().put("success",true).put("data",new JSONObject().put("id",OWNER));
   else if(path.equals("/api/v1/eliza/agents"))data=new JSONObject().put("success",true).put("data",new JSONArray());
   else if(path.equals("/api/v1/eliza/google/accounts")){JSONArray list=new JSONArray();for(String id:new String[]{"a","b"})list.put(new JSONObject().put("configured",true).put("connected",true).put("reason","fixture").put("connectionId",id).put("grantedCapabilities",new JSONArray().put("google.gmail.triage")).put("identity",new JSONObject().put("name","Fixture "+id)));data=list;}
   else if(path.equals("/api/v1/eliza/google/gmail/search"))data=new JSONObject().put("messages",new JSONArray().put(message())).put("syncedAt","fixture-revision");
   else if(path.equals("/api/v1/eliza/google/gmail/read"))data=new JSONObject().put("message",message()).put("bodyText","Synthetic provider message only");
   else throw new IllegalArgumentException();
   JSObject result=new JSObject();result.put("status",200);result.put("data",data);call.resolve(result);
  }catch(Exception error){call.reject("Synthetic fixture rejects this request");}
 }
 private JSONObject message()throws JSONException{return new JSONObject().put("externalId","fixture-message").put("threadId","fixture-thread").put("subject","Fixture reply").put("from","Synthetic sender").put("fromEmail","sender@example.invalid").put("to",new JSONArray().put("owner@example.invalid")).put("snippet","Synthetic").put("receivedAt","2026-09-30T00:00:00Z").put("isUnread",false);}
}
