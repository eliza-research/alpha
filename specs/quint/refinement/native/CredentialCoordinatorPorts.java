package ai.alphacompute.alphaphone;

import ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.function.Consumer;
import org.json.*;

/**
 * External storage, HTTP and service observations. No mutation policy is
 * evaluated here.
 */
public final class CredentialCoordinatorPorts {
  public interface Observer {
    void event(String kind, String slot, String value);
  }
  public static Observer observer = (kind, slot, value) -> {};
  public static final JSONArray events = new JSONArray();
  public static volatile boolean confirmed, failStop, failIdentity,
      failCloudObserver;
  public static volatile long strictEpoch;
  public static volatile int strictStops, writes, identityReads;
  public static long time;
  public static long tick = 100;
  public static String failBeforeSlot, failAfterSlot, failReadSlot;
  public static CountDownLatch stopped = new CountDownLatch(1);
  public static CountDownLatch requestEntered = new CountDownLatch(1),
                               requestRelease = new CountDownLatch(1);
  public static CountDownLatch streamEntered = new CountDownLatch(1),
                               streamRelease = new CountDownLatch(1);
  public static final JSONArray notifications = new JSONArray();
  public static void notification(String name, JSONObject value) {
    synchronized (notifications) {
      notifications.put(new JSONObject()
                            .put("name", name)
                            .put("value", new JSONObject(value.toString())));
    }
  }
  public static void emit(String kind, String slot, String value) {
    synchronized (events) {
      events.put(new JSONObject()
                     .put("kind", kind)
                     .put("slot", slot == null ? JSONObject.NULL : slot)
                     .put("value", value == null ? JSONObject.NULL : value));
    }
    observer.event(kind, slot, value);
  }
  public static synchronized long elapsed() { return time += tick; }
  public static void dispatchStrictStop(long request) {
    if (request != strictEpoch)
      throw new IllegalStateException("Superseded fixture shutdown");
    strictStops++;
    emit("strict-stop", null, null);
    stopped.countDown();
    if (failStop)
      throw new IllegalStateException("Strict stop dispatch uncertain");
  }
  public static long strictStop() {
    strictStops++;
    strictEpoch++;
    emit("strict-stop", null, null);
    stopped.countDown();
    if (failStop)
      throw new IllegalStateException("Strict stop dispatch uncertain");
    return strictEpoch;
  }
  public static JSONObject boot() {
    JSONObject state = ResidentTestPorts.boot();
    emit("boot", null, state.toString());
    return state;
  }
  public static String read(String key) throws Exception {
    String value = JsonCredentialSlots.VALUES.get(key);
    emit("read", key, value);
    if (key.equals(failReadSlot))
      throw new IOException("Encrypted read unavailable");
    return value;
  }
  public static void write(String key, String value) throws Exception {
    emit("write-start", key, value);
    if (key.equals(failBeforeSlot))
      throw new IOException("Storage refused before replacement");
    if (value == null)
      JsonCredentialSlots.VALUES.remove(key);
    else
      JsonCredentialSlots.VALUES.put(key, value);
    writes++;
    emit("write-committed", key, value);
    if (key.equals(failAfterSlot))
      throw new IOException("Storage failed after replacement");
  }
  public static void absent() {
    ResidentTestPorts.state = "dead";
    ResidentTestPorts.serviceActive = false;
    ResidentTestPorts.socketListening = false;
    confirmed = true;
  }
  public static String request(String input) {
    JSONObject request = new JSONObject(input);
    if (request.getString("path").equals("/api/status")) {
      requestEntered.countDown();
      await(requestRelease);
      return new JSONObject().put("status", 200).put("body", "{}").toString();
    }
    return ResidentTestPorts.request(input);
  }
  public static void stream(String input, Consumer<String> events,
                            ElizaAgentService.LocalStreamHandle handle) {
    streamEntered.countDown();
    await(streamRelease);
    events.accept(
        new JSONObject().put("type", "response").put("status", 200).toString());
  }
  private static void await(CountDownLatch latch) {
    try {
      if (!latch.await(10, java.util.concurrent.TimeUnit.SECONDS))
        throw new AssertionError("Fixture response not released");
    } catch (InterruptedException interrupted) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException(interrupted);
    }
  }
  public static void installNetwork() {
    URL.setURLStreamHandlerFactory(
        protocol -> !protocol.equals("https") ? null : new URLStreamHandler() {
          protected URLConnection openConnection(URL url) throws IOException {
            if (!url.getHost().equals(CloudDeployment.PRODUCTION_API_HOST) ||
                !url.getPath().equals("/api/v1/user"))
              throw new IOException("Unconfigured fixture URL");
            return new HttpURLConnection(url) {
              public void connect() {}
              public void disconnect() {}
              public boolean usingProxy() { return false; }
              public int getResponseCode() {
                identityReads++;
                return failIdentity ? 503 : 200;
              }
              public InputStream getInputStream() {
                JSONObject data = new JSONObject().put(
                    "id", "3b241101-e2bb-4255-8caf-4136c566a962");
                return new ByteArrayInputStream(
                    new JSONObject()
                        .put("success", true)
                        .put("data", data)
                        .toString()
                        .getBytes(StandardCharsets.UTF_8));
              }
            };
          }
        });
  }
}
