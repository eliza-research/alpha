package ai.alphacompute.alphaphone;

import ai.eliza.voice.LiveSegmentPipe;
import java.lang.reflect.Field;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

/** Executes the real pipe with a controlled owner-bound provider and serial worker. */
public final class AsrPipeTraces {
 static LiveSegmentPipe pipe;static Trace trace;static Thread worker;static Runnable queuedWorker;
 static boolean started,executed,owned=true,throwFailure,throwCancel;static int warmPosts,batchPosts,closePosts,lastMask,cancels;static int lastCutoff=3;
 static final Object lock=new Object();static Exchange pending;
 static final JSONArray results=new JSONArray(),failures=new JSONArray();
 static final class Exchange {final JSONObject body;final String phase;final CountDownLatch release=new CountDownLatch(1);volatile JSONObject response;volatile Exception error;Exchange(JSONObject body,String phase){this.body=body;this.phase=phase;}}
 static final LiveSegmentPipe.Transport transport=new LiveSegmentPipe.Transport(){
  public void check(){if(!owned)throw new IllegalStateException("retired provider owner");}
  public JSONObject post(JSONObject body)throws Exception {
   boolean close=body.optBoolean("close");String phase=close?"closing":warmPosts==0?"warming":"sending";
   if(!close){double at=(double)Trace.read(pipe,"cutoff");lastCutoff=Double.isNaN(at)?-1:Double.isInfinite(at)?3:(int)at;}
   if(close)closePosts++;else if(phase.equals("warming")){warmPosts++;lastMask=mask(body);}else{batchPosts++;lastMask=mask(body);}
   Exchange next=new Exchange(body,phase);synchronized(lock){pending=next;lock.notifyAll();}
   if(!next.release.await(10,TimeUnit.SECONDS))throw new IllegalStateException("provider fixture timeout");
   synchronized(lock){pending=null;lock.notifyAll();}
   if(next.error!=null)throw next.error;return next.response;
  }
  public void cancelInFlight(){cancels++;if(throwCancel)throw new IllegalStateException("cancel fixture");}
 };
 static int mask(JSONObject body){
  int value=0;JSONArray frames=body.optJSONArray("frames"),vad=body.optJSONArray("vad");
  if(frames!=null)for(int i=0;i<frames.length();i++){if(!frames.getJSONObject(i).has("timestamp"))return 16;value|=frames.getJSONObject(i).getDouble("timestamp")==0?1:2;}
  if(vad!=null)for(int i=0;i<vad.length();i++)value|=vad.getJSONObject(i).getDouble("timestampMs")==0?4:8;
  return value;
 }
 static JSONArray frames(int mask,boolean valid){
  JSONArray result=new JSONArray();if((mask&1)!=0)result.put(new JSONObject().put("timestamp",0));if((mask&2)!=0)result.put(new JSONObject().put("timestamp",2));
  if(!valid)while(result.length()<33)result.put(new JSONObject().put("timestamp",0));return result;
 }
 static JSONArray vad(int mask){JSONArray result=new JSONArray();if((mask&4)!=0)result.put(new JSONObject().put("timestampMs",0));if((mask&8)!=0)result.put(new JSONObject().put("timestampMs",2));return result;}
 static String future(CompletableFuture<Boolean> value){return !value.isDone()?"pending":value.getNow(false)?"true":"false";}
 @SuppressWarnings("unchecked") static ArrayDeque<JSONObject> queue()throws Exception{return (ArrayDeque<JSONObject>)Trace.read(pipe,"queued");}
 static boolean finished()throws Exception{return (boolean)Trace.read(pipe,"finished");}
 static String phase()throws Exception {
  if(finished())return "finished";if(!started)return "cold";if(!executed)return "queued";
  synchronized(lock){return pending==null?"idle":pending.phase;}
 }
 static JSONObject observe()throws Exception {
  JSONArray queued=new JSONArray();synchronized(pipe){for(JSONObject body:queue())queued.put(mask(body));}
  double limit=(double)Trace.read(pipe,"cutoff");
  int projected=Double.isNaN(limit)?-1:Double.isInfinite(limit)?3:(int)limit;
  @SuppressWarnings("unchecked") CompletableFuture<Boolean> closed=(CompletableFuture<Boolean>)Trace.read(pipe,"closed");
  return Trace.fields("started",started,"phase",phase(),"owned",owned,"closing",Trace.read(pipe,"closing"),"cancelled",Trace.read(pipe,"cancelled"),"finished",finished(),
   "ready",future(pipe.ready()),"closed",future(closed),"cutoff",projected,"queued",queued,"lastMask",lastMask,"lastCutoff",lastCutoff,"accepted",accepted,
   "warmPosts",warmPosts,"batchPosts",batchPosts,"closePosts",closePosts,"results",results.length(),"failures",failures.length(),
   "failure",failures.isEmpty()?"none":failures.getString(failures.length()-1),"cancels",cancels);
 }
 static boolean accepted;
 static double limit(int value){return value==-1?Double.NaN:value==3?Double.POSITIVE_INFINITY:value;}
 static void await(String wanted)throws Exception {
  long until=System.nanoTime()+TimeUnit.SECONDS.toNanos(10);
  for(;;){
   String actual=phase();boolean stable=!wanted.equals("idle")||worker!=null&&worker.getState()==Thread.State.TIMED_WAITING;
   if(wanted.equals("finished"))stable=((CompletableFuture<?>)Trace.read(pipe,"closed")).isDone();
   if(actual.equals(wanted)&&stable)return;
   if(System.nanoTime()>until)throw new AssertionError("Expected "+wanted+", observed "+actual);
   Thread.sleep(1);
  }
 }
 static void ownership(boolean value)throws Exception{owned=value;trace.step("ownership",observe(),value);}
 static void start(boolean succeeds)throws Exception {
  accepted=false;
  try{pipe.start(succeeds?task->queuedWorker=task:task->{throw new RejectedExecutionException("worker fixture");});}
  catch(IllegalStateException callbackFailure){if(!throwFailure&&!throwCancel)throw callbackFailure;}
  started=true;if(throwCancel)trace.step("startRejectedBeforeNotification",observe());else trace.step("start",observe(),succeeds);
 }
 static void begin(String wanted,JSONObject...following)throws Exception {
  executed=true;worker=new Thread(queuedWorker,"asr-pipe-fixture");worker.start();await(wanted);
  ArrayList<JSONObject> actions=new ArrayList<>();actions.add(Trace.action("beginWarm"));actions.addAll(Arrays.asList(following));
  trace.macro("drain starts",observe(),actions.toArray(new JSONObject[0]));
 }
 static void offer(int value,boolean valid,String wanted,JSONObject...following)throws Exception {
  accepted=pipe.offer(frames(value,valid),vad(value));if(wanted!=null)await(wanted);
  ArrayList<JSONObject> actions=new ArrayList<>();actions.add(Trace.action("offer",value,valid));actions.addAll(Arrays.asList(following));
  trace.macro("offer",observe(),actions.toArray(new JSONObject[0]));
 }
 static void specialOffer(String mode)throws Exception {
  JSONArray frames=new JSONArray().put(new JSONObject().put("timestamp",0)),edges=new JSONArray();
  boolean fits=true;int projected=1;
  if(mode.equals("malformed-frame")){frames=new JSONArray().put(new JSONObject());projected=16;}
  else if(mode.startsWith("chars-")){
   JSONObject frame=frames.getJSONObject(0).put("pad","");
   int current=new JSONObject().put("frames",frames).put("vad",edges).toString().length();
   int size=LiveSegmentPipe.MAX_BATCH_CHARS+(mode.equals("chars-over")?1:0);
   frame.put("pad","x".repeat(size-current));fits=mode.equals("chars-boundary");
  }
  accepted=pipe.offer(frames,edges);trace.step("offer",observe(),projected,fits);
  if(mode.equals("immutable")){frames.getJSONObject(0).put("timestamp",2);trace.stutter("caller mutation cannot rewrite retained batch",observe());}
 }
 static void cutoff(int value)throws Exception{pipe.cutoff(limit(value));trace.step("cutoff",observe(),value);}
 static void close(boolean discard,int value,String wanted,JSONObject...following)throws Exception {
  pipe.close(discard,limit(value));if(wanted!=null)await(wanted);
  ArrayList<JSONObject> actions=new ArrayList<>();actions.add(Trace.action("close",discard,value));actions.addAll(Arrays.asList(following));
  trace.macro("close",observe(),actions.toArray(new JSONObject[0]));
 }
 static JSONObject response(String kind,boolean ack){
  int status=kind.equals("asr")?502:kind.equals("error")?503:200;
  JSONObject body=new JSONObject().put("closed",ack);
  if(kind.equals("asr"))body.put("code","ASR_FAILED");
  if(kind.equals("final"))body.put("final",new JSONObject().put("turnId","turn").put("text","fixture").put("mode","dictation").put("asrFinalFromSpeechEndMs",5));
  if(kind.equals("invalid"))body.put("final",new JSONObject().put("turnId","turn").put("text",42));
  return new JSONObject().put("status",status).put("body",kind.equals("malformed")?"{":body.toString());
 }
 static void reply(String action,String kind,boolean ack,String wanted,JSONObject...following)throws Exception {
  Exchange exchange;synchronized(lock){exchange=pending;}
  if(exchange==null)throw new AssertionError("No provider request");
  if(kind.equals("throw"))exchange.error=new IllegalStateException("provider fixture");else exchange.response=response(kind,ack);
  exchange.release.countDown();
  long until=System.nanoTime()+TimeUnit.SECONDS.toNanos(10);
  for(;;){synchronized(lock){if(pending!=exchange)break;}if(System.nanoTime()>until)throw new AssertionError("Provider reply was not consumed");Thread.sleep(1);}
  await(wanted);
  ArrayList<JSONObject> actions=new ArrayList<>();actions.add(action.equals("closeReply")?Trace.action(action,kind,ack):Trace.action(action,kind));actions.addAll(Arrays.asList(following));
  trace.macro(action,observe(),actions.toArray(new JSONObject[0]));
 }
 static void finish()throws Exception {close(false,3,"closing",Trace.action("take"),Trace.action("beginClose"));reply("closeReply","ok",true,"finished");}
 static void run(String mode)throws Exception {
  pipe=new LiveSegmentPipe(transport,new LiveSegmentPipe.Sink(){public void result(JSONObject value){results.put(value);}public void failed(String code){failures.put(code);if(throwFailure)throw new IllegalStateException("receiver fixture");}},"00000000-0000-0000-0000-000000000001","room");
  trace=new Trace("asr-pipe-"+mode,observe());
  try{
   if(mode.startsWith("rejected")){throwFailure=mode.equals("rejected-callback");throwCancel=mode.equals("rejected-cancel");start(false);offer(0,true,null);}
   else if(mode.equals("closed-before-start")){close(false,3,null);start(true);begin("closing",Trace.action("beginClose"));reply("closeReply","ok",true,"finished");}
   else if(mode.equals("owner-before-start")){ownership(false);start(true);begin("finished",Trace.action("beginClose"));}
   else{
    start(true);begin("warming");
    if(mode.equals("queue-bound")){for(int i=0;i<8;i++)offer(1,true,null);offer(1,true,null);close(true,3,null);reply("warmReply","ok",true,"closing",Trace.action("take"),Trace.action("beginClose"));reply("closeReply","ok",true,"finished");}
    else if(mode.equals("oversize")){offer(1,false,null);reply("warmReply","ok",true,"closing",Trace.action("take"),Trace.action("beginClose"));reply("closeReply","ok",false,"finished");}
    else if(mode.equals("cancel-warm")){close(true,1,null);reply("warmReply","ok",true,"closing",Trace.action("take"),Trace.action("beginClose"));reply("closeReply","invalid",true,"finished");}
    else if(mode.equals("owner-during-warm")){ownership(false);reply("warmReply","ok",true,"finished",Trace.action("beginClose"));}
    else if(mode.startsWith("warm-")){String kind=mode.substring(5);reply("warmReply",kind,false,"closing",Trace.action("beginClose"));reply("closeReply","ok",true,"finished");}
    else if(mode.equals("immutable")||mode.startsWith("chars-")||mode.equals("malformed-frame")){
     specialOffer(mode);
     if(mode.equals("chars-over")){reply("warmReply","ok",true,"closing",Trace.action("take"),Trace.action("beginClose"));reply("closeReply","ok",true,"finished");}
     else if(mode.equals("malformed-frame")){reply("warmReply","ok",true,"closing",Trace.action("take"),Trace.action("beginClose"));reply("closeReply","ok",true,"finished");}
     else{reply("warmReply","ok",true,"sending",Trace.action("take"));reply("batchReply","ok",true,"idle");finish();}
    }
    else if(mode.equals("fifo")){
     offer(1,true,null);offer(8,true,null);reply("warmReply","ok",true,"sending",Trace.action("take"));
     reply("batchReply","ok",true,"sending",Trace.action("take"));reply("batchReply","final",true,"idle");finish();
    }
    else if(mode.startsWith("cutoff-")){
     int cutoff=mode.equals("cutoff-nan")?-1:Integer.parseInt(mode.substring(7));offer(9,true,null);cutoff(cutoff);close(false,3,null);
     if(cutoff==-1){reply("warmReply","ok",true,"closing",Trace.action("take"),Trace.action("take"),Trace.action("beginClose"));}
     else{reply("warmReply","ok",true,"sending",Trace.action("take"));reply("batchReply","final",true,"closing",Trace.action("take"),Trace.action("beginClose"));}
     reply("closeReply","ok",true,"finished");
    }else{
     reply("warmReply","ok",true,"idle");
     if(mode.equals("normal")||mode.equals("final")){offer(15,true,"sending",Trace.action("take"));reply("batchReply",mode.equals("final")?"final":"ok",true,"idle");finish();}
     else if(mode.equals("cancel-batch")){offer(6,true,"sending",Trace.action("take"));close(true,0,null);reply("batchReply","final",true,"closing",Trace.action("take"),Trace.action("beginClose"));reply("closeReply","ok",true,"finished");}
     else if(mode.equals("owner-during-batch")){offer(1,true,"sending",Trace.action("take"));ownership(false);reply("batchReply","final",true,"finished",Trace.action("beginClose"));}
     else if(mode.startsWith("batch-")){offer(1,true,"sending",Trace.action("take"));String kind=mode.substring(6);if(kind.equals("asr")){reply("batchReply",kind,false,"idle");finish();}else{reply("batchReply",kind,false,"closing",Trace.action("beginClose"));reply("closeReply","ok",true,"finished");}}
     else if(mode.startsWith("close-")){close(false,3,"closing",Trace.action("take"),Trace.action("beginClose"));String kind=mode.substring(6);reply("closeReply",kind,!kind.equals("unconfirmed"),"finished");}
    }
   }
   System.out.println(trace.value);
  }finally{
   if(worker!=null&&worker.isAlive()){
    pipe.close(true,Double.POSITIVE_INFINITY);synchronized(lock){if(pending!=null){pending.error=new IllegalStateException("teardown");pending.release.countDown();}}
    worker.join(12000);
   }
  }
 }
 public static void main(String[]args)throws Exception {
  if(!args[0].equals("campaign")){run(args[0]);return;}
  JSONArray traces=new JSONArray();for(int i=1;i<args.length;i++){
   Process process=new ProcessBuilder(System.getProperty("java.home")+"/bin/java","-cp",System.getProperty("java.class.path"),AsrPipeTraces.class.getName(),args[i]).redirectError(ProcessBuilder.Redirect.INHERIT).start();
   String out=new String(process.getInputStream().readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);if(process.waitFor()!=0)throw new AssertionError("Pipe scenario failed: "+args[i]);traces.put(new JSONObject(out));
  }System.out.println(traces);
 }
}
