package ai.alphacompute.alphaphone;

import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.os.Build;
import android.view.accessibility.AccessibilityManager;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.util.IdentityHashMap;
import java.util.Map;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/** Actual MainActivity and AlphaDevicePlugin appearance members with a synthetic UI queue. */
public final class TextScaleLifecycleTraces {
 record Pending(int owner,int percent,PluginCall call) {}
 final MainActivity[] activities=new MainActivity[3];
 final AlphaDevicePlugin[] plugins=new AlphaDevicePlugin[3];
 final Map<MainActivity,Pending> admitted=new IdentityHashMap<>();
 final Trace trace;
 int owner,percent,zoom;
 String outcome="none";

 TextScaleLifecycleTraces(String name,int stored)throws Exception{
  BuildConfig.IS_LAUNCHER=false;
  Context.appearance.visible=stored;Context.appearance.durable=stored;
  trace=new Trace(name,observe());trace.value.put("init",Trace.action("initWith",stored));
 }

 static void require(boolean condition,String text){if(!condition)throw new AssertionError(text);}
 static Configuration configuration(String font){
  Configuration config=new Configuration();
  config.fontScale=switch(font){
   case "normal" -> 1f;
   case "large" -> 1.5f;
   case "larger" -> 2f;
   case "tiny" -> 0.001f;
   case "zero" -> 0f;
   case "nan" -> Float.NaN;
   case "negative" -> -1f;
   case "infinite" -> Float.POSITIVE_INFINITY;
   default -> throw new AssertionError(font);
  };
  return config;
 }
 static String font(float value){
  if(Float.isNaN(value))return "nan";
  if(value==Float.POSITIVE_INFINITY)return "infinite";
  return switch(Float.floatToIntBits(value)){
   case 0 -> "zero";
   default -> {
    for(String name:new String[]{"normal","large","larger","tiny","negative"})
     if(value==configuration(name).fontScale)yield name;
    throw new AssertionError("Unexpected synthetic font scale");
   }
  };
 }

 void create(int id,boolean bridge,String font)throws Exception{
  MainActivity activity=new MainActivity();
  activity.taskId=id;
  activity.setIntent(new Intent(Intent.ACTION_MAIN));
  activity.getResources().configuration=configuration(font);
  MainActivityPorts.bridgeAvailable=bridge;
  activity.onCreate(null);
  activities[id]=activity;
  AlphaDevicePlugin plugin=new AlphaDevicePlugin();plugin.attach(activity);plugins[id]=plugin;
  point("create",id,bridge,font);
 }
 void configure(int id,String font)throws Exception{
  activities[id].onConfigurationChanged(configuration(font));point("configure",id,font);
 }
 void systemFont(int id,String font)throws Exception{
  activities[id].getResources().configuration=configuration(font);point("systemFont",id,font);
 }
 void resume(int id)throws Exception{activities[id].onResume();point("resume",id);}
 void finish(int id)throws Exception{activities[id].finish();point("finish",id);}
 void destroy(int id)throws Exception{activities[id].onDestroy();point("destroy",id);}

 static PluginCall argument(String key,int value,String type){
  JSObject data=new JSObject();
  switch(type){
   case "int" -> data.put(key,value);
   case "long" -> data.put(key,(long)value);
   case "text" -> data.put(key,Integer.toString(value));
   case "missing" -> {}
   default -> throw new AssertionError(type);
  }
  return new PluginCall(data);
 }
 void request(int id,int value,String type)throws Exception{
  PluginCall call=argument("percent",value,type);
  int before=BridgeActivity.uiTasks.size();
  plugins[id].setTextScale(call);
  if(BridgeActivity.uiTasks.size()>before){
   require(BridgeActivity.uiTasks.getLast().owner()==activities[id]&&admitted.put(activities[id],new Pending(id,value,call))==null,
    "Each valid queued request has the exact activity");
  }
  record(id,call);point("request",id,value,type);
 }
 void deliver(String mode)throws Exception{
  var task=BridgeActivity.uiTasks.removeFirst();
  Pending request=admitted.remove(task.owner());
  Context.appearance.mode=mode;
  task.run().run();
  Context.appearance.mode="saved";
  record(request.owner(),request.call());point("deliver",mode);
 }
 void record(int id,PluginCall call){
  owner=id;percent=0;zoom=0;
  if(!call.answered){outcome="pending";return;}
  if(call.error!=null){
   outcome=switch(call.error){
    case "Text size must be 75 to 150 percent." -> "invalid";
    case "Alpha view is unavailable" -> "unavailable";
    case "Text size could not be saved" -> "unconfirmed";
    default -> throw new AssertionError(call.error);
   };
   return;
  }
  require(call.result.keySet().equals(Set.of("textScalePercent","effectiveTextZoom")),"Exact native appearance reply");
  outcome="saved";percent=call.result.getInt("textScalePercent");zoom=call.result.getInt("effectiveTextZoom");
 }

 void restart()throws Exception{
  require(BridgeActivity.uiTasks.isEmpty(),"Simulated process boundary has no pending calls");
  for(int i=1;i<=2;i++){
   if(activities[i]!=null&&!activities[i].isDestroyed())activities[i].onDestroy();
   activities[i]=null;plugins[i]=null;
  }
  Context.appearance.visible=Context.appearance.durable;Context.appearance.commits=0;
  owner=0;percent=0;zoom=0;outcome="none";
  point("restart");
 }

 JSONObject view(int id){
  MainActivity a=activities[id];
  if(a==null)return new JSONObject().put("phase","absent").put("font","normal").put("zoom",0).put("writes",0);
  var bridge=a.getBridge();
  String phase=a.isDestroyed()?"destroyed":a.isFinishing()?"finishing":bridge!=null?"live":"no-bridge";
  var settings=bridge==null?null:bridge.getWebView().getSettings();
  return new JSONObject().put("phase",phase).put("font",font(a.getResources().getConfiguration().fontScale))
   .put("zoom",settings==null?0:settings.getTextZoom()).put("writes",settings==null?0:settings.zoomWrites);
 }
 JSONObject observe(){
  JSONArray pending=new JSONArray();
  for(var task:BridgeActivity.uiTasks){
   var req=admitted.get(task.owner());
   require(req!=null&&!req.call().answered,"Pending queue carries an unanswered exact call");
   pending.put(new JSONObject().put("owner",req.owner()).put("percent",req.percent()));
  }
  var prefs=Context.appearance;
  return Trace.fields("viewA",view(1),"viewB",view(2),"visible",prefs.visible,"durable",prefs.durable,"commits",prefs.commits,
   "pending",pending,"reply",new JSONObject().put("owner",owner).put("outcome",outcome).put("percent",percent).put("zoom",zoom));
 }
 void point(String name,Object... args){trace.step(name,observe(),args);}

 void timeout(int sdk,boolean service,int base,String type,int suggested){
  Build.VERSION.SDK_INT=sdk;
  AccessibilityManager manager=new AccessibilityManager();manager.recommendation=suggested;
  Context.accessibility=service?manager:null;
  PluginCall call=argument("baseMs",base,type);
  plugins[1].recommendedTimeout(call);
  boolean valid=type.equals("int")&&base>=1&&base<=600000;
  boolean lookup=valid&&sdk>=29&&service;
  require(manager.queries==(lookup?1:0),"Accessibility timeout consults the current system service at most once");
  if(valid)require(call.answered&&call.error==null&&call.result.keySet().equals(Set.of("timeoutMs"))
   &&call.result.getInt("timeoutMs")== (lookup?suggested:base),"Exact native timeout projection");
  else require(call.answered&&"Base timeout must be 1 to 600000 ms.".equals(call.error)&&call.result==null,
   "Invalid native timeout request has no lookup");
  trace.stutter("timeout API "+sdk+" service "+service+" base "+base+" type "+type+" suggestion "+suggested,observe());
 }

 public static void main(String[] args)throws Exception{
  String name=args[0];
  var f=new TextScaleLifecycleTraces(name,name.equals("invalid-installed")?151:0);
  switch(name){
   case "two-views-config-and-resume":
    f.create(1,true,"normal");f.create(2,true,"large");f.request(1,125,"int");
    f.configure(2,"larger");f.deliver("saved");f.resume(2);
    f.systemFont(1,"large");f.resume(1);
    break;
   case "configuration-before-queued-write":
    f.create(1,true,"normal");f.request(1,75,"int");f.configure(1,"large");f.deliver("saved");
    require(f.zoom==113,"Java float half rounding follows the current configuration");
    f.configure(1,"tiny");f.configure(1,"zero");f.configure(1,"nan");f.configure(1,"negative");f.configure(1,"infinite");
    break;
   case "invalid-installed":
    f.create(1,true,"large");f.request(1,74,"int");f.request(1,151,"int");f.request(1,100,"long");
    f.request(1,100,"text");f.request(1,100,"missing");f.request(1,150,"int");f.deliver("saved");
    break;
   case "late-destroyed-owner":
    f.create(1,true,"normal");f.request(1,150,"int");f.destroy(1);f.create(2,true,"large");
    f.request(2,125,"int");f.deliver("saved");f.deliver("saved");
    break;
   case "finishing-owner":
    f.create(1,true,"normal");f.request(1,150,"int");f.finish(1);f.deliver("saved");f.destroy(1);
    break;
   case "failed-commit-and-restart":
    f.create(1,true,"normal");f.request(1,100,"int");f.deliver("saved");
    f.request(1,150,"int");f.deliver("before");f.resume(1);
    f.request(1,125,"int");f.deliver("visible");f.resume(1);
    f.restart();f.create(1,true,"large");
    break;
   case "webview-unavailable":
    f.create(1,false,"normal");f.configure(1,"large");f.resume(1);f.destroy(1);
    f.create(2,true,"large");
    break;
   case "timeout-stateless":
    f.create(1,true,"normal");
    f.timeout(28,true,5000,"int",30000);f.timeout(29,false,5000,"int",30000);
    f.timeout(29,true,1,"int",2);f.timeout(36,true,600000,"int",650000);
    f.timeout(36,true,5000,"int",1000);f.timeout(36,true,5000,"int",30000);
    f.timeout(36,true,0,"int",30000);f.timeout(36,true,600001,"int",30000);
    f.timeout(36,true,5000,"long",30000);f.timeout(36,true,5000,"text",30000);
    f.timeout(36,true,5000,"missing",30000);
    break;
   default: throw new AssertionError(name);
  }
  System.out.println(f.trace.value);
 }
}
