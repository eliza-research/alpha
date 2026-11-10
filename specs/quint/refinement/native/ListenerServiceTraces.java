package ai.eliza.sense;

import ai.elizaresearch.alphaphone.Trace;
import android.media.AudioRecord;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;
import org.json.*;

/** Actual shared Listener, ListeningService, ListenerStore and engine lifecycle under primitive ports. */
public final class ListenerServiceTraces {
 static ListeningService service;static Trace trace;
 static ExecutorService executor()throws Exception{return (ExecutorService)Trace.read(service,"recognizer");}
 static JSONObject observe()throws Exception {
  AudioRecord last=ServicePorts.record;
  return Trace.fields("created",service.created,"destroyed",Trace.read(service,"destroyed"),
   "foregroundRequested",service.foreground,"selfStopped",service.selfStopped,
   "modes",ServicePorts.audio.modeRegistered,"recordings",ServicePorts.audio.recordingRegistered,
   "playback",ServicePorts.audio.playbackRegistered,"observer",ServicePorts.resolver.observed,
   "reapplyQueued",ServicePorts.queued.contains((Runnable)Trace.read(service,"reapply")),
   "indicatorTimer",ServicePorts.timers.containsKey((Runnable)Trace.read(service,"indicatorCheck")),
   "leaseTimer",ServicePorts.timers.containsKey((Runnable)Trace.read(service,"leaseCheck")),
   "analyse",Trace.read(service,"analyse"),"capture",Trace.read(service,"capture")!=null,
   "record",Trace.read(service,"record")!=null,"allocations",ServicePorts.records.size(),
   "physical",last!=null&&last.recording,"released",last!=null&&last.released,
   "microphoneHeld",Listener.microphoneHeld,"unsilenced",Listener.unsilencedSince>=0,
   "marker",StorePorts.preferences.getBoolean("captureSessionOpen",false),
   "durableMarker",StorePorts.preferences.disk.getOrDefault("captureSessionOpen",false),
   "storageFailed",ListenerStore.storageFailed(),"stopRequests",StorePorts.stops,
   "epoch",Trace.read(Listener.epoch,"generation"),"epochActive",Trace.read(Listener.epoch,"active"),
   "enginePresent",Trace.read(service,"engine")!=null,"engineClosed",ServicePorts.engine!=null&&ServicePorts.engine.closed,
   "engineLoading",ServicePorts.holdLoad&&ServicePorts.loadEntered.getCount()==0&&ServicePorts.allowLoad.getCount()>0,
   "cancels",ServicePorts.engine==null?0:ServicePorts.engine.cancelled,"executorShutdown",executor().isShutdown(),
   "superDestroyed",service.superDestroyed,"userEnabled",StorePorts.preferences.getBoolean("enabled",false),
   "paused",StorePorts.preferences.getLong("pausedUntilMs",0)!=0,"status",ServicePorts.status);
 }
 static void record(String action,Object...args)throws Exception {trace.step(action,observe(),args);}
 static void create()throws Exception {service.onCreate();record("create");}
 static void start()throws Exception {
  new ListenerStore(service).resume();new ListenerStore(service).setEnabled(true);
  int prior=ServicePorts.records.size();service.onStartCommand(new android.content.Intent(),0,1);
  if(ServicePorts.records.size()>prior&&!ServicePorts.record.began.await(5,TimeUnit.SECONDS))throw new AssertionError("Capture did not start");
  if(ServicePorts.engine==null&&!ServicePorts.loadEntered.await(5,TimeUnit.SECONDS))throw new AssertionError("ASR load did not start");
  record("start");
 }
 static void markerWriteFailed()throws Exception {
  StorePorts.preferences.outcome="memory-failure";
  service.onStartCommand(new android.content.Intent(),0,1);
  executor().submit(()->{}).get(5,TimeUnit.SECONDS);record("markerWriteFailed");
 }
 static void load()throws Exception {ServicePorts.allowLoad.countDown();if(executor().isShutdown())executor().awaitTermination(5,TimeUnit.SECONDS);else executor().submit(()->{}).get(5,TimeUnit.SECONDS);record("load");}
 static void stop(boolean disable,boolean stopOk,boolean releaseOk)throws Exception {
  ServicePorts.stopFails=!stopOk;ServicePorts.releaseFails=!releaseOk;
  if(disable)new ListenerStore(service).setEnabled(false);else new ListenerStore(service).pause(Long.MAX_VALUE);
  service.onStartCommand(new android.content.Intent(),0,1);record(disable?"disable":"pause",stopOk,releaseOk);
 }
 static void destroy(boolean stopOk,boolean releaseOk)throws Exception {
  ServicePorts.stopFails=!stopOk;ServicePorts.releaseFails=!releaseOk;service.onDestroy();
  if(ServicePorts.allowLoad.getCount()==0)executor().awaitTermination(5,TimeUnit.SECONDS);
  record("destroy",stopOk,releaseOk);
 }
 static void run(Path path,String mode)throws Exception {
  StorePorts.preferences=new StorePorts.Preferences(path);new ListenerStore(new android.content.Context()).grantConsent(100,0);
  long generation=Listener.lease.acquire(1);Listener.lease.renew(generation,ServicePorts.now,1,true,true,true);
  ServicePorts.holdLoad=true;service=new ListeningService();trace=new Trace("listener-service-"+mode,observe());
  try{
   create();
   if(mode.equals("marker-write-failure")){markerWriteFailed();destroy(true,true);System.out.println(trace.value);return;}
   start();
   if(mode.equals("destroy-loading")){destroy(true,true);load();}
   else if(mode.equals("pause-loading")){stop(false,true,true);load();destroy(true,true);}
   else{
    load();
    switch(mode){
     case "normal": destroy(true,true);break;
     case "release-failure": destroy(true,false);break;
     case "both-failure": destroy(false,false);break;
     case "stop-failure": destroy(false,true);break;
     case "paused": stop(false,true,true);destroy(true,true);break;
     case "disabled": stop(true,true,true);destroy(true,true);break;
     case "retained-refuses-replacement": stop(false,false,false);start();stop(false,true,true);destroy(true,true);break;
     case "retained-release-retry": stop(false,true,false);stop(false,true,true);destroy(true,true);break;
     case "repeated-start": stop(false,true,true);start();start();destroy(true,true);break;
     case "reopen": stop(false,true,true);start();destroy(true,true);break;
     case "late-start": destroy(true,true);service.onStartCommand(new android.content.Intent(),0,2);trace.stutter("late start after destruction",observe());break;
     default: throw new AssertionError(mode);
    }
   }
   System.out.println(trace.value);
  }finally{
   ServicePorts.allowLoad.countDown();ServicePorts.stopFails=false;ServicePorts.releaseFails=false;
   for(AudioRecord record:ServicePorts.records)record.unblock.countDown();
   executor().shutdownNow();executor().awaitTermination(5,TimeUnit.SECONDS);
  }
 }
 public static void main(String[]args)throws Exception {
  if(!args[1].equals("campaign")){run(Path.of(args[0]),args[1]);return;}
  JSONArray traces=new JSONArray();for(int i=2;i<args.length;i++){
   Path path=Path.of(args[0],args[i]+".json");Files.deleteIfExists(path);
   Process process=new ProcessBuilder(System.getProperty("java.home")+"/bin/java","-cp",System.getProperty("java.class.path"),ListenerServiceTraces.class.getName(),path.toString(),args[i]).redirectError(ProcessBuilder.Redirect.INHERIT).start();
   String out=new String(process.getInputStream().readAllBytes(),StandardCharsets.UTF_8);if(process.waitFor()!=0)throw new AssertionError("Service scenario failed "+args[i]);traces.put(new JSONObject(out));
  }System.out.println(traces);
 }
}
