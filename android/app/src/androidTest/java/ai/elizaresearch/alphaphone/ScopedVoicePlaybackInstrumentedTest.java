package ai.elizaresearch.alphaphone;

import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.json.JSONObject;
import org.json.JSONTokener;
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

/** Public WebView bridge -> synthetic loopback TTS -> real MediaPlayer, without microphone/provider. */
@RunWith(AndroidJUnit4.class)
public class ScopedVoicePlaybackInstrumentedTest {
  private static JSONObject call(String expression) throws Exception {
    String key = "__scopedVoice" + UUID.randomUUID().toString().replace("-", "");
    WebViewTestDriver.evaluate("window." + key + "=null;Promise.resolve(" + expression
        + ").then(x=>window." + key + "=JSON.stringify(x||{}))"
        + ".catch(e=>window." + key + "=JSON.stringify({error:String(e)}))");
    try {
      for (int i = 0; i < 200; i++) {
        String raw = WebViewTestDriver.evaluate("window." + key);
        if (!"null".equals(raw)) return new JSONObject((String) new JSONTokener(raw).nextValue());
        SystemClock.sleep(50);
      }
      throw new AssertionError("Scoped voice bridge deadline");
    } finally { WebViewTestDriver.evaluate("delete window." + key); }
  }

  private static byte[] wav() {
    // Three seconds of silent PCM leaves a witnessed active-playback window.
    int samples = 24000;
    ByteBuffer b = ByteBuffer.allocate(44 + samples * 2).order(ByteOrder.LITTLE_ENDIAN);
    b.put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt(36 + samples * 2)
        .put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII)).putInt(16)
        .putShort((short) 1).putShort((short) 1).putInt(8000).putInt(16000)
        .putShort((short) 2).putShort((short) 16)
        .put("data".getBytes(StandardCharsets.US_ASCII)).putInt(samples * 2);
    return b.array();
  }

  private static final class Fixture implements AutoCloseable {
    final ServerSocket server = new ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"));
    final ExecutorService worker = Executors.newSingleThreadExecutor();
    final List<String> texts = new CopyOnWriteArrayList<>();
    final String token = "synthetic-scoped-voice-" + UUID.randomUUID();
    final Future<?> task;
    volatile Socket active;
    Fixture() throws Exception {
      server.setSoTimeout(15000);
      task = worker.submit(() -> {
        try {
          for (int index = 0; index < 2; index++) {
            try (Socket socket = server.accept()) {
              active = socket;
              socket.setSoTimeout(10000);
              InputStream in = socket.getInputStream();
              ByteArrayOutputStream head = new ByteArrayOutputStream();
              int c, tail = 0;
              while ((c = in.read()) != -1) {
                head.write(c); tail = (tail << 8) | c;
                if (tail == 0x0d0a0d0a) break;
                if (head.size() > 16384) throw new IOException("Header bound");
              }
              String headers = head.toString(StandardCharsets.US_ASCII);
              if (!headers.startsWith("POST /api/tts/paradee HTTP/1.1\r\n"))
                throw new IOException("Unexpected local fixture route");
              String requestId="";for(String line:headers.split("\r\n"))if(line.toLowerCase(Locale.ROOT).startsWith("x-request-id:"))requestId=line.substring(13).trim();
              int length = -1;
              boolean authorized = false;
              for (String line : headers.split("\r\n")) {
                if (line.toLowerCase(Locale.ROOT).startsWith("content-length:"))
                  length = Integer.parseInt(line.substring(15).trim());
                if (line.equalsIgnoreCase("Authorization: Bearer " + token)) authorized = true;
              }
              if (!authorized || length < 1 || length > 16384) throw new IOException("Fixture envelope");
              byte[] body = in.readNBytes(length);
              if (body.length != length) throw new EOFException("Incomplete fixture body");
              JSONObject request = new JSONObject(new String(body, StandardCharsets.UTF_8));
              if (request.length()!=1) throw new IOException("Fixture format");
              texts.add(request.getString("text"));
              byte[] response = wav();
              OutputStream out = socket.getOutputStream();
              out.write(("HTTP/1.1 200 OK\r\nContent-Type: audio/wav\r\nContent-Length: "
                  + response.length + "\r\nX-Request-Id: "+requestId+"\r\nX-Eliza-Speech-Provider: libelizainference-paradee\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
              out.write(response); out.flush();
            } finally { active = null; }
          }
        } catch (Exception error) { throw new RuntimeException("Local voice fixture failed", error); }
      });
    }
    @Override public void close() throws Exception {
      server.close();
      Socket socket = active;
      if (socket != null) socket.close();
      worker.shutdownNow();
      assertTrue("Fixture worker stopped", worker.awaitTermination(5, TimeUnit.SECONDS));
    }
  }

  @Test public void staleStopAndLatePlayPreserveNewerPreparedAndActivePlayback() throws Exception {
   org.junit.Assume.assumeTrue("Loopback HTTP fixtures require a -PELIZA_DEV_ALLOW_TEST_MOCKS=1 debug build", BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
    try (Fixture fixture = new Fixture();
         BoundedActivityScenario<MainActivity> scenario = BoundedActivityScenario.launch(MainActivity.class)) {
      for (int i = 0; i < 100; i++) {
        if ("true".equals(WebViewTestDriver.evaluate("Boolean(window.Capacitor?.Plugins?.AlphaVoiceCloud)"))) break;
        SystemClock.sleep(100);
      }
      assertEquals("true", WebViewTestDriver.evaluate("Boolean(window.Capacitor?.Plugins?.AlphaVoiceCloud)"));
      String origin = "http://127.0.0.1:" + fixture.server.getLocalPort();
      String slot = "remote:" + origin;
      String oldRequest = UUID.randomUUID().toString();
      String newRequest = UUID.randomUUID().toString();
      long expires = System.currentTimeMillis() + 600000;
      String binding = "sessionId:" + JSONObject.quote(UUID.randomUUID().toString())
          + ",origin:" + JSONObject.quote(origin) + ",ownerId:'synthetic-scoped-owner',expiresAt:" + expires;
      String listenerKey = "__scopedVoiceListeners" + UUID.randomUUID().toString().replace("-", "");
      String eventsKey = listenerKey + "Events";
      try {
        JSONObject stored = call("Capacitor.Plugins.AlphaConnection.secureWrite({slot:"
            + JSONObject.quote(slot) + ",value:JSON.stringify({origin:" + JSONObject.quote(origin)
            + ",identityId:'synthetic-scoped-owner',token:" + JSONObject.quote(fixture.token)
            + ",expiresAt:" + expires + "})})");
        assertFalse(stored.toString(), stored.has("error"));
        JSONObject oldSpeech = call("Capacitor.Plugins.AlphaVoiceCloud.synthesizePaired({" + binding
            + ",text:'old synthetic wave',requestId:" + JSONObject.quote(oldRequest) + "})");
        JSONObject newSpeech = call("Capacitor.Plugins.AlphaVoiceCloud.synthesizePaired({" + binding
            + ",text:'new synthetic wave',requestId:" + JSONObject.quote(newRequest) + "})");
        String oldId = oldSpeech.getString("playbackId"), newId = newSpeech.getString("playbackId");
        assertNotEquals(oldId, newId);
        fixture.task.get(5, TimeUnit.SECONDS);
        assertEquals(Arrays.asList("old synthetic wave", "new synthetic wave"), fixture.texts);

        JSONObject listeners = call("(async()=>{window." + eventsKey + "=[];window." + listenerKey
            + "=await Promise.all(['playbackEnded','playbackFailed'].map(type=>"
            + "Capacitor.Plugins.AlphaVoiceCloud.addListener(type,e=>window." + eventsKey
            + ".push({type,id:e.playbackId}))));return {ready:true}})()");
        assertTrue(listeners.toString(), listeners.optBoolean("ready"));
        // Old cleanup must preserve a newly prepared file, before a MediaPlayer exists.
        assertFalse(call("Capacitor.Plugins.AlphaVoiceCloud.stopPlayback({requestId:"
            + JSONObject.quote(oldRequest) + "})").has("error"));
        assertTrue(call("Capacitor.Plugins.AlphaVoiceCloud.play({playbackId:"
            + JSONObject.quote(oldId) + "})").has("error"));
        // Resolution comes from MediaPlayer's onPrepared listener after start().
        assertFalse(call("Capacitor.Plugins.AlphaVoiceCloud.play({playbackId:"
            + JSONObject.quote(newId) + "})").has("error"));
        assertEquals("[]", new JSONTokener(WebViewTestDriver.evaluate("JSON.stringify(window." + eventsKey + ")")).nextValue());
        // Repeat both stale operations while the real newer player is active.
        assertFalse(call("Capacitor.Plugins.AlphaVoiceCloud.stopPlayback({requestId:"
            + JSONObject.quote(oldRequest) + "})").has("error"));
        assertTrue(call("Capacitor.Plugins.AlphaVoiceCloud.play({playbackId:"
            + JSONObject.quote(oldId) + "})").has("error"));
        for (int i = 0; i < 120; i++) {
          if ("true".equals(WebViewTestDriver.evaluate("window." + eventsKey + ".length>0"))) break;
          SystemClock.sleep(50);
        }
        JSONObject observation = call("({events:window." + eventsKey + "})");
        assertEquals("Exactly one actual MediaPlayer completion", 1, observation.getJSONArray("events").length());
        JSONObject event = observation.getJSONArray("events").getJSONObject(0);
        assertEquals("playbackEnded", event.getString("type"));
        assertEquals(newId, event.getString("id"));
        assertTrue("Completed audio is consumed", call("Capacitor.Plugins.AlphaVoiceCloud.play({playbackId:"
            + JSONObject.quote(newId) + "})").has("error"));
      } finally {
        call("Capacitor.Plugins.AlphaVoiceCloud.stopPlayback({requestId:" + JSONObject.quote(oldRequest) + "})");
        call("Capacitor.Plugins.AlphaVoiceCloud.stopPlayback({requestId:" + JSONObject.quote(newRequest) + "})");
        call("(async()=>{for(const h of window." + listenerKey + "||[])await h.remove();delete window."
            + listenerKey + ";delete window." + eventsKey + ";return {}})()");
        call("Capacitor.Plugins.AlphaConnection.secureRemove({slot:" + JSONObject.quote(slot) + "})");
      }
    }
  }
}
