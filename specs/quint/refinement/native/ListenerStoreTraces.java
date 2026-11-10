package ai.eliza.sense;

import ai.elizaresearch.alphaphone.Trace;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.json.*;

/** Executes actual store methods. Only preferences persistence and OS facts are ports. */
public final class ListenerStoreTraces {
 static ListenerStore store;static Trace trace;static String reply="none";
 static long normalized(long value){return value==Long.MAX_VALUE?-1:value;}
 static JSONObject data(Map<String,Object> values){
  JSONObject raw=new JSONObject(values);JSONArray exits=new JSONArray();
  for(long time:CrashLoopBreaker.decode(raw.optString("uncleanExits",null)))exits.put(time);
  return new JSONObject().put("consent",raw.optInt("consentVersion",0)).put("consentAt",raw.optLong("consentAtMs",0))
   .put("enabled",raw.optBoolean("enabled",false)).put("pause",normalized(raw.optLong("pausedUntilMs",0)))
   .put("pauseBoot",raw.optLong("pauseBoot",-1)).put("open",raw.optBoolean("captureSessionOpen",false))
   .put("markerBoot",raw.optLong("captureSessionBoot",-1)).put("markerInstall",raw.optLong("captureSessionInstall",-1))
   .put("exits",exits).put("tripped",raw.optBoolean("stoppedAfterErrors",false));
 }
 static JSONObject observe()throws Exception {
  JSONObject value=Trace.fields("memory",data(StorePorts.preferences.memory),"disk",data(StorePorts.preferences.disk),
   "generation",ListenerStore.consentGeneration(),"processConsent",Trace.read(store,"processConsent"),
   "failed",ListenerStore.storageFailed(),"epoch",Trace.read(Listener.epoch,"generation"),
   "epochActive",Trace.read(Listener.epoch,"active"),"speechUnavailable",Listener.speechUnavailable,
   "indicatorLost",Listener.indicatorLost,"stops",StorePorts.stops,"attempts",StorePorts.preferences.attempts,
   "boot",StorePorts.boot,"install",StorePorts.install,"reply",reply);
  value.put("visibleConsent",store.consentVersion()).put("visibleEnabled",store.enabled()).put("visiblePause",normalized(store.pausedUntil()));
  return value;
 }
 static void record(String action,Object...args)throws Exception {trace.step(action,observe(),args);}
 static void seed(boolean open,int count,boolean consent,boolean tripped)throws Exception {
  Map<String,Object> values=StorePorts.preferences.memory;values.clear();
  values.put("captureSessionOpen",open);values.put("captureSessionBoot",1L);values.put("captureSessionInstall",1L);
  values.put("consentVersion",consent?1:0);values.put("enabled",consent);values.put("stoppedAfterErrors",tripped);
  StringJoiner exits=new StringJoiner(",");for(int i=0;i<count;i++)exits.add("100");values.put("uncleanExits",exits.toString());
  StorePorts.preferences.disk.clear();StorePorts.preferences.disk.putAll(values);StorePorts.preferences.persist();record("seed",open,count,consent,tripped);
 }
 static void grant(long ticket,String result)throws Exception {StorePorts.preferences.outcome=result;reply=String.valueOf(store.grantConsent(100,ticket));record("grant",ticket,result);}
 static void revoke(String result)throws Exception {StorePorts.preferences.outcome=result;store.revokeConsent();reply="void";record("revoke",result);}
 static void reset(String result)throws Exception {StorePorts.preferences.outcome=result;reply=String.valueOf(store.reset());record("reset",result);}
 static void enable(boolean enabled,String result)throws Exception {StorePorts.preferences.outcome=result;store.setEnabled(enabled);reply="void";record("enable",enabled,result);}
 static void pause(long until,String result)throws Exception {StorePorts.preferences.outcome=result;store.pause(until<0?Long.MAX_VALUE:until);reply="void";record("pause",until,result);}
 static void resume(String result)throws Exception {StorePorts.preferences.outcome=result;store.resume();reply="void";record("resume",result);}
 static void session(boolean open,String result)throws Exception {StorePorts.preferences.outcome=result;reply=String.valueOf(store.setSessionOpen(open));record("session",open,result);}
 static void process(long now,boolean count,String result)throws Exception {StorePorts.preferences.outcome=result;reply=String.valueOf(store.recordProcessStart(now,count));record("processStart",now,count,result);}
 static void environment(int boot,long install,boolean unavailable,boolean lost)throws Exception {StorePorts.boot=boot;StorePorts.install=install;Listener.speechUnavailable=unavailable;Listener.indicatorLost=lost;record("environment",boot,install,unavailable,lost);}
 static void arm()throws Exception {Listener.epoch.renew(true);record("arm");}
 static JSONObject child(String mode,Path path)throws Exception {
  Process process=new ProcessBuilder(System.getProperty("java.home")+"/bin/java","-cp",System.getProperty("java.class.path"),ListenerStoreTraces.class.getName(),path.toString(),mode,String.valueOf(StorePorts.boot),String.valueOf(StorePorts.install)).redirectError(ProcessBuilder.Redirect.INHERIT).start();
  String output=new String(process.getInputStream().readAllBytes(),StandardCharsets.UTF_8);if(process.waitFor()!=0)throw new AssertionError("Store child failed "+mode);return new JSONObject(output);
 }
 static void restart()throws Exception {trace.step("restart",child("restart",StorePorts.preferences.path));}
 static void run(String mode)throws Exception {
  trace=new Trace("listener-store-"+mode,observe());
  switch(mode){
   case "grant": grant(0,"success");enable(false,"success");enable(true,"success");break;
   case "revoke": grant(0,"success");session(true,"success");revoke("success");break;
   case "pause": grant(0,"success");pause(200,"success");environment(2,1,false,false);resume("success");pause(-1,"success");break;
   case "restart": throw new AssertionError("restart observer handled before run");
   case "restart-consent": grant(0,"success");restart();break;
   case "stale-consent": reset("success");grant(0,"success");grant(1,"success");break;
   case "reset-recovery": grant(0,"memory-failure");reset("success");grant(0,"success");grant(1,"success");break;
   case "reset-failed": grant(0,"success");reset("memory-failure");grant(1,"success");restart();break;
   case "reset-durable-throw": grant(0,"success");reset("durable-throw");restart();break;
   case "reset-early-throw": grant(0,"success");reset("early-throw");restart();break;
   case "failed-close": grant(0,"success");session(true,"success");arm();session(false,"memory-failure");restart();break;
   case "tripped": seed(true,2,true,false);process(200,true,"success");process(600100,false,"success");resume("success");break;
   case "full-history": seed(true,8,true,true);process(200,true,"success");restart();break;
   case "malformed-history": seed(true,2,true,false);StorePorts.preferences.memory.put("uncleanExits","bad,100, ,100,garbage");StorePorts.preferences.disk.put("uncleanExits","bad,100, ,100,garbage");StorePorts.preferences.persist();trace.stutter("load malformed legacy entries",observe());process(200,true,"success");break;
   case "window": seed(true,2,true,false);process(600100,true,"success");break;
   case "reboot": seed(true,2,true,false);environment(2,1,false,false);process(200,true,"success");break;
   case "update": seed(true,2,true,false);environment(1,2,false,false);process(200,true,"success");break;
   case "unknown-boot": seed(true,2,true,false);environment(-1,1,false,false);process(200,true,"success");break;
   case "permission": seed(true,2,true,false);process(200,false,"success");break;
   case "failed-crash-write": seed(true,2,true,false);process(200,true,"memory-failure");restart();break;
   case "clear-errors": seed(false,3,true,true);environment(1,1,true,true);enable(true,"success");break;
   case "failed-enable": grant(0,"success");environment(1,1,true,true);enable(true,"memory-failure");break;
   case "failed-pause": grant(0,"success");pause(200,"memory-failure");resume("success");break;
   case "failed-revoke": grant(0,"success");revoke("early-throw");restart();break;
   default:
    if(!Set.of("memory-failure","early-throw","durable-throw").contains(mode))throw new AssertionError(mode);
    arm();environment(1,1,true,true);grant(0,mode);grant(0,"success");restart();
  }
  System.out.println(trace.value);
 }
 public static void main(String[]args)throws Exception {
  if(args[1].equals("campaign")){
   JSONArray traces=new JSONArray();for(int i=2;i<args.length;i++){Path path=Path.of(args[0],args[i]+".json");Files.deleteIfExists(path);traces.put(child(args[i],path));}System.out.println(traces);return;
  }
  StorePorts.boot=Integer.parseInt(args.length>2?args[2]:"1");StorePorts.install=Long.parseLong(args.length>3?args[3]:"1");
  StorePorts.preferences=new StorePorts.Preferences(Path.of(args[0]));store=new ListenerStore(new android.content.Context());
  if(args[1].equals("restart")){System.out.println(observe());return;}
  run(args[1]);
 }
}
