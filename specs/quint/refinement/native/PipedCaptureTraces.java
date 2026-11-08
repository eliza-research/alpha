package ai.elizaresearch.alphaphone;

import ai.eliza.voice.*;
import com.getcapacitor.*;
import java.io.File;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
import org.json.*;

/** Runs the real shared bridge, capture controller, recorder and ASR pipe together. */
public final class PipedCaptureTraces {
 static final String ID="00000000-0000-0000-0000-000000000001";
 static final Object lock=new Object();static Exchange pending;static int posts;
 static boolean owned=true;static String closeReason="none";
 static final class Exchange {final JSONObject body;final String kind;final CountDownLatch release=new CountDownLatch(1);JSONObject response;Exchange(JSONObject b,String k){body=b;kind=k;}}
 static final LiveSegmentPipe.Transport transport=new LiveSegmentPipe.Transport(){
  public void check(){if(!owned)throw new IllegalStateException("retired enrollment");}
  public JSONObject post(JSONObject body)throws Exception {
   String kind=body.optBoolean("close")?"close":posts++==0?"warm":"batch";
   Exchange next=new Exchange(body,kind);synchronized(lock){pending=next;lock.notifyAll();}
   if(!next.release.await(10,TimeUnit.SECONDS))throw new IllegalStateException("fixture response deadline");
   synchronized(lock){pending=null;lock.notifyAll();}return next.response;
  }
  public void cancelInFlight(){}
 };
 static final class Bridge extends LocalSpeechBridgePlugin {
  Bridge(){super("alpha-cloud-voice-","alpha-cloud-tts-");}
  protected LiveCaptureController.Route residentRoute(String owner){if(!owner.equals("owner"))throw new AssertionError("Owner argument");return ()->transport;}
  void pauseHost(){handleOnPause();}void closeHost(){handleOnDestroy();}
 }
 static Bridge bridge;static LiveCaptureController controller;static LiveSegmentPipe pipe;static LiveVoiceCapture capture;
 static PluginCall startCall,stopCall;static Trace trace;
 @SuppressWarnings("unchecked") static Map<String,LiveSegmentPipe> pipes()throws Exception{return (Map<String,LiveSegmentPipe>)Trace.read(controller,"pipes");}
 static String startOutcome(){return startCall==null?"none":startCall.settled==0?"pending":startCall.rejected==null?"recording":"cancelled";}
 static String stopOutcome(){return stopCall==null?"none":stopCall.settled==0?"pending":Boolean.TRUE.equals(stopCall.result.getBoolean("serverClosed",false))?"true":"false";}
 static String future(CompletableFuture<Boolean> future){return !future.isDone()?"pending":future.getNow(false)?"true":"false";}
 static String pendingKind(){synchronized(lock){return pending==null?"none":pending.kind;}}
 static boolean physical(){return LiveCapturePorts.records.stream().anyMatch(record->record.recording);}
 static void settleStops()throws Exception {
  ExecutorService stop=(ExecutorService)Trace.read(controller,"stopWorker");
  long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(5);
  boolean barrierComplete=false;
  while(!stop.isShutdown()&&!barrierComplete){
   try{stop.submit(()->{}).get(deadline-System.nanoTime(),TimeUnit.NANOSECONDS);barrierComplete=true;}
   catch(RejectedExecutionException full){
    // The source has a one-slot queue. An already-queued stop can briefly block the fixture barrier.
    if(System.nanoTime()>=deadline)throw full;
    Thread.sleep(1);
   }
  }
  if(!barrierComplete&&!stop.awaitTermination(deadline-System.nanoTime(),TimeUnit.NANOSECONDS))throw new TimeoutException("Stop worker did not terminate");
  if(capture!=null&&!(boolean)Trace.read(capture,"running")){Thread thread=(Thread)Trace.read(capture,"thread");if(thread!=null)thread.join(3000);}
 }
 static void await(java.util.function.BooleanSupplier condition)throws Exception {
  long until=System.nanoTime()+TimeUnit.SECONDS.toNanos(8);while(!condition.getAsBoolean()){if(System.nanoTime()>until)throw new AssertionError("Piped source did not reach boundary: "+pendingKind()+" / "+startOutcome());Thread.sleep(1);}
 }
 static JSONObject observe()throws Exception {
  if(pipe==null)pipe=pipes().get(ID);
  Object active=Trace.read(Trace.read(controller,"admission"),"active");boolean current=active!=null&&!(boolean)Trace.read(active,"cancelled"),discard=active!=null&&(boolean)Trace.read(active,"discard");
  int frames=0,pcm=0,transcripts=0;String failure="none";
  for(int i=0;i<NoteBridgePorts.events.length();i++){
   JSONObject event=NoteBridgePorts.events.getJSONObject(i),value=event.getJSONObject("value");
   if(event.getString("event").equals("liveCaptureFrames")){frames++;pcm+=value.getJSONArray("frames").length();}
   if(event.getString("event").equals("liveCaptureTranscript")){if(value.has("final"))transcripts++;else failure=value.getString("error");}
  }
  @SuppressWarnings("unchecked") CompletableFuture<Boolean> closed=pipe==null?null:(CompletableFuture<Boolean>)Trace.read(pipe,"closed");
  boolean foreground=(boolean)Trace.read(bridge,"speechForeground"),destroyed=(boolean)Trace.read(bridge,"destroyed");
  if(stopCall!=null)closeReason="stop";
  else if(!foreground||destroyed)closeReason=startOutcome().equals("pending")||startOutcome().equals("cancelled")?"start":"lifecycle";
  else if(startOutcome().equals("cancelled")||startOutcome().equals("pending")&&pendingKind().equals("close"))closeReason="start";
  else if(failure.equals("TRANSPORT")&&startOutcome().equals("recording"))closeReason="pipe";
  return Trace.fields("epoch",((AtomicLong)Trace.read(bridge,"epoch")).get(),"foreground",foreground,"destroyed",destroyed,
   "inCall",NoteBridgePorts.audio.mode!=android.media.AudioManager.MODE_NORMAL,"owned",owned,"attempt",startOutcome(),
   "hasPipe",pipes().containsKey(ID),"ready",pipe==null?"none":future(pipe.ready()),"closed",closed==null?"none":future(closed),
   "pending",pendingKind(),"opening",LiveCapturePorts.holdOpen&&LiveCapturePorts.opening.getCount()==0,
   "published",Trace.read(controller,"current")!=null,"physical",physical(),"current",current,"discard",discard,
   "frames",frames,"rendererPcm",pcm,"transcripts",transcripts,"failure",failure,"stop",stopOutcome(),"closeReason",closeReason);
 }
 static void record(String action,Object...args)throws Exception {trace.step(action,observe(),args);}
 static void start()throws Exception {
  LiveCapturePorts.holdOpen=true;startCall=new PluginCall(new JSObject().put("captureId",ID).put("ownerId","owner").put("nativeAsr",true));
  bridge.startLiveCapture(startCall);await(()->pendingKind().equals("warm"));record("start");
 }
 static void ownerGone()throws Exception {owned=false;record("retireOwner");}
 static void phone()throws Exception {NoteBridgePorts.audio.mode=android.media.AudioManager.MODE_IN_CALL;record("call",true);}
 static void pause(boolean destroy)throws Exception {
  boolean warming=pendingKind().equals("warm");if(destroy)bridge.closeHost();else bridge.pauseHost();
  if(!warming)await(()->pendingKind().equals("close"));settleStops();
  if(!warming)await(()->{try{return Trace.read(controller,"current")==null;}catch(Exception error){throw new IllegalStateException(error);}});
  record(destroy?"destroy":"pause");
 }
 static JSONObject response(String kind,boolean closed){
  JSONObject value=new JSONObject().put("closed",closed);int status=200;
  if(kind.equals("final"))value.put("final",new JSONObject().put("turnId","turn").put("text","words"));
  if(kind.equals("asr")){status=502;value.put("code","ASR_FAILED");}if(kind.equals("error"))status=503;
  return new JSONObject().put("status",status).put("body",value.toString());
 }
 static void answer(String kind,boolean closed)throws Exception {
  Exchange exchange;synchronized(lock){exchange=pending;}
  if(exchange==null)throw new AssertionError("No pipe request");exchange.response=response(kind,closed);exchange.release.countDown();
  await(()->{synchronized(lock){return pending!=exchange;}});
 }
 static void warm(boolean success)throws Exception {
  answer(success?"ok":"error",false);
  if(success&&owned&&(boolean)Trace.read(bridge,"speechForeground")&&!(boolean)Trace.read(bridge,"destroyed"))await(()->LiveCapturePorts.opening.getCount()==0);
  else if(owned)await(()->pendingKind().equals("close"));else await(()->!startOutcome().equals("pending"));
  record("warmReply",success);
 }
 static void open()throws Exception {
  LiveCapturePorts.holdOpen=false;LiveCapturePorts.allowOpen.countDown();
  await(()->!startOutcome().equals("pending")||pendingKind().equals("close"));
  capture=(LiveVoiceCapture)Trace.read(controller,"current");settleStops();record("finishOpen");
 }
 static void frames()throws Exception {
  LiveVoiceCapture.Sink sink=(LiveVoiceCapture.Sink)Trace.read(capture,"sink");
  sink.frames(ID,new JSONArray().put(new JSONObject().put("timestamp",0)),new JSONArray().put(new JSONObject().put("timestampMs",0)),0.5f);
  boolean discard=(boolean)Trace.read(Trace.read(Trace.read(controller,"admission"),"active"),"discard");
  if(!discard&&pendingKind().equals("none")&&!futureClosed())await(()->pendingKind().equals("batch"));
  record("frames");
 }
 static boolean futureClosed(){try{return pipe!=null&&(boolean)Trace.read(pipe,"finished");}catch(Exception error){throw new IllegalStateException(error);}}
 static void batch(String kind)throws Exception {
  answer(kind,false);
  if(!owned){await(PipedCaptureTraces::futureClosed);settleStops();}
  else if(kind.equals("error")){await(()->pendingKind().equals("close"));settleStops();}
  else await(()->pendingKind().equals("none"));record("batchReply",kind);
 }
 static void stop(boolean discard)throws Exception {
  stopCall=new PluginCall(new JSObject().put("captureId",ID).put("discard",discard));bridge.stopLiveCapture(stopCall);
  if(futureClosed())await(()->stopCall.settled>0);else await(()->pendingKind().equals("close"));settleStops();
  await(()->{try{return Trace.read(controller,"current")==null;}catch(Exception error){throw new IllegalStateException(error);}});
  if(futureClosed())record("stopFinishedPipe");else record("stop",discard);
 }
 static void closed(boolean acknowledged)throws Exception {
  answer("ok",acknowledged);
  if(stopCall!=null)await(()->stopCall.settled>0);
  else if(startOutcome().equals("pending"))await(()->!startOutcome().equals("pending"));else await(PipedCaptureTraces::futureClosed);
  if(!closeReason.equals("pipe"))await(()->{try{return !pipes().containsKey(ID);}catch(Exception error){throw new IllegalStateException(error);}});
  settleStops();record("closeReply",acknowledged);
 }
 static void run(String path,String mode)throws Exception {
  NoteRecordingPorts.root=new File(path,mode);NoteRecordingPorts.root.mkdirs();bridge=new Bridge();bridge.load();controller=(LiveCaptureController)Trace.read(bridge,"live");trace=new Trace("piped-capture-"+mode,observe());
  try{
   start();
   if(mode.equals("owner-warm")){ownerGone();warm(true);}
   else if(mode.equals("warm-failure")){warm(false);closed(true);}
   else if(mode.equals("pause-warm")||mode.equals("destroy-warm")){pause(mode.equals("destroy-warm"));warm(true);closed(true);}
   else{
    warm(true);if(mode.equals("call-open"))phone();open();
    if(mode.equals("call-open"))closed(true);
    else if(mode.equals("final")||mode.equals("asr")||mode.equals("pipe-error")||mode.equals("owner-batch")){
     frames();if(mode.equals("owner-batch"))ownerGone();batch(mode.equals("owner-batch")?"final":mode.equals("pipe-error")?"error":mode);
     if(mode.equals("pipe-error")){closed(false);stop(false);}else if(mode.equals("owner-batch"))stop(false);else{stop(false);closed(true);}
    }else if(mode.equals("pause-live")||mode.equals("destroy-live")){pause(mode.equals("destroy-live"));closed(true);}
    else if(mode.equals("stop-discard")){stop(true);frames();closed(true);}
    else{stop(false);frames();closed(!mode.equals("unconfirmed"));}
   }
   System.out.println(trace.value);
  }finally{
   owned=true;LiveCapturePorts.holdOpen=false;LiveCapturePorts.allowOpen.countDown();
   synchronized(lock){if(pending!=null){pending.response=response("ok",true);pending.release.countDown();}}
   if(!(boolean)Trace.read(bridge,"destroyed"))bridge.closeHost();
   for(String field:new String[]{"worker","stopWorker","pipeWorker"})((ExecutorService)Trace.read(controller,field)).awaitTermination(5,TimeUnit.SECONDS);
   ((ExecutorService)Trace.read(bridge,"workers")).awaitTermination(5,TimeUnit.SECONDS);
  }
 }
 public static void main(String[]args)throws Exception {
  if(!args[1].equals("campaign")){run(args[0],args[1]);return;}
  JSONArray traces=new JSONArray();for(int i=2;i<args.length;i++){
   Process process=new ProcessBuilder(System.getProperty("java.home")+"/bin/java","-cp",System.getProperty("java.class.path"),PipedCaptureTraces.class.getName(),args[0],args[i]).redirectError(ProcessBuilder.Redirect.INHERIT).start();
   String out=new String(process.getInputStream().readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);if(process.waitFor()!=0)throw new AssertionError("Piped source failed: "+args[i]);traces.put(new JSONObject(out));
  }System.out.println(traces);
 }
}
