package ai.alphacompute.alphaphone;
import ai.eliza.plugins.reminders.ReminderTestAccess;

import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.JSONObject;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

/** Opt-in real provider flow. Requires the running loopback host, adb reverse,
 * and provisioned debug bearer. No fabricated response or client internals. */
@RunWith(AndroidJUnit4.class)
public class LiveAgentInstrumentedTest {
 private String eval(BoundedActivityScenario<MainActivity> scenario, String js) throws Exception {
  return NotesSecureFixture.evaluate(js);
 }
 private void waitFor(BoundedActivityScenario<MainActivity> scenario,String condition,long timeoutMs) throws Exception {
  long deadline=SystemClock.elapsedRealtime()+timeoutMs;
  while(SystemClock.elapsedRealtime()<deadline) {
   if("true".equals(eval(scenario,"Boolean("+condition+")"))) return;
   SystemClock.sleep(150);
  }
  fail("Live flow condition timed out: "+condition+"; status="+eval(scenario,"document.querySelector('[role=status]')?.textContent || ''"));
 }
 private void click(BoundedActivityScenario<MainActivity> scenario,String label) throws Exception {
  String selector="[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==="+JSONObject.quote(label)+")";
  waitFor(scenario,selector+" && !("+selector+").disabled",10000);
  eval(scenario,"("+selector+").click()");
 }
 private void navigate(BoundedActivityScenario<MainActivity> scenario,String view) throws Exception {
  eval(scenario,AppNavigation.request(view));
  waitFor(scenario,AppNavigation.selected(view),10000);
 }
 private String savedNote(String title) {
  return "__notesEnvelope.records.find(n=>n.title==="+JSONObject.quote(title)+")";
 }
 @Test public void realProviderProposesAndUserApprovesPersistedLocalNote() throws Exception {
  Assume.assumeTrue("Live provider test requires explicit -e liveAgent true", "true".equals(InstrumentationRegistry.getArguments().getString("liveAgent")));
  String title="Live agent note "+UUID.randomUUID();
  String body="This note was proposed by the real development model and saved only after explicit approval.";
  String prompt="Create a new local note with exactly this title: "+title+" And exactly this body: "+body+" Use the create_note function to propose it for my approval. Do not add or change any words.";
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)) {
   waitFor(scenario,"document.querySelector('[data-screen]') && document.documentElement.dataset.activeView",10000);
   try {
    navigate(scenario,"Notes");
    eval(scenario,AppNavigation.type());
    waitFor(scenario,AppNavigation.composer(),10000);
    assertEquals("No test note exists before asking the model","false",eval(scenario,"Boolean("+savedNote(title)+")"));
    eval(scenario,"(()=>{const e=("+AppNavigation.composer()+");Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,"+JSONObject.quote(prompt)+");e.dispatchEvent(new Event('input',{bubbles:true}));})()");
    waitFor(scenario,"("+AppNavigation.composer()+").value==="+JSONObject.quote(prompt),10000);
    eval(scenario,"document.querySelector('button[aria-label=Send]').click()");
    // The pending proposal is a review card whose first row approves it: "Create note" over the
    // quoted title and the body (device-record-presentation.ts). The prompt never quotes the title.
    String proposal="[...document.querySelectorAll('.alpha-action-review button')].find(b=>b.textContent.includes('Create note')&&b.textContent.includes("+JSONObject.quote("\u201c"+title+"\u201d")+"))";
    waitFor(scenario,proposal,60000);
    assertEquals("A model proposal must not create a note before approval","false",eval(scenario,"Boolean("+savedNote(title)+")"));
    assertEquals("The proposal must show the exact body being approved","true",eval(scenario,"document.querySelector('[data-screen]').textContent.includes("+JSONObject.quote(body)+")"));
    // The only execution trigger is the real rendered approval button.
    eval(scenario,"("+proposal+").click()");
    waitFor(scenario,"("+savedNote(title)+")?.body==="+JSONObject.quote(body),10000);
    navigate(scenario,"Home"); navigate(scenario,"Notes");
    String row="[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==="+JSONObject.quote("Open "+title)+")";
    waitFor(scenario,row,10000); eval(scenario,"("+row+").click()");
    waitFor(scenario,"document.querySelector('textarea[aria-label=Note]')?.value==="+JSONObject.quote(body),10000);
    scenario.recreate();
    waitFor(scenario,"document.documentElement.dataset.activeView",10000); navigate(scenario,"Notes");
    waitFor(scenario,row,10000);
    assertEquals("Approved note persists across Activity recreation","true",eval(scenario,"("+savedNote(title)+")?.body==="+JSONObject.quote(body)));
    eval(scenario,"("+row+").click()");
    eval(scenario,"document.querySelector('button[aria-label=\"Delete note\"]').click()");
    waitFor(scenario,"!("+savedNote(title)+")",10000);
   } finally {
    // Failure cleanup is scoped exclusively to this generated title.
    NotesSecureFixture.replaceRecords("records=>records.filter(n=>n.title!=="+JSONObject.quote(title)+")");
   }
  }
 }
 private org.json.JSONArray nativeReminders(BoundedActivityScenario<MainActivity> scenario) throws Exception {
  eval(scenario,"window.__liveReminders=null;Capacitor.Plugins.DailyApps.listReminders().then(r=>window.__liveReminders=JSON.stringify(r.reminders))");
  waitFor(scenario,"window.__liveReminders!==null",10000);
  return new org.json.JSONArray((String)new org.json.JSONTokener(eval(scenario,"window.__liveReminders")).nextValue());
 }
 private JSONObject findReminder(org.json.JSONArray list,String title)throws Exception{
  for(int i=0;i<list.length();i++)if(title.equals(list.getJSONObject(i).getString("title")))return list.getJSONObject(i);
  return null;
 }
 @Test public void realProviderProposesReminderRequiresApproval() throws Exception {
  Assume.assumeTrue("Live provider test requires explicit -e liveAgent true","true".equals(InstrumentationRegistry.getArguments().getString("liveAgent")));
  android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  if(android.os.Build.VERSION.SDK_INT>=33)InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(context.getPackageName(),android.Manifest.permission.POST_NOTIFICATIONS);
  String title="Live reminder "+UUID.randomUUID(),body="One explicitly approved local reminder.";
  long at=System.currentTimeMillis()+3600000;
  String instant=java.time.Instant.ofEpochMilli(at).toString();
  String prompt="Propose one local reminder using create_reminder, with exactly title: "+title+" and exactly body: "+body+" Set at to exactly "+at+" Unix milliseconds, which is "+instant+". Do not execute it; request my approval.";
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)) {
   waitFor(scenario,"document.documentElement.dataset.activeView",10000);navigate(scenario,"Calendar");
   assertNull("No reminder before model request",findReminder(nativeReminders(scenario),title));
   eval(scenario,AppNavigation.type());waitFor(scenario,AppNavigation.composer(),10000);
   eval(scenario,"(()=>{const e=("+AppNavigation.composer()+");Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,"+JSONObject.quote(prompt)+");e.dispatchEvent(new Event('input',{bubbles:true}));})()");
   waitFor(scenario,"("+AppNavigation.composer()+").value==="+JSONObject.quote(prompt),10000);
   eval(scenario,"document.querySelector('button[aria-label=Send]').click()");
   String proposal="[...document.querySelectorAll('[data-screen] button')].find(b=>b.textContent.includes("+JSONObject.quote("Approve: Create reminder: "+title)+"))";
   waitFor(scenario,proposal,90000);
   // Prompt text also contains these values, so require another occurrence in
   // the model proposal rather than accepting the user's own request bubble.
   for(String exact:new String[]{body,instant})assertEquals("Exact reminder details visible in proposal","true",eval(scenario,"document.querySelector('[data-screen]').textContent.split("+JSONObject.quote(exact)+").length>=3"));
   assertNull("Proposal alone must not schedule",findReminder(nativeReminders(scenario),title));
   eval(scenario,"("+proposal+").click()");
   JSONObject saved=null;
   for(int i=0;i<60;i++){saved=findReminder(nativeReminders(scenario),title);if(saved!=null)break;SystemClock.sleep(100);}
   assertNotNull("Explicit approval creates real native reminder",saved);assertEquals("scheduled",saved.getString("status"));assertEquals(body,saved.getString("body"));assertEquals(at,saved.getLong("at"));
   navigate(scenario,"Home");navigate(scenario,"Calendar");
   if(!java.time.Instant.ofEpochMilli(at).atZone(java.time.ZoneId.systemDefault()).toLocalDate().equals(java.time.LocalDate.now()))eval(scenario,"document.querySelector('button[aria-label=Tomorrow]')?.click()");
   waitFor(scenario,"document.querySelector('[data-screen]').textContent.includes("+JSONObject.quote(title)+")",10000);
  }finally{
   org.json.JSONArray rows=ReminderTestAccess.list(context);
   for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);if(title.equals(row.optString("title")))ReminderTestAccess.cancel(context,row.getString("id"));}
  }
 }

}
