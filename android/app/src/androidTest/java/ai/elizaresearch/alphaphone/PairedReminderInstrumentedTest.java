package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.reminders.ReminderTestAccess;
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
public final class PairedReminderInstrumentedTest {
 private static String canonical(Object value)throws Exception{if(value instanceof JSONObject){JSONObject o=(JSONObject)value;java.util.ArrayList<String> keys=new java.util.ArrayList<>();java.util.Iterator<String> it=o.keys();while(it.hasNext())keys.add(it.next());java.util.Collections.sort(keys);StringBuilder out=new StringBuilder("{");for(String k:keys){if(out.length()>1)out.append(',');out.append(JSONObject.quote(k)).append(':').append(canonical(o.get(k)));}return out.append('}').toString();}if(value instanceof JSONArray){JSONArray a=(JSONArray)value;StringBuilder out=new StringBuilder("[");for(int i=0;i<a.length();i++){if(i>0)out.append(',');out.append(canonical(a.get(i)));}return out.append(']').toString();}return value instanceof String?JSONObject.quote((String)value):String.valueOf(value);}
 private static final String ORIGIN="http://10.0.2.2:47860";
 private static void until(String expression,long timeout)throws Exception{long end=SystemClock.elapsedRealtime()+timeout;while(SystemClock.elapsedRealtime()<end){if("true".equals(NotesSecureFixture.evaluate("Boolean("+expression+")")))return;SystemClock.sleep(100);}fail("Reminder stage did not reach its asserted state");}
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
 private void send(String prompt)throws Exception{NotesSecureFixture.evaluate(AppNavigation.type());until(AppNavigation.composer(),15000);NotesSecureFixture.evaluate("(()=>{const e=("+AppNavigation.composer()+");Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,"+JSONObject.quote(prompt)+");e.dispatchEvent(new Event('input',{bubbles:true}));})()");click("Send");}

 @Test public void selectedReminderRoundTrip()throws Exception {
  Assume.assumeTrue("Owned paired reminder campaign only", "1".equals(InstrumentationRegistry.getArguments().getString("pairedReminder")));
  assertTrue("Run only in a disposable secondary Android user",android.os.Process.myUid()/100000>0);
  Context c=InstrumentationRegistry.getInstrumentation().getTargetContext();File fixture=new File(c.getFilesDir(),"paired-reminder-fixture.json");
  JSONObject config=new JSONObject(new String(Files.readAllBytes(fixture.toPath()),StandardCharsets.UTF_8));assertEquals(ORIGIN,config.getString("origin"));assertEquals(UUID.fromString(config.getString("runId")).toString(),config.getString("runId"));
  String id="paired_reminder_"+config.getString("runId"),title="Paired reminder "+config.getString("runId"),body="Original synthetic content",previous=null,slot=null,scope=null;boolean admitted=false,created=false;Throwable primary=null;
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   until("document.querySelector('.os')",30000);AppNavigation.liveMode();
   slot="device:"+arrayHash(new JSONArray().put(ORIGIN).put(config.getString("ownerId")).put(config.getString("agentId")));
   assertNull("Existing proxy credential must never be overwritten",credential("remote:"+ORIGIN));assertNull("Existing proxy enrollment must never be overwritten",credential(slot));assertNull("Existing fixture reminder",ReminderTestAccess.read(c,id));
   previous=NotesSecureFixture.evaluate("localStorage.getItem('alpha.connection.selection.v1')");
   try {
    assertTrue("Normal notification permission required",ReminderTestAccess.allowed(c));
    assertEquals("true",NotesSecureFixture.evaluate("(()=>{localStorage.removeItem('alpha.connection.selection.v1');return localStorage.getItem('alpha.connection.selection.v1')===null})()"));scenario.recreate();until("document.querySelector('.alpha-connection-scrim')",30000);
    NotesSecureFixture.evaluate("[...document.querySelectorAll('.alpha-connection summary')].find(e=>e.textContent==='Local development agent').click()");
    NotesSecureFixture.evaluateSensitive("(()=>{const inputs=[...document.querySelectorAll('.alpha-connection details')].find(e=>e.querySelector('summary')?.textContent==='Local development agent').querySelectorAll('input');inputs[0].value="+JSONObject.quote(ORIGIN)+";inputs[1].value="+JSONObject.quote(config.getString("code"))+";})()");admitted=true;click("Connect local agent");until("!document.querySelector('.alpha-connection-scrim')",90000);
    open("Settings");click("Agent connection");until("document.querySelector('.alpha-connection-scrim')",15000);NotesSecureFixture.evaluate("[...document.querySelectorAll('.alpha-connection summary')].find(e=>e.textContent==='Conversation history').click()");click("Load conversations");String restore="[...document.querySelectorAll('.alpha-connection-agent')].find(e=>e.querySelector('strong')?.textContent==="+JSONObject.quote(config.getString("conversationTitle"))+")?.querySelector('button')";until(restore+"&&!("+restore+").disabled",30000);NotesSecureFixture.evaluate("("+restore+").click()");until("!document.querySelector('.alpha-connection-scrim')",30000);
    JSONObject device=new JSONObject(credential(slot));scope=arrayHash(new JSONArray().put(slot.substring(7)).put(device.getString("installationId")));
    ReminderTestAccess.schedule(c,id,title,body,System.currentTimeMillis()+3600000);created=true;
    for(String type:new String[]{"reminder_read_selected","reminder_update","reminder_snooze","reminder_complete","reminder_cancel"}){
     JSONObject before=ReminderTestAccess.read(c,id),target=ReminderTestAccess.selected(c,id);
     open("Home");
     Intent intent=new Intent(c,MainActivity.class).setAction("ai.elizaresearch.alphaphone.OPEN_REMINDER").putExtra(ReminderTestAccess.OPEN_ID,id).putExtra(ReminderTestAccess.OCCURRENCE,target.getString("occurrenceId")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_CLEAR_TOP);
     BoundedActivityScenario.main(()->c.startActivity(intent));until(AppNavigation.selected("Calendar"),30000);until("document.body.textContent.includes("+JSONObject.quote(title)+")",30000);
     String prompt="Use PROPOSE_DEVICE_ACTION to propose exactly one "+type+" for the selected synthetic reminder. Use this exact target: "+target.toString()+". "+(type.equals("reminder_update")?"Set fields title to "+JSONObject.quote(title)+" and body to \"Updated synthetic content\"; do not change schedule. ":"")+"Do not execute it or propose any other action. Await explicit phone approval.";
     send(prompt);String approval="[...document.querySelectorAll('button')].find(e=>e.textContent.includes("+JSONObject.quote("Approve: "+type.replace('_',' '))+")&&e.getClientRects().length&&!e.disabled)";until(approval,180000);
     assertEquals("No effect before explicit approval",before.toString(),ReminderTestAccess.read(c,id).toString());
     int completed=Integer.parseInt(NotesSecureFixture.evaluate("[...document.querySelectorAll('button')].filter(e=>e.textContent.includes('Completed')).length"));
     long approvedAt=System.currentTimeMillis();NotesSecureFixture.evaluate("("+approval+").click()");
     String journal="Capacitor.Plugins.AlphaActionJournal.list({scope:"+JSONObject.quote(scope)+"})";JSONObject entry=null;
     long end=SystemClock.elapsedRealtime()+60000;while(SystemClock.elapsedRealtime()<end){JSONArray entries=NotesSecureFixture.call(journal).getJSONArray("entries");for(int i=0;i<entries.length();i++){JSONObject e=entries.getJSONObject(i);if(type.equals(e.getJSONObject("record").getJSONObject("operation").optString("type"))&&"terminal".equals(e.optString("phase"))){entry=e;break;}}if(entry!=null)break;SystemClock.sleep(200);}
     assertNotNull("Actual durable native action journal",entry);assertEquals("succeeded",entry.getString("status"));JSONObject record=entry.getJSONObject("record");
     String binding=arrayHash(new JSONArray().put(scope).put(record.getString("ownerId")).put(record.getString("agentId")).put(record.getString("sessionId")).put(record.getString("origin")).put(record.getString("installationId")).put(record.getString("enrollmentId")).put(entry.getString("proposalId")).put(record.getString("digest")).put(entry.getString("operationId")));
     JSONObject receipt=ReminderTestAccess.operationReceipt(c,entry.getString("operationId"),binding,record.getJSONObject("operation"));assertEquals("succeeded",receipt.getString("status"));assertEquals(canonical(receipt.getJSONObject("result")),canonical(entry.getJSONObject("result").getJSONObject("reminderResult")));
     if(type.equals("reminder_read_selected"))assertEquals(body,receipt.getJSONObject("result").getJSONObject("fields").getString("body"));
     if(type.equals("reminder_update"))assertEquals("Updated synthetic content",ReminderTestAccess.read(c,id).getString("body"));
     if(type.equals("reminder_snooze")){long deadline=receipt.getJSONObject("result").getLong("at");assertTrue("Exact ten minute native snooze deadline",deadline>=approvedAt+600000&&deadline<=System.currentTimeMillis()+600000);assertEquals(deadline,ReminderTestAccess.read(c,id).getLong("at"));}
     if(type.equals("reminder_complete"))assertEquals("completed",ReminderTestAccess.read(c,id).getString("status"));
     if(type.equals("reminder_cancel"))assertEquals("cancelled",ReminderTestAccess.read(c,id).getString("status"));
     until("[...document.querySelectorAll('button')].filter(e=>e.textContent.includes('Completed')).length>"+completed,30000);
     android.os.Bundle status=new android.os.Bundle();status.putString("pairedReminderStage",type);InstrumentationRegistry.getInstrumentation().sendStatus(0,status);
    }
   }catch(Exception|AssertionError error){primary=error;throw error;}
   finally{try{
    if(created){ReminderTestAccess.cancel(c,id);ReminderTestAccess.removeFixture(c,java.util.Collections.singletonList(id),java.util.Collections.<String>emptyList());assertNull(ReminderTestAccess.read(c,id));}
    if(admitted)NotesSecureFixture.call("Promise.all([Capacitor.Plugins.AlphaConnection.secureRemove({slot:"+JSONObject.quote("remote:"+ORIGIN)+"}),Capacitor.Plugins.AlphaConnection.secureRemove({slot:"+JSONObject.quote(slot)+"})]).then(()=>({removed:true}))");
    NotesSecureFixture.evaluate("(()=>{const previous="+previous+";if(previous===null)localStorage.removeItem('alpha.connection.selection.v1');else localStorage.setItem('alpha.connection.selection.v1',previous);})()");scenario.recreate();until("document.querySelector('.os')",30000);
   }catch(Exception|AssertionError cleanup){if(primary!=null)primary.addSuppressed(cleanup);else throw cleanup;}}
  }
 }
}
