package ai.elizaresearch.alphaphone;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.getcapacitor.PermissionState;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.Proxy;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/** Debug source-set only. The bearer stays in app-private storage/native memory.
 * The host uses adb reverse; production auth and remote URL configuration are absent. */
@CapacitorPlugin(name = "DevelopmentAgent", permissions = {@Permission(alias="microphone",strings={android.Manifest.permission.RECORD_AUDIO})})
public final class DevelopmentAgentPlugin extends Plugin {
 private DevelopmentVoiceCapture voice;
 private final java.util.concurrent.atomic.AtomicLong voiceEpoch = new java.util.concurrent.atomic.AtomicLong();
 private final ConcurrentHashMap<String,Long> pendingMicrophone = new ConcurrentHashMap<>();
 private final java.util.concurrent.atomic.AtomicReference<String> voiceRequestId = new java.util.concurrent.atomic.AtomicReference<>();
 @Override public void load() { voice = new DevelopmentVoiceCapture(getContext(), value -> notifyListeners("recordingStopped",value,true)); }
 @Override protected void handleOnPause() {
  // A system permission dialog pauses this Activity. Its still-pending explicit
  // request remains eligible; explicit cancellation/destroy invalidates it.
  if (pendingMicrophone.isEmpty()) voiceEpoch.incrementAndGet();
  if (voice != null) voice.stopAutomatically();
 }
 @PluginMethod public void startRecording(PluginCall call) {
  long epoch = voiceEpoch.get();
  if (getPermissionState("microphone") != PermissionState.GRANTED) {
   pendingMicrophone.put(call.getCallbackId(),epoch);
   requestPermissionForAlias("microphone",call,"microphonePermission"); return;
  }
  startMicrophone(call,epoch);
 }
 @PermissionCallback private void microphonePermission(PluginCall call) {
  Long epoch = pendingMicrophone.remove(call.getCallbackId());
  if (epoch == null || epoch.longValue() != voiceEpoch.get()) {call.reject("Recording cancelled","CANCELLED");return;}
  if (getPermissionState("microphone") != PermissionState.GRANTED) { call.reject("Microphone permission was not granted", "PERMISSION_DENIED"); return; }
  startMicrophone(call,epoch.longValue());
 }
 private void startMicrophone(PluginCall call,long epoch) {
  getActivity().runOnUiThread(() -> { if (epoch != voiceEpoch.get()) {call.reject("Recording cancelled","CANCELLED");return;} try { call.resolve(voice.start()); } catch (Exception ignored) { call.reject("Microphone could not start. Finish or discard any previous recording.","RECORDING_FAILED"); } });
 }
 @PluginMethod public void stopRecording(PluginCall call) {
  getActivity().runOnUiThread(() -> { try { call.resolve(voice.stop()); } catch (RuntimeException ignored) { call.reject("Recording could not be saved. Record at least one second and try again.","RECORDING_FAILED"); } });
 }
 @PluginMethod public void saveRecording(PluginCall call){getActivity().runOnUiThread(()->{try{String key=call.getString("recordingId");AlphaNoteAudioPlugin store=(AlphaNoteAudioPlugin)getBridge().getPlugin("AlphaNoteAudio").getInstance();call.resolve(voice.retain(store,key,call.getString("noteId"),call.getString("transcript")));}catch(Exception error){call.reject("The recording could not be saved. Keep this draft and retry.");}});}
 @PluginMethod public void cancelRecording(PluginCall call) {
  voiceEpoch.incrementAndGet();
  pendingMicrophone.clear();
  String activeVoice = voiceRequestId.get();
  if (activeVoice != null) abortRequest(activeVoice);
  voice.cancel(); JSObject value=new JSObject();value.put("status","cancelled");call.resolve(value);
 }
 @PluginMethod public void transcribeRecording(PluginCall call) {
  String id=call.getString("requestId",""), recordingId=call.getString("recordingId","");
  File file=voice.selected(recordingId);
  if (!id.matches("[A-Za-z0-9_-]{1,100}") || file==null || file.length()<=0 || file.length()>4*1024*1024) {call.reject("Choose a recorded audio draft","INVALID_RECORDING");return;}
  if (!voiceRequestId.compareAndSet(null,id)) {call.reject("A transcription is already pending","BUSY");return;}
  Request request=new Request(call);
  if(requests.putIfAbsent(id,request)!=null){voiceRequestId.compareAndSet(id,null);call.reject("Request is already pending","DUPLICATE_REQUEST");return;}
  try {request.work=workers.submit(() -> {
   try {
    String bearer=token(); if(bearer==null)throw new IOException("not configured");
    JSONObject response=exchangeAudio(bearer,file,id,request);
    String text=response.getString("text"); if(text.length()>16000 || !response.optBoolean("local",false))throw new IOException("invalid transcription");
    JSObject value=new JSObject();value.put("text",text);value.put("language",response.optString("language","en"));value.put("engine",response.optString("engine","whisper.cpp"));value.put("local",true);
    if(request.finished.compareAndSet(false,true)){call.resolve(value);}
   } catch(Exception ignored) {if(request.finished.compareAndSet(false,true))call.reject("Local transcription failed. The recording stays on this device until you retry or discard it.","TRANSCRIPTION_FAILED");}
   finally {requests.remove(id,request);voiceRequestId.compareAndSet(id,null);}
  });}catch(RejectedExecutionException error){requests.remove(id,request);voiceRequestId.compareAndSet(id,null);call.reject("Development service is busy","BUSY");}
 }
 private JSONObject exchangeAudio(String bearer,File file,String id,Request request) throws Exception {
  HttpURLConnection connection=(HttpURLConnection)new URL(ORIGIN+"/transcribe").openConnection(Proxy.NO_PROXY);request.connection=connection;
  if(request.finished.get()){connection.disconnect();throw new IOException("cancelled");}
  try {
   connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(5000);connection.setReadTimeout(90000);
   connection.setRequestMethod("POST");connection.setDoOutput(true);connection.setFixedLengthStreamingMode(file.length());
   connection.setRequestProperty("Authorization","Bearer "+bearer);connection.setRequestProperty("Content-Type","audio/mp4");connection.setRequestProperty("X-Request-Id",id);
   try(InputStream input=new java.io.FileInputStream(file);java.io.OutputStream output=connection.getOutputStream()) {
    byte[] buffer=new byte[4096];int count;while((count=input.read(buffer))!=-1){if(request.finished.get()||Thread.currentThread().isInterrupted())throw new IOException("cancelled");output.write(buffer,0,count);}
   }
   if(connection.getResponseCode()!=200)throw new IOException("transcription failed");
   try(InputStream input=connection.getInputStream();ByteArrayOutputStream output=new ByteArrayOutputStream()) {
    byte[] buffer=new byte[4096];int count;while((count=input.read(buffer))!=-1){if(output.size()+count>65536||request.finished.get())throw new IOException("response limit");output.write(buffer,0,count);}
    return new JSONObject(new String(output.toByteArray(),StandardCharsets.UTF_8));
   }
  }finally{connection.disconnect();}
 }
 private static final String ORIGIN = "http://127.0.0.1:47831";
 private static final int MAX_RESPONSE = 256 * 1024;
 private final ThreadPoolExecutor workers = new ThreadPoolExecutor(2, 2, 0, TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(4));
 private final ConcurrentHashMap<String, Request> requests = new ConcurrentHashMap<>();
 private static final class Request {
  final PluginCall call;
  final AtomicBoolean finished = new AtomicBoolean(false);
  volatile HttpURLConnection connection;
  volatile Future<?> work;
  Request(PluginCall call) { this.call = call; }
 }
 private String token() throws IOException {
  File file = new File(getContext().getFilesDir(), "development-agent-token");
  if (!file.isFile() || file.length() < 32 || file.length() > 512) return null;
  String value;
  try (InputStream input = new java.io.FileInputStream(file); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
   byte[] buffer = new byte[128]; int count;
   while ((count = input.read(buffer)) != -1) {
    if (bytes.size() + count > 512) return null;
    bytes.write(buffer, 0, count);
   }
   value = new String(bytes.toByteArray(), StandardCharsets.UTF_8).trim();
  }
  return value.matches("[A-Za-z0-9_-]{32,256}") ? value : null;
 }
 private JSONObject exchange(String path, String bearer, JSONObject body, Request request) throws Exception {
  HttpURLConnection connection = (HttpURLConnection)new URL(ORIGIN + path).openConnection(Proxy.NO_PROXY);
  if (request != null) {
   request.connection = connection;
   if (request.finished.get()) { connection.disconnect(); throw new IOException("cancelled"); }
  }
  try {
   connection.setInstanceFollowRedirects(false);
   connection.setConnectTimeout(5000); connection.setReadTimeout(body == null ? 5000 : 30000);
   connection.setRequestProperty("Authorization", "Bearer " + bearer);
   connection.setRequestProperty("Accept", "application/json");
   if (body != null) {
    byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
    if (bytes.length > 32768) throw new IOException("request limit");
    connection.setRequestMethod("POST"); connection.setDoOutput(true);
    connection.setRequestProperty("Content-Type", "application/json"); connection.setFixedLengthStreamingMode(bytes.length);
    try (java.io.OutputStream output = connection.getOutputStream()) { output.write(bytes); }
   }
   if (connection.getResponseCode() != 200) throw new IOException("development service response");
   long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(60);
   try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
    byte[] buffer = new byte[4096]; int count;
    while ((count = input.read(buffer)) != -1) {
     if (Thread.currentThread().isInterrupted() || (request != null && request.finished.get()) || System.nanoTime() > deadline) throw new IOException("request interrupted");
     if (output.size() + count > MAX_RESPONSE) throw new IOException("response limit");
     output.write(buffer, 0, count);
    }
    return new JSONObject(new String(output.toByteArray(), StandardCharsets.UTF_8));
   }
  } finally { connection.disconnect(); }
 }
 private org.json.JSONArray proposals(JSONObject response, JSONObject requestContext) throws Exception {
  org.json.JSONArray input = response.optJSONArray("proposals"), output = new org.json.JSONArray();
  if (input == null) return output;
  if (input.length() > 4 || requestContext == null) throw new IOException("invalid proposals");
  java.util.HashSet<String> ids = new java.util.HashSet<>();
  for (int i = 0; i < input.length(); i++) {
   JSONObject value = input.getJSONObject(i), operation = value.getJSONObject("operation");
   String id = value.getString("id"), title = value.getString("title"), description = value.getString("description");
   long expiry = value.getLong("expiresAt"), revision = value.getLong("contextRevision");
   if (!id.matches("[A-Za-z0-9_-]{1,100}") || !ids.add(id) || title.trim().isEmpty() || title.length() > 300 || description.length() > 64000
       || expiry <= System.currentTimeMillis() || expiry > System.currentTimeMillis() + 300000
       || revision != requestContext.getLong("revision")) throw new IOException("invalid proposal context");
   JSONObject safeOperation = new JSONObject();
   String type = operation.getString("type");
   if ("create_note".equals(type)) {
    String noteTitle = operation.getString("title"), noteBody = operation.getString("body");
    if (noteTitle.trim().isEmpty() || noteTitle.length() > 256 || noteBody.length() > 32000) throw new IOException("invalid note proposal");
    safeOperation.put("type", type).put("title", noteTitle).put("body", noteBody);
   } else if ("reminder_create".equals(type)) {
    // Exact canonical fields are validated again by the shared renderer contract.
    operation.getJSONObject("fields").getJSONObject("schedule");
    safeOperation = operation;
   } else if ("open_view".equals(type)) {
    String view = operation.getString("view");
    // Mirrors DEVELOPMENT_PROPOSAL_VIEWS; parity is checked by the owning development scope flow.
    if (!java.util.Arrays.asList("home","maps","camera","photos","notes","calendar","notifications","reminders","workflows","files","inbox","browser","settings").contains(view)) throw new IOException("invalid view proposal");
    safeOperation.put("type", type).put("view", view);
   } else throw new IOException("unsupported proposal");
   JSONObject safe = new JSONObject().put("id",id).put("title",title).put("description",description).put("expiresAt",expiry).put("contextRevision",revision).put("operation",safeOperation);
   if (value.has("simulated")) safe.put("simulated",value.getBoolean("simulated"));
   if ("open_view".equals(type) && value.has("navigation")) safe.put("navigation",value.getJSONObject("navigation"));
   output.put(safe);
  }
  return output;
 }
 @PluginMethod public void status(PluginCall call) {
  try { workers.execute(() -> {
   JSObject result = new JSObject(); result.put("available", true); result.put("mode", "development"); result.put("configured", false); result.put("connected", false);
   try {
    String bearer = token(); result.put("configured", bearer != null);
    if (bearer != null) {
     JSONObject health = exchange("/health", bearer, null, null);
     result.put("connected", true);
     for (String key : new String[]{"sessionId", "model", "providerOrigin"}) {
      String value = health.optString(key, ""); if (value.length() <= 512) result.put(key, value);
     }
    }
   } catch (Exception ignored) { result.put("message", "Development service unavailable. Check the host service and adb reverse."); }
   call.resolve(result);
  }); } catch (RejectedExecutionException error) { call.reject("Development service is busy", "BUSY"); }
 }
 @PluginMethod public void chat(PluginCall call) {
  String id = call.getString("requestId", ""), text = call.getString("text", "");
  if (!id.matches("[A-Za-z0-9_-]{1,100}") || text.trim().isEmpty() || text.length() > 16000) { call.reject("Invalid development request", "INVALID_REQUEST"); return; }
  Request request = new Request(call);
  if (requests.putIfAbsent(id, request) != null) { call.reject("Request is already pending", "DUPLICATE_REQUEST"); return; }
  try { request.work = workers.submit(() -> {
   try {
    String bearer = token();
    if (bearer == null) {
     if (request.finished.compareAndSet(false, true)) call.reject("Development connection is not configured", "NOT_CONFIGURED"); return;
    }
    JSONObject body = new JSONObject().put("requestId", id).put("text", text).put("context", call.getData().opt("context"));
    JSONObject response = exchange("/chat", bearer, body, request);
    String reply = response.optString("text", "");
    if (reply.isEmpty() || reply.length() > 100000) throw new IOException("invalid response");
    JSObject value = new JSObject(); value.put("requestId", id); value.put("text", reply); value.put("proposals", proposals(response, body.optJSONObject("context")));
    if (request.finished.compareAndSet(false, true)) call.resolve(value);
   } catch (Exception ignored) {
    if (request.finished.compareAndSet(false, true)) call.reject("Development request failed or timed out. No action was executed.", "DEVELOPMENT_REQUEST_FAILED");
   } finally { requests.remove(id, request); }
  }); } catch (RejectedExecutionException error) { requests.remove(id, request); call.reject("Development service is busy", "BUSY"); }
 }
 private boolean abortRequest(String id) {
  voiceRequestId.compareAndSet(id,null);
  Request request = requests.remove(id);
  boolean cancelled = request != null && request.finished.compareAndSet(false, true);
  if (cancelled) {
   if (request.connection != null) request.connection.disconnect();
   if (request.work != null) request.work.cancel(true);
   request.call.reject("Development request cancelled", "CANCELLED");
  }
  return cancelled;
 }
 @PluginMethod public void cancel(PluginCall call) {
  JSObject value = new JSObject(); value.put("cancelled", abortRequest(call.getString("requestId", ""))); call.resolve(value);
 }
 @Override protected void handleOnDestroy() {
  voiceEpoch.incrementAndGet();
  pendingMicrophone.clear();
  if (voice != null) voice.cancel();
  for (Request request : requests.values()) {
   request.finished.set(true);
   if (request.connection != null) request.connection.disconnect();
   if (request.work != null) request.work.cancel(true);
  }
  requests.clear(); workers.shutdownNow();
 }
}
