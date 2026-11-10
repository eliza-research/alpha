package ai.alphacompute.alphaphone;

import android.app.AlertDialog;
import android.os.SystemClock;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.*;
import org.junit.Test;
import java.util.*;
import static org.junit.Assert.*;

/** Synthetic article in a real isolated HTTPS child; actual private HTTP and MediaPlayer. The
 * resident (execution 'device') path is covered by residentReadingTokenIsSingleUseAndBound. */
public final class BrowserReadingInstrumentedTest {
 private final BrowserReadingFixture reading=new BrowserReadingFixture();
 private String js(String code)throws Exception{return reading.js(code);}
 private void waitFor(String condition)throws Exception{reading.waitFor(condition);}
 private void invoke(String code)throws Exception{reading.invoke(code);}
 private JSONObject result()throws Exception{return reading.result();}
 private JSONObject call(String code)throws Exception{return reading.call(code);}
 @Test public void explicitImmutableReviewExcludesSensitiveSubtreesAndRejectsReplay()throws Exception{
  org.junit.Assume.assumeTrue("Explicit browser reading synthetic HTTP fixture", "1".equals(InstrumentationRegistry.getArguments().getString("browserReading")));
  assertTrue("Run against a test-mocks app build: only that build admits this fixture's loopback HTTP route (any other build refuses it, correctly)",BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  try(BrowserReadingFixture.Server server=new BrowserReadingFixture.Server();BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   String origin=server.origin(),slot="remote:"+origin;long expiry=System.currentTimeMillis()+600000;
   String binding=BrowserReadingFixture.binding(origin,expiry);
   boolean installed=false;Throwable primary=null;
   try{
    reading.openExample();
    reading.installBody(BrowserReadingFixture.MARKUP);installed=true;
    reading.writeSpeechToken(slot,origin,expiry);
    reading.captureArgs();
    reading.cancelThenApproveOnce(server,binding);
   }catch(Exception|AssertionError failure){primary=failure;throw failure;}finally{reading.cleanup(primary,slot,installed);}
  }
 }
 /** {ok, message} of a plugin call, so refusals can be told apart from a later speech failure. */
 private JSONObject settle(String code)throws Exception{
  js("window.__readingSettled=null;Promise.resolve("+code+").then(v=>window.__readingSettled={ok:true,value:v??{}},e=>window.__readingSettled={ok:false,message:String(e?.message??'')})");
  waitFor("window.__readingSettled!==null");return new JSONObject(js("window.__readingSettled"));
 }
 private static final String EXPIRED="Reading approval expired";
 /** Review and approve one device reading; returns its token. */
 private String approveDevice(String binding)throws Exception{
  invoke("Capacitor.Plugins.AlphaBrowser.reviewReading({...window.__readingArgs,execution:'device',"+binding+"})");
  AlertDialog approved=reading.dialog();
  BoundedActivityScenario.main(()->approved.getButton(AlertDialog.BUTTON_POSITIVE).performClick());
  JSONObject review=result();assertFalse("Device reading approved: "+review,review.has("error"));return review.getString("readingToken");
 }
 /**
  * The resident path production uses (createNativeReadingVoice prefers the resident binding and
  * calls AlphaVoiceCloud.synthesizeLocalBrowserReading with execution 'device'). One approved token:
  * execution other than 'device', a wrong session, a wrong owner and an unknown token are refused
  * without spending it; the exact binding is accepted once (synthesis may then fail on an image
  * without the packaged speech models, which is a later, different error); a replay is refused. An
  * expired binding and a cancelled review are refused too. Nothing is sent to any host.
  */
 @Test public void residentReadingTokenIsSingleUseAndBound()throws Exception{
  org.junit.Assume.assumeTrue("Explicit browser reading fixture", "1".equals(InstrumentationRegistry.getArguments().getString("browserReading")));
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   String article="Synthetic article for resident reading.";boolean installed=false;Throwable primary=null;
   try{
    reading.openExample();
    reading.installBody("<article><p>"+article+"</p></article>");installed=true;
    reading.captureArgs();
    long expiry=System.currentTimeMillis()+100_000;
    String binding="ownerId:'synthetic-resident-owner',sessionId:'synthetic-resident-session',expiresAt:"+expiry;
    String token=approveDevice(binding);
    String local="Capacitor.Plugins.AlphaVoiceCloud.synthesizeLocalBrowserReading({ownerId:%s,sessionId:%s,expiresAt:"+expiry+",readingToken:%s,execution:%s,requestId:'resident-reading-'+Date.now()})";
    java.util.function.BiFunction<String[],String,String> with=(parts,tok)->String.format(local,JSONObject.quote(parts[0]),JSONObject.quote(parts[1]),JSONObject.quote(tok),JSONObject.quote(parts[2]));
    String[] exact={"synthetic-resident-owner","synthetic-resident-session","device"};
    // Refusals that never spend the approval.
    assertEquals("Not device execution",EXPIRED,settle(with.apply(new String[]{exact[0],exact[1],"agent"},token)).optString("message"));
    assertEquals("Wrong session",EXPIRED,settle(with.apply(new String[]{exact[0],"other-session",exact[2]},token)).optString("message"));
    assertEquals("Wrong owner",EXPIRED,settle(with.apply(new String[]{"other-owner",exact[1],exact[2]},token)).optString("message"));
    assertEquals("Unknown token",EXPIRED,settle(with.apply(exact,UUID.randomUUID().toString())).optString("message"));
    // The exact binding is accepted once; any later failure is synthesis, never the approval.
    JSONObject accepted=settle(with.apply(exact,token));
    assertFalse("The valid token is accepted: "+accepted,!accepted.getBoolean("ok")&&EXPIRED.equals(accepted.optString("message")));
    call("Capacitor.Plugins.AlphaVoiceCloud.stopPlayback()");call("Capacitor.Plugins.AlphaBrowser.cancelReading(window.__readingTab||{})");
    assertEquals("A replayed token is refused",EXPIRED,settle(with.apply(exact,token)).optString("message"));
    // Expired: the binding's own expiry passes before the token is used.
    long soon=System.currentTimeMillis()+4000;
    String expiring=approveDevice("ownerId:'synthetic-resident-owner',sessionId:'synthetic-resident-session',expiresAt:"+soon);
    SystemClock.sleep(Math.max(0,soon-System.currentTimeMillis())+500);
    assertEquals("An expired binding is refused",EXPIRED,settle(String.format("Capacitor.Plugins.AlphaVoiceCloud.synthesizeLocalBrowserReading({ownerId:'synthetic-resident-owner',sessionId:'synthetic-resident-session',expiresAt:"+soon+",readingToken:%s,execution:'device',requestId:'resident-expired'})",JSONObject.quote(expiring))).optString("message"));
    // Cancelled: cancelling the approved review withdraws its token.
    String cancelled=approveDevice(binding);
    assertFalse(call("Capacitor.Plugins.AlphaBrowser.cancelReading(window.__readingTab||{})").has("error"));
    assertEquals("A cancelled review's token is refused",EXPIRED,settle(with.apply(exact,cancelled)).optString("message"));
   }catch(Exception|AssertionError failure){primary=failure;throw failure;}finally{reading.cleanup(primary,null,installed);}
  }
 }
}
