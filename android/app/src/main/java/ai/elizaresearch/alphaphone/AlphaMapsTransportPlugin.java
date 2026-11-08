package ai.elizaresearch.alphaphone;

import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import android.util.Base64;
import java.net.*;
import java.io.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.zip.GZIPInputStream;

/** Debug regional-data bridge only. No cookies, auth, arbitrary proxy or TLS bypass.
 * Release Maps uses its explicitly configured HTTPS endpoint directly.
 * The navigation methods (all builds) own the screen-off session of AlphaNavigationService:
 * the renderer starts it only from an explicit Start, mirrors the next instruction, and
 * hears exactly one navigationStopped event when the notification's Stop ends it. */
@CapacitorPlugin(name="AlphaMapsTransport")
public final class AlphaMapsTransportPlugin extends Plugin {
 private final ConcurrentHashMap<String,Pending> pending=new ConcurrentHashMap<>();
 private final ThreadPoolExecutor workers=new ThreadPoolExecutor(3,3,30,TimeUnit.SECONDS,new ArrayBlockingQueue<>(24));
 private final ScheduledThreadPoolExecutor deadlines=new ScheduledThreadPoolExecutor(1);
 { deadlines.setRemoveOnCancelPolicy(true); }
 private final ExecutorService closers=new ThreadPoolExecutor(1,1,30,TimeUnit.SECONDS,new ArrayBlockingQueue<>(32));
 private volatile boolean destroyed;
 private final ConcurrentHashMap<String,Long> earlyCancelled=new ConcurrentHashMap<>();
 private final class Pending {
  final PluginCall call;final AtomicBoolean settled=new AtomicBoolean();volatile boolean cancelled;volatile HttpURLConnection connection;volatile FutureTask<Void> task;volatile ScheduledFuture<?> deadline;
  Pending(PluginCall call){this.call=call;}
  void reject(String reason){if(settled.compareAndSet(false,true)){if(deadline!=null)deadline.cancel(false);call.reject(reason);}}
  void resolve(JSObject value){if(settled.compareAndSet(false,true)){if(deadline!=null)deadline.cancel(false);call.resolve(value);}}
  void cancel(String reason){cancelled=true;reject(reason);FutureTask<Void> queued=task;if(queued!=null){workers.remove(queued);queued.cancel(true);}HttpURLConnection active=connection;if(active!=null)PluginWorkers.submit(closers,active::disconnect,()->{/* The owning worker also closes in finally. */});}
 }
 // Compile-time constant: builds without ELIZA_DEV_ALLOW_TEST_MOCKS=1 carry no loopback origin.
 private static final String DEVELOPMENT_ORIGIN=BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS?"http://10.0.2.2:47850":"";
 @PluginMethod public void request(PluginCall call){
  if(!BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS||DEVELOPMENT_ORIGIN.isEmpty()||destroyed){call.reject("Regional development transport is unavailable in this build");return;}
  String path=call.getString("path"),id=call.getString("requestId");
  try{URI uri=new URI(path==null?"":path);String p=uri.getRawPath();
   if(id==null||!id.matches("[a-zA-Z0-9_-]{1,80}")||path.length()>4096||uri.isAbsolute()||uri.getRawAuthority()!=null||uri.getFragment()!=null||p==null||!(p.matches("/tiles/[0-9]{1,2}/[0-9]{1,6}/[0-9]{1,6}\\.pbf")||p.equals("/capabilities")||p.equals("/search")||p.equals("/place")||p.equals("/route")))throw new IllegalArgumentException();
  }catch(Exception invalid){call.reject("Invalid regional request");return;}
  if(earlyCancelled.remove(id)!=null){call.reject("Regional request cancelled");return;}
  Pending job=new Pending(call);if(pending.putIfAbsent(id,job)!=null){call.reject("Duplicate regional request");return;}
  if(earlyCancelled.remove(id)!=null){job.cancel("Regional request cancelled");pending.remove(id,job);return;}
  try{
   // Admission deadline includes queue time, connection and decoding. Rejection
   // must not wait behind blocked tiles or a blocking disconnect operation.
   job.deadline=deadlines.schedule(()->{job.cancel("Regional service timed out");pending.remove(id,job);},15,TimeUnit.SECONDS);
   FutureTask<Void> task=new FutureTask<>(()->{try{
   if(job.cancelled||destroyed)throw new IOException();
   HttpURLConnection connection=(HttpURLConnection)new URL(DEVELOPMENT_ORIGIN+path).openConnection();job.connection=connection;
   connection.setUseCaches(false);connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(10000);connection.setReadTimeout(15000);connection.setRequestProperty("Accept-Encoding","identity");connection.setRequestProperty("User-Agent","AlphaPhone-RegionalMaps/0.1");
   if(job.cancelled||destroyed)throw new IOException();int status=connection.getResponseCode();
   if(status>=300&&status<400)throw new IOException();
   InputStream raw=status>=400?connection.getErrorStream():connection.getInputStream();
   try(InputStream body="gzip".equalsIgnoreCase(connection.getContentEncoding())?new GZIPInputStream(raw):raw;ByteArrayOutputStream bytes=new ByteArrayOutputStream()){
    byte[] buffer=new byte[8192];int n;long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(15);
    while(body!=null&&(n=body.read(buffer))!=-1){if(job.cancelled||destroyed||System.nanoTime()>deadline||bytes.size()+n>2*1024*1024)throw new IOException();bytes.write(buffer,0,n);}
    if(job.cancelled||destroyed)throw new IOException();JSObject result=new JSObject();result.put("status",status);result.put("data",Base64.encodeToString(bytes.toByteArray(),Base64.NO_WRAP));job.resolve(result);
   }
  }catch(Exception unavailable){job.reject(job.cancelled?"Regional request cancelled":"Regional service unavailable");}
  finally{if(job.deadline!=null)job.deadline.cancel(false);if(job.connection!=null)job.connection.disconnect();pending.remove(id,job);}return null;});
   job.task=task;if(job.cancelled){task.cancel(false);return;}PluginWorkers.submit(workers,task,()->{pending.remove(id,job);job.cancel("Regional service is busy; try again");});
  }catch(RejectedExecutionException busy){/* deadlines.schedule after shutdown. */pending.remove(id,job);job.cancel("Regional service is busy; try again");}
 }
 @PluginMethod public void cancel(PluginCall call){String id=call.getString("requestId");Pending job=id==null?null:pending.get(id);if(job!=null){job.cancel("Regional request cancelled");pending.remove(id,job);}else if(id!=null&&id.matches("[a-zA-Z0-9_-]{1,80}")){long now=android.os.SystemClock.elapsedRealtime();earlyCancelled.entrySet().removeIf(e->now-e.getValue()>30000);if(earlyCancelled.size()<64)earlyCancelled.put(id,now);}call.resolve();}
 private final AlphaNavigationService.StopListener navigationStops=(session,reason)->{JSObject event=new JSObject();event.put("sessionId",session);event.put("reason",reason);notifyListeners("navigationStopped",event);};
 @Override public void load(){AlphaNavigationService.setStopListener(navigationStops);}
 private static String text(PluginCall call,String name){String value=call.getString(name,"");return value==null?"":value.length()>200?value.substring(0,200):value;}
 @PluginMethod public void navigationAvailability(PluginCall call){JSObject result=new JSObject();result.put("background",AlphaNavigationService.declared(getContext()));result.put("activeSessionId",AlphaNavigationService.activeSession());call.resolve(result);}
 @PluginMethod public void startNavigation(PluginCall call){
  String session=call.getString("sessionId");
  if(session==null||!session.matches(AlphaNavigationService.SESSION_PATTERN)){call.reject("Invalid navigation session");return;}
  if(!AlphaNavigationService.declared(getContext())){call.reject("Background navigation is unavailable in this build","unavailable");return;}
  if(!AlphaNavigationService.locationGranted(getContext())){call.reject("Location permission is required for background navigation","permission-denied");return;}
  // A Start delivered after this renderer closed has no guidance behind it and nothing left to stop it.
  if(destroyed){call.reject("Background navigation is unavailable: Alpha closed","unavailable");return;}
  // One session at a time: a new explicit Start retires the previous one first.
  String previous=AlphaNavigationService.activeSession();if(previous!=null)AlphaNavigationService.stop(getContext(),previous,"replaced");
  try{
   AlphaNavigationService.start(getContext(),session,text(call,"title"),text(call,"text"));
   // Destruction may have passed the check above while this ran; it sets the flag before it stops the active session, so one of the two stops this one.
   if(destroyed){AlphaNavigationService.stop(getContext(),session,"renderer-closed");call.reject("Background navigation is unavailable: Alpha closed","unavailable");return;}
   call.resolve();
  }
  catch(RuntimeException refused){AlphaNavigationService.stop(getContext(),session,"refused");call.reject("Background navigation could not start","unavailable");}
 }
 @PluginMethod public void updateNavigation(PluginCall call){
  String session=call.getString("sessionId");JSObject result=new JSObject();
  try{result.put("active",session!=null&&AlphaNavigationService.update(getContext(),session,text(call,"title"),text(call,"text")));}catch(RuntimeException unavailable){result.put("active",false);}
  call.resolve(result);
 }
 @PluginMethod public void stopNavigation(PluginCall call){
  String session=call.getString("sessionId");JSObject result=new JSObject();
  result.put("stopped",session!=null&&AlphaNavigationService.stop(getContext(),session,"app"));call.resolve(result);
 }
 @Override protected void handleOnDestroy(){
  // Guidance lives in this renderer; without it the session must not keep a stale notification.
  // The flag comes first: a Start still running on the bridge thread sees it and retires its own session.
  destroyed=true;
  AlphaNavigationService.clearStopListener(navigationStops);String active=AlphaNavigationService.activeSession();if(active!=null)AlphaNavigationService.stop(getContext(),active,"renderer-closed");
  for(Pending job:pending.values())job.cancel("Regional transport closed");workers.shutdownNow();deadlines.shutdownNow();closers.shutdown();pending.clear();earlyCancelled.clear();}
}
