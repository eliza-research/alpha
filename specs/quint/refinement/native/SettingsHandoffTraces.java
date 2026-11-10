package ai.alphacompute.alphaphone;

import ai.eliza.plugins.system.SystemSettingsPages;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/** Actual bridge methods and allowlist, with a closed Activity that records only synthetic intents. */
public final class SettingsHandoffTraces {
 final Activity host;
 final Context context;
 final AlphaDevicePlugin plugin=new AlphaDevicePlugin();
 final Trace trace;
 PluginCall pending;
 String command="";
 JSONObject reply=reply("none","","",false);

 SettingsHandoffTraces(String name,boolean launcher,boolean present){
  BuildConfig.IS_LAUNCHER=launcher;
  host=present?new Activity():null;context=host==null?new Context():host;plugin.attach(context,host);
  trace=new Trace(name,observe());trace.value.put("init",Trace.action("initWith",launcher,present));
 }
 static void check(boolean value,String reason){if(!value)throw new AssertionError(reason);}
 static JSONObject reply(String status,String page,String destination,boolean specific){
  return new JSONObject().put("status",status).put("page",page).put("destination",destination).put("specific",specific);
 }
 void classify(PluginCall call){
  if(!call.answered){reply=reply("pending","","",false);return;}
  if(call.error!=null){
   String result=switch(call.error){
    case "Unsupported settings page" -> "unsupported";
    case "This Android settings page is unavailable","Password provider setup could not be opened. No provider change is confirmed." -> "unavailable";
    default -> throw new AssertionError(call.error);
   };
   reply=reply(result,"","",false);return;
  }
  check(call.result.getString("status").equals("opened"),"Only an opened handoff may resolve");
  if(command.equals("provider-settings")){
   check(call.result.keySet().equals(Set.of("status","destination")),"Exact provider handoff reply");
   reply=reply("opened","",call.result.getString("destination"),false);
  }else{
   check(call.result.keySet().equals(Set.of("status","page","specific")),"Exact Settings handoff reply");
   reply=reply("opened",call.result.getString("page"),"",call.result.getBoolean("specific"));
  }
 }
 JSONObject observe(){
  JSONArray attempts=new JSONArray();
  if(host!=null)for(var attempt:host.attempts){
   Intent intent=attempt.intent();
   check(intent.flags==0||intent.flags==Intent.FLAG_ACTIVITY_NEW_TASK,"Exact Activity task flags");
   check(intent.extras.isEmpty()||intent.extras.keySet().equals(Set.of(Settings.EXTRA_APP_PACKAGE)),"Only package binding may cross the Settings handoff");
   attempts.put(new JSONObject().put("target",intent.action).put("data",intent.data==null?"":intent.data.toString())
    .put("packageExtra",intent.extras.getOrDefault(Settings.EXTRA_APP_PACKAGE,"")).put("newTask",intent.flags!=0)
    .put("result",attempt.result()).put("phase",attempt.phase()));
  }
  String provider=context.packages.refuse?"refused":!context.packages.trusted?"untrusted":
   !context.autofillPresent?"absent":!context.autofill.supported?"unsupported":"trusted";
  check(host==null?pending==null:host.ui.size()==(pending==null?0:1),"Exact closed UI queue");
  return Trace.fields("launcher",BuildConfig.IS_LAUNCHER,"phase",host==null?"absent":host.phase,"provider",provider,
   "command",command,"pending",pending!=null,"attempts",attempts,"reply",reply);
 }
 void point(String action,Object... args){trace.step(action,observe(),args);}
 void request(String input){
  command=input;
  if(host!=null)host.attempts.clear();
  JSObject data=new JSObject();
  if(input.equals("provider-settings"))data.put("action","settings");
  else if(input.equals("numeric"))data.put("page",3);
  else if(!input.equals("missing"))data.put("page",input);
  PluginCall call=new PluginCall(data);
  try{
   if(input.equals("provider-settings"))plugin.openPasswordProvider(call);else plugin.openSettings(call);
   classify(call);
   if(!call.answered)pending=call;
  }catch(NullPointerException absent){
   check(host==null&&!call.answered,"Only an explicitly absent host can escape synchronously");
   reply=reply("threw","","",false);
  }
  point("request",input);
 }
 void deliver(String first,String second){
  host.first=first;host.second=second;
  host.ui.removeFirst().run();
  check(pending.answered,"The exact queued handoff settled");
  classify(pending);pending=null;point("deliver",first,second);
 }
 void provider(String mode){
  context.packages.refuse=mode.equals("refused");context.packages.trusted=!mode.equals("untrusted");
  context.autofillPresent=!mode.equals("absent");context.autofill.supported=!mode.equals("unsupported");
  point("provider",mode);
 }
 void phase(String mode){host.phase=mode;point("retire",mode);}
 void open(String name,String first,String second){request(name);deliver(first,second);}
 public static void main(String[] args){
  String name=args[0];
  var f=new SettingsHandoffTraces(name,name.endsWith("-launcher"),!name.equals("absent-host"));
  switch(name){
   case "all-pages-launcher","all-pages-standalone" -> {
    f.open("system","ok","ok");
    for(String page:SystemSettingsPages.PAGES)f.open(page,"ok","ok");
   }
   case "fallback-launcher","fallback-standalone" -> {
    f.open("mobile","missing","ok");f.open("airplane","security","ok");f.open("dnd","missing","ok");
    f.open("mobile","missing","security");f.open("dnd","security","missing");f.open("wifi","missing","ok");
    f.open("system","security","ok");
   }
   case "invalid" -> {f.request("missing");f.request("numeric");f.request("unknown");f.request(" wifi");}
   case "absent-host" -> {f.request("system");f.request("wifi");f.request("provider-settings");f.request("unknown");}
   case "retired-host-launcher" -> {
    f.request("mobile");f.phase("finishing");f.deliver("security","missing");
    f.request("system");f.phase("destroyed");f.deliver("ok","missing");
   }
   case "provider-launcher","provider-standalone" -> {
    f.open("provider-settings","ok","ok");f.open("provider-settings","missing","ok");
    f.open("provider-settings","missing","security");f.open("provider-settings","security","ok");
    for(String mode:new String[]{"untrusted","unsupported","absent","refused"}){
     f.provider(mode);f.open("provider-settings","ok","ok");
    }
   }
   default -> throw new AssertionError(name);
  }
  System.out.println(f.trace.value);
 }
}
