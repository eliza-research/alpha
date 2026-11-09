package ai.alphacompute.alphaphone;

import java.nio.file.Files;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

/** Controlled service/OS replies. Production plugin code owns every lifecycle decision. */
public final class ResidentTestPorts {
  public static String nativeDirectory;
  public static boolean packaged = true;
  public static final Map<String, String> slots = new ConcurrentHashMap<>();
  public static volatile String rootToken = "root-fixture";
  public static volatile String state = "dead";
  public static volatile boolean serviceActive, socketListening, failStop, losePairResponse;
  public static volatile int starts, stops, pairs, requests;
  public static volatile String pausePath;
  public static volatile Runnable onStart = () -> {};
  public static volatile CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
  public static void initialize(String fixtureDirectory) throws Exception {
    nativeDirectory =
        Files.createTempDirectory(java.nio.file.Path.of(fixtureDirectory), "resident-libraries-").toString();
    Files.createFile(java.nio.file.Path.of(nativeDirectory, "libeliza_bun.so"));
  }
  public static void start() {
    starts++;
    state = "listening";
    serviceActive = true;
    socketListening = true;
    onStart.run();
  }
  public static void stop() {
    stops++;
    if (failStop)
      throw new IllegalStateException("Fixture stop failed");
  }
  public static JSONObject boot() {
    return new JSONObject()
        .put("state", state)
        .put("serviceActive", serviceActive)
        .put("socketListening", socketListening);
  }
  public static void pause(String path) {
    pausePath = path;
    entered = new CountDownLatch(1);
    release = new CountDownLatch(1);
  }
  public static void awaitEntered() throws Exception {
    if (!entered.await(5, TimeUnit.SECONDS))
      throw new AssertionError("Service boundary not reached");
  }
  public static String request(String serialized) {
    JSONObject request = new JSONObject(serialized);
    String path = request.getString("path");
    requests++;
    if (path.equals(pausePath)) {
      pausePath = null;
      entered.countDown();
      try {
        if (!release.await(10, TimeUnit.SECONDS))
          throw new AssertionError("Service boundary not released");
      } catch (InterruptedException interrupted) {
        Thread.currentThread().interrupt();
        throw new IllegalStateException(interrupted);
      }
    }
    JSONObject body;
    switch (path) {
      case "/api/auth/status":
        body = new JSONObject().put("authenticated", true).put("instanceId", "instance-fixture");
        break;
      case "/api/auth/pair-code":
        body = new JSONObject().put("code", "code-fixture");
        break;
      case "/api/auth/pair":
        pairs++;
        if (losePairResponse)
          throw new IllegalStateException("Pair accepted, response lost");
        body = new JSONObject()
                   .put("access", "owner")
                   .put("instanceId", "instance-fixture")
                   .put("token", "owner-fixture")
                   .put("identityId", "identity-fixture");
        break;
      case "/api/auth/me":
        body = new JSONObject()
                   .put("access", new JSONObject().put("role", "OWNER"))
                   .put("identity", new JSONObject().put("id", "identity-fixture"))
                   .put("session",
                       new JSONObject()
                           .put("id", "owner-fixture")
                           .put("expiresAt", System.currentTimeMillis() + 3600000));
        break;
      default:
        throw new AssertionError("Unmodeled service route " + path);
    }
    return new JSONObject().put("status", 200).put("body", body.toString()).toString();
  }
}
