package ai.eliza.sense;

import ai.alphacompute.alphaphone.Trace;
import android.content.Intent;
import android.media.*;
import java.lang.reflect.Field;
import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BooleanSupplier;
import org.json.JSONObject;

/** Runs the whole listener capture loop and recognition worker with synthetic PCM and callbacks. */
public final class ListenerInputTraces {
 final ListeningService service=new ListeningService();
 final Trace trace;
 final long leaseGeneration;
 long asrTicket=-1;
 ListenerInputTraces(Path state,String mode)throws Exception {
  StorePorts.preferences=new StorePorts.Preferences(state);
  new ListenerStore(new android.content.Context()).grantConsent(100,0);
  leaseGeneration=Listener.lease.acquire(1);renew();
  service.onCreate();service.deliverStart(new Intent(),0,1);
  ServicePorts.record.allowRead.countDown();
  await(()->ServicePorts.record!=null&&ServicePorts.record.entered.get()>0,"initial capture read");
  settleWorker();trace=new Trace("listener-input-"+mode,observe());
 }
 Object field(String name){try{return Trace.read(service,name);}catch(Exception e){throw new AssertionError(e);}}
 static void await(BooleanSupplier condition,String boundary)throws Exception {
  long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(6);
  while(!condition.getAsBoolean()){if(System.nanoTime()>=deadline)throw new AssertionError("No listener boundary: "+boundary);Thread.sleep(1);}
 }
 boolean recognizing(){return ((AtomicBoolean)field("recognizing")).get();}
 ExecutorService worker(){return (ExecutorService)field("recognizer");}
 void settleWorker()throws Exception {if(worker().isShutdown())worker().awaitTermination(5,TimeUnit.SECONDS);else worker().submit(()->{}).get(5,TimeUnit.SECONDS);}
 void renew(){if(!Listener.lease.renew(leaseGeneration,ServicePorts.now,1,true,true,true))throw new AssertionError("Fixture lease renewal rejected");}
 static Object captured(Runnable task,Class<?> type)throws Exception {
  for(Field f:task.getClass().getDeclaredFields())if(f.getType()==type){f.setAccessible(true);return f.get(task);}return null;
 }
 Runnable queuedAction()throws Exception {for(Runnable task:ServicePorts.queued)if(captured(task,WakePhrase.Action.class)!=null)return task;return null;}
 static boolean zero(float[] data){if(data==null)return true;for(float n:data)if(n!=0)return false;return true;}
 static boolean zero(short[] data){if(data==null)return true;for(short n:data)if(n!=0)return false;return true;}
 JSONObject observe()throws Exception {
  long quiet=(long)field("playbackQuietSince");Runnable action=queuedAction();
  float[] utterance=ListenerInputPorts.lastSamples;
  int chunks=ServicePorts.records.stream().mapToInt(r->r.chunks.get()).sum(),samples=ServicePorts.records.stream().mapToInt(r->r.samples.get()).sum();
  return Trace.fields("now",ServicePorts.now,"quietSince",quiet==Long.MAX_VALUE-1500?-1:quiet,
   "locked",ServicePorts.locked,"indicator",ServicePorts.indicator,"lease",Listener.lease.generation()>0,
   "lost",Listener.indicatorLost,"leaseStopPosted",((AtomicBoolean)field("leaseStopPosted")).get(),
   "inCall",Listener.inCall,"other",Listener.otherAppRecording,"silenced",Listener.micSilenced,
   "paused",StorePorts.preferences.getLong("pausedUntilMs",0)!=0,"capture",field("capture")!=null,
   "analyse",field("analyse"),"active",Trace.read(Listener.epoch,"active"),"epoch",Trace.read(Listener.epoch,"generation"),
   "readTicket",field("record")==null?-1:((AudioRecord)field("record")).readTicket,
   "allocations",ServicePorts.records.size(),"reapplyQueued",ServicePorts.queued.contains(field("reapply")),
   "status",ServicePorts.status,"destroyed",field("destroyed"),"recognizing",recognizing(),
   "calls",ListenerInputPorts.calls.get(),"asrTicket",asrTicket,"asrSamples",utterance==null?0:utterance.length,"samplesCleared",zero(utterance),
   "chunks",chunks,"samples",samples,"frameCleared",ServicePorts.records.stream().allMatch(r->zero(r.lastFrame)),
   "actionQueued",action==null?"none":captured(action,WakePhrase.Action.class)==WakePhrase.Action.INVOKE?"invoke":"pause",
   "actionTicket",action==null?-1:captured(action,long.class),"invocations",ServicePorts.invocations);
 }
 void step(String name,Object...args)throws Exception {trace.step(name,observe(),args);}
 void phone(int mode)throws Exception {ServicePorts.audio.mode(mode);step("phone",mode);}
 void recordings(boolean other,boolean silenced)throws Exception {
  List<AudioRecordingConfiguration> configs=new ArrayList<>();
  if(field("record")!=null)configs.add(new AudioRecordingConfiguration(1,silenced));
  if(other)configs.add(new AudioRecordingConfiguration(2,false));
  ServicePorts.audio.recordings(configs);step("recordings",other,silenced);
 }
 void playback(String kind)throws Exception {
  List<AudioPlaybackConfiguration> configs=kind.equals("ended")?List.of():List.of(new AudioPlaybackConfiguration(
   kind.equals("unknown")?null:new AudioAttributes(kind.equals("beep")?5:1)));
  ServicePorts.audio.playback(configs);step("playback",kind);
 }
 void time(long now)throws Exception {ServicePorts.now=now;renew();step("time",now);}
 void lock(boolean locked)throws Exception {ServicePorts.locked=locked;step("lock",locked);}
 void indicator(boolean visible)throws Exception {ServicePorts.indicator=visible;step("indicator",visible);}
 void loseLease()throws Exception {Listener.lease.revoke(leaseGeneration);step("loseLease");}
 void apply()throws Exception {
  AudioRecord previous=ServicePorts.record;Runnable reapply=(Runnable)field("reapply");
  if(ServicePorts.queued.remove(reapply))reapply.run();else service.deliverStart(new Intent(),0,1);
  if(previous!=ServicePorts.record){ServicePorts.record.allowRead.countDown();await(()->ServicePorts.record.entered.get()>0,"new capture read");}
  if(!recognizing())settleWorker();step("applyPolicy");
 }
 void frames(String kind,boolean entersAsr)throws Exception {
  AudioRecord record=(AudioRecord)field("record");if(record==null)throw new AssertionError("No capture record");
  int before=record.entered.get(),calls=ListenerInputPorts.calls.get(),added=0;
  int speech=kind.equals("short")?14:15,silence=35;
  int length=kind.equals("partial")?160:320;long ticket=Listener.epoch.ticket();
  for(int frame=0;frame<speech+silence;frame++)for(int part=0;part<320/length;part++){
   short[] input=new short[length];if(frame<speech)Arrays.fill(input,(short)16000);record.input.add(input);added++;
  }
  int expected=before+added;await(()->record.entered.get()>=expected,"frames consumed and next read entered");
  if(entersAsr){await(()->ListenerInputPorts.calls.get()>calls,"ASR entered");asrTicket=ticket;}
  else if(!recognizing()||ListenerInputPorts.calls.get()==0)settleWorker();
  step("frames",kind);
 }
 void asrReply(String kind)throws Exception {
  String words=kind.equals("invoke")?"hey alpha open":kind.equals("pause")?"alpha pause listening":"unaddressed words";
  ListenerInputPorts.responses.add(words);await(()->!recognizing(),"recognition returned");settleWorker();step("asrReply",kind);
 }
 void act()throws Exception {Runnable action=queuedAction();if(action==null)throw new AssertionError("No queued wake action");ServicePorts.queued.remove(action);action.run();step("act");}
 void destroy()throws Exception {service.onDestroy();if(!recognizing())settleWorker();step("destroy");}
 static JSONObject run(Path path,String mode)throws Exception {
  ListenerInputTraces test=new ListenerInputTraces(path,mode);
  try{
   switch(mode){
    case "invoke": test.frames("speech",true);test.asrReply("invoke");test.act();break;
    case "short": test.frames("short",false);break;
    case "ignored-words": test.frames("speech",true);test.asrReply("ignore");break;
    case "partial": test.frames("partial",true);test.asrReply("invoke");test.act();break;
    case "busy": test.frames("speech",true);test.frames("speech",false);test.asrReply("invoke");test.act();break;
    case "locked": test.frames("speech",true);test.asrReply("invoke");test.lock(true);test.act();break;
    case "locked-pause": test.frames("speech",true);test.asrReply("pause");test.lock(true);test.act();test.apply();break;
    case "call-holds-asr": test.frames("speech",true);test.phone(1);test.apply();test.asrReply("invoke");test.phone(0);test.apply();break;
    case "call-queued-action": test.frames("speech",true);test.asrReply("invoke");test.phone(2);test.act();test.apply();break;
    case "mode-partitions": test.phone(6);test.apply();test.phone(7);test.apply();break;
    case "mixed-recording": test.recordings(true,true);test.apply();break;
    case "other-recording": test.recordings(true,false);test.apply();test.recordings(false,false);test.apply();test.frames("speech",true);test.asrReply("invoke");test.act();break;
    case "mic-privacy": test.recordings(false,true);test.apply();test.frames("speech",false);test.recordings(false,false);test.apply();test.frames("speech",false);test.frames("speech",true);test.asrReply("invoke");test.act();break;
    case "playback-guard": test.playback("media");test.frames("speech",false);test.playback("ended");test.apply();test.time(11499);test.frames("speech",false);test.time(11500);test.frames("speech",true);test.asrReply("invoke");test.act();break;
    case "playback-held-asr": test.frames("speech",true);test.playback("unknown");test.asrReply("invoke");test.playback("ended");test.apply();break;
    case "system-sound": test.playback("beep");test.frames("speech",true);test.asrReply("invoke");test.act();break;
    case "indicator-hidden": test.indicator(false);test.frames("speech",false);test.apply();break;
    case "lease-revoked": test.loseLease();test.frames("speech",false);test.frames("short",false);test.apply();break;
    case "destroy-pending-asr": test.frames("speech",true);test.destroy();test.asrReply("invoke");break;
    case "destroy-queued-action": test.frames("speech",true);test.asrReply("invoke");test.destroy();test.act();break;
    default: throw new AssertionError(mode);
   }
   return test.trace.value;
  }finally{
   if(test.recognizing())ListenerInputPorts.responses.add("unaddressed words");
   if(!Boolean.TRUE.equals(test.field("destroyed")))test.service.onDestroy();
   test.worker().awaitTermination(5,TimeUnit.SECONDS);
  }
 }
 public static void main(String[]args)throws Exception {System.out.println(run(Path.of(args[0]),args[1]));}
}
