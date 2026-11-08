package ai.eliza.sense;

import ai.elizaresearch.alphaphone.Trace;
import java.nio.file.*;
import java.util.concurrent.*;
import org.json.*;

/** Drives the real onCreate/start/destroy lifecycle, then observes cleanup after a release fault. */
public final class ListenerServiceProbe {
 public static void main(String[]args)throws Exception {
  StorePorts.preferences=new StorePorts.Preferences(Path.of(args[0]));
  new ListenerStore(new android.content.Context()).grantConsent(100,ListenerStore.consentGeneration());
  long generation=Listener.lease.acquire(1);Listener.lease.renew(generation,ServicePorts.now,1,true,true,true);
  ListeningService service=new ListeningService();service.onCreate();service.onStartCommand(new android.content.Intent(),0,1);
  if(!ServicePorts.record.began.await(5,TimeUnit.SECONDS))throw new AssertionError("Capture failed to start");
  ExecutorService recognizer=(ExecutorService)Trace.read(service,"recognizer");recognizer.submit(()->{}).get(5,TimeUnit.SECONDS);
  ServicePorts.releaseFails=true;ServicePorts.stopFails=args.length>1&&args[1].equals("both");
  boolean threw=false;try{service.onDestroy();}catch(RuntimeException failed){threw=true;}
  if(!recognizer.isShutdown())recognizer.submit(()->{}).get(5,TimeUnit.SECONDS);else recognizer.awaitTermination(5,TimeUnit.SECONDS);
  System.out.println(new JSONObject().put("threw",threw).put("microphoneHeld",Listener.microphoneHeld)
   .put("markerOpen",StorePorts.preferences.getBoolean("captureSessionOpen",false))
   .put("modeRegistered",ServicePorts.audio.modeRegistered).put("recordingRegistered",ServicePorts.audio.recordingRegistered)
   .put("playbackRegistered",ServicePorts.audio.playbackRegistered).put("observerRegistered",ServicePorts.resolver.observed)
   .put("executorShutdown",recognizer.isShutdown()).put("engineClosed",ServicePorts.engine.closed)
   .put("recording",ServicePorts.record.recording).put("released",ServicePorts.record.released).put("superDestroyed",service.superDestroyed));
  // Harness teardown occurs after observations, even when the original lifecycle stranded its worker.
  ServicePorts.record.unblock.countDown();recognizer.shutdownNow();recognizer.awaitTermination(5,TimeUnit.SECONDS);
 }
}
