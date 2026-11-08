package ai.elizaresearch.alphaphone;
import android.os.SystemClock;
import android.content.*;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.runner.lifecycle.*;
import java.io.*;
import java.lang.reflect.Field;
import java.nio.file.Files;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.json.*;
import org.junit.*;
import static org.junit.Assert.*;
/** Real paired host + UI approval + Android execution. Explicit external fixture gate only. */
public final class PairedMapsInstrumentedTest {
 private static String canonical(Object value)throws Exception{if(value instanceof JSONObject){JSONObject o=(JSONObject)value;java.util.ArrayList<String> keys=new java.util.ArrayList<>();java.util.Iterator<String> it=o.keys();while(it.hasNext())keys.add(it.next());java.util.Collections.sort(keys);StringBuilder out=new StringBuilder("{");for(String k:keys){if(out.length()>1)out.append(',');out.append(JSONObject.quote(k)).append(':').append(canonical(o.get(k)));}return out.append('}').toString();}if(value instanceof JSONArray){JSONArray a=(JSONArray)value;StringBuilder out=new StringBuilder("[");for(int i=0;i<a.length();i++){if(i>0)out.append(',');out.append(canonical(a.get(i)));}return out.append(']').toString();}return value instanceof String?JSONObject.quote((String)value):String.valueOf(value);}
 private static String stage="startup";
 private static final String ORIGIN="http://10.0.2.2:47860";
 private static void until(String expression,long timeout)throws Exception{long end=SystemClock.elapsedRealtime()+timeout;while(SystemClock.elapsedRealtime()<end){if("true".equals(NotesSecureFixture.evaluate("Boolean("+expression+")")))return;SystemClock.sleep(100);}fail("Maps stage "+stage+" timed out after "+timeout+"ms; predicateSha256="+hash(expression)+"; visibleState="+NotesSecureFixture.evaluate("JSON.stringify({view:document.documentElement.dataset.activeView,conversationHidden:document.querySelector('[data-alpha-layer=conversation]')?.getAttribute('aria-hidden'),connected:!document.querySelector('.alpha-connection-scrim')})"));}
 private static void click(String label)throws Exception{String q="[...document.querySelectorAll('button')].find(e=>(e.getAttribute('aria-label')==="+JSONObject.quote(label)+"||e.textContent.trim()==="+JSONObject.quote(label)+")&&e.getClientRects().length&&!e.disabled)";until(q,30000);NotesSecureFixture.evaluate("("+q+").click()");}
 private static MainActivity activity(){for(android.app.Activity a:ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED))if(a instanceof MainActivity)return (MainActivity)a;throw new IllegalStateException("No resumed Alpha");}
 private static AlphaConnectionPlugin store(){return (AlphaConnectionPlugin)activity().getBridge().getPlugin("AlphaConnection").getInstance();}
 private static AlphaVoiceCloudPlugin voice(){return (AlphaVoiceCloudPlugin)activity().getBridge().getPlugin("AlphaVoiceCloud").getInstance();}
 private static void field(Object o,String name,Object value)throws Exception{Field f=o.getClass().getDeclaredField(name);f.setAccessible(true);f.set(o,value);}
 private static String hash(String raw)throws Exception{assertNotNull("Required private native credential",raw);StringBuilder out=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(raw.getBytes(StandardCharsets.UTF_8)))out.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return out.toString();}
 // Match production JSON.stringify bytes: Android JSONArray escapes URL slashes.
 private static String arrayHash(JSONArray values)throws Exception{String encoded=NotesSecureFixture.evaluate("JSON.stringify("+values.toString()+")");return hash(new JSONArray("["+encoded+"]").getString(0));}
 private static String credential(String slot)throws Exception{AtomicReference<String> value=new AtomicReference<>();BoundedActivityScenario.main(()->{try{value.set(store().readCredentialSlot(slot));}catch(Exception e){throw new IllegalStateException("Private store read failed");}});return value.get();}
 private void open(String name)throws Exception{NotesSecureFixture.evaluate(AppNavigation.request(name));until(AppNavigation.selected(name),30000);until("window.__alphaTestNavigation?.status==='complete'",30000);}
 private void closeConversationOnMaps()throws Exception{
  click("Minimize chat");
  until("document.querySelector('[data-alpha-layer=conversation]')?.getAttribute('aria-hidden')==='true'",30000);
  until(AppNavigation.selected("Maps"),30000);
 }
 private void send(String prompt)throws Exception{NotesSecureFixture.evaluate(AppNavigation.type());until(AppNavigation.composer(),15000);NotesSecureFixture.evaluate("(()=>{const e=("+AppNavigation.composer()+");Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,"+JSONObject.quote(prompt)+");e.dispatchEvent(new Event('input',{bubbles:true}));})()");click("Send");}

 private static final String APPROVAL="[...document.querySelectorAll('button')].find(e=>e.textContent.includes('Approve: maps read selected')&&e.getClientRects().length&&!e.disabled)";
 private void input(String label,String value)throws Exception{
  String q="document.querySelector('input[aria-label="+JSONObject.quote(label)+"]')";until(q,30000);
  NotesSecureFixture.evaluate("(()=>{const e="+q+";Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,"+JSONObject.quote(value)+");e.dispatchEvent(new Event('input',{bubbles:true}));})()");
  until(q+".value==="+JSONObject.quote(value),30000);NotesSecureFixture.evaluate(q+".dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
 }
 private void noNavigation()throws Exception{
  until("!document.querySelector('[aria-label=\"End navigation\"]')",30000);
  AtomicReference<Integer> count=new AtomicReference<>();BoundedActivityScenario.main(()->{try{Object p=activity().getBridge().getPlugin("ElizaLocation").getInstance();Field f=p.getClass().getDeclaredField("watches");f.setAccessible(true);count.set(((java.util.Map<?,?>)f.get(p)).size());}catch(Exception e){throw new AssertionError(e);}});assertEquals(Integer.valueOf(0),count.get());
 }
 private JSONObject journal(String scope)throws Exception{return NotesSecureFixture.call("Capacitor.Plugins.AlphaActionJournal.list({scope:"+JSONObject.quote(scope)+"})");}
 private JSONObject approveRead(String scope,String stage,JSONObject expected)throws Exception{
  int completed=Integer.parseInt(NotesSecureFixture.evaluate("[...document.querySelectorAll('button')].filter(e=>e.textContent.includes('Completed')).length"));int before=journal(scope).getJSONArray("entries").length();assertEquals("true",NotesSecureFixture.evaluate("document.body.textContent.includes('This shares location information. It does not start navigation.')"));noNavigation();
  NotesSecureFixture.evaluate("("+APPROVAL+").click()");
  JSONObject full=null;long end=SystemClock.elapsedRealtime()+60000;
  while(SystemClock.elapsedRealtime()<end){JSONArray entries=journal(scope).getJSONArray("entries");assertTrue("No extra action journal entries",entries.length()<=before+1);if(entries.length()==before+1){for(int i=0;i<entries.length();i++){JSONObject row=entries.getJSONObject(i);String kind=row.getJSONObject("record").getJSONObject("operation").getJSONObject("target").getString("kind");if(expected.getString("kind").equals(kind)&&"terminal".equals(row.optString("phase"))){full=NotesSecureFixture.call("Capacitor.Plugins.AlphaActionJournal.get("+new JSONObject().put("scope",scope).put("proposalId",row.getString("proposalId"))+")").getJSONObject("entry");break;}}}if(full!=null)break;SystemClock.sleep(100);}
  assertNotNull("Native terminal Maps receipt",full);assertEquals("succeeded",full.getString("status"));JSONObject op=full.getJSONObject("record").getJSONObject("operation"),result=full.getJSONObject("result").getJSONObject("mapsResult");assertEquals("maps_read_selected",op.getString("type"));assertEquals("maps_read_selected",result.getString("kind"));assertEquals(1,result.getInt("version"));assertEquals(canonical(op.getJSONObject("target")),canonical(result.getJSONObject("target")));assertEquals(canonical(expected),canonical(result.getJSONObject("fields")));
  until("[...document.querySelectorAll('button')].filter(e=>e.textContent.includes('Completed')).length>"+completed,30000);String history=journal(scope).toString();assertFalse("History excludes Maps payloads",history.contains("\"mapsResult\""));assertFalse(history.contains("\"coordinate\""));assertFalse(history.contains("\"latitude\""));assertTrue(history.contains("mapsReadRetained"));noNavigation();
  JSONObject proof=new JSONObject().put("stage",stage).put("proposalId",full.getString("proposalId")).put("operationId",full.getString("operationId")).put("digest",full.getJSONObject("record").getString("digest")).put("target",op.getJSONObject("target")).put("result",result).put("binding",new JSONObject().put("ownerId",full.getJSONObject("record").getString("ownerId")).put("agentId",full.getJSONObject("record").getString("agentId")).put("origin",full.getJSONObject("record").getString("origin")).put("installationId",full.getJSONObject("record").getString("installationId")).put("enrollmentId",full.getJSONObject("record").getString("enrollmentId")).put("sessionSha256",hash(full.getJSONObject("record").getString("sessionId"))));
  android.os.Bundle status=new android.os.Bundle();status.putString("pairedMapsStage",stage);InstrumentationRegistry.getInstrumentation().sendStatus(0,status);return proof;
 }
 @Test public void selectedPlaceRouteAndStaleApproval()throws Exception{
  Assume.assumeTrue("Owned paired Maps campaign only","1".equals(InstrumentationRegistry.getArguments().getString("pairedMaps")));
  assertTrue("Disposable secondary Android user required",android.os.Process.myUid()/100000>0);
  Context c=InstrumentationRegistry.getInstrumentation().getTargetContext();File fixture=new File(c.getFilesDir(),"paired-maps-fixture.json"),complete=new File(c.getFilesDir(),"paired-maps-complete.json");assertFalse("Fresh completion evidence required",complete.exists());
  JSONObject config=new JSONObject(new String(Files.readAllBytes(fixture.toPath()),StandardCharsets.UTF_8));assertEquals(ORIGIN,config.getString("origin"));assertEquals(UUID.fromString(config.getString("runId")).toString(),config.getString("runId"));assertEquals("alpha-osm-monaco",config.getJSONObject("placeFields").getString("providerId"));
  String previous=null,slot=null,scope=null;boolean admitted=false;Throwable primary=null;
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   until("document.querySelector('.os')",30000);AppNavigation.liveMode();slot="device:"+arrayHash(new JSONArray().put(ORIGIN).put(config.getString("ownerId")).put(config.getString("agentId")));assertNull(credential("remote:"+ORIGIN));assertNull(credential(slot));previous=NotesSecureFixture.evaluate("localStorage.getItem('alpha.connection.selection.v1')");
   try{
    NotesSecureFixture.evaluate("localStorage.removeItem('alpha.connection.selection.v1')");scenario.recreate();until("document.querySelector('.alpha-connection-scrim')",30000);NotesSecureFixture.evaluate("[...document.querySelectorAll('.alpha-connection summary')].find(e=>e.textContent==='Local development agent').click()");
    NotesSecureFixture.evaluateSensitive("(()=>{const inputs=[...document.querySelectorAll('.alpha-connection details')].find(e=>e.querySelector('summary')?.textContent==='Local development agent').querySelectorAll('input');inputs[0].value="+JSONObject.quote(ORIGIN)+";inputs[1].value="+JSONObject.quote(config.getString("code"))+";})()");admitted=true;click("Connect local agent");until("!document.querySelector('.alpha-connection-scrim')",90000);
    open("Settings");click("Agent connection");until("document.querySelector('.alpha-connection-scrim')",15000);NotesSecureFixture.evaluate("[...document.querySelectorAll('.alpha-connection summary')].find(e=>e.textContent==='Conversation history').click()");click("Load conversations");String restore="[...document.querySelectorAll('.alpha-connection-agent')].find(e=>e.querySelector('strong')?.textContent==="+JSONObject.quote(config.getString("conversationTitle"))+")?.querySelector('button')";until(restore+"&&!("+restore+").disabled",30000);NotesSecureFixture.evaluate("("+restore+").click()");until("!document.querySelector('.alpha-connection-scrim')",30000);
    JSONObject device=new JSONObject(credential(slot));scope=arrayHash(new JSONArray().put(slot.substring(7)).put(device.getString("installationId")));assertEquals(0,journal(scope).getJSONArray("entries").length());
    open("Maps");until("document.querySelector('[data-alpha-map-plane]')?.dataset.mapReady==='true'",30000);until("Number(document.querySelector('[data-alpha-map-plane]')?.dataset.mapFeatureCount)>0",30000);
    input("Search places",config.getString("query"));String place="[...document.querySelectorAll('[data-alpha-maps-root] button')].find(e=>e.textContent.trim().startsWith("+JSONObject.quote(config.getJSONObject("placeFields").getString("label"))+"))";until(place,30000);NotesSecureFixture.evaluate("("+place+").click()");until("document.querySelector('[aria-label=\"Rename place\"]')?.textContent==="+JSONObject.quote(config.getJSONObject("placeFields").getString("label")),30000);
    String prompt="Use PROPOSE_DEVICE_ACTION to propose exactly one maps_read_selected for the current selected Maps object and its exact opaque target from phone context. Do not execute it, start navigation, or propose any other action. Await explicit phone approval.";
    stage="place-proposal";send(prompt+" Use operationKey maps_place_"+config.getString("runId")+".");until(APPROVAL,180000);assertEquals(0,journal(scope).getJSONArray("entries").length());JSONArray proofs=new JSONArray();proofs.put(approveRead(scope,"place-approved",config.getJSONObject("placeFields")));stage="route-selection";closeConversationOnMaps();
    // The provider-backed route uses an explicit public fixture origin, never GPS.
    click("Directions");input("Route origin coordinates","43.7384, 7.4246");click("Walk");until("document.querySelector('[data-alpha-maps-root]').textContent.includes('no live traffic')",30000);noNavigation();
    stage="route-proposal";send(prompt+" Use operationKey maps_route_"+config.getString("runId")+".");until(APPROVAL,180000);assertEquals(1,journal(scope).getJSONArray("entries").length());proofs.put(approveRead(scope,"route-approved",config.getJSONObject("routeFields")));
    // Same route, new real proposal; then invalidate it by leaving the Maps view.
    stage="stale-proposal";send(prompt+" Use operationKey maps_stale_"+config.getString("runId")+".");until(APPROVAL,180000);assertEquals(2,journal(scope).getJSONArray("entries").length());closeConversationOnMaps();stage="stale-navigation";open("Notes");noNavigation();
    // Old cards may remain visible in chat; a visible one must reject through
    // the normal production click handler before any device decision/claim.
    NotesSecureFixture.evaluate(AppNavigation.type());until(AppNavigation.composer(),15000);
    if("true".equals(NotesSecureFixture.evaluate("Boolean("+APPROVAL+")"))){NotesSecureFixture.evaluate("("+APPROVAL+").click()");until("document.body.textContent.includes('This action is expired or no longer matches the current view.')",30000);}
    SystemClock.sleep(1000);assertEquals(2,journal(scope).getJSONArray("entries").length());noNavigation();
    JSONObject done=new JSONObject().put("runId",config.getString("runId")).put("installationId",device.getString("installationId")).put("enrollmentId",device.getString("enrollmentId")).put("proofs",proofs).put("staleNoJournal",true).put("finalView","notes");
    try(FileOutputStream output=new FileOutputStream(complete)){output.write(done.toString().getBytes(StandardCharsets.UTF_8));output.getFD().sync();}
    android.os.Bundle status=new android.os.Bundle();status.putString("pairedMapsStage","selection-stale");InstrumentationRegistry.getInstrumentation().sendStatus(0,status);
   }catch(Exception|AssertionError error){primary=error;throw error;}
   finally{try{
    if(admitted)NotesSecureFixture.call("Promise.all([Capacitor.Plugins.AlphaConnection.secureRemove({slot:"+JSONObject.quote("remote:"+ORIGIN)+"}),Capacitor.Plugins.AlphaConnection.secureRemove({slot:"+JSONObject.quote(slot)+"})]).then(()=>({removed:true}))");
    NotesSecureFixture.evaluate("(()=>{const previous="+previous+";if(previous===null)localStorage.removeItem('alpha.connection.selection.v1');else localStorage.setItem('alpha.connection.selection.v1',previous);})()");scenario.recreate();until("document.querySelector('.os')",30000);
   }catch(Exception|AssertionError cleanup){if(primary!=null)primary.addSuppressed(cleanup);else throw cleanup;}}
  }
 }
}
