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
/** Actual maximum attachment payload across WebView bridge, native CAS and encrypted disk. */
public final class LargeInboxAttachmentInstrumentedTest {
 private String js(String code)throws Exception{return WebViewTestDriver.evaluate(code);}
 private void ready(String expression)throws Exception{for(int i=0;i<600;i++){if("true".equals(js("Boolean("+expression+")")))return;SystemClock.sleep(100);}fail("Large attachment bridge state missing");}
 private JSONObject call(String expression)throws Exception{ready("window.Capacitor?.Plugins?.AlphaConnection");js("window.__largeInboxResult=null;Promise.resolve().then(async()=>{"+expression+"}).then(v=>window.__largeInboxResult=JSON.stringify(v||{}),()=>window.__largeInboxResult=JSON.stringify({error:true}))");ready("window.__largeInboxResult!==null");return new JSONObject((String)new JSONTokener(js("window.__largeInboxResult")).nextValue());}
 private static String sha(String value)throws Exception{StringBuilder out=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)))out.append(String.format(Locale.ROOT,"%02x",b&255));return out.toString();}
 private void prepare(String marker)throws Exception{ready("window.Capacitor?.Plugins?.AlphaConnection");js("window.__largeInboxRecord=(phase)=>JSON.stringify({version:1,marker:"+JSONObject.quote(marker)+",phase,proposal:{kind:'send',to:['fixture@example.invalid'],bodyText:'Synthetic only',attachments:[{name:'fixture.pdf',mimeType:'application/pdf',dataBase64:btoa('%PDF-1.7\\n'+' '.repeat(5*1024*1024-9))}]}})");}
 @Test public void maximumPayloadCasSurvivesRecreation()throws Exception{
  org.junit.Assume.assumeTrue("Explicit large Inbox bridge campaign","1".equals(InstrumentationRegistry.getArguments().getString("largeInboxAttachmentNative")));
  String marker="LARGE-INBOX-"+UUID.randomUUID(),draft="inbox-drafts:v1:"+marker,journal="inbox-operation:v1:"+sha(marker),ordinary="ordinary-test:"+marker;
  File folder=new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getNoBackupFilesDir(),"connection-credentials");Throwable primary=null;
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   try{
    prepare(marker);
    for(String slot:new String[]{draft,journal}){
     String key=JSONObject.quote(slot);
     assertEquals("saved",call("return Capacitor.Plugins.AlphaConnection.secureCompareExchange({slot:"+key+",expectedValue:null,value:__largeInboxRecord('review')});").getString("status"));
     assertEquals("saved",call("return Capacitor.Plugins.AlphaConnection.secureCompareExchange({slot:"+key+",expectedValue:__largeInboxRecord('review'),value:__largeInboxRecord('dispatching')});").getString("status"));
     assertEquals("conflict",call("return Capacitor.Plugins.AlphaConnection.secureCompareExchange({slot:"+key+",expectedValue:__largeInboxRecord('review'),value:__largeInboxRecord('stale')});").getString("status"));
     byte[] encrypted=Files.readAllBytes(new File(folder,sha(slot)).toPath());assertTrue(encrypted.length>6*1024*1024);assertFalse(new String(encrypted,StandardCharsets.ISO_8859_1).contains(marker));
    }
    scenario.recreate();prepare(marker);
    for(String slot:new String[]{draft,journal}){
     JSONObject result=call("const result=await Capacitor.Plugins.AlphaConnection.secureRead({slot:"+JSONObject.quote(slot)+"});return {exact:result.value===__largeInboxRecord('dispatching'),length:result.value.length};");assertTrue(result.getBoolean("exact"));assertTrue(result.getInt("length")>6*1024*1024);
    }
    assertTrue(call("await Capacitor.Plugins.AlphaConnection.secureWrite({slot:"+JSONObject.quote(ordinary)+",value:JSON.stringify({body:'x'.repeat(300000)})});return {unexpected:true};").has("error"));
   }catch(Exception|AssertionError failure){primary=failure;throw failure;}finally{
    try{for(String slot:new String[]{draft,journal,ordinary}){assertFalse(call("return Capacitor.Plugins.AlphaConnection.secureRemove({slot:"+JSONObject.quote(slot)+"});").has("error"));for(String suffix:new String[]{"",".bak",".new"})assertFalse(new File(folder,sha(slot)+suffix).exists());}js("delete window.__largeInboxRecord;delete window.__largeInboxResult");}catch(Exception|AssertionError cleanup){if(primary!=null)primary.addSuppressed(cleanup);else throw cleanup;}
   }
  }
 }
}
