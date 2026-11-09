package ai.eliza.voice;

import ai.elizaresearch.alphaphone.Trace;
import android.content.Context;
import android.os.ParcelFileDescriptor;
import android.os.Handler;
import android.os.Looper;
import android.speech.SpeechRecognizer;
import java.util.Queue;
import java.util.concurrent.CancellationException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

/** Observes a real recognition session with a controlled platform recognizer and pipe. */
public final class OnDeviceRecognizerTraces {
 final Context context=new Context();
 final OnDeviceRecognizer source=new OnDeviceRecognizer(context);
 SpeechRecognizer service;
 OnDeviceRecognizerSessionTest.Finishing finishing;
 final Trace trace;
 boolean stalled;
 String outcome="none";
 OnDeviceRecognizerTraces(String scenario)throws Exception {
  if(!OnDeviceRecognizer.available(context))throw new AssertionError("Fixture model should be installed");
  trace=new Trace("on-device-recognizer-"+scenario,observe());
 }
 Object field(String name){try{return Trace.read(source,name);}catch(Exception error){throw new AssertionError(error);}}
 boolean flag(String name){return Boolean.TRUE.equals(field(name));}
 ParcelFileDescriptor[] pipe(){return (ParcelFileDescriptor[])field("pipe");}
 static String failure(String raw){
  if(raw==null)return "none";
  if(raw.equals(OnDeviceRecognizer.BACKLOG))return "backlog";
  if(raw.equals(RecognizerUnavailable.TIMEOUT))return "timeout";
  if(raw.equals("error 12")||raw.equals("error 13"))return "language_unavailable";
  if(raw.startsWith("error "))return "service_error";
  return raw;
 }
 static String transcript(String text){return text==null?"none":text.isEmpty()?"empty":"heard";}
 static String result(Object value){
  if(value instanceof String text)return transcript(text);
  if(value instanceof CancellationException)return "cancelled";
  if(value instanceof RecognizerUnavailable unavailable)return failure(unavailable.getMessage());
  if(value instanceof IllegalStateException)return "already_finished";
  throw new AssertionError("Unexpected finish result: "+value);
 }
 @SuppressWarnings("unchecked") JSONObject observe(){
  ParcelFileDescriptor[] pipe=pipe();Queue<byte[]> queue=(Queue<byte[]>)field("audio");
  int bytes=pipe==null?0:pipe[0].received().length;
  int queuedBytes=queue.stream().mapToInt(chunk->chunk.length).sum();
  boolean available=OnDeviceRecognizer.available(context);
  if(SpeechRecognizer.probes.get()!=1)throw new AssertionError("Unexpected support probe during session");
  return Trace.fields("pipe",pipe!=null,"serviceStarted",service!=null,"recognizerOwned",field("recognizer")!=null,
   "released",flag("released"),"serviceDestroyed",service!=null&&service.destroyed,
   "serviceCancelled",service!=null&&service.cancelled,"readClosed",pipe!=null&&pipe[0].isClosed(),
   "writeClosed",pipe!=null&&pipe[1].isClosed(),"finished",flag("finished"),"stopped",flag("stopped"),
   "answered",source.answered(),"finishPending",finishing!=null,
   "cancelPending",flag("stopped")&&flag("released")&&!source.answered(),"stalled",stalled,
   "bytes",bytes,"backlog",source.backlogBytes(),"queuedBytes",queuedBytes,
   "transcript",transcript((String)field("text")),"failure",failure((String)field("failure")),
   "outcome",outcome,"demoted",!available);
 }
 void step(String action,Object... args){trace.step(action,observe(),args);}
 void captureService()throws Exception {if(service==null&&pipe()!=null)service=OnDeviceRecognizerSessionTest.listening(null);}
 void settled()throws Exception {
  if(service!=null)OnDeviceRecognizerSessionTest.released(service);
  if(pipe()!=null)OnDeviceRecognizerSessionTest.waitFor(()->pipe()[1].isClosed(),"writer closed");
  if(finishing!=null){outcome=result(finishing.await());finishing=null;}
 }
 void feed(int length)throws Exception {
  byte[] input=OnDeviceRecognizerSessionTest.pcm(length,1);
  try{
   outcome=source.feed(input)?"accepted":"refused";
   if(outcome.equals("accepted")){
    captureService();
    if(!stalled)OnDeviceRecognizerSessionTest.waitFor(()->source.backlogBytes()==0,"accepted bytes written");
    else if(length>0)OnDeviceRecognizerSessionTest.waitFor(()->((Queue<?>)field("audio")).isEmpty(),"writer owns held first chunk");
   }else if(source.answered())settled();
  }catch(IllegalStateException finished){outcome="already_finished";}
  step("feed",length);
 }
 void stall(){pipe()[0].stall();stalled=true;step("stall");}
 void finish(long limit)throws Exception {
  if(flag("finished")||source.answered()||flag("stopped")){
   try{outcome=result(source.finish(limit));}catch(RuntimeException|RecognizerUnavailable error){outcome=result(error);}
  }else{
   finishing=new OnDeviceRecognizerSessionTest.Finishing(source,limit);
   OnDeviceRecognizerSessionTest.waitFor(()->flag("finished"),"finish admitted");
   captureService();
   if(!stalled)OnDeviceRecognizerSessionTest.waitFor(()->pipe()[1].isClosed(),"finish sent end of audio");
   outcome="pending";
  }
  step("finish");
 }
 void callback(String kind)throws Exception {
  switch(kind){
   case "heard": service.listener.onResults(OnDeviceRecognizerSessionTest.heard("synthetic words"));break;
   case "empty": service.listener.onError(SpeechRecognizer.ERROR_NO_MATCH);break;
   case "service_error": service.listener.onError(SpeechRecognizer.ERROR_SERVER_DISCONNECTED);break;
   case "language_unavailable": service.listener.onError(SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE);break;
   default: throw new AssertionError(kind);
  }
  settled();step("callback",kind);
 }
 void timeout()throws Exception {settled();step("timeout");}
 void cancel()throws Exception {
  source.cancel();OnDeviceRecognizerSessionTest.waitFor(source::answered,"cancel answered");
  settled();step("cancel");
 }
 void cancelBeforeCallbackDelivery()throws Exception {
  CountDownLatch entered=new CountDownLatch(1),resume=new CountDownLatch(1);
  new Handler(Looper.getMainLooper()).post(()->{
   entered.countDown();try{resume.await();}catch(InterruptedException error){Thread.currentThread().interrupt();}
  });
  if(!entered.await(5,TimeUnit.SECONDS))throw new AssertionError("Could not hold main queue");
  try{
   source.cancel();
   OnDeviceRecognizerSessionTest.waitFor(()->pipe()[1].isClosed(),"cancel woke writer while main held");
   step("requestCancel");
   service.listener.onError(SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE);
   step("callback","language_unavailable");
  }finally{resume.countDown();}
  OnDeviceRecognizerSessionTest.waitFor(source::answered,"cancel answered");settled();step("settleCancel");
 }
 static JSONObject run(String mode)throws Exception {
  OnDeviceRecognizerTraces test=new OnDeviceRecognizerTraces(mode);
  try{
   switch(mode){
    case "incremental": test.feed(6401);test.feed(2);test.feed(0);test.finish(5000);test.callback("heard");test.feed(2);test.finish(5000);break;
    case "early-result": test.feed(2);test.callback("heard");test.feed(2);test.finish(5000);break;
    case "no-speech": test.feed(2);test.callback("empty");test.finish(5000);break;
    case "active-language-error": test.feed(2);test.finish(5000);test.callback("language_unavailable");break;
    case "duplicate-language-error": test.feed(2);test.callback("heard");test.callback("language_unavailable");test.finish(5000);break;
    case "cancelled-language-error": test.feed(2);test.cancel();test.callback("language_unavailable");test.finish(5000);break;
    case "cancel-before-callback-delivery": test.feed(2);test.cancelBeforeCallbackDelivery();test.finish(5000);break;
    case "other-error": test.feed(2);test.callback("service_error");test.callback("heard");test.finish(5000);break;
    case "timeout": test.feed(2);test.finish(2000);test.timeout();test.callback("heard");break;
    case "finish-empty": test.finish(5000);test.callback("empty");break;
    case "cancel-pending": test.feed(2);test.finish(5000);test.cancel();break;
    case "cancel-before-open": test.cancel();test.feed(2);test.finish(5000);break;
    case "cancel-after-result": test.feed(2);test.callback("heard");test.cancel();test.finish(5000);break;
    case "backlog-boundary": test.feed(0);test.stall();test.feed((int)OnDeviceRecognizer.MAX_BACKLOG_BYTES);test.feed(1);test.feed(2);test.finish(5000);break;
    case "cancel-stalled": test.feed(0);test.stall();test.feed(2);test.finish(5000);test.cancel();break;
    default: throw new AssertionError(mode);
   }
   return test.trace.value;
  }finally{if(!test.source.answered())test.source.cancel();}
 }
 public static void main(String[]args)throws Exception {System.out.println(run(args[0]));}
}
