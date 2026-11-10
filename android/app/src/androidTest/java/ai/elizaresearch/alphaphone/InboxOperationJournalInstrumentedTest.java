package ai.elizaresearch.alphaphone;
import android.os.SystemClock;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.*;
import org.json.*;
import org.junit.Test;
import static org.junit.Assert.*;
/** Gated native encrypted-draft CAS and activity recreation, no fixture network requests. */
public final class InboxOperationJournalInstrumentedTest {
 private String js(String code)throws Exception{return WebViewTestDriver.evaluate(code);}
 private void ready(String expression)throws Exception{for(int i=0;i<200;i++){if("true".equals(js("Boolean("+expression+")")))return;SystemClock.sleep(100);}fail("Draft fixture state missing");}
 private JSONObject call(String expression)throws Exception{ready("window.Capacitor?.Plugins?.AlphaConnection");js("window.__inboxOperationNative=null;Promise.resolve().then(()=>"+expression+").then(v=>window.__inboxOperationNative=JSON.stringify(v||{}),()=>window.__inboxOperationNative=JSON.stringify({error:true}))");ready("window.__inboxOperationNative!==null");return new JSONObject((String)new JSONTokener(js("window.__inboxOperationNative")).nextValue());}
 private static String sha(String value)throws Exception{StringBuilder out=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)))out.append(String.format(Locale.ROOT,"%02x",b&255));return out.toString();}
 @Test public void encryptedOperationIsAtomicAndSurvivesRecreation()throws Exception{
  org.junit.Assume.assumeTrue("Explicit Inbox operation native campaign","1".equals(InstrumentationRegistry.getArguments().getString("inboxOperationNative")));
  String slot="inbox-operation:v1:"+sha(UUID.randomUUID().toString()),sentinel=new JSONObject().put("version",1).put("owner","synthetic-owner").put("grantId","synthetic-grant").put("requestId",UUID.randomUUID().toString()).put("phase","dispatching").put("body","SYNTHETIC-PRIVATE-OPERATION-"+UUID.randomUUID()).toString();File folder=new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getNoBackupFilesDir(),"connection-credentials");Throwable primary=null;
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   try{
    JSONObject create=new JSONObject().put("slot",slot).put("expectedValue",JSONObject.NULL).put("value",sentinel);assertEquals("saved",call("Capacitor.Plugins.AlphaConnection.secureCompareExchange("+create+")").getString("status"));
    assertFalse(new String(Files.readAllBytes(new File(folder,sha(slot)).toPath()),StandardCharsets.ISO_8859_1).contains(sentinel));
    JSONObject stale=new JSONObject(create.toString()).put("value","STALE OVERWRITE");assertEquals("conflict",call("Capacitor.Plugins.AlphaConnection.secureCompareExchange("+stale+")").getString("status"));
    scenario.recreate();assertEquals(sentinel,call("Capacitor.Plugins.AlphaConnection.secureRead({slot:"+JSONObject.quote(slot)+"})").getString("value"));
    JSONObject invalid=new JSONObject(create.toString()).put("slot","inbox-operation:v1:invalid");assertTrue(call("Capacitor.Plugins.AlphaConnection.secureCompareExchange("+invalid+")").has("error"));
    JSONObject remove=new JSONObject().put("slot",slot).put("expectedValue",sentinel).put("value",JSONObject.NULL);assertEquals("saved",call("Capacitor.Plugins.AlphaConnection.secureCompareExchange("+remove+")").getString("status"));
    assertTrue(call("Capacitor.Plugins.AlphaConnection.secureRead({slot:"+JSONObject.quote(slot)+"})").isNull("value"));
   }catch(Exception|AssertionError failure){primary=failure;throw failure;}finally{try{assertFalse(call("Capacitor.Plugins.AlphaConnection.secureRemove({slot:"+JSONObject.quote(slot)+"})").has("error"));for(String suffix:new String[]{"",".bak",".new"})assertFalse(new File(folder,sha(slot)+suffix).exists());}catch(Exception|AssertionError cleanup){if(primary!=null)primary.addSuppressed(cleanup);else throw cleanup;}}
  }
 }
}
