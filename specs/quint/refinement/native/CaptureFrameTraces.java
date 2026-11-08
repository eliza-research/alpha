package ai.elizaresearch.alphaphone;

import ai.eliza.voice.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.*;

/** Real LiveVoiceCapture loop. Only PCM reads, VAD results and cleanup outcomes are ports. */
public final class CaptureFrameTraces {
 static final class Window {final int probability,pieces,id;Window(int p,int pieces,int id){this.probability=p;this.pieces=pieces;this.id=id;}}
 static final class Source implements LiveVoiceCapture.Source {
  final BlockingQueue<Window> input=new LinkedBlockingQueue<>();final AtomicInteger waiting=new AtomicInteger();
  volatile boolean stopped,closed,failClose;volatile short[] seenBuffer;Window current;int delivered,reads,negativeReads;
  public int read(short[] buffer,int offset,int length){
   seenBuffer=buffer;
   try{
    if(current==null){waiting.incrementAndGet();current=input.take();delivered=0;}
    if(current.id==-1){negativeReads++;return -1;}
    if(stopped||current.id==0)return 0;
    int count=Math.min(length,512/current.pieces);Arrays.fill(buffer,offset,offset+count,(short)(current.id*100));reads++;delivered+=count;
    if(delivered==512){lastWindow=current;current=null;}return count;
   }catch(InterruptedException interrupted){Thread.currentThread().interrupt();return -1;}
  }
  public long captureTimeNs(long frame){return 1_000_000_000L+frame*62_500;}
  public String clock(){return "fixture";}
  public boolean echoCancelled(){return false;}
  public long bufferMs(){return 0;}
  public void requestStop(){stopped=true;input.offer(new Window(0,1,0));}
  public void close(){if(failClose)throw new IllegalStateException("source cleanup fixture");closed=true;}
 }
 static final class Detector implements LiveVoiceCapture.Detector {
  volatile float[] seenBuffer;volatile boolean closed,failClose,reset;final ArrayList<Integer> history=new ArrayList<>();
  public void reset(){reset=true;}
  public float[] process(float[] window){seenBuffer=window;int p=lastWindow.probability;synchronized(history){history.add(p);}if(p==-2000)return null;if(p==-2001)return new float[0];return new float[]{p==-1001?Float.NaN:p==-1000?Float.POSITIVE_INFINITY:p==-999?Float.NEGATIVE_INFINITY:p/1000f};}
  public void close(){if(failClose)throw new IllegalStateException("detector cleanup fixture");closed=true;}
 }
 public static volatile byte[] encodedBuffer;
 static Source source;static Detector detector;static LiveVoiceCapture capture;static Window lastWindow;
 static JSONArray packets;static CountDownLatch ended;static String error="none";
 static int issued;static Trace trace;
 static boolean zero(byte[] values){if(values==null)return true;for(byte value:values)if(value!=0)return false;return true;}
 static boolean zero(short[] values){if(values==null)return true;for(short value:values)if(value!=0)return false;return true;}
 static boolean zero(float[] values){if(values==null)return true;for(float value:values)if(value!=0)return false;return true;}
 static JSONObject observe()throws Exception {
  JSONArray history;synchronized(detector.history){history=new JSONArray(detector.history);}
  JSONArray snapshot;synchronized(packets){snapshot=new JSONArray(packets.toString());}
  return Trace.fields("started",Trace.read(capture,"startAttempted"),"running",Trace.read(capture,"running"),"ended",ended.getCount()==0,
   "history",history,"packets",snapshot,"reads",source.reads,"negativeReads",source.negativeReads,
   "attached",Trace.read(Trace.read(capture,"resource"),"active")!=null,"detectorReset",detector.reset,"sourceClosed",source.closed,"detectorClosed",detector.closed,"buffersZeroed",zero(source.seenBuffer)&&zero(detector.seenBuffer)&&zero(encodedBuffer),"error",error,"flush",ended.getCount()==0&&source.negativeReads==0);
 }
 static void await(java.util.function.BooleanSupplier predicate)throws Exception {long until=System.nanoTime()+TimeUnit.SECONDS.toNanos(5);while(!predicate.getAsBoolean()){if(System.nanoTime()>until)throw new AssertionError("Capture loop did not reach input boundary");Thread.sleep(1);}}
 static void begin()throws Exception {capture.start();await(()->source.waiting.get()>0);trace.step("start",observe());}
 static void window(int probability,int pieces)throws Exception {
  int waiting=source.waiting.get();source.input.put(new Window(probability,pieces,++issued));await(()->source.waiting.get()>waiting);trace.step("accept",observe(),probability,pieces);
 }
 static void stop(boolean sourceOk,boolean detectorOk,boolean call)throws Exception {
  source.failClose=!sourceOk;detector.failClose=!detectorOk;if(call)capture.interrupt("call");else capture.stop();
  if(!ended.await(5,TimeUnit.SECONDS))throw new AssertionError("No capture end");trace.step("stop",observe(),sourceOk,detectorOk,call);
 }
 static void failRead()throws Exception {
  source.input.put(new Window(0,1,-1));if(!ended.await(5,TimeUnit.SECONDS))throw new AssertionError("No error end");trace.step("readFailure",observe());
  capture.stop();trace.step("stop",observe(),true,true,false);
 }
 static void run(String mode)throws Exception {
  source=new Source();detector=new Detector();packets=new JSONArray();ended=new CountDownLatch(1);
  capture=new LiveVoiceCapture(null,"00000000-0000-0000-0000-000000000001",new LiveVoiceCapture.Sink(){
   public void frames(String id,JSONArray frames,JSONArray vad,float peak){
    JSONArray ids=new JSONArray(),edges=new JSONArray();
    for(int i=0;i<frames.length();i++){byte[] bytes=Base64.getDecoder().decode(frames.getJSONObject(i).getString("pcm16"));int sample=(short)((bytes[0]&255)|(bytes[1]<<8));ids.put(sample/100);}
    for(int i=0;i<vad.length();i++)edges.put(vad.getJSONObject(i).getString("type"));
    synchronized(packets){packets.put(new JSONObject().put("frames",ids).put("edges",edges).put("peak",Math.round(peak*32768/100)));}
   }
   public void ended(String id,String failure){error=failure==null?"none":failure;ended.countDown();}
  },"dictation",()->source,()->detector);
  trace=new Trace("capture-frames-"+mode,observe());
  if(mode.equals("probe-cleanup")){
   begin();for(int n=0;n<4;n++)window(500,1);source.failClose=true;capture.stop();
   System.out.println(new JSONObject().put("ended",ended.getCount()==0).put("buffersZeroed",zero(source.seenBuffer)&&zero(detector.seenBuffer)&&zero(encodedBuffer)).put("error",error));return;
  }
  try{
   begin();
   if(mode.equals("stop-empty"))stop(true,true,false);
   else if(mode.equals("silence")){for(int n=0;n<5;n++)window(0,1);stop(true,true,false);}
   else if(mode.equals("preroll")){for(int n=0;n<12;n++)window(0,1);window(500,1);window(500,1);stop(true,true,false);}
   else if(mode.equals("close-edge")){window(500,1);window(500,1);for(int n=0;n<16;n++)window(349,1);stop(true,true,false);}
   else if(mode.equals("middle-reset")){window(500,1);window(500,1);for(int n=0;n<15;n++)window(349,1);window(350,1);for(int n=0;n<16;n++)window(0,1);stop(true,true,false);}
   else if(mode.equals("non-finite")){window(500,1);window(-1001,1);window(500,1);window(500,1);for(int n=0;n<16;n++)window(n%2==0?-1000:-999,1);stop(true,true,false);}
   else if(mode.equals("missing-probability")){window(500,1);window(-2000,1);window(1001,1);window(500,1);for(int n=0;n<16;n++)window(n%2==0?-2000:-2001,1);stop(true,true,false);}
   else if(mode.equals("read-failure")){for(int n=0;n<3;n++)window(500,1);failRead();}
   else{for(int n=0;n<4;n++)window(500,mode.equals("partial-reads")?4:1);stop(!mode.equals("source-close-failure"),!mode.equals("detector-close-failure"),mode.equals("interrupt"));}
   System.out.println(trace.value);
  }finally{if(ended.getCount()!=0){source.failClose=false;detector.failClose=false;capture.stop();ended.await(5,TimeUnit.SECONDS);}}
 }
 public static void main(String[]args)throws Exception {
  if(!args[0].equals("campaign")){run(args[0]);return;}
  JSONArray traces=new JSONArray();for(int i=1;i<args.length;i++){
   Process process=new ProcessBuilder(System.getProperty("java.home")+"/bin/java","-cp",System.getProperty("java.class.path"),CaptureFrameTraces.class.getName(),args[i]).redirectError(ProcessBuilder.Redirect.INHERIT).start();
   String output=new String(process.getInputStream().readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);if(process.waitFor()!=0)throw new AssertionError("Frame scenario failed: "+args[i]);traces.put(new JSONObject(output));
  }System.out.println(traces);
 }
}
