package ai.eliza.voice;

import ai.elizaresearch.alphaphone.Trace;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
import org.json.*;

/** Actual recognizer cache with worker probes held at the provider return boundary. */
public final class RecognizerAvailabilityTraces {
 static final class Probe {
  final String language;
  final CountDownLatch started=new CountDownLatch(1),release=new CountDownLatch(1);
  volatile long ticket;
  volatile RecognizerAvailability.Answer answer=RecognizerAvailability.Answer.UNANSWERED;
  FutureTask<Boolean> task;
  Probe(String language){this.language=language;}
 }
 final AtomicLong clock=new AtomicLong();
 final RecognizerAvailability source=new RecognizerAvailability(clock::get,60000,30000);
 final Map<Long,Probe> pending=new HashMap<>();
 final Trace trace;
 String reply="none";
 RecognizerAvailabilityTraces(String scenario)throws Exception {trace=new Trace("recognizer-availability-"+scenario,observe());}
 static String name(Enum<?> value){return value.name().toLowerCase(Locale.ROOT);}
 static String available(boolean value){return value?"available":"unavailable";}
 static RecognizerAvailability.Answer answer(String kind){return RecognizerAvailability.Answer.valueOf(kind.toUpperCase(Locale.ROOT));}
 static JSONObject map(JSONArray entries){return new JSONObject().put("quintCollection","map").put("entries",entries);}
 @SuppressWarnings("unchecked") JSONObject observe()throws Exception {
  Map<String,Object> entries=(Map<String,Object>)Trace.read(source,"entries");JSONArray cache=new JSONArray(),probes=new JSONArray();
  for(String language:List.of("en","es")){
   Object entry=entries.get(language);long until=entry==null?0:(long)Trace.read(entry,"until");
   cache.put(new JSONArray().put(language).put(new JSONObject()
    .put("kind",entry==null?"unknown":name((Enum<?>)Trace.read(entry,"known")))
    .put("ticket",entry==null?0:Trace.read(entry,"ticket")).put("until",until==Long.MAX_VALUE?-1:until)));
  }
  for(long ticket=1;ticket<=4;ticket++)probes.put(new JSONArray().put(ticket).put(pending.containsKey(ticket)?pending.get(ticket).language:"none"));
  return Trace.fields("entries",map(cache),"pending",map(probes),"now",clock.get(),
   "tickets",((AtomicLong)Trace.read(source,"tickets")).get(),"demotedAll",Trace.read(source,"demotedAll"),"reply",reply)
   .put("knownEn",name(source.known("en"))).put("knownEs",name(source.known("es")));
 }
 void step(String action,Object... args)throws Exception {trace.step(action,observe(),args);}
 void start(String language)throws Exception {
  Probe probe=new Probe(language);
  probe.task=new FutureTask<>(()->source.available(language,ticket->{
   probe.ticket=ticket;probe.started.countDown();
   try{if(!probe.release.await(8,TimeUnit.SECONDS))throw new AssertionError("Probe reply was never released");}
   catch(InterruptedException stopped){Thread.currentThread().interrupt();throw new AssertionError(stopped);}
   return probe.answer;
  }));
  Thread worker=new Thread(probe.task,"recognizer-probe-"+language);worker.setDaemon(true);worker.start();
  if(!probe.started.await(5,TimeUnit.SECONDS))throw new AssertionError("A new probe was not admitted: "+source.known(language));
  pending.put(probe.ticket,probe);step("beginProbe",language);
 }
 void complete(long ticket,String kind)throws Exception {
  Probe probe=pending.get(ticket);probe.answer=answer(kind);probe.release.countDown();
  reply=available(probe.task.get(5,TimeUnit.SECONDS));pending.remove(ticket);step("completeProbe",ticket,kind);
 }
 void cached(String language)throws Exception {reply=available(source.available(language,ticket->{throw new AssertionError("Unexpected fresh provider probe: "+ticket);}));step("cached",language);}
 void record(String language,String kind)throws Exception {reply=name(source.record(language,answer(kind)));step("recordNow",language,kind);}
 void late(String language,String kind,long ticket)throws Exception {reply=name(source.record(language,answer(kind),ticket));step("lateAnswer",language,kind,ticket);}
 void advance(long now)throws Exception {clock.set(now);step("advance",now);}
 void demote(String language,long duration)throws Exception {if(duration==-1)source.demote(language);else source.demote(language,duration);step("demote",language,duration);}
 void demoteAll()throws Exception {source.demoteAll();step("demoteAll");}
 static JSONObject run(String mode)throws Exception {
  RecognizerAvailabilityTraces test=new RecognizerAvailabilityTraces(mode);
  try{
   switch(mode){
    case "installed": test.start("en");test.complete(1,"installed");test.advance(90000);test.cached("en");break;
    case "absent": test.start("en");test.complete(1,"absent");test.advance(59999);test.cached("en");test.advance(60000);test.start("en");test.complete(2,"installed");break;
    case "unanswered": test.start("en");test.complete(1,"unanswered");test.advance(29999);test.cached("en");test.advance(30000);test.start("en");test.complete(2,"absent");break;
    case "late-recovery": test.start("en");test.complete(1,"unanswered");test.advance(29999);test.late("en","installed",1);test.cached("en");break;
    case "newer-answer": test.start("en");test.start("en");test.complete(2,"absent");test.complete(1,"installed");test.cached("en");break;
    case "newer-unanswered": test.start("en");test.start("en");test.complete(2,"unanswered");test.complete(1,"installed");test.cached("en");break;
    case "newer-expired-answer": test.start("en");test.start("en");test.complete(2,"absent");test.advance(60000);test.complete(1,"installed");test.start("en");test.complete(3,"installed");break;
    case "nonanswer-keeps-installed": test.record("en","installed");test.record("en","unanswered");test.cached("en");break;
    case "temporary-demote": test.start("en");test.demote("en",60000);test.demote("en",1);test.complete(1,"installed");test.advance(59999);test.cached("en");test.advance(60000);test.start("en");test.complete(2,"installed");break;
    case "extend-demote": test.demote("en",30000);test.advance(1);test.demote("en",60000);test.advance(60000);test.cached("en");test.advance(90000);test.start("en");test.complete(1,"absent");break;
    case "permanent-demote": test.start("en");test.demote("en",-1);test.demote("en",60000);test.advance(90000);test.complete(1,"installed");test.cached("en");break;
    case "expired-demote-late-answer": test.start("en");test.demote("en",1);test.advance(1);test.complete(1,"installed");test.cached("en");break;
    case "independent-languages": test.start("en");test.start("es");test.complete(2,"installed");test.complete(1,"absent");test.demote("en",-1);test.cached("es");break;
    case "global-demote": test.start("en");test.start("es");test.demoteAll();test.complete(2,"installed");test.complete(1,"absent");test.cached("en");test.cached("es");break;
    default: throw new AssertionError(mode);
   }
   return test.trace.value;
  }finally{for(Probe probe:test.pending.values())probe.release.countDown();}
 }
 public static void main(String[] args)throws Exception {JSONArray traces=new JSONArray();for(String mode:args)traces.put(run(mode));System.out.println(traces);}
}
