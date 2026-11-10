package ai.elizaresearch.alphaphone;

import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.json.JSONObject;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Product builds (no ELIZA_DEV_ALLOW_TEST_MOCKS) expose no mock entry and retire a legacy mock selection. */
@RunWith(AndroidJUnit4.class)
public class NoMockProductInstrumentedTest {
 private static final String SELECTION="alpha.connection.selection.v1";
 private static void until(String expression)throws Exception{
  long deadline=SystemClock.elapsedRealtime()+20000;
  while(SystemClock.elapsedRealtime()<deadline){
   if("true".equals(NotesSecureFixture.evaluate("Boolean("+expression+")")))return;
   SystemClock.sleep(80);
  }
  fail("Renderer did not reach expected state: "+expression);
 }
 private static void assertNoMockEntry()throws Exception{
  for(String label:new String[]{"Enter mock mode","Try mock mode"})
   assertEquals("Product build must not offer '"+label+"'","false",NotesSecureFixture.evaluate("document.documentElement.textContent.includes("+JSONObject.quote(label)+")"));
  assertEquals("No mock banner","false",NotesSecureFixture.evaluate("!!document.querySelector('.mock-mode-banner')"));
  assertNotEquals("Renderer never runs in mock mode","\"mock\"",NotesSecureFixture.evaluate("document.documentElement.dataset.connectionMode||null"));
 }
 @Test public void productBuildOffersNoMockEntryPoint()throws Exception{
  Assume.assumeFalse("Test-mocks builds intentionally expose mock mode",BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   until("document.querySelector('[data-screen]')");
   String saved=NotesSecureFixture.evaluate("localStorage.getItem('"+SELECTION+"')");
   try{
    // A signed-out production install must render the required sign-in page.
    String previousDocument=NotesSecureFixture.evaluate("performance.timeOrigin");
    WebViewTestDriver.navigateHostDocument("localStorage.removeItem('"+SELECTION+"');location.replace(location.origin+location.pathname)",true);
    until("performance.timeOrigin!=="+previousDocument+"&&document.querySelector('.alpha-auth-page [role=main]')");
    NotesSecureFixture.evaluate("document.querySelectorAll('.alpha-connection details').forEach(d=>d.open=true)");
    assertEquals("Required sign-in cannot be dismissed","false",NotesSecureFixture.evaluate("!!document.querySelector('.alpha-auth-page button[aria-label=\"Close connection settings\"]')"));
    assertNoMockEntry();
   }finally{
    WebViewTestDriver.navigateHostDocument("localStorage."+("null".equals(saved)?"removeItem('"+SELECTION+"')":"setItem('"+SELECTION+"',"+saved+")")+";location.replace(location.origin+location.pathname)",true);
   }
  }
 }
 @Test public void legacyMockSelectionRequiresSignIn()throws Exception{
  Assume.assumeFalse("Test-mocks builds intentionally honour a mock selection",BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   until("document.querySelector('[data-screen]')");
   String saved=NotesSecureFixture.evaluate("localStorage.getItem('"+SELECTION+"')");
   try{
    String previousDocument=NotesSecureFixture.evaluate("performance.timeOrigin");
    WebViewTestDriver.navigateHostDocument("localStorage.setItem('"+SELECTION+"',JSON.stringify({kind:'mock'}));location.replace(location.origin+location.pathname)",true);
    until("performance.timeOrigin!=="+previousDocument+"&&document.querySelector('.alpha-auth-page [role=main]')");
    assertEquals("Underlying phone is inert while sign-in is required","true",NotesSecureFixture.evaluate("document.querySelector('.os').inert"));
    assertNotEquals("Legacy mock selection is retired","\"mock\"",NotesSecureFixture.evaluate("JSON.parse(localStorage.getItem('"+SELECTION+"')||'null')?.kind??null"));
    assertEquals("Required sign-in cannot be dismissed","false",NotesSecureFixture.evaluate("!!document.querySelector('.alpha-auth-page button[aria-label=\"Close connection settings\"]')"));
    assertNoMockEntry();
   }finally{
    WebViewTestDriver.navigateHostDocument("localStorage."+("null".equals(saved)?"removeItem('"+SELECTION+"')":"setItem('"+SELECTION+"',"+saved+")")+";location.replace(location.origin+location.pathname)",true);
   }
  }
 }
}
