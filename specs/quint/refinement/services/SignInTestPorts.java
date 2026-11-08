package ai.elizaresearch.alphaphone;

import com.getcapacitor.JSObject;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import org.json.JSONObject;
import org.json.JSONArray;
import ai.eliza.auth.cloud.CloudSignInReadiness;

/** External ports only. The tested plugin owns protocol, cancellation and persistence sequencing. */
public final class SignInTestPorts {
  public static final Map<String, String> values = new ConcurrentHashMap<>();
  public static final List<JSObject> outcomes = new CopyOnWriteArrayList<>();
  static final BlockingQueue<Event> events = new LinkedBlockingQueue<>();
  public static volatile String failSlot, failRemoveSlot, pauseReadSlot;
  public static int pauseReadSkips;
  static int exchanges;
  static int codeSends;
  static int codeVerifies;
  public static volatile boolean browserOpened;
  public static volatile int authorizations;
  static int issued;
  static String scenario;
  static final Map<Integer, Integer> acknowledgements = new ConcurrentHashMap<>();
  static final Set<Integer> acceptedAcknowledgements = ConcurrentHashMap.newKeySet();
  static int revocations;
  static final String PENDING = "cloud-signin:v1:pending", ACK = "cloud-signin:v1:ack:production",
                      CREDENTIAL = "cloud:production";
  static final class Event {
    final String name;
    final CountDownLatch release = new CountDownLatch(1);
    Event(String name) {
      this.name = name;
    }
  }
  public static void checkpoint(String label) {
    Event event = new Event(label);
    events.add(event);
    try {
      if (!event.release.await(20, TimeUnit.SECONDS))
        throw new AssertionError("Unreleased fixture boundary " + label);
    } catch (InterruptedException stopped) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException("fixture interrupted", stopped);
    }
  }
  static Event next(String expected) throws Exception {
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
    while (System.nanoTime() < deadline) {
      Event event = events.poll(100, TimeUnit.MILLISECONDS);
      if (event == null)
        continue;
      if (event.name.equals(expected))
        return event;
      event.release.countDown();
    }
    throw new AssertionError("Missing fixture boundary " + expected);
  }
  static String secret(int index) {
    return "eliza_mobile_" + String.valueOf((char) ('a' + index)).repeat(40);
  }
  static int owner() {
    String value = values.get(CREDENTIAL);
    if (value == null)
      return 0;
    String token = new JSONObject(value).getString("token");
    for (int i = 1; i <= issued; i++)
      if (secret(i).equals(token))
        return i;
    throw new AssertionError("unknown credential");
  }
  static boolean targetStored(int target) {
    return owner() == target;
  }
  static void install(String chosen) {
    scenario = chosen;
    URL.setURLStreamHandlerFactory(protocol -> {
      if (!protocol.equals("https") && !protocol.equals("http"))
        return null;
      return new URLStreamHandler() {
        protected URLConnection openConnection(URL url) throws IOException {
          if (!url.getProtocol().equals("https") || !(url.getHost().equals(CloudDeployment.PRODUCTION_API_HOST) || url.getHost().equals(CloudDeployment.PRODUCTION_WEB_HOST) && url.getPath().equals("/.well-known/assetlinks.json"))
              || url.getPort() != -1)
            throw new IOException("Unmatched fixture authority");
          return new Connection(url);
        }
      };
    });
  }
  static final class Connection extends HttpURLConnection {
    final ByteArrayOutputStream request = new ByteArrayOutputStream();
    byte[] response;
    int code;
    Connection(URL url) {
      super(url);
    }
    public void connect() {}
    public void disconnect() {}
    public boolean usingProxy() {
      return false;
    }
    public OutputStream getOutputStream() {
      return request;
    }
    void response() throws IOException {
      if (response != null)
        return;
      String path = url.getPath();
      JSONObject body =
          request.size() == 0 ? new JSONObject() : new JSONObject(request.toString(StandardCharsets.UTF_8));
      JSONObject result = new JSONObject();
      code = 200;
      switch (path) {
        case "/.well-known/assetlinks.json":
          response = new JSONArray().put(new JSONObject()
              .put("relation", new JSONArray().put("delegate_permission/common.handle_all_urls"))
              .put("target", new JSONObject().put("namespace", "android_app")
                  .put("package_name", "ai.elizaresearch.alphaphone")
                  .put("sha256_cert_fingerprints", new JSONArray().put(CloudSignInReadiness.certificateFingerprint(new byte[0])))))
              .toString().getBytes(StandardCharsets.UTF_8);
          return;
        case "/api/v1/app-auth/mobile/config":
          if (scenario.equals("cancel-then-phone") || scenario.equals("phone-code-cap")) {
            result.put("success", true)
                .put("clientId", AlphaCloudSignInPlugin.REGISTRATION.clientId)
                .put("environment", "production")
                .put("redirectUri", AlphaCloudSignInPlugin.REGISTRATION.defaultEnvironment().callback())
                .put("codeChallengeMethod", "S256");
          } else
            code = 404;
          break;
        case "/steward/auth/providers":
          result.put("sms", true).put("captcha", new JSONObject().put("enabled", false));
          break;
        case "/steward/auth/email/code/send":
        case "/steward/auth/sms/send":
          codeSends++;
          code = 202;
          result.put("expiresAt", System.currentTimeMillis() + 600000);
          break;
        case "/steward/auth/email/code/verify":
        case "/steward/auth/sms/verify":
          codeVerifies++;
          if (scenario.endsWith("code-cap") || codeVerifies == 1) code = 401;
          else result.put("mfaRequired", true).put("mfa", new JSONObject()
              .put("type", "totp").put("challengeId", "fixture-challenge")
              .put("expiresAt", System.currentTimeMillis() + 300000));
          break;
        case "/steward/auth/mfa/totp/complete":
          result.put("token", "steward_session_" + "x".repeat(32));
          break;
        case "/steward/auth/oauth/exchange":
          exchanges++;
          result.put("token",
              "steward_session_"
                  + "x".repeat(32));
          break;
        case "/api/v1/app-auth/connect":
          result.put("codeType", "mobile_app_auth_code")
              .put("code",
                  "emac_"
                      + "a".repeat(64))
              .put("accountCreated", false);
          break;
        case "/api/v1/app-auth/mobile/token":
          issued++;
          result.put("secret", secret(issued))
              .put("credentialId", String.format("00000000-0000-4000-8000-%012d", issued))
              .put("expiresAt", System.currentTimeMillis() + 3600000)
              .put("acknowledgeBy", System.currentTimeMillis() + 600000)
              .put("acknowledgementRequired", true)
              .put("tokenType", "Bearer");
          break;
        case "/api/v1/app-auth/mobile/ack":
          int index = 0;
          for (int i = 1; i <= issued; i++)
            if (secret(i).equals(body.getString("secret")))
              index = i;
          if (index == 0)
            throw new IOException("Unknown fixture credential");
          int round = acknowledgements.merge(index, 1, Integer::sum);
          if (scenario.equals("ack-restart") && index == 2 && round <= 3)
            code = 503;
          else if (scenario.equals("retry") && index == 2 && round == 1)
            code = 503;
          result.put("status", "acknowledged").put("credentialId", body.getString("credentialId"));
          if (code == 200) acceptedAcknowledgements.add(index);
          break;
        case "/api/v1/api-keys/current":
          if (!method.equals("DELETE"))
            throw new IOException("Expected revoke DELETE");
          revocations++;
          code = 204;
          break;
        case "/steward/auth/logout":
          break;
        default:
          throw new IOException("Unmatched fixture route");
      }
      response = result.toString().getBytes(StandardCharsets.UTF_8);
      if (!path.equals("/api/v1/app-auth/mobile/config"))
        checkpoint("http:" + path);
    }
    public int getResponseCode() throws IOException {
      response();
      return code;
    }
    public long getContentLengthLong() {
      return response == null ? 0 : response.length;
    }
    public String getHeaderField(String name) {
      return null;
    }
    public InputStream getInputStream() throws IOException {
      response();
      return new ByteArrayInputStream(response);
    }
    public InputStream getErrorStream() {
      try {
        response();
        return new ByteArrayInputStream(response);
      } catch (IOException error) {
        throw new IllegalStateException(error);
      }
    }
  }
}
