package ai.elizaresearch.alphaphone;

import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Real WebView bridge, encrypted native disk, concurrent claims and Activity recreation. */
@RunWith(AndroidJUnit4.class)
public class ActionJournalInstrumentedTest {
 private static String hash(String value)throws Exception{
  byte[] bytes=MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
  StringBuilder out=new StringBuilder();for(byte b:bytes)out.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return out.toString();
 }
 private JSONObject call(String expression)throws Exception{
  // The bridge can appear in a document that cold-start navigation will replace.
  // Wait for the live document before dispatching; never retry an effect call.
  try(StartupDocumentProbe startup=new StartupDocumentProbe()){startup.awaitReady(true);}
  assertEquals("Journal bridge is registered in the ready document","true",WebViewTestDriver.evaluate("Boolean(window.Capacitor?.Plugins?.AlphaActionJournal)"));
  WebViewTestDriver.evaluate("window.__journalResult=null;Promise.resolve().then(()=>"+expression+").then(v=>window.__journalResult=JSON.stringify(v),()=>window.__journalResult=JSON.stringify({error:true}))");
  for(int i=0;i<200;i++){
   String raw=WebViewTestDriver.evaluate("window.__journalResult");
   if(!"null".equals(raw))return new JSONObject((String)new JSONTokener(raw).nextValue());
   SystemClock.sleep(50);
  }
  throw new AssertionError("Journal bridge did not complete");
 }
 @Test public void journalSurvivesRecreationAndRejectsRepeatedEffects()throws Exception{
  String scope=hash(UUID.randomUUID().toString()),id=UUID.randomUUID().toString();
  JSONObject request=new JSONObject().put("scope",scope).put("proposalId",id).put("operationId",UUID.randomUUID().toString())
   .put("operationHash",hash("synthetic-operation")).put("record",new JSONObject().put("title","Synthetic journal plaintext sentinel"));
  String params=request.toString(),binding=new JSONObject().put("scope",scope).put("proposalId",id).toString();
  File folder=new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getNoBackupFilesDir(),"connection-credentials");
  String entrySlot="action-journal:v1:"+scope+":entry:"+id,indexSlot="action-journal:v1:"+scope+":index";
  try(BoundedActivityScenario<MainActivity> activity=BoundedActivityScenario.launch(MainActivity.class)){
   JSONObject reserved=call("Promise.all([Capacitor.Plugins.AlphaActionJournal.reserve("+params+"),Capacitor.Plugins.AlphaActionJournal.reserve("+params+")]).then(entries=>({entries}))");
   JSONArray rows=reserved.getJSONArray("entries");assertNotEquals(rows.getJSONObject(0).getBoolean("created"),rows.getJSONObject(1).getBoolean("created"));
   assertEquals("reserved",rows.getJSONObject(0).getJSONObject("entry").getString("phase"));
   JSONObject changedOperation=new JSONObject(params).put("operationId",UUID.randomUUID().toString());
   assertTrue("Replay must retain the original operation identity",call("Capacitor.Plugins.AlphaActionJournal.reserve("+changedOperation+")").has("error"));
   String encrypted=new String(Files.readAllBytes(new File(folder,hash(entrySlot)).toPath()),StandardCharsets.ISO_8859_1);
   assertFalse("Journal contents must be encrypted",encrypted.contains("Synthetic journal plaintext sentinel"));
   activity.recreate();
   JSONObject restored=call("Capacitor.Plugins.AlphaActionJournal.get("+binding+")").getJSONObject("entry");
   assertEquals(request.getString("operationId"),restored.getString("operationId"));
   JSONObject applying=new JSONObject(binding).put("attemptId",UUID.randomUUID().toString());
   assertEquals("applying",call("Capacitor.Plugins.AlphaActionJournal.markApplying("+applying+")").getJSONObject("entry").getString("phase"));
   activity.recreate();
   assertTrue("A recovered applying entry cannot issue another effect",call("Capacitor.Plugins.AlphaActionJournal.markApplying("+applying+")").has("error"));
   JSONObject done=new JSONObject(binding).put("status","succeeded").put("summary","Synthetic operation completed");
   assertEquals("terminal",call("Capacitor.Plugins.AlphaActionJournal.finish("+done+")").getJSONObject("entry").getString("phase"));
   assertFalse(call("Capacitor.Plugins.AlphaActionJournal.finish("+done+")").has("error"));
   done.put("result",new JSONObject().put("changed",true));assertTrue(call("Capacitor.Plugins.AlphaActionJournal.finish("+done+")").has("error"));done.remove("result");
   done.put("status","failed");assertTrue(call("Capacitor.Plugins.AlphaActionJournal.finish("+done+")").has("error"));
   request.put("record",new JSONObject().put("title","Changed immutable proposal"));assertTrue(call("Capacitor.Plugins.AlphaActionJournal.reserve("+request+")").has("error"));
   request.put("operationHash",hash("changed-operation"));assertTrue(call("Capacitor.Plugins.AlphaActionJournal.reserve("+request+")").has("error"));
   JSONObject other=new JSONObject(binding).put("scope",hash("other-scope"));assertTrue(call("Capacitor.Plugins.AlphaActionJournal.get("+other+")").isNull("entry"));
   assertEquals(1,call("Capacitor.Plugins.AlphaActionJournal.list("+new JSONObject().put("scope",scope)+")").getJSONArray("entries").length());
  }finally{
   for(String slot:new String[]{entrySlot,indexSlot})for(String suffix:new String[]{"",".bak",".new"})new File(folder,hash(slot)+suffix).delete();
  }
 }
 @Test public void mapsReadIsRetainedButRedactedFromHistory()throws Exception{
  String scope=hash(UUID.randomUUID().toString()),id=UUID.randomUUID().toString(),operationId=UUID.randomUUID().toString();
  JSONObject target=new JSONObject().put("kind","map-place").put("id","maps_"+UUID.randomUUID()).put("revision","1");
  JSONObject operation=new JSONObject().put("type","maps_read_selected").put("target",target);
  JSONObject request=new JSONObject().put("scope",scope).put("proposalId",id).put("operationId",operationId).put("operationHash",hash(operation.toString())).put("record",new JSONObject().put("operation",operation));
  JSONObject binding=new JSONObject().put("scope",scope).put("proposalId",id);
  File folder=new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getNoBackupFilesDir(),"connection-credentials");
  String entrySlot="action-journal:v1:"+scope+":entry:"+id,indexSlot="action-journal:v1:"+scope+":index";
  try(BoundedActivityScenario<MainActivity> activity=BoundedActivityScenario.launch(MainActivity.class)){
   assertTrue(call("Capacitor.Plugins.AlphaActionJournal.reserve("+request+")").getBoolean("created"));
   call("Capacitor.Plugins.AlphaActionJournal.markApplying("+new JSONObject(binding.toString()).put("attemptId",UUID.randomUUID().toString())+")");
   JSONObject fields=new JSONObject().put("kind","map-place").put("providerId","fixture-region").put("providerRevision","1").put("attribution","Synthetic fixture").put("label","Maps private snapshot sentinel").put("coordinate",new JSONObject().put("latitude",43.7384).put("longitude",7.4246));
   JSONObject maps=new JSONObject().put("kind","maps_read_selected").put("version",1).put("target",target).put("fields",fields);
   JSONObject done=new JSONObject(binding.toString()).put("status","succeeded").put("summary","Approved Maps read");
   assertTrue(call("Capacitor.Plugins.AlphaActionJournal.finish("+done+")").has("error"));
   done.put("result",new JSONObject().put("operationId",operationId).put("mapsResult",maps));
   assertFalse(call("Capacitor.Plugins.AlphaActionJournal.finish("+done+")").has("error"));
   activity.recreate();
   JSONObject restored=call("Capacitor.Plugins.AlphaActionJournal.get("+binding+")").getJSONObject("entry");
   assertEquals("Maps private snapshot sentinel",restored.getJSONObject("result").getJSONObject("mapsResult").getJSONObject("fields").getString("label"));
   JSONObject listed=call("Capacitor.Plugins.AlphaActionJournal.list("+new JSONObject().put("scope",scope)+")");
   assertEquals(1,listed.getJSONArray("entries").length());
   JSONObject summary=listed.getJSONArray("entries").getJSONObject(0).getJSONObject("result");
   assertFalse("Passive history excludes the entire Maps result envelope",summary.has("mapsResult"));
   assertTrue(summary.getBoolean("mapsReadRetained"));assertEquals(operationId,summary.getString("operationId"));
   String history=listed.toString();
   assertFalse(history.contains("Maps private snapshot sentinel"));assertFalse(history.contains("43.7384"));assertFalse(history.contains("\"coordinate\""));assertFalse(history.contains("\"latitude\""));
   activity.recreate();
   JSONObject afterHistory=call("Capacitor.Plugins.AlphaActionJournal.get("+binding+")").getJSONObject("entry");
   assertEquals("History projection must not rewrite the durable replay receipt",restored.toString(),afterHistory.toString());
   assertFalse("Identical persisted completion remains idempotent",call("Capacitor.Plugins.AlphaActionJournal.finish("+done+")").has("error"));
   String encrypted=new String(Files.readAllBytes(new File(folder,hash(entrySlot)).toPath()),StandardCharsets.ISO_8859_1);assertFalse(encrypted.contains("Maps private snapshot sentinel"));
   fields.put("label","Changed snapshot");assertTrue(call("Capacitor.Plugins.AlphaActionJournal.finish("+done+")").has("error"));
  }finally{for(String slot:new String[]{entrySlot,indexSlot})for(String suffix:new String[]{"",".bak",".new"})new File(folder,hash(slot)+suffix).delete();}
 }

}
