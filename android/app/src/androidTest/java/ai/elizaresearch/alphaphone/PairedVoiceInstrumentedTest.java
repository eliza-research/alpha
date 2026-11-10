package ai.elizaresearch.alphaphone;

import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.*;
import java.net.*;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.Assert.*;

/** Real WebView bridge, paired credentials, HTTP transport and MediaPlayer. Local synthetic server only. */
@RunWith(AndroidJUnit4.class)
public class PairedVoiceInstrumentedTest {
 private static JSONObject call(String expression)throws Exception {
  WebViewTestDriver.evaluate("window.__cloudVoiceResult=null;Promise.resolve("+expression+").then(x=>window.__cloudVoiceResult=JSON.stringify(x||{})).catch(e=>window.__cloudVoiceResult=JSON.stringify({error:String(e)}))");
  for(int i=0;i<200;i++){String raw=WebViewTestDriver.evaluate("window.__cloudVoiceResult");if(!"null".equals(raw))return new JSONObject((String)new JSONTokener(raw).nextValue());SystemClock.sleep(50);}throw new AssertionError("Voice call timed out");
 }
 private static byte[] wav(){int n=1600;ByteBuffer b=ByteBuffer.allocate(44+n*2).order(ByteOrder.LITTLE_ENDIAN);b.put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt(36+n*2).put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII)).putInt(16).putShort((short)1).putShort((short)1).putInt(8000).putInt(16000).putShort((short)2).putShort((short)16).put("data".getBytes(StandardCharsets.US_ASCII)).putInt(n*2);return b.array();}
 private static class Fixture implements AutoCloseable {
  final ServerSocket server=new ServerSocket(0,8,InetAddress.getByName("127.0.0.1"));
  final List<String> requests=new CopyOnWriteArrayList<>();final List<byte[]> bodies=new CopyOnWriteArrayList<>();final ExecutorService worker=Executors.newSingleThreadExecutor();final Future<?> task;
  Fixture()throws Exception {task=worker.submit(()->{try{for(int index=0;index<4;index++)try(Socket socket=server.accept()){
   socket.setSoTimeout(10000);InputStream in=socket.getInputStream();ByteArrayOutputStream head=new ByteArrayOutputStream();int c;while((c=in.read())!=-1){head.write(c);byte[] b=head.toByteArray();int n=b.length;if(n>=4&&b[n-4]==13&&b[n-3]==10&&b[n-2]==13&&b[n-1]==10)break;if(n>16384)throw new IOException();}
   String h=head.toString(StandardCharsets.US_ASCII);int length=0;for(String line:h.split("\r\n"))if(line.toLowerCase(Locale.ROOT).startsWith("content-length:"))length=Integer.parseInt(line.substring(15).trim());requests.add(h);byte[] body=in.readNBytes(length);bodies.add(body);
   String requestId="";for(String line:h.split("\r\n"))if(line.toLowerCase(Locale.ROOT).startsWith("x-request-id:"))requestId=line.substring(13).trim();
   byte[] response=index==0?"{\"ready\":true,\"provider\":\"libelizainference-paradee\",\"format\":\"pcm16-wav\",\"sampleRate\":24000,\"maxCharacters\":500}".getBytes(StandardCharsets.UTF_8):index==1?wav():"no audio".getBytes(StandardCharsets.US_ASCII);
   String status=index==3?"302 Found":"200 OK";String type=index==0?"application/json":index==1?"audio/wav":"text/html";
   OutputStream out=socket.getOutputStream();out.write(("HTTP/1.1 "+status+"\r\nContent-Type: "+type+"\r\nContent-Length: "+response.length+"\r\nX-Request-Id: "+requestId+"\r\nX-Eliza-Speech-Provider: libelizainference-paradee\r\nLocation: https://example.com/\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));out.write(response);out.flush();
  }}catch(IOException e){if(!server.isClosed())throw new RuntimeException(e);}});}
  public void close()throws Exception{server.close();worker.shutdownNow();}
 }
 @Test public void pairedSpeechUsesPrivateCredentialAndRejectsStaleIdentityAndRedirect()throws Exception {
  org.junit.Assume.assumeTrue("Loopback HTTP fixtures require a -PELIZA_DEV_ALLOW_TEST_MOCKS=1 debug build", BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  try(Fixture fixture=new Fixture();BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   for(int i=0;i<100;i++){if("true".equals(WebViewTestDriver.evaluate("Boolean(window.Capacitor?.Plugins?.AlphaVoiceCloud)")))break;SystemClock.sleep(100);}
   String origin="http://127.0.0.1:"+fixture.server.getLocalPort(),slot="remote:"+origin;
   long expiry=System.currentTimeMillis()+600000;
   String binding="sessionId:"+JSONObject.quote(UUID.randomUUID().toString())+",origin:"+JSONObject.quote(origin)+",ownerId:'synthetic-owner',expiresAt:"+expiry;
   try{
    assertFalse(call("Capacitor.Plugins.AlphaConnection.secureWrite({slot:"+JSONObject.quote(slot)+",value:JSON.stringify({origin:"+JSONObject.quote(origin)+",identityId:'synthetic-owner',token:'synthetic-test-only',expiresAt:"+expiry+"})})").has("error"));
    assertTrue(call("Capacitor.Plugins.AlphaVoiceCloud.pairedVoiceStatus({"+binding+",ownerId:'wrong-owner',requestId:'wrong'})").has("error"));
    assertTrue(call("Capacitor.Plugins.AlphaVoiceCloud.pairedVoiceStatus({"+binding+",expiresAt:1,requestId:'expired'})").has("error"));
    assertTrue(call("Capacitor.Plugins.AlphaVoiceCloud.pairedVoiceStatus({"+binding+",origin:'http://example.com',requestId:'insecure'})").has("error"));
    assertTrue("Missing session is rejected",call("Capacitor.Plugins.AlphaVoiceCloud.pairedVoiceStatus({"+binding+",sessionId:undefined,requestId:'missing-session'})").has("error"));
    assertTrue("Malformed session is rejected",call("Capacitor.Plugins.AlphaVoiceCloud.pairedVoiceStatus({"+binding+",sessionId:'bad/session',requestId:'invalid-session'})").has("error"));
    assertEquals(0,fixture.requests.size());
    assertTrue(call("Capacitor.Plugins.AlphaVoiceCloud.pairedVoiceStatus({"+binding+",requestId:'status'})").getBoolean("ready"));
    assertTrue(fixture.requests.get(0).contains("GET /api/tts/paradee/status"));
    JSONObject speech=call("Capacitor.Plugins.AlphaVoiceCloud.synthesizePaired({"+binding+",text:'synthetic paired playback',requestId:crypto.randomUUID()})");assertTrue(speech.toString(),speech.has("playbackId"));assertFalse(speech.has("token"));
    assertTrue(fixture.requests.get(1).contains("POST /api/tts/paradee "));assertTrue(fixture.requests.get(1).contains("Bearer synthetic-test-only"));
    assertEquals("synthetic paired playback",new JSONObject(new String(fixture.bodies.get(1),StandardCharsets.UTF_8)).getString("text"));
    WebViewTestDriver.evaluate("window.__pairedPlaybackEnded=false;Capacitor.Plugins.AlphaVoiceCloud.addListener('playbackEnded',()=>window.__pairedPlaybackEnded=true)");
    assertFalse(call("Capacitor.Plugins.AlphaVoiceCloud.play({playbackId:"+JSONObject.quote(speech.getString("playbackId"))+"})").has("error"));
    for(int i=0;i<80&&!"true".equals(WebViewTestDriver.evaluate("window.__pairedPlaybackEnded"));i++)SystemClock.sleep(50);
    assertEquals("true",WebViewTestDriver.evaluate("window.__pairedPlaybackEnded"));
    assertTrue(call("Capacitor.Plugins.AlphaVoiceCloud.play({playbackId:"+JSONObject.quote(speech.getString("playbackId"))+"})").has("error"));
    assertTrue(call("Capacitor.Plugins.AlphaVoiceCloud.synthesizePaired({"+binding+",text:'reject html',requestId:crypto.randomUUID()})").has("error"));
    assertTrue(call("Capacitor.Plugins.AlphaVoiceCloud.synthesizePaired({"+binding+",text:'reject redirect',requestId:crypto.randomUUID()})").has("error"));
    assertEquals(4,fixture.requests.size());fixture.task.get(5,TimeUnit.SECONDS);
   }finally{call("Capacitor.Plugins.AlphaVoiceCloud.stopPlayback()");call("Capacitor.Plugins.AlphaConnection.secureRemove({slot:"+JSONObject.quote(slot)+"})");}
  }
 }
}
