package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.reminders.ReminderTestAccess;

import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.nio.file.Files;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Opt-in actual patched backend -> rendered approval -> note -> durable journal. */
@RunWith(AndroidJUnit4.class)
public class DeviceActionInstrumentedTest {
 private void until(String expression,long timeout)throws Exception {
  long deadline=SystemClock.elapsedRealtime()+timeout;
  while(SystemClock.elapsedRealtime()<deadline){if("true".equals(NotesSecureFixture.evaluate("Boolean("+expression+")")))return;SystemClock.sleep(100);}
  fail("Patched device flow did not reach expected state");
 }
 private void click(String text)throws Exception {
  String expression="[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==="+JSONObject.quote(text)+"&&e.getClientRects().length)";
  until(expression,15000);NotesSecureFixture.evaluate("("+expression+").click()");
 }
 private void propose(String prompt,String label)throws Exception {
  NotesSecureFixture.evaluate(AppNavigation.type());until(AppNavigation.composer(),15000);
  NotesSecureFixture.evaluate("(()=>{const e=("+AppNavigation.composer()+");Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,"+JSONObject.quote(prompt)+");e.dispatchEvent(new Event('input',{bubbles:true}));})()");
  NotesSecureFixture.evaluate("document.querySelector('button[aria-label=Send]').click()");
  until(approval(label),180000);
 }
 private String approval(String label){return "[...document.querySelectorAll('button')].find(e=>e.textContent.includes("+JSONObject.quote("Approve: "+label)+")&&e.getClientRects().length&&!e.disabled)";}
 private JSONObject reminder(String title)throws Exception {
  JSONArray rows=ReminderTestAccess.list(InstrumentationRegistry.getInstrumentation().getTargetContext());
  JSONObject found=null;
  for(int i=0;i<rows.length();i++)if(title.equals(rows.getJSONObject(i).optString("title"))){assertNull("Exactly one native reminder",found);found=rows.getJSONObject(i);}
  return found;
 }
 private String hash(String value)throws Exception {
  StringBuilder out=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)))out.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return out.toString();
 }
 @Test public void realProposalApprovedOncePersistsNoteAndJournal()throws Exception {
  Assume.assumeTrue("Requires explicit patched device opt-in","true".equals(InstrumentationRegistry.getArguments().getString("deviceActions")));
  assertTrue("Loopback HTTP fixtures require a -PELIZA_DEV_ALLOW_TEST_MOCKS=1 debug build",BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  File fixture=new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getFilesDir(),"device-action-pairing.json");
  JSONObject config=new JSONObject(new String(Files.readAllBytes(fixture.toPath()),StandardCharsets.UTF_8));
  String origin=config.getString("origin"),title=config.getString("title"),body="Synthetic Android fixture only.";
  assertEquals("Only disposable patched loopback host allowed","http://10.0.2.2:47840",origin);
  String identity=new JSONArray().put(origin).put(config.getString("ownerId")).put(config.getString("agentId")).toString();
  String reminderTitle=title+" reminder";
  String notes="__notesEnvelope.records.filter(n=>n.title==="+JSONObject.quote(title)+")";
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)) {
   until("document.querySelector('[data-screen]')",20000);
   String oldDocument=NotesSecureFixture.evaluate("performance.timeOrigin");
   NotesSecureFixture.evaluate("localStorage.removeItem('alpha.connection.selection.v1');location.replace(location.origin+location.pathname)");
   until("performance.timeOrigin!=="+oldDocument+"&&document.querySelector('.alpha-connection-scrim')&&[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Connect local agent'&&!e.disabled)",20000);
   NotesSecureFixture.evaluate("[...document.querySelectorAll('.alpha-connection summary')].find(e=>e.textContent==='Local development agent').click()");
   NotesSecureFixture.evaluateSensitive("(()=>{const d=[...document.querySelectorAll('.alpha-connection details')].find(e=>e.querySelector('summary')?.textContent==='Local development agent');const inputs=d.querySelectorAll('input');inputs[0].value="+JSONObject.quote(origin)+";inputs[1].value="+JSONObject.quote(config.getString("code"))+";})()");
   click("Connect local agent");until("!document.querySelector('.alpha-connection-scrim')||document.querySelector('.alpha-connection-error')",60000);
   assertEquals("Pairing error", "null", NotesSecureFixture.evaluate("document.querySelector('.alpha-connection-error')?.textContent??null"));
   until("!document.querySelector('.alpha-connection-scrim')",10000);
   assertEquals("0",NotesSecureFixture.evaluate("("+notes+").length"));
   NotesSecureFixture.evaluate(AppNavigation.type());until(AppNavigation.composer(),15000);
   String prompt="Use PROPOSE_DEVICE_ACTION to propose exactly one create_note operation for this enrolled phone, with title "+JSONObject.quote(title)+" and body "+JSONObject.quote(body)+". Wait for explicit device approval; do not claim the note is already saved.";
   NotesSecureFixture.evaluate("(()=>{const e=("+AppNavigation.composer()+");Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,"+JSONObject.quote(prompt)+");e.dispatchEvent(new Event('input',{bubbles:true}));})()");
   NotesSecureFixture.evaluate("document.querySelector('button[aria-label=Send]').click()");
   String approval="[...document.querySelectorAll('button')].find(e=>e.textContent.includes('Approve: create note')&&e.getClientRects().length)";
   until(approval,180000);assertEquals("No effect before explicit approval","0",NotesSecureFixture.evaluate("("+notes+").length"));
   NotesSecureFixture.evaluate("window.__deviceApprove=("+approval+");window.__deviceApprove.click()");
   until("("+notes+").length===1",60000);
   assertEquals(JSONObject.quote(body),NotesSecureFixture.evaluate("("+notes+")[0].body"));
   // A rapid repeat on the retained DOM node must never create a second note.
   NotesSecureFixture.evaluate("window.__deviceApprove.click()");SystemClock.sleep(500);
   assertEquals("1",NotesSecureFixture.evaluate("("+notes+").length"));
   until("[...document.querySelectorAll('button')].some(e=>e.textContent.includes('Completed'))",30000);
   scenario.recreate();until("document.documentElement.dataset.activeView==='home'&&!document.querySelector('.alpha-connection-scrim')",60000);
   assertEquals("1",NotesSecureFixture.evaluate("("+notes+").length"));
   // Only safe receipt facts are exposed from the encrypted native journal.
   String inspect="(async()=>{try{const hash=async(value)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(b=>b.toString(16).padStart(2,'0')).join('');const base=await hash("+identity+");const raw=await Capacitor.Plugins.AlphaConnection.secureRead({slot:'device:'+base});if(!raw.value){window.__deviceJournalStage='Device credential missing';return;}const d=JSON.parse(raw.value);const scope=await hash([base,d.installationId]);const list=await Capacitor.Plugins.AlphaActionJournal.list({scope});window.__deviceJournalOK=list.entries.some(e=>e.phase==='terminal'&&e.status==='succeeded'&&e.record.operation.title==="+JSONObject.quote(title)+"&&e.operationId===("+notes+")[0].id);window.__deviceJournalStage=window.__deviceJournalOK?'Verified':'Matching terminal journal entry missing';}catch{window.__deviceJournalStage='Journal inspection failed';}})()";
   NotesSecureFixture.evaluateSensitive(inspect);until("typeof window.__deviceJournalStage==='string'",15000);
   assertEquals("Native journal must contain the exact completed note", "\"Verified\"", NotesSecureFixture.evaluate("window.__deviceJournalStage"));
   // A second real model proposal must reach Android AlarmManager only after approval.
   android.content.Context target=InstrumentationRegistry.getInstrumentation().getTargetContext();
   InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(target.getPackageName(),android.Manifest.permission.POST_NOTIFICATIONS);
   long due=System.currentTimeMillis()+86400000L;
   String dueAt=java.time.Instant.ofEpochMilli(due).toString();
   assertNull(reminder(reminderTitle));
   propose("Propose exactly one create_reminder on this enrolled phone with title "+JSONObject.quote(reminderTitle)+" and dueAt "+JSONObject.quote(dueAt)+". Await approval.","create reminder");
   assertNull("No native schedule before approval",reminder(reminderTitle));
   NotesSecureFixture.evaluate("window.__reminderApprove=("+approval("create reminder")+");window.__reminderApprove.click()");
   long reminderDeadline=SystemClock.elapsedRealtime()+60000;
   JSONObject scheduled=null;
   while(SystemClock.elapsedRealtime()<reminderDeadline){scheduled=reminder(reminderTitle);if(scheduled!=null)break;SystemClock.sleep(100);}
   assertNotNull("Native reminder persisted",scheduled);assertEquals(due,scheduled.getLong("at"));assertEquals("scheduled",scheduled.getString("status"));
   NotesSecureFixture.evaluate("window.__reminderApprove.click()");SystemClock.sleep(500);assertEquals(scheduled.getString("id"),reminder(reminderTitle).getString("id"));
   until("[...document.querySelectorAll('button')].some(e=>e.textContent.includes('Completed'))",30000);
   // Navigation uses the same one-shot approval boundary and changes the real screen.
   propose("Propose exactly one open_view operation with view settings on this enrolled phone. Await approval.","open view");
   assertNotEquals("\"settings\"",NotesSecureFixture.evaluate("document.documentElement.dataset.activeView"));
   NotesSecureFixture.evaluate("("+approval("open view")+").click()");
   until("document.documentElement.dataset.activeView==='settings'",30000);
   String destination="https://example.com/?alpha-device-action="+java.util.UUID.randomUUID();
   propose("Propose exactly one browser_navigate operation with url "+JSONObject.quote(destination)+" on this enrolled phone. Await approval.","browser navigate");
   NotesSecureFixture.evaluate("("+approval("browser navigate")+").click()");until("document.documentElement.dataset.activeView==='browser'",30000);
   BrowserFlowInstrumentedTest browser=new BrowserFlowInstrumentedTest();boolean loaded=false;long pageDeadline=SystemClock.elapsedRealtime()+45000;
   while(SystemClock.elapsedRealtime()<pageDeadline){if("true".equals(browser.child("location.href==="+JSONObject.quote(destination)+"&&document.readyState==='complete'&&document.title==='Example Domain'&&document.body.innerText.includes('documentation examples')&&typeof Capacitor==='undefined'"))){loaded=true;break;}SystemClock.sleep(100);}
   String pageProbe=browser.child("JSON.stringify({expectedHost:location.hostname==='example.com',expectedUrl:location.href==="+JSONObject.quote(destination)+",ready:document.readyState,expectedBody:document.title==='Example Domain'&&!!document.body?.innerText.includes('documentation examples'),bridgeAbsent:typeof Capacitor==='undefined'})");
   String viewportProbe=NotesSecureFixture.evaluate("JSON.stringify({viewport:!!document.querySelector('[data-native-browser-viewport]'),state:document.querySelector('[data-native-browser-viewport]')?.getAttribute('aria-label'),panelVisible:document.querySelector('[data-alpha-layer=conversation]')?.getAttribute('aria-hidden')==='false'})");
   assertTrue("Approved action loads actual HTTPS page in isolated native browser; page="+pageProbe+" viewport="+viewportProbe,loaded);

   scenario.recreate();until("document.documentElement.dataset.activeView&&!document.querySelector('.alpha-connection-scrim')",60000);
   assertEquals("1",NotesSecureFixture.evaluate("("+notes+").length"));
   assertEquals("scheduled",reminder(reminderTitle).getString("status"));
   String audit="(async()=>{try{const hash=async(value)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(b=>b.toString(16).padStart(2,'0')).join('');const base=await hash("+identity+");const raw=await Capacitor.Plugins.AlphaConnection.secureRead({slot:'device:'+base});const d=JSON.parse(raw.value);const scope=await hash([base,d.installationId]);const list=await Capacitor.Plugins.AlphaActionJournal.list({scope});const terminal=list.entries.filter(e=>e.phase==='terminal'&&e.status==='succeeded');window.__allDeviceReceipts=terminal.some(e=>e.record.operation.type==='create_reminder'&&e.record.operation.title==="+JSONObject.quote(reminderTitle)+")&&terminal.some(e=>e.record.operation.type==='open_view'&&e.record.operation.view==='settings')&&terminal.some(e=>e.record.operation.type==='browser_navigate'&&e.record.operation.url==="+JSONObject.quote(destination)+");}catch{window.__allDeviceReceipts=false;}})()";
   NotesSecureFixture.evaluateSensitive(audit);until("window.__allDeviceReceipts===true",15000);


  } finally {
   JSONObject created=reminder(reminderTitle);
   if(created!=null)ReminderTestAccess.cancel(InstrumentationRegistry.getInstrumentation().getTargetContext(),created.getString("id"));
   fixture.delete();
  }
 }
}
