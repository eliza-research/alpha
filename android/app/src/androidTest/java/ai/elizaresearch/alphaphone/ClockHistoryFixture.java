package ai.elizaresearch.alphaphone;

import android.os.SystemClock;
import java.util.Objects;
import org.json.JSONObject;
import static org.junit.Assert.*;

/** Test-only encrypted receipt observation; unobserved or replaced records are retained. */
final class ClockHistoryFixture implements AutoCloseable {
 private static final String SLOT="clock-handoff:v1:device";
 private String owned;
 ClockHistoryFixture()throws Exception{
  long end=SystemClock.elapsedRealtime()+20000;
  while(!"true".equals(WebViewTestDriver.evaluate("Boolean(window.Capacitor?.Plugins?.AlphaConnection)"))){
   if(SystemClock.elapsedRealtime()>=end)throw new AssertionError("Clock secure bridge did not become ready");
   SystemClock.sleep(100);
  }
  assertNull("Use a fixture without existing encrypted Clock history",read());
 }
 private String read()throws Exception{
  JSONObject response=NotesSecureFixture.call("Capacitor.Plugins.AlphaConnection.secureRead({slot:'"+SLOT+"'})");
  return response.isNull("value")?null:response.getString("value");
 }
 void completed(String action)throws Exception{
  long end=SystemClock.elapsedRealtime()+20000;
  while(SystemClock.elapsedRealtime()<end){
   String raw=read();
   if(raw!=null&&!Objects.equals(raw,owned)){
    JSONObject value=new JSONObject(raw),record=value.getJSONObject("record");
    if(!"opening".equals(record.getString("status"))){
     assertEquals(1,value.getInt("version"));assertEquals(action,record.getString("action"));
     assertEquals("Native handoff returned an opened receipt","opened",record.getString("status"));
     owned=raw;return;
    }
   }
   SystemClock.sleep(100);
  }
  throw new AssertionError("Clock encrypted completion missing; retain uncertain history");
 }
 @Override public void close()throws Exception{
  String current=read();
  if(current==null)return;
  assertEquals("Retain changed or unobserved Clock history for recovery",owned,current);
  JSONObject args=new JSONObject().put("slot",SLOT).put("expectedValue",owned).put("value",JSONObject.NULL);
  assertEquals("Fixture cleanup must not erase a newer handoff","saved",NotesSecureFixture.call("Capacitor.Plugins.AlphaConnection.secureCompareExchange("+args+")").getString("status"));
  assertNull(read());
 }
}
