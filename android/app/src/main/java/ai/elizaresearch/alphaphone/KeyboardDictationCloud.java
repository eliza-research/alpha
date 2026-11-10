package ai.elizaresearch.alphaphone;

import android.content.Context;
import ai.eliza.voice.RecordingPcm;
import ai.eliza.voice.CartesiaSpeech;
import ai.eliza.plugins.agent.runtime.NativeProviderSlot;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.UUID;
import org.json.JSONObject;

/** Uses Alpha's selected Cloud or Direct voice route without fallback or changing charge ownership. */
final class KeyboardDictationCloud implements CartesiaSpeech.Guard {
 private final Context context;
 private final long authority = AlphaLocalAgentPlugin.credentialAuthorityEpoch();
 private String credentialId;
 private final boolean direct;
 private final String providerRevision;
 private volatile boolean cancelled;
 private volatile HttpURLConnection connection;
 KeyboardDictationCloud(Context context) throws Exception {
  this.context = context;
  JSONObject selected = selection();
  direct = KeyboardDictationPolicy.usesDirect(selected.optString("provider"), selected.optBoolean("unbound"));
  providerRevision = NativeProviderSlot.managementRevision(selected.toString(), authority);
  if (direct) directKey(); else credentialId = credential().getString("credentialId");
 }
 private JSONObject selection() throws Exception {
  return AlphaLocalAgentPlugin.withCredentialAuthority(authority, () -> {
   if (cancelled || ai.eliza.plugins.passwords.PasswordSurfaces.visible()) throw new IOException("Dictation cancelled");
   return new JSONObject(new AlphaCredentialStore(context).readCredentialSlot("local-agent-provider:v1"));
  });
 }
 private String directKey() throws Exception {
  JSONObject selected = selection();
  if (!KeyboardDictationPolicy.usesDirect(selected.optString("provider"),selected.optBoolean("unbound"))
      || !providerRevision.equals(NativeProviderSlot.managementRevision(selected.toString(), authority))) throw new IOException("Provider changed");
  String key = selected.optString("cartesiaKey", "");
  if (!LocalAgentProviderAdmission.validProviderToken(key, 1024)) throw new IOException("Voice is not configured");
  return key;
 }
 private JSONObject credential() throws Exception {
  return AlphaLocalAgentPlugin.withCredentialAuthority(authority, () -> {
   if (cancelled || ai.eliza.plugins.passwords.PasswordSurfaces.visible()) throw new IOException("Dictation cancelled");
   AlphaCredentialStore store = new AlphaCredentialStore(context);
   JSONObject saved = new JSONObject(store.readCredentialSlot("cloud:production"));
   String id = saved.getString("credentialId");
   if (id.isEmpty() || (credentialId != null && !credentialId.equals(id))) throw new IOException("Account changed");
   LocalAgentProviderAdmission.requireCloudVoiceSelection(store.readCredentialSlot("local-agent-provider:v1"), id);
   if (saved.has("expiresAt") && saved.getLong("expiresAt") <= System.currentTimeMillis()) throw new IOException("Sign in again");
   return saved;
  });
 }
 public void check() throws Exception {
  if (direct) directKey(); else {
   if (!providerRevision.equals(NativeProviderSlot.managementRevision(selection().toString(), authority))) throw new IOException("Provider changed");
   credential();
  }
 }
 public void opened(HttpURLConnection request) throws Exception { connection = request; check(); }
 void cancel() { cancelled = true; HttpURLConnection active = connection; if (active != null) active.disconnect(); }
 String transcribe(File file) throws Exception {
  check();
  byte[] wav = RecordingPcm.decode(file, () -> cancelled);
  try {
   if (direct) {
    String result = CartesiaSpeech.transcribe(directKey(), wav, this, CartesiaSpeech.HTTPS);
    check(); return result;
   }
   String host = CloudSpeechPolicy.host(BuildConfig.ELIZA_RUNTIME_PROFILE, false, "production");
   JSONObject saved = credential();
   String token = saved.getString("token");
   if (token.isEmpty() || token.length() > 16384 || token.contains("\r") || token.contains("\n")) throw new IOException("Sign in again");
   HttpURLConnection request = (HttpURLConnection)new URL("https://" + host + "/api/v1/voice/stt").openConnection();
   connection = request;
   String boundary = "AlphaDictation" + UUID.randomUUID().toString().replace("-", "");
   byte[] prefix = ("--"+boundary+"\r\nContent-Disposition: form-data; name=\"provider\"\r\n\r\ncartesia\r\n--"+boundary+"\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"recording.wav\"\r\nContent-Type: audio/wav\r\n\r\n").getBytes(StandardCharsets.US_ASCII);
   byte[] suffix = ("\r\n--"+boundary+"--\r\n").getBytes(StandardCharsets.US_ASCII);
   request.setInstanceFollowRedirects(false); request.setUseCaches(false);
   request.setConnectTimeout(20000); request.setReadTimeout(60000);
   request.setRequestMethod("POST"); request.setDoOutput(true);
   request.setRequestProperty("Authorization", "Bearer " + token);
   request.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
   request.setFixedLengthStreamingMode(prefix.length + wav.length + suffix.length);
   check();
   try (OutputStream output = request.getOutputStream()) { output.write(prefix); output.write(wav); output.write(suffix); }
   int status = request.getResponseCode();
   if (status < 200 || status >= 300) throw new IOException("Cloud dictation unavailable");
   CloudSpeechPolicy.requireProvider(BuildConfig.ELIZA_RUNTIME_PROFILE, request.getHeaderField("X-Eliza-STT-Provider"));
   ByteArrayOutputStream bytes = new ByteArrayOutputStream();
   try (InputStream input = request.getInputStream()) {
    byte[] buffer = new byte[8192]; int count;
    while ((count = input.read(buffer)) != -1) {
     if (cancelled || bytes.size() + count > 256 * 1024) throw new IOException("Dictation cancelled");
     bytes.write(buffer, 0, count);
    }
   }
   Object text = new JSONObject(bytes.toString(StandardCharsets.UTF_8.name())).get("transcript");
   if (!(text instanceof String)) throw new IOException("Invalid transcript");
   check(); return (String)text;
  } finally { Arrays.fill(wav, (byte)0); HttpURLConnection request = connection; connection = null; if (request != null) request.disconnect(); }
 }
}
