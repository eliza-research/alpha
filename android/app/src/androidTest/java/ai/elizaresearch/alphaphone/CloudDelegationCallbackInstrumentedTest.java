package ai.elizaresearch.alphaphone;

import android.content.Intent;
import android.net.Uri;
import android.os.SystemClock;
import android.util.Base64;
import androidx.test.platform.app.InstrumentationRegistry;
import java.security.SecureRandom;
import org.json.JSONObject;
import org.json.JSONTokener;
import org.junit.Test;
import static org.junit.Assert.*;

/** Owned synthetic callbacks through the actual Activity and Capacitor bridge. No auth exchange. */
public final class CloudDelegationCallbackInstrumentedTest {
 private static String state(){byte[] bytes=new byte[32];new SecureRandom().nextBytes(bytes);return Base64.encodeToString(bytes,Base64.URL_SAFE|Base64.NO_PADDING|Base64.NO_WRAP);}
 private static Intent intent(String uri){return new Intent(Intent.ACTION_VIEW,Uri.parse(uri),InstrumentationRegistry.getInstrumentation().getTargetContext(),MainActivity.class);}
 private static String uri(String state,String code){return "alphaphone://cloud-delegation?state="+state+"&code="+code;}
 private static void gate(){org.junit.Assume.assumeTrue("Explicit synthetic Cloud callback campaign","1".equals(InstrumentationRegistry.getArguments().getString("cloudDelegationNative")));}
 private String js(String code)throws Exception{return WebViewTestDriver.evaluate(code);}
 private void waitFor(String condition)throws Exception{long deadline=SystemClock.elapsedRealtime()+30000;while(SystemClock.elapsedRealtime()<deadline){if("true".equals(js("Boolean("+condition+")")))return;SystemClock.sleep(100);}fail("Callback bridge condition timed out: "+condition);}
 private JSONObject call(String body)throws Exception{
  waitFor("window.Capacitor?.Plugins?.AlphaConnection?.readDelegationCallback");
  js("window.__cloudCallbackTest=null;Promise.resolve().then(async()=>{"+body+"}).then(value=>window.__cloudCallbackTest=JSON.stringify({value}),error=>window.__cloudCallbackTest=JSON.stringify({error:String(error)}))");
  waitFor("window.__cloudCallbackTest!==null");
  JSONObject result=new JSONObject((String)new JSONTokener(js("window.__cloudCallbackTest")).nextValue());assertFalse(result.toString(),result.has("error"));return result.getJSONObject("value");
 }
 private JSONObject read()throws Exception{return call("return await Capacitor.Plugins.AlphaConnection.readDelegationCallback();");}
 private void clear(String state)throws Exception{call("await Capacitor.Plugins.AlphaConnection.clearDelegationCallback({state:"+JSONObject.quote(state)+"});return {};");}
 private void expect(String state,String code)throws Exception{JSONObject callback=read().getJSONObject("callback");assertEquals(state,callback.getString("state"));assertEquals(code,callback.getString("code"));assertFalse(callback.has("error"));}
 private void warm(String value)throws Exception{BoundedActivityScenario.main(()->InstrumentationRegistry.getInstrumentation().getTargetContext().startActivity(intent(value).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_SINGLE_TOP)));}
 private void cleanup(String state)throws Exception{clear(state);assertTrue(read().isNull("callback"));}

 @Test public void coldCallbackSurvivesRecreationAndOnlyMatchingClear()throws Exception{
  gate();String owned=state();
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(intent(uri(owned,"synthetic-cold")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK))){
   try{expect(owned,"synthetic-cold");clear(state());expect(owned,"synthetic-cold");scenario.recreate();expect(owned,"synthetic-cold");clear(owned);assertTrue(read().isNull("callback"));scenario.recreate();assertTrue(read().isNull("callback"));}
   finally{cleanup(owned);}
  }
 }

 @Test public void warmCallbackRejectsMalformedLinksAndRetainsLatestOnRecreation()throws Exception{
  gate();String first=state(),latest=state();
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(intent(uri(first,"synthetic-first")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK))){
   try{
    expect(first,"synthetic-first");
    call("window.__cloudCallbackEvents=0;window.__cloudCallbackListener=await Capacitor.Plugins.AlphaConnection.addListener('cloudDelegationCallback',()=>window.__cloudCallbackEvents++);return {};");
    // A retained cold event may be delivered when the listener attaches; drain it before warm delivery.
    SystemClock.sleep(250);js("window.__cloudCallbackEvents=0");
    warm(uri(latest,"synthetic-warm"));waitFor("window.__cloudCallbackEvents>0");expect(latest,"synthetic-warm");
    String base=uri(latest,"malformed");
    String[] rejected={base+"&code=duplicate",base+"&state="+first,base+"&error=access_denied",base+"&extra=x",base+"#fragment",base.replace("alphaphone:","https:"),base.replace("cloud-delegation?","cloud-delegation/path?"),base.replace("cloud-delegation?","cloud-delegation:99?"),base.replace("cloud-delegation?","user@cloud-delegation?"),"alphaphone://cloud-delegation?state=short&code=x","alphaphone://cloud-delegation?state="+latest+"&code="};
    for(String bad:rejected){int before=Integer.parseInt(js("window.__cloudCallbackEvents"));warm(bad);SystemClock.sleep(200);expect(latest,"synthetic-warm");assertEquals("Malformed link emitted callback",before,Integer.parseInt(js("window.__cloudCallbackEvents")));}
    clear(first);expect(latest,"synthetic-warm");scenario.recreate();expect(latest,"synthetic-warm");
    clear(latest);assertTrue(read().isNull("callback"));scenario.recreate();assertTrue(read().isNull("callback"));
    warm("alphaphone://cloud-delegation?state="+latest+"&error=access_denied");
    long deadline=SystemClock.elapsedRealtime()+5000;JSONObject value=read();while(value.isNull("callback")&&SystemClock.elapsedRealtime()<deadline){SystemClock.sleep(100);value=read();}
    JSONObject error=value.getJSONObject("callback");assertEquals(latest,error.getString("state"));assertEquals("access_denied",error.getString("error"));assertFalse(error.has("code"));
   }finally{clear(first);cleanup(latest);}
  }
 }
}
