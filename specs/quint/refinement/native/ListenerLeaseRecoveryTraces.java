package ai.eliza.sense;

import ai.alphacompute.alphaphone.Trace;
import android.media.AudioRecord;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;
import org.json.*;

/** Current service capture identity is observed separately from its durable crash marker. */
public final class ListenerLeaseRecoveryTraces {
 static ListeningService service;static Trace trace;static final JSONArray observations=new JSONArray();
 static JSONObject observe()throws Exception {
  return Trace.fields("captureActive",Trace.read(service,"capture")!=null,
   "captureSince",Listener.unsilencedSince,"sessionOpen",StorePorts.preferences.getBoolean("captureSessionOpen",false));
 }
 static void checkpoint(String label)throws Exception {
  Thread worker=(Thread)Trace.read(service,"capture");
  observations.put(new JSONObject().put("label",label).put("workerPresent",worker!=null)
   .put("workerAlive",worker!=null&&worker.isAlive()).put("recordPresent",Trace.read(service,"record")!=null)
   .put("microphoneHeld",Listener.microphoneHeld).put("unsilencedSince",Listener.unsilencedSince)
   .put("physicalRecording",ServicePorts.record!=null&&ServicePorts.record.recording)
   .put("readCalls",AudioRecord.readCalls.get()).put("allocations",ServicePorts.records.size())
   .put("marker",StorePorts.preferences.getBoolean("captureSessionOpen",false))
   .put("durableMarker",StorePorts.preferences.disk.getOrDefault("captureSessionOpen",false)));
 }
 static void step(String action,Object...args)throws Exception {trace.step(action,observe(),args);checkpoint(action);}
 static void frame()throws Exception {
  IndicatorLease.Loss loss=Listener.lease.verdict(ServicePorts.now,0,
   IndicatorLease.requiresAttribution(Listener.microphoneHeld&&Listener.unsilencedSince>=0,Listener.unsilencedSince,ServicePorts.now),true);
  boolean allowed=Listener.observeIndicatorLease(service,ServicePorts.now);
  if(allowed!=(loss==IndicatorLease.Loss.NONE))throw new AssertionError("Actual listener/lease verdict disagreement");
  trace.step("processFrame",observe().put("s.lastCheck",loss.name().toLowerCase().replace('_','-')));
  checkpoint("processFrame");observations.getJSONObject(observations.length()-1).put("leasePermits",allowed);
 }
 static void open()throws Exception {
  service.onCreate();service.deliverStart(new android.content.Intent(),0,1);
  if(ServicePorts.record==null||!AudioRecord.readEntered.await(5,TimeUnit.SECONDS))throw new AssertionError("Actual worker did not reach the input port");
  ExecutorService recognizer=(ExecutorService)Trace.read(service,"recognizer");recognizer.submit(()->{}).get(5,TimeUnit.SECONDS);
  if(!((Thread)Trace.read(service,"capture")).isAlive())throw new AssertionError("Current worker is not live");
  step("openCapture");
 }
 static void close()throws Exception {
  service.onDestroy();
  ((ExecutorService)Trace.read(service,"recognizer")).awaitTermination(5,TimeUnit.SECONDS);
  step("closeCapture");
 }
 static void run(Path settings,String mode)throws Exception {
  ServicePorts.now=0;StorePorts.boot=0;StorePorts.install=0;
  StorePorts.preferences=new StorePorts.Preferences(settings);service=new ListeningService();
  trace=new Trace("lease-current-capture-"+mode,observe());checkpoint("init");
  ListenerStore store=new ListenerStore(service);
  if(!store.setSessionOpen(true))throw new AssertionError("Controlled marker write failed");
  step("loadSavedHistory",0,true);
  if(mode.equals("restored-marker")){ServicePorts.now=2499;step("advance",2499);}
  if(!store.grantConsent(100,ListenerStore.consentGeneration()))throw new AssertionError("Controlled consent failed");
  step("explicitConsent");
  long token=Listener.lease.acquire(0);step("acquire");
  if(!Listener.lease.renew(token,ServicePorts.now,0,true,true,false,"on","shade"))throw new AssertionError("Controlled lease refused");
  step("renew",token,true,true,false,"on","shade");
  frame();
  if(Trace.read(service,"capture")!=null||Trace.read(service,"record")!=null||Listener.microphoneHeld||AudioRecord.readCalls.get()!=0)
   throw new AssertionError("Stored marker created current capture without a service start");
  open();frame();
  if(mode.equals("fresh-grace")){
   ServicePorts.now=2499;step("advance",2499);frame();
   ServicePorts.now=2500;step("advance",2500);frame();
  }
  close();frame();
  System.out.println(new JSONObject().put("trace",trace.value).put("observations",observations));
 }
 public static void main(String[]args)throws Exception {
  if(args.length>1){run(Path.of(args[0]),args[1]);return;}
  JSONArray traces=new JSONArray(),all=new JSONArray();
  for(String mode:new String[]{"restored-marker","fresh-grace"}){
   Path settings=Path.of(args[0],mode+".json");Files.deleteIfExists(settings);
   Process process=new ProcessBuilder(System.getProperty("java.home")+"/bin/java","-cp",System.getProperty("java.class.path"),
    ListenerLeaseRecoveryTraces.class.getName(),settings.toString(),mode).redirectError(ProcessBuilder.Redirect.INHERIT).start();
   String output=new String(process.getInputStream().readAllBytes(),StandardCharsets.UTF_8);
   if(process.waitFor()!=0)throw new AssertionError("Actual capture probe failed: "+mode);
   JSONObject result=new JSONObject(output);traces.put(result.getJSONObject("trace"));
   all.put(new JSONObject().put("mode",mode).put("states",result.getJSONArray("observations")));
  }
  System.out.println(new JSONObject().put("traces",traces).put("observations",all));
 }
}
