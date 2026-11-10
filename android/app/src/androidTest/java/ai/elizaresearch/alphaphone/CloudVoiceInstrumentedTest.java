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

/** Real WebView bridge, private recorder, HTTP transport and MediaPlayer. Local synthetic server only. */
@RunWith(AndroidJUnit4.class)
public class CloudVoiceInstrumentedTest {
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
   byte[] response=index==0?"{\"transcript\":\"Synthetic local transcript\"}".getBytes(StandardCharsets.UTF_8):index==1?wav():"no audio".getBytes(StandardCharsets.US_ASCII);
   String status=index==3?"302 Found":"200 OK";String type=index==0?"application/json":index==1?"audio/wav":"text/html";
   OutputStream out=socket.getOutputStream();out.write(("HTTP/1.1 "+status+"\r\nContent-Type: "+type+"\r\nContent-Length: "+response.length+"\r\nLocation: https://example.com/\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));out.write(response);out.flush();
  }}catch(IOException e){if(!server.isClosed())throw new RuntimeException(e);}});}
  public void close()throws Exception{server.close();worker.shutdownNow();}
 }
 @Test public void privateRecordingAndCloudTransportUseNativeCredentialsAndPlayback()throws Exception {
  org.junit.Assume.assumeTrue("Loopback HTTP fixtures require a -PELIZA_DEV_ALLOW_TEST_MOCKS=1 debug build", BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(context.getPackageName(),android.Manifest.permission.RECORD_AUDIO);
  try(Fixture fixture=new Fixture();BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   for(int i=0;i<100;i++){if("true".equals(WebViewTestDriver.evaluate("Boolean(window.Capacitor?.Plugins?.AlphaVoiceCloud)")))break;SystemClock.sleep(100);}
   String fixtureSlot="instrumentation.voice-"+UUID.randomUUID();
   String quotedSlot=JSONObject.quote(fixtureSlot);
   try{
    assertFalse(call("Capacitor.Plugins.AlphaConnection.secureWrite({slot:"+quotedSlot+",value:JSON.stringify({token:'synthetic-test-only',credentialId:'synthetic-generation'})})").has("error"));
    BoundedActivityScenario.main(()->{for(android.app.Activity a:androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(androidx.test.runner.lifecycle.Stage.RESUMED))if(a instanceof MainActivity){AlphaVoiceCloudPlugin plugin=(AlphaVoiceCloudPlugin)((MainActivity)a).getBridge().getPlugin("AlphaVoiceCloud").getInstance();plugin.instrumentationBaseUrl="http://127.0.0.1:"+fixture.server.getLocalPort();plugin.instrumentationCredentialSlot=fixtureSlot;}});
    assertTrue(call("Capacitor.Plugins.AlphaVoiceCloud.synthesize({environment:'staging',credentialId:'stale-generation',text:'must not upload',requestId:'stale-account'})").has("error"));
    assertEquals("A stale account must not reach the voice server",0,fixture.requests.size());
    JSONObject started=call("Capacitor.Plugins.AlphaVoiceCloud.startRecording()");assertFalse(started.toString(),started.has("error"));SystemClock.sleep(1300);
    JSONObject stopped=call("Capacitor.Plugins.AlphaVoiceCloud.stopRecording()");assertEquals(started.getString("recordingId"),stopped.getString("recordingId"));
    String id=JSONObject.quote(started.getString("recordingId"));
    JSONObject transcript=call("Capacitor.Plugins.AlphaVoiceCloud.transcribeRecording({environment:'staging',credentialId:'synthetic-generation',recordingId:"+id+",requestId:'stt'})");assertEquals("Synthetic local transcript",transcript.getString("text"));assertFalse(transcript.getBoolean("local"));assertFalse(transcript.has("token"));
    assertTrue(fixture.requests.get(0).contains("POST /api/v1/voice/stt"));assertTrue(fixture.requests.get(0).contains("Bearer synthetic-test-only"));assertTrue(new String(fixture.bodies.get(0),StandardCharsets.ISO_8859_1).contains("name=\"audio\""));
    JSONObject speech=call("Capacitor.Plugins.AlphaVoiceCloud.synthesize({environment:'staging',credentialId:'synthetic-generation',text:'synthetic playback',requestId:'tts'})");assertTrue(speech.has("playbackId"));
    WebViewTestDriver.evaluate("window.__cloudPlaybackEnded=false;Capacitor.Plugins.AlphaVoiceCloud.addListener('playbackEnded',()=>window.__cloudPlaybackEnded=true)");
    assertFalse(call("Capacitor.Plugins.AlphaVoiceCloud.play({playbackId:"+JSONObject.quote(speech.getString("playbackId"))+"})").has("error"));
    for(int i=0;i<80&&!"true".equals(WebViewTestDriver.evaluate("window.__cloudPlaybackEnded"));i++)SystemClock.sleep(50);
    assertEquals("true",WebViewTestDriver.evaluate("window.__cloudPlaybackEnded"));
    assertTrue(call("Capacitor.Plugins.AlphaVoiceCloud.play({playbackId:"+JSONObject.quote(speech.getString("playbackId"))+"})").has("error"));
    assertTrue(call("Capacitor.Plugins.AlphaVoiceCloud.synthesize({environment:'staging',credentialId:'synthetic-generation',text:'reject html',requestId:'mime'})").has("error"));
    assertTrue(call("Capacitor.Plugins.AlphaVoiceCloud.synthesize({environment:'staging',credentialId:'synthetic-generation',text:'reject redirect',requestId:'redirect'})").has("error"));
    assertTrue(call("Capacitor.Plugins.AlphaVoiceCloud.synthesize({environment:'https://example.com',credentialId:'synthetic-generation',text:'reject origin',requestId:'origin'})").has("error"));
    call("Capacitor.Plugins.AlphaVoiceCloud.cancelRecording()");assertTrue(call("Capacitor.Plugins.AlphaVoiceCloud.transcribeRecording({environment:'staging',credentialId:'synthetic-generation',recordingId:"+id+",requestId:'discarded'})").has("error"));
    assertEquals(4,fixture.requests.size());fixture.task.get(5,TimeUnit.SECONDS);
   }finally{
    call("Capacitor.Plugins.AlphaVoiceCloud.cancelRecording()");call("Capacitor.Plugins.AlphaVoiceCloud.stopPlayback()");
    call("Capacitor.Plugins.AlphaConnection.secureRemove({slot:"+quotedSlot+"})");
   }
  }
 }
}
