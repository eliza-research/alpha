package ai.elizaresearch.alphaphone;
import android.os.SystemClock;
import org.json.*;
import static org.junit.Assert.*;
/** Test-only real encrypted-bridge reader and exact-CAS fixture setup/cleanup.
 * No localStorage shim, production test hook, or plaintext persistence. */
final class NotesSecureFixture {
 private static final String SLOT="notes-records:v1:device";
 static JSONObject call(String expression)throws Exception{
  WebViewTestDriver.evaluateSensitive("window.__notesSecureFixtureResult=null;Promise.resolve().then(()=>"+expression+").then(value=>window.__notesSecureFixtureResult=JSON.stringify({value}),()=>window.__notesSecureFixtureResult=JSON.stringify({error:true}))");
  long end=SystemClock.elapsedRealtime()+20000;while(SystemClock.elapsedRealtime()<end){
   String encoded=WebViewTestDriver.evaluateSensitive("window.__notesSecureFixtureResult");
   if(!"null".equals(encoded)){JSONObject result=new JSONObject((String)new JSONTokener(encoded).nextValue());WebViewTestDriver.evaluateSensitive("delete window.__notesSecureFixtureResult");assertFalse("Actual Notes secure bridge rejected the operation",result.optBoolean("error"));return result.getJSONObject("value");}SystemClock.sleep(100);
  }throw new AssertionError("Notes secure bridge response timed out; effects are never retried");
 }
 static String read()throws Exception{
  long end=SystemClock.elapsedRealtime()+20000;while(SystemClock.elapsedRealtime()<end){JSONObject r=call("Capacitor.Plugins.AlphaConnection.secureRead({slot:'"+SLOT+"'})");if(!r.isNull("value"))return r.getString("value");SystemClock.sleep(100);}throw new AssertionError("Encrypted Notes were not initialized");
 }
 static String raw()throws Exception{return new JSONObject(read()).getString("currentRaw");}
 static String evaluate(String expression)throws Exception{return evaluateInternal(expression,false);}
 static String evaluateSensitive(String expression)throws Exception{return evaluateInternal(expression,true);}
 private static String evaluateInternal(String expression,boolean sensitive)throws Exception{
  if(!expression.contains("__notesEnvelope"))return sensitive?WebViewTestDriver.evaluateSensitive(expression):WebViewTestDriver.evaluate(expression);
  // Bind one private native snapshot without eval, which the production CSP forbids.
  return WebViewTestDriver.evaluateSensitive("((__notesEnvelope)=>("+expression+"))(JSON.parse("+JSONObject.quote(raw())+"))");
 }
 static void replaceRecords(String transform)throws Exception{
  String expected=read();JSONObject saved=new JSONObject(expected),envelope=new JSONObject(saved.getString("currentRaw"));
  String encoded=WebViewTestDriver.evaluateSensitive("JSON.stringify(("+transform+")("+envelope.getJSONArray("records")+"))");
  JSONArray records=new JSONArray((String)new JSONTokener(encoded).nextValue());envelope.put("records",records);saved.put("currentRaw",envelope.toString());
  JSONObject args=new JSONObject().put("slot",SLOT).put("expectedValue",expected).put("value",saved.toString());
  assertEquals("Fixture CAS must not overwrite a concurrent Notes edit","saved",call("Capacitor.Plugins.AlphaConnection.secureCompareExchange("+args+")").getString("status"));
  assertEquals("Exact encrypted fixture readback",saved.toString(),read());
 }
 private NotesSecureFixture(){}
}
