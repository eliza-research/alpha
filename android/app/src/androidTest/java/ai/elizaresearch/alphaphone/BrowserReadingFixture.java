package ai.elizaresearch.alphaphone;

import android.app.AlertDialog;
import android.os.SystemClock;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

/** Shared parts of the reading journeys: a synthetic article in a real isolated HTTPS child, the
 * private loopback speech route, the native review dialog and the approval sequence. Synthetic data only. */
final class BrowserReadingFixture {
 static final String ARTICLE="Synthetic article for explicit reading.",SECRET="excluded-synthetic-marker";
 static final String MARKUP="<article><p>"+ARTICLE+"</p><form><p>"+SECRET+"</p><input value='"+SECRET+"'></form><p hidden>"+SECRET+"</p><p style='opacity:0'>"+SECRET+"</p><p aria-hidden='true'>"+SECRET+"</p><div contenteditable>"+SECRET+"</div></article>";
 /** Pages the review must refuse by their content, before any token or outbound speech. */
 static final String[] SENSITIVE_PAGES={"<article><div>Your vault</div><div>synthetic-only</div></article>","<article><div>Password: synthetic-only</div></article>","<aside>Recovery codes: synthetic-only</aside><article>Garden journal</article>","<article><span>Verification</span><span>code</span><div>123456</div></article>","<article>123456</article>","<input type='password' hidden><article>Garden journal</article>","<input autocomplete='one-time-code'><article>Garden journal</article>","<article>"+"garden ".repeat(10000)+"</article>"};
 final BrowserFlowInstrumentedTest child=new BrowserFlowInstrumentedTest();
 final String key="__alphaReading"+UUID.randomUUID().toString().replace("-","");

 String js(String code)throws Exception{return WebViewTestDriver.evaluate(code);}
 static MainActivity resumedActivity(){
  for(android.app.Activity activity:androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(androidx.test.runner.lifecycle.Stage.RESUMED))if(activity instanceof MainActivity)return (MainActivity)activity;
  throw new IllegalStateException("No resumed Alpha Activity");
 }
 void waitFor(String condition)throws Exception{for(int i=0;i<300;i++){if("true".equals(js("Boolean("+condition+")")))return;SystemClock.sleep(100);}fail("Browser reading state timed out: "+condition);}
 void invoke(String code)throws Exception{js("window.__readingResult=null;Promise.resolve("+code+").then(v=>window.__readingResult=JSON.stringify(v||{}),()=>window.__readingResult=JSON.stringify({error:true}))");}
 JSONObject result()throws Exception{waitFor("window.__readingResult!==null");return new JSONObject((String)new JSONTokener(js("window.__readingResult")).nextValue());}
 JSONObject call(String code)throws Exception{invoke(code);return result();}
 static String text(View view){String out=view instanceof TextView?((TextView)view).getText().toString():"";if(view instanceof ViewGroup){ViewGroup group=(ViewGroup)view;for(int i=0;i<group.getChildCount();i++)out+="\n"+text(group.getChildAt(i));}return out;}
 /** The review helper's own dialog, once it is showing. */
 AlertDialog dialog()throws Exception{AtomicReference<AlertDialog> result=new AtomicReference<>();for(int i=0;i<150;i++){BoundedActivityScenario.main(()->{MainActivity activity=resumedActivity();try{Object plugin=activity.getBridge().getPlugin("AlphaBrowser").getInstance();java.lang.reflect.Field reading=ai.eliza.plugins.browsersurface.BrowserTabHostPlugin.class.getDeclaredField("reading");reading.setAccessible(true);Object helper=reading.get(plugin);java.lang.reflect.Field field=ai.eliza.plugins.browsersurface.BrowserReviewedReading.class.getDeclaredField("dialog");field.setAccessible(true);result.set((AlertDialog)field.get(helper));}catch(Exception e){throw new AssertionError(e);}});if(result.get()!=null&&result.get().isShowing())return result.get();SystemClock.sleep(100);}throw new AssertionError("Actual review dialog missing");}
 static byte[] wav(){int samples=1600;ByteBuffer b=ByteBuffer.allocate(44+samples*2).order(ByteOrder.LITTLE_ENDIAN);b.put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt(36+samples*2).put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII)).putInt(16).putShort((short)1).putShort((short)1).putInt(8000).putInt(16000).putShort((short)2).putShort((short)16).put("data".getBytes(StandardCharsets.US_ASCII)).putInt(samples*2);return b.array();}
 /** Loopback paired-speech route: answers PairedSpeechContract's TTS path, echoing X-Request-Id. */
 static final class Server implements AutoCloseable {
  final ServerSocket socket=new ServerSocket(0,2,InetAddress.getByName("127.0.0.1"));final List<String> bodies=new CopyOnWriteArrayList<>();final ExecutorService worker=Executors.newSingleThreadExecutor();final Future<?> future;
  Server()throws Exception{future=worker.submit(()->{try{while(!socket.isClosed())try(Socket client=socket.accept()){client.setSoTimeout(10000);InputStream in=client.getInputStream();ByteArrayOutputStream header=new ByteArrayOutputStream();while(header.size()<16384){int c=in.read();if(c<0)throw new IOException();header.write(c);if(header.toString(StandardCharsets.US_ASCII).endsWith("\r\n\r\n"))break;}String headers=header.toString(StandardCharsets.US_ASCII);if(!headers.startsWith("POST "+PairedSpeechContract.TTS_PATH+" HTTP/")||!headers.contains("Bearer browser-reading-synthetic"))throw new IOException();String requestId="";for(String line:headers.split("\r\n"))if(line.toLowerCase(Locale.ROOT).startsWith("x-request-id:"))requestId=line.substring(13).trim();int length=0;for(String line:headers.split("\r\n"))if(line.toLowerCase(Locale.ROOT).startsWith("content-length:"))length=Integer.parseInt(line.substring(15).trim());if(length<1||length>32768)throw new IOException();byte[] body=in.readNBytes(length);if(body.length!=length)throw new IOException();bodies.add(new String(body,StandardCharsets.UTF_8));byte[] audio=wav();OutputStream out=client.getOutputStream();out.write(("HTTP/1.1 200 OK\r\nContent-Type: audio/wav\r\nContent-Length: "+audio.length+"\r\nX-Request-Id: "+requestId+"\r\nX-Eliza-Speech-Provider: "+PairedSpeechContract.TTS_PROVIDER+"\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));out.write(audio);out.flush();}}catch(IOException error){if(!socket.isClosed())throw new RuntimeException(error);}});}
  String origin(){return "http://127.0.0.1:"+socket.getLocalPort();}
  public void close()throws Exception{socket.close();worker.shutdownNow();future.get(5,TimeUnit.SECONDS);}
 }
 static String binding(String origin,long expiry){return "origin:"+JSONObject.quote(origin)+",ownerId:'synthetic-browser-owner',sessionId:'synthetic-browser-session',expiresAt:"+expiry;}
 static String review(String binding){return "Capacitor.Plugins.AlphaBrowser.reviewReading({...window.__readingArgs,"+binding+"})";}

 /** Opens Browser, records the presented tab and loads https://example.com/ in the isolated child. */
 void openExample()throws Exception{
  AppNavigation.liveMode();js(AppNavigation.request("Browser"));waitFor(AppNavigation.selected("Browser"));waitFor("window.__alphaTestNavigation?.status==='complete'");
  // The native page is withdrawn while the modal first-run access panel is open; answer it first, as an owner does.
  AppNavigation.declineStartupAccess();
  js("window.__readingNative=Capacitor.nativePromise;Capacitor.nativePromise=function(p,m,a){if(p==='AlphaBrowser'&&m==='present'&&a.id)window.__readingTab={session:a.session,id:a.id};return window.__readingNative.apply(this,arguments);}");
  String enter="(()=>{const e=document.querySelector('input[aria-label=Address]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'https://example.com/');e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()";
  js("(()=>{if(document.querySelector('input[aria-label=Address]'))"+enter+";else [...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='Edit address').click();})()");
  if("true".equals(js("!!document.querySelector('input[aria-label=Address]')")))js(enter);
  waitFor("window.__readingTab&&document.querySelector('[role=img][aria-label=\"Secure connection\"]')");
  assertEquals("true",child.child("typeof Capacitor==='undefined'&&location.origin==='https://example.com'"));
 }
 /** Replaces the child's body with {@code markup}, keeping the original for {@link #cleanup}. */
 void installBody(String markup)throws Exception{
  assertEquals("true",child.child("(()=>{if(window["+JSONObject.quote(key)+"])return false;const old=document.body;window["+JSONObject.quote(key)+"]=old;const next=document.createElement('body');next.innerHTML="+JSONObject.quote(markup)+";old.replaceWith(next);return true;})()"));
 }
 /** Stores the synthetic paired-speech token for the loopback route in the real credential slot. */
 void writeSpeechToken(String slot,String origin,long expiry)throws Exception{
  assertFalse(call("Capacitor.Plugins.AlphaConnection.secureWrite({slot:"+JSONObject.quote(slot)+",value:JSON.stringify({origin:"+JSONObject.quote(origin)+",identityId:'synthetic-browser-owner',token:'browser-reading-synthetic',expiresAt:"+expiry+"})})").has("error"));
 }
 /** The committed tab's current {session,id,navigation,url}, as the review needs it. */
 void captureArgs()throws Exception{
  js("window.__readingArgs=null;Capacitor.Plugins.AlphaBrowser.command({...window.__readingTab,command:'stop'}).then(v=>window.__readingArgs={session:v.session,id:v.id,navigation:v.navigation,url:v.url})");waitFor("window.__readingArgs");
 }
 /** Every SENSITIVE_PAGES body is refused before a review dialog, a token or outbound speech. */
 void sensitivePagesRefused(Server server,String binding)throws Exception{
  for(String sensitive:SENSITIVE_PAGES){
   assertEquals("true",child.child("document.body.innerHTML="+JSONObject.quote(sensitive)+";true"));
   JSONObject denied=call(review(binding));assertTrue(denied.toString(),denied.has("error"));assertFalse(denied.has("readingToken"));assertEquals(0,server.bodies.size());
   assertTrue(call("Capacitor.Plugins.AlphaVoiceCloud.synthesizeBrowserReading({"+binding+",readingToken:'not-issued',requestId:'blocked-fixture'})").has("error"));assertEquals(0,server.bodies.size());
  }
 }
 /**
  * With MARKUP in the child: a cancelled review sends nothing; an approved review reads the
  * reviewed article (not a later edit, never the excluded subtrees) exactly once, plays it, and
  * refuses a replay of its token.
  */
 void cancelThenApproveOnce(Server server,String binding)throws Exception{
  String review=review(binding);
  invoke(review);AlertDialog cancelled=dialog();BoundedActivityScenario.main(()->{assertTrue(text(cancelled.getWindow().getDecorView()).contains(ARTICLE));assertFalse(text(cancelled.getWindow().getDecorView()).contains(SECRET));cancelled.getButton(AlertDialog.BUTTON_NEGATIVE).performClick();});assertTrue(result().has("error"));assertEquals(0,server.bodies.size());
  invoke(review);AlertDialog approved=dialog();assertEquals(0,server.bodies.size());
  child.child("document.querySelector('article p').textContent='Changed after review';true");
  BoundedActivityScenario.main(()->approved.getButton(AlertDialog.BUTTON_POSITIVE).performClick());String token=result().getString("readingToken");
  String synth="Capacitor.Plugins.AlphaVoiceCloud.synthesizeBrowserReading({"+binding+",readingToken:"+JSONObject.quote(token)+",requestId:'69f8b4b6-cfe5-4de0-96ef-cdd304f4e4b2'})";
  JSONObject audio=call(synth);assertFalse(audio.toString(),audio.has("error"));assertEquals(1,server.bodies.size());assertEquals(ARTICLE,new JSONObject(server.bodies.get(0)).getString("text"));assertFalse(server.bodies.get(0).contains(SECRET));
  js("window.__readingEnded=false;Capacitor.Plugins.AlphaVoiceCloud.addListener('playbackEnded',()=>window.__readingEnded=true)");assertFalse(call("Capacitor.Plugins.AlphaVoiceCloud.play({playbackId:"+JSONObject.quote(audio.getString("playbackId"))+"})").has("error"));waitFor("window.__readingEnded===true");assertTrue(call(synth).has("error"));assertEquals(1,server.bodies.size());
 }

 @FunctionalInterface interface Cleanup { void run()throws Exception; }
 static Throwable attemptCleanup(Throwable prior,Cleanup action){
  try{action.run();}catch(Exception|AssertionError failure){if(prior==null)return failure;prior.addSuppressed(failure);}return prior;
 }
 /**
  * Runs every cleanup step even when one fails: the caller's own {@code first} steps (undoing what
  * it changed in the page), then stops playback, cancels the review, removes the
  * speech slot (when {@code slot} is set), restores the original body and the bridge hook. A
  * cleanup failure is suppressed into {@code primary}, or thrown when the journey itself passed.
  */
 void cleanup(Throwable primary,String slot,boolean installed,Cleanup... first)throws Exception{
  Throwable failure=primary;
  for(Cleanup step:first)failure=attemptCleanup(failure,step);
  failure=attemptCleanup(failure,()->call("Capacitor.Plugins.AlphaVoiceCloud.stopPlayback()"));
  failure=attemptCleanup(failure,()->call("Capacitor.Plugins.AlphaBrowser.cancelReading(window.__readingTab||{})"));
  // A speech token left in the credential vault outlives the run, so its removal must succeed.
  if(slot!=null)failure=attemptCleanup(failure,()->assertFalse("Synthetic speech token removed",call("Capacitor.Plugins.AlphaConnection.secureRemove({slot:"+JSONObject.quote(slot)+"})").has("error")));
  if(installed)failure=attemptCleanup(failure,()->assertEquals("true",child.child("(()=>{const old=window["+JSONObject.quote(key)+"];if(!old)return false;document.body.replaceWith(old);delete window["+JSONObject.quote(key)+"];return !window["+JSONObject.quote(key)+"];})()")));
  failure=attemptCleanup(failure,()->js("if(window.__readingNative)Capacitor.nativePromise=window.__readingNative;for(const k of ['__readingNative','__readingTab','__readingArgs','__readingResult','__readingEnded','__readingSettled'])delete window[k]"));
  if(primary==null&&failure!=null){if(failure instanceof Exception)throw (Exception)failure;throw (AssertionError)failure;}
 }
}
