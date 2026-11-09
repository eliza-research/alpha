package ai.eliza.voice;

import ai.alphacompute.alphaphone.Trace;
import java.util.Arrays;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import org.json.*;

/** Drives the actual warm-up writer at its output-factory and audio port boundaries. */
public final class SpeechWarmupTraces {
 static final class Port implements StreamingSpeechPlayback.Output {
  final CountDownLatch opening=new CountDownLatch(1),open=new CountDownLatch(1);
  final Semaphore writing=new Semaphore(0),reply=new Semaphore(0);
  final AtomicLong now=new AtomicLong();
  final AtomicInteger plays=new AtomicInteger(),writes=new AtomicInteger(),releases=new AtomicInteger();
  final AtomicBoolean silent=new AtomicBoolean(true),aborted=new AtomicBoolean();
  final String mode;volatile long replyTime;
  Port(String mode){this.mode=mode;}
  StreamingSpeechPlayback.Output open(){opening.countDown();hold(open);if(mode.equals("open-fail"))throw new IllegalStateException("controlled open");return this;}
  public void play(){plays.incrementAndGet();if(mode.equals("play-fail"))throw new IllegalStateException("controlled play");}
  public int write(float[] samples,int offset,int length){
   if(length!=480||offset!=0||samples.length!=480)throw new AssertionError("Unexpected 20 ms output window");
   for(float value:samples)if(value!=0f)silent.set(false);
   writes.incrementAndGet();writing.release();hold(reply);now.set(replyTime);
   if(mode.equals("write-fail"))throw new IllegalStateException("controlled write");
   return mode.equals("zero")?0:mode.equals("negative")?-1:length;
  }
  public long playedFrames(){return 0;}
  public long presentationNs(long frame){return -1;}
  public void setVolume(float value){}
  public void abort(){aborted.set(true);if(mode.equals("abort-fail"))throw new IllegalStateException("controlled abort");}
  public void stop(){throw new AssertionError("Warmup aborts rather than stops");}
  public void release(){releases.incrementAndGet();if(mode.equals("release-fail"))throw new IllegalStateException("controlled release");}
 }
 static void hold(CountDownLatch latch){
  boolean interrupted=false;while(true)try{if(!latch.await(5,TimeUnit.SECONDS))throw new AssertionError("Port deadline");break;}catch(InterruptedException expected){interrupted=true;}
  if(interrupted)Thread.currentThread().interrupt();
 }
 static void hold(Semaphore permits){
  boolean interrupted=false;while(true)try{if(!permits.tryAcquire(5,TimeUnit.SECONDS))throw new AssertionError("Write deadline");break;}catch(InterruptedException expected){interrupted=true;}
  if(interrupted)Thread.currentThread().interrupt();
 }
 static void await(Semaphore permits)throws Exception {if(!permits.tryAcquire(5,TimeUnit.SECONDS))throw new AssertionError("Warmup write did not arrive");}
 static void await(CountDownLatch latch)throws Exception {if(!latch.await(5,TimeUnit.SECONDS))throw new AssertionError("Warmup boundary did not arrive");}
 static JSONObject state(SpeechOutputWarmup warmup,Port port)throws Exception {
  Thread writer=warmup==null?null:(Thread)Trace.read(warmup,"writer");
  return Trace.fields("created",warmup!=null,"closed",warmup!=null&&Boolean.TRUE.equals(Trace.read(warmup,"closed")),
   "writerLive",writer!=null&&writer.isAlive(),"outputOwned",warmup!=null&&Trace.read(warmup,"output")!=null,
   "opens",port.opening.getCount()==0?1:0,"plays",port.plays.get(),"writes",port.writes.get(),
   "aborted",port.aborted.get(),"releases",port.releases.get(),"silent",port.silent.get(),"now",port.now.get());
 }
 static void join(SpeechOutputWarmup warmup)throws Exception {
  Thread writer=(Thread)Trace.read(warmup,"writer");writer.join(5000);if(writer.isAlive())throw new AssertionError("Writer did not retire");
 }
 static JSONObject scenario(String mode)throws Exception {
  Port port=new Port(mode);Trace trace=new Trace("speech-warmup-"+mode,state(null,port));
  SpeechOutputWarmup warmup=new SpeechOutputWarmup(24000,port::open,port.now::get);
  try{
   await(port.opening);trace.step("create",state(warmup,port));
   if(mode.equals("late-open")){warmup.close();trace.step("close",state(warmup,port));}
   port.open.countDown();
   if(mode.equals("open-fail")||mode.equals("play-fail")||mode.equals("late-open")){
    join(warmup);trace.step("finishOpen",state(warmup,port),mode.equals("open-fail")?"fail":mode.equals("play-fail")?"play_fail":"success");
   }else{
    await(port.writing);trace.step("finishOpen",state(warmup,port),"success");
    if(Arrays.asList("close-write","abort-fail","release-fail").contains(mode)){
     warmup.close();trace.step("close",state(warmup,port));warmup.close();trace.step("close",state(warmup,port));
    }
    if(mode.equals("near-deadline")){
     port.replyTime=SpeechOutputWarmup.LIMIT_NS-1;port.reply.release();await(port.writing);
     trace.step("finishWrite",state(warmup,port),port.replyTime,"success");
    }
    String result=Arrays.asList("zero","negative","write-fail").contains(mode)?"refused":"success";
    port.replyTime=result.equals("refused")?1:SpeechOutputWarmup.LIMIT_NS;port.reply.release();join(warmup);
    trace.step("finishWrite",state(warmup,port),port.replyTime,result);
   }
   warmup.close();trace.step("close",state(warmup,port));return trace.value;
  }finally{port.open.countDown();port.reply.release();warmup.close();join(warmup);}
 }
 public static void main(String[] args)throws Exception {
  JSONArray traces=new JSONArray();for(String mode:args)traces.put(scenario(mode));System.out.println(traces);
 }
}
