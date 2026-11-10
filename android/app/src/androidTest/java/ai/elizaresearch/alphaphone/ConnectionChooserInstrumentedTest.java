package ai.elizaresearch.alphaphone;

import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Startup -> close the chooser -> Settings -> mock -> restart -> exit, using rendered controls.
 * Decision P-43: no "Continue offline" choice exists and none is saved; test-mocks builds only. */
@RunWith(AndroidJUnit4.class)
public class ConnectionChooserInstrumentedTest {
 private void until(String expression)throws Exception{
  long deadline=SystemClock.elapsedRealtime()+20000;
  while(SystemClock.elapsedRealtime()<deadline){
   if("true".equals(NotesSecureFixture.evaluate("Boolean("+expression+")")))return;
   SystemClock.sleep(80);
  }
  fail("Connection screen did not reach expected state: "+expression+"; "+new BrowserFlowInstrumentedTest().diagnostics());
 }
 private void click(String label)throws Exception{
  String expression="[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==="+JSONObject.quote(label)+"&&e.getClientRects().length)";
  until(expression);NotesSecureFixture.evaluate("("+expression+").click()");
 }
 @Test public void offlineAndMockAreExplicitAndMockDoesNotChangeSavedNotes()throws Exception{
  org.junit.Assume.assumeTrue("Mock mode exists only in -PELIZA_DEV_ALLOW_TEST_MOCKS=1 builds",BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   until("document.querySelector('[data-screen]')");
   String saved=NotesSecureFixture.evaluate("localStorage.getItem('alpha.connection.selection.v1')");
   String notes=NotesSecureFixture.evaluate("JSON.stringify(__notesEnvelope)");
   try{
    String previousDocument=NotesSecureFixture.evaluate("performance.timeOrigin");
    WebViewTestDriver.navigateHostDocument("localStorage.removeItem('alpha.connection.selection.v1');location.replace(location.origin+location.pathname)",true);
    // The old document may already show this dialog. Require the new navigation first.
    until("performance.timeOrigin!=="+previousDocument+"&&document.querySelector('.os')&&document.querySelector('.alpha-connection-scrim')");
    assertEquals("Underlying phone is inert during connection choice","true",NotesSecureFixture.evaluate("document.querySelector('.os').inert"));
    NotesSecureFixture.evaluate(AppNavigation.closeConnection());
    until("!document.querySelector('.alpha-connection-scrim')&&!document.querySelector('.os').inert");
    // P-43: closing saves no "no agent" choice, so the chooser opens again after a restart.
    scenario.recreate();until("document.documentElement.dataset.activeView==='home'&&document.querySelector('.alpha-connection-scrim')");
    assertEquals("No offline choice is saved","null",NotesSecureFixture.evaluate("localStorage.getItem('alpha.connection.selection.v1')"));
    NotesSecureFixture.evaluate(AppNavigation.closeConnection());
    until("!document.querySelector('.alpha-connection-scrim')&&!document.querySelector('.os').inert");
    NotesSecureFixture.evaluate(AppNavigation.request("Settings"));until(AppNavigation.selected("Settings"));
    until("window.__alphaTestNavigation?.status==='complete'&&!!document.querySelector('button[aria-label=\"Agent connection\"]')&&!document.querySelector('button[aria-label=\"Agent connection\"]').disabled");
    NotesSecureFixture.evaluate("document.querySelector('button[aria-label=\"Agent connection\"]').click()");
    until("document.querySelector('.alpha-connection-scrim')");
    NotesSecureFixture.evaluate("[...document.querySelectorAll('.alpha-connection summary')].find(e=>e.textContent==='Mock mode').click()");
    WebViewTestDriver.navigateHostDocument("[...document.querySelectorAll('.alpha-connection button')].find(e=>e.textContent.trim()==='Enter mock mode').click()",false);
    until("document.querySelector('.mock-mode-banner')&&document.documentElement.dataset.connectionMode==='mock'");
    assertEquals("Mock entry must preserve real saved notes",notes,NotesSecureFixture.evaluate("JSON.stringify(__notesEnvelope)"));
    scenario.recreate();until("document.querySelector('.mock-mode-banner')");
    WebViewTestDriver.navigateHostDocument("document.querySelector('.mock-mode-banner button').click()",true);
    until("document.documentElement.dataset.connectionMode==='live'&&!document.querySelector('.mock-mode-banner')");
    assertEquals("Mock exit must preserve real saved notes",notes,NotesSecureFixture.evaluate("JSON.stringify(__notesEnvelope)"));
   }finally{
    WebViewTestDriver.navigateHostDocument("localStorage."+("null".equals(saved)?"removeItem('alpha.connection.selection.v1')":"setItem('alpha.connection.selection.v1',"+saved+")")+";location.replace(location.origin+location.pathname)",false);
   }
  }
 }
}
