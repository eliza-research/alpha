package ai.elizaresearch.alphaphone;

import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.nio.file.Files;
import org.json.JSONObject;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Explicit opt-in: real local Eliza app-host pairing, native HTTP chat, restart restoration. */
@RunWith(AndroidJUnit4.class)
public class RemoteAgentInstrumentedTest {
 private void until(String expression,long timeout)throws Exception{
  long deadline=SystemClock.elapsedRealtime()+timeout;
  while(SystemClock.elapsedRealtime()<deadline){if("true".equals(WebViewTestDriver.evaluate("Boolean("+expression+")")))return;SystemClock.sleep(100);}
  fail("Remote phone flow did not reach expected state");
 }
 private void click(String text)throws Exception{
  String expression="[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==="+JSONObject.quote(text)+"&&e.getClientRects().length)";
  until(expression,15000);WebViewTestDriver.evaluate("("+expression+").click()");
 }
 private void message(String prompt,String expected)throws Exception{
  WebViewTestDriver.evaluate(AppNavigation.type());until(AppNavigation.composer(),15000);
  WebViewTestDriver.evaluate("(()=>{const e=("+AppNavigation.composer()+");Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,"+JSONObject.quote(prompt)+");e.dispatchEvent(new Event('input',{bubbles:true}));})()");
  WebViewTestDriver.evaluate("document.querySelector('button[aria-label=Send]').click()");
  until("[...document.querySelectorAll('[data-screen] *')].some(e=>e.children.length===0&&e.textContent.trim()==="+JSONObject.quote(expected)+")",120000);
 }
 @Test public void realLocalAppHostPairsChatsAndRestoresOnPhone()throws Exception{
  Assume.assumeTrue("Requires explicit localRemote opt-in","true".equals(InstrumentationRegistry.getArguments().getString("localRemote")));
  assertTrue("Loopback HTTP fixtures require a -PELIZA_DEV_ALLOW_TEST_MOCKS=1 debug build",BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  File fixture=new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getFilesDir(),"local-remote-pairing.json");
  JSONObject config=new JSONObject(new String(Files.readAllBytes(fixture.toPath()),java.nio.charset.StandardCharsets.UTF_8));
  String code=config.getString("code"),origin=config.getString("origin");
  assertEquals("Only disposable loopback app-host allowed","http://10.0.2.2:47839",origin);
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   until("document.querySelector('[data-screen]')",20000);
   WebViewTestDriver.evaluate("localStorage.removeItem('alpha.connection.selection.v1');location.replace(location.origin+location.pathname)");
   until("document.querySelector('.alpha-connection-scrim')",20000);
   WebViewTestDriver.evaluate("[...document.querySelectorAll('.alpha-connection summary')].find(e=>e.textContent==='Local development agent').click()");
   WebViewTestDriver.evaluateSensitive("(()=>{const d=[...document.querySelectorAll('.alpha-connection details')].find(e=>e.querySelector('summary')?.textContent==='Local development agent');const inputs=d.querySelectorAll('input');inputs[0].value="+JSONObject.quote(origin)+";inputs[1].value="+JSONObject.quote(code)+";})()");
   click("Connect local agent");
   until("!document.querySelector('.alpha-connection-scrim')||document.querySelector('.alpha-connection-error')",60000);
   assertEquals("Pairing should complete without a connection error", "null", WebViewTestDriver.evaluate("document.querySelector('.alpha-connection-error')?.textContent??null"));
   until("!document.querySelector('.alpha-connection-scrim')",10000);
   message("What is 7 multiplied by 8? Reply with only the integer.","56");
   scenario.recreate();until("document.documentElement.dataset.activeView==='home'&&!document.querySelector('.alpha-connection-scrim')",60000);
   message("What is 9 multiplied by 7? Reply with only the integer.","63");
  }finally{fixture.delete();}
 }
}
