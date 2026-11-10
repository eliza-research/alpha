package ai.eliza.sense;

import ai.alphacompute.alphaphone.Trace;
import java.nio.file.Path;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

/** Drives real service admission when the durable open-session write fails. */
public final class ListenerAdmissionProbe {
 public static void main(String[] args)throws Exception {
  StorePorts.preferences=new StorePorts.Preferences(Path.of(args[0]));
  new ListenerStore(new android.content.Context()).grantConsent(100,0);
  long generation=Listener.lease.acquire(1);
  Listener.lease.renew(generation,ServicePorts.now,1,true,true,true);
  StorePorts.preferences.outcome="memory-failure";
  ListeningService service=new ListeningService();
  service.onCreate();service.onStartCommand(new android.content.Intent(),0,1);
  ExecutorService recognizer=(ExecutorService)Trace.read(service,"recognizer");
  try{
   recognizer.submit(()->{}).get(5,TimeUnit.SECONDS);
   System.out.println(new JSONObject().put("storageFailed",ListenerStore.storageFailed())
    .put("epochActive",Trace.read(Listener.epoch,"active")).put("analyse",Trace.read(service,"analyse"))
    .put("engineLoaded",ServicePorts.engine!=null).put("capture",Trace.read(service,"capture")!=null)
    .put("durableMarker",StorePorts.preferences.disk.getOrDefault("captureSessionOpen",false))
    .put("memoryMarker",StorePorts.preferences.getBoolean("captureSessionOpen",false))
    .put("physical",ServicePorts.record.recording).put("released",ServicePorts.record.released)
    .put("stops",StorePorts.stops));
  }finally{service.onDestroy();recognizer.awaitTermination(5,TimeUnit.SECONDS);}
 }
}
