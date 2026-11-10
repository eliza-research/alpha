package ai.elizaresearch.alphaphone;

import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.Assume;
import org.junit.runner.RunWith;
import org.json.JSONObject;
import org.json.JSONTokener;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

/** Executes the bundled React renderer in the real Android WebView; no mocked bridge. */
@RunWith(AndroidJUnit4.class)
public class FlowInstrumentedTest {
 private String eval(BoundedActivityScenario<MainActivity> scenario, String js) throws Exception {
  return NotesSecureFixture.evaluate(js);
 }
 private void waitFor(BoundedActivityScenario<MainActivity> scenario, String condition) throws Exception {
  for (int i=0;i<100;i++) { if ("true".equals(eval(scenario,"Boolean("+condition+")"))) return; SystemClock.sleep(100); }
  fail("Rendered condition did not become true: "+condition+"; navigation="+eval(scenario,"JSON.stringify(window.__alphaTestNavigation||null)")+"; body="+eval(scenario,"document.body.innerText"));
 }
 private void ready(BoundedActivityScenario<MainActivity> scenario) throws Exception {
  waitFor(scenario,"document.querySelector('[data-screen]') && document.documentElement.dataset.activeView");
 }
 private void click(BoundedActivityScenario<MainActivity> scenario, String text) throws Exception {
  String target="[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==="+JSONObject.quote(text)+")";
  waitFor(scenario,target+" && !("+target+").disabled");
  eval(scenario,"("+target+").click()");
 }
 private void navigate(BoundedActivityScenario<MainActivity> scenario, String view) throws Exception {
  eval(scenario,AppNavigation.request(view));
  waitFor(scenario,AppNavigation.selected(view)+" && window.__alphaTestNavigation?.status==='complete'");
 }
 private void input(BoundedActivityScenario<MainActivity> scenario, String selector, String value) throws Exception {
  waitFor(scenario,"document.querySelector("+JSONObject.quote(selector)+")");
  // Native setter plus bubbling input exercises React's normal controlled-field path.
  eval(scenario,"(()=>{const e=document.querySelector("+JSONObject.quote(selector)+");const p=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,"+JSONObject.quote(value)+");e.dispatchEvent(new Event('input',{bubbles:true}));})()");
  waitFor(scenario,"document.querySelector("+JSONObject.quote(selector)+").value==="+JSONObject.quote(value));
 }
 private void label(BoundedActivityScenario<MainActivity> scenario, String label) throws Exception {
  String target="[...document.querySelectorAll('[data-screen] button')].find(e=>e.getAttribute('aria-label')==="+JSONObject.quote(label)+")";
  waitFor(scenario,target); eval(scenario,"("+target+").click()");
 }
 private String saved(String title) {
  return "__notesEnvelope.records.find(n=>n.title==="+JSONObject.quote(title)+")";
 }
 @Test public void allPrototypeAppsAndNotesSurviveRealActivityLifecycle() throws Exception {
  String title="Flow test "+UUID.randomUUID();
  // This is the granted-camera navigation/lifecycle fixture. The separate permission
  // campaign proves denial and retry; an unanswered OS prompt would keep recreation paused.
  androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(
   androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().getTargetContext().getPackageName(),android.Manifest.permission.CAMERA);
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)) {
   ready(scenario);
   Throwable primaryFailure=null;
   try {
    String[] views={"Inbox","Calendar","Browser","Camera","Photos","Maps","Notes","Files","Workflows","Settings"};
    for(String view:views) {
     navigate(scenario,view);
     assertEquals("Prototype app surface must remain mounted: "+view,"true",eval(scenario,"!!document.querySelector('[data-screen]')"));
    }
    navigate(scenario,"Notes"); label(scenario,"New note");
    input(scenario,"input[aria-label='Title']",title);
    input(scenario,"textarea[aria-label='Note']","Original note");
    waitFor(scenario,"("+saved(title)+")?.body==='Original note'");
    input(scenario,"textarea[aria-label='Note']","Edited note");
    label(scenario,"Back to notes"); label(scenario,"Open "+title);
    waitFor(scenario,"document.querySelector('textarea[aria-label=Note]')?.value==='Edited note'");
    scenario.recreate(); ready(scenario); navigate(scenario,"Notes"); label(scenario,"Open "+title);
    waitFor(scenario,"document.querySelector('textarea[aria-label=Note]')?.value==='Edited note'");
    label(scenario,"Delete note"); waitFor(scenario,"!("+saved(title)+")");
   } catch(Exception|AssertionError failure) {primaryFailure=failure;throw failure;} finally {
    try { NotesSecureFixture.replaceRecords("records=>records.filter(n=>n.title!=="+JSONObject.quote(title)+")"); } catch(Exception|AssertionError cleanup) {if(primaryFailure!=null)primaryFailure.addSuppressed(cleanup);else throw cleanup;}
   }
  }
 }
}
