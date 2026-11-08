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

/** Real WebView bridge, paired credentials, actual AAC decoder and HTTP transport. Local synthetic server only. */
@RunWith(AndroidJUnit4.class)
public class PairedAsrInstrumentedTest {
 private static JSONObject call(String expression)throws Exception {
  WebViewTestDriver.evaluate("window.__cloudVoiceResult=null;Promise.resolve("+expression+").then(x=>window.__cloudVoiceResult=JSON.stringify(x||{})).catch(e=>window.__cloudVoiceResult=JSON.stringify({error:String(e)}))");
  for(int i=0;i<600;i++){String raw=WebViewTestDriver.evaluate("window.__cloudVoiceResult");if(!"null".equals(raw))return new JSONObject((String)new JSONTokener(raw).nextValue());SystemClock.sleep(50);}throw new AssertionError("Voice call timed out");
 }
 private static class Fixture implements AutoCloseable {
  final ServerSocket server=new ServerSocket(0,8,InetAddress.getByName("127.0.0.1"));
  final List<String> requests=new CopyOnWriteArrayList<>();final List<byte[]> bodies=new CopyOnWriteArrayList<>();final ExecutorService worker=Executors.newSingleThreadExecutor();final Future<?> task;
  Fixture()throws Exception {task=worker.submit(()->{try{for(int index=0;index<2;index++)try(Socket socket=server.accept()){
   socket.setSoTimeout(10000);InputStream in=socket.getInputStream();ByteArrayOutputStream head=new ByteArrayOutputStream();int c;while((c=in.read())!=-1){head.write(c);byte[] b=head.toByteArray();int n=b.length;if(n>=4&&b[n-4]==13&&b[n-3]==10&&b[n-2]==13&&b[n-1]==10)break;if(n>16384)throw new IOException();}
   String h=head.toString(StandardCharsets.US_ASCII);int length=0;for(String line:h.split("\r\n"))if(line.toLowerCase(Locale.ROOT).startsWith("content-length:"))length=Integer.parseInt(line.substring(15).trim());requests.add(h);byte[] body=in.readNBytes(length);bodies.add(body);
   String requestId="";for(String line:h.split("\r\n"))if(line.toLowerCase(Locale.ROOT).startsWith("x-request-id:"))requestId=line.substring(13).trim();
   byte[] response=(index==0?"{\"ready\":true,\"provider\":\"local-inference\",\"format\":\"pcm16-wav\",\"maxDurationSeconds\":60,\"language\":\"en\"}":"{\"text\":\"Synthetic provider transcript\",\"provider\":\"local-inference\"}").getBytes(StandardCharsets.UTF_8);
   String status="200 OK",type="application/json";
   OutputStream out=socket.getOutputStream();out.write(("HTTP/1.1 "+status+"\r\nContent-Type: "+type+"\r\nContent-Length: "+response.length+"\r\nLocation: https://example.com/\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));out.write(response);out.flush();
  }}catch(IOException e){if(!server.isClosed())throw new RuntimeException(e);}});}
  public void close()throws Exception{server.close();worker.shutdownNow();}
 }
 @Test public void nativeAacDecodeAndAuthenticatedExplicitAsrPreserveDraft()throws Exception{
  org.junit.Assume.assumeTrue("Loopback HTTP fixtures require a -PELIZA_DEV_ALLOW_TEST_MOCKS=1 debug build", BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();File audio=File.createTempFile("paired-asr-",".m4a",context.getCacheDir());
  try(InputStream input=InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("paired-whisper-fixture.m4a");OutputStream output=new FileOutputStream(audio)){byte[] buffer=new byte[8192];int n;while((n=input.read(buffer))!=-1)output.write(buffer,0,n);}
  try{ai.eliza.voice.RecordingPcm.decode(audio,()->true);fail("Cancelled decoder must not return audio");}catch(IOException expected){}
  try(Fixture fixture=new Fixture();BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   for(int i=0;i<100;i++){if("true".equals(WebViewTestDriver.evaluate("Boolean(window.Capacitor?.Plugins?.AlphaVoiceCloud)")))break;SystemClock.sleep(100);}
   String origin="http://127.0.0.1:"+fixture.server.getLocalPort(),slot="remote:"+origin,clip=UUID.randomUUID().toString();long expiry=System.currentTimeMillis()+600000;String binding="origin:"+JSONObject.quote(origin)+",ownerId:'synthetic-owner',sessionId:'synthetic-session',expiresAt:"+expiry;
   try{
    assertFalse(call("Capacitor.Plugins.AlphaConnection.secureWrite({slot:"+JSONObject.quote(slot)+",value:JSON.stringify({origin:"+JSONObject.quote(origin)+",identityId:'synthetic-owner',sessionId:'synthetic-session',token:'synthetic-test-only',expiresAt:"+expiry+"})})").has("error"));
    BoundedActivityScenario.main(()->{try{for(android.app.Activity a:androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(androidx.test.runner.lifecycle.Stage.RESUMED))if(a instanceof MainActivity){AlphaVoiceCloudPlugin plugin=(AlphaVoiceCloudPlugin)((MainActivity)a).getBridge().getPlugin("AlphaVoiceCloud").getInstance();java.lang.reflect.Field f=ai.eliza.voice.LocalSpeechBridgePlugin.class.getDeclaredField("capture");f.setAccessible(true);Object capture=f.get(plugin);for(String name:new String[]{"file","id","durationMs"}){java.lang.reflect.Field field=ai.eliza.voice.LocalVoiceRecording.class.getDeclaredField(name);field.setAccessible(true);field.set(capture,name.equals("file")?audio:name.equals("id")?clip:6200L);}}}catch(Exception e){throw new RuntimeException(e);}});
    assertTrue(call("Capacitor.Plugins.AlphaVoiceCloud.transcribePairedRecording({"+binding+",ownerId:'wrong',recordingId:"+JSONObject.quote(clip)+",requestId:'00000000-0000-4000-8000-000000000001'})").has("error"));assertEquals(0,fixture.requests.size());
    JSONObject capability=call("Capacitor.Plugins.AlphaVoiceCloud.pairedTranscriptionStatus({"+binding+",requestId:'capability'})");
    assertFalse("Paired transcription capability request rejected: "+capability.optString("error"),capability.has("error"));
    assertTrue("Authenticated fixture must advertise ready transcription",capability.getBoolean("ready"));
    JSONObject transcript=call("Capacitor.Plugins.AlphaVoiceCloud.transcribePairedRecording({"+binding+",recordingId:"+JSONObject.quote(clip)+",requestId:'00000000-0000-4000-8000-000000000002'})");assertEquals("Synthetic provider transcript",transcript.getString("text"));assertTrue(transcript.getBoolean("local"));assertFalse(transcript.has("token"));
    assertTrue(fixture.requests.get(1).contains("POST /api/asr/libelizainference "));assertTrue(fixture.requests.get(1).contains("Bearer synthetic-test-only"));byte[] wav=fixture.bodies.get(1);assertEquals("RIFF",new String(wav,0,4,StandardCharsets.US_ASCII));ByteBuffer pcm=ByteBuffer.wrap(wav).order(ByteOrder.LITTLE_ENDIAN);assertEquals(1,pcm.getShort(22));assertEquals(16000,pcm.getInt(24));assertEquals(16,pcm.getShort(34));assertTrue(wav.length>32000);assertTrue(wav.length<=60*32000+44);assertTrue("Transcription keeps original recording for review/save",audio.isFile());
    fixture.task.get(5,TimeUnit.SECONDS);
   }finally{call("Capacitor.Plugins.AlphaVoiceCloud.cancelRecording()");call("Capacitor.Plugins.AlphaConnection.secureRemove({slot:"+JSONObject.quote(slot)+"})");}
  }finally{audio.delete();}
 }
}
