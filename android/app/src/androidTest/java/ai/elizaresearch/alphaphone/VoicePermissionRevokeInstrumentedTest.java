package ai.elizaresearch.alphaphone;

import android.content.Context;
import android.content.pm.PackageManager;
import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.json.JSONObject;
import org.json.JSONTokener;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/**
 * Microphone permission revoked while the native recorder is capturing, then granted again.
 *
 * Android kills the app process when a runtime permission is revoked, and instrumentation runs in
 * that process, so one process cannot observe both sides. The runner
 * (node scripts/test-native-permissions.mjs voice-revoke APP.apk TEST.apk NEW_OUTPUT) owns the
 * permission state of a temporary emulator user and starts one phase per process:
 *   baseline  permission granted: the real recorder captures, stops and discards (this emulator can record)
 *   record    starts a real capture, proves bytes are being written, publishes a marker and waits;
 *             the runner then runs `pm revoke` and requires this process to die mid-test
 *   verify    new process, permission still revoked: the partial capture file is gone, no recording
 *             or note audio exists for that capture, and nothing is left that could be uploaded
 *   regrant   the runner granted the permission again: capture works without reinstalling
 * Plugin-level calls only; nothing is transcribed and no account or network request is involved.
 * Emulator evidence for the native recorder and Android's revoke behaviour, not device acceptance.
 */
@RunWith(AndroidJUnit4.class)
public final class VoicePermissionRevokeInstrumentedTest {
 static final String MARKER = "voice-revoke/recording.json";
 private static final String VOICE = "Capacitor.Plugins.AlphaVoiceCloud";

 private static JSONObject call(String expression) throws Exception {
  WebViewTestDriver.evaluate("window.__voiceRevoke=null;Promise.resolve().then(()=>" + expression + ").then(v=>window.__voiceRevoke=JSON.stringify(v||{}),e=>window.__voiceRevoke=JSON.stringify({error:true,code:String(e&&e.code||''),message:String(e&&e.message||'')}))");
  long end = SystemClock.elapsedRealtime() + 30000;
  while (SystemClock.elapsedRealtime() < end) {
   String raw = WebViewTestDriver.evaluate("window.__voiceRevoke");
   if (!"null".equals(raw)) return new JSONObject((String) new JSONTokener(raw).nextValue());
   SystemClock.sleep(50);
  }
  throw new AssertionError("Native voice call timed out: " + expression);
 }
 private static void ready() throws Exception {
  long end = SystemClock.elapsedRealtime() + 60000;
  while (SystemClock.elapsedRealtime() < end) {
   if ("true".equals(WebViewTestDriver.evaluate("Boolean(window.Capacitor?.Plugins?.AlphaVoiceCloud&&window.Capacitor?.Plugins?.AlphaNoteAudio)"))) return;
   SystemClock.sleep(100);
  }
  fail("Native voice bridge unavailable");
 }
 private static File capture(Context context, String id) { return new File(context.getCacheDir(), "alpha-cloud-voice-" + id + ".m4a"); }
 private static int captures(Context context) {
  File[] files = context.getCacheDir().listFiles((dir, name) -> name.startsWith("alpha-cloud-voice-") && name.endsWith(".m4a"));
  return files == null ? 0 : files.length;
 }
 private static File marker(Context context) { return new File(context.getFilesDir(), MARKER); }
 private static int permission(Context context) { return context.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO); }

 /** Starts a real capture and returns its id once the recorder has written bytes. */
 private static String startCapture(Context context) throws Exception {
  JSONObject started = call(VOICE + ".startRecording()");
  assertFalse("Recorder starts with the permission granted: " + started, started.has("error"));
  assertEquals("recording", started.getString("status"));
  String id = started.getString("recordingId");
  File file = capture(context, id);
  long end = SystemClock.elapsedRealtime() + 15000;
  while (SystemClock.elapsedRealtime() < end && file.length() == 0) SystemClock.sleep(100);
  assertTrue("The recorder created its capture file", file.length() > 0);
  assertFalse("The capture reports live microphone metrics", call(VOICE + ".getRecordingMetrics({recordingId:" + JSONObject.quote(id) + "})").has("error"));
  return id;
 }
 private static void captureStopsAndDiscards(Context context) throws Exception {
  String id = startCapture(context);
  SystemClock.sleep(1200);
  JSONObject stopped = call(VOICE + ".stopRecording()");
  assertFalse("Recorder stops cleanly: " + stopped, stopped.has("error"));
  assertEquals(id, stopped.getString("recordingId"));
  assertFalse(call(VOICE + ".cancelRecording()").has("error"));
  assertFalse("Discard deletes the raw capture", capture(context, id).exists());
  assertEquals(0, captures(context));
 }

 @Test public void microphoneRevokedWhileRecordingPhase() throws Exception {
  String phase = InstrumentationRegistry.getArguments().getString("voiceRevokePhase");
  Assume.assumeTrue("Run through node scripts/test-native-permissions.mjs voice-revoke (the runner owns permission state)", phase != null);
  Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
  String runId = InstrumentationRegistry.getArguments().getString("voiceRevokeRunId");
  assertTrue("The runner supplies one run id for all phases", runId != null && runId.matches("[a-f0-9]{32}"));
  switch (phase) {
   case "baseline": {
    assertEquals("The runner grants RECORD_AUDIO before the baseline", PackageManager.PERMISSION_GRANTED, permission(context));
    marker(context).delete();
    try (BoundedActivityScenario<MainActivity> scenario = BoundedActivityScenario.launch(MainActivity.class)) { ready(); captureStopsAndDiscards(context); }
    break;
   }
   case "record": {
    assertEquals(PackageManager.PERMISSION_GRANTED, permission(context));
    try (BoundedActivityScenario<MainActivity> scenario = BoundedActivityScenario.launch(MainActivity.class)) {
     ready();
     String id = startCapture(context);
     File file = marker(context), pending = new File(file.getParentFile(), "recording.json.tmp");
     assertTrue(file.getParentFile().isDirectory() || file.getParentFile().mkdirs());
     Files.write(pending.toPath(), new JSONObject().put("runId", runId).put("pid", android.os.Process.myPid()).put("recordingId", id).put("bytes", capture(context, id).length()).toString().getBytes(StandardCharsets.UTF_8));
     assertTrue("Marker published atomically", pending.renameTo(file));
     // The runner revokes RECORD_AUDIO now. Android kills this process; reaching the end is a failure.
     long end = SystemClock.elapsedRealtime() + 90000;
     while (SystemClock.elapsedRealtime() < end) SystemClock.sleep(200);
     fail("The process survived; the runner did not revoke RECORD_AUDIO while recording");
    }
    break;
   }
   case "verify": {
    JSONObject saved = new JSONObject(new String(Files.readAllBytes(marker(context).toPath()), StandardCharsets.UTF_8));
    String id = saved.getString("recordingId");
    assertEquals("The marker belongs to this run", runId, saved.getString("runId"));
    assertNotEquals("Revocation ended the recording process", saved.getInt("pid"), android.os.Process.myPid());
    assertEquals("RECORD_AUDIO is still revoked", PackageManager.PERMISSION_DENIED, permission(context));
    try (BoundedActivityScenario<MainActivity> scenario = BoundedActivityScenario.launch(MainActivity.class)) {
     ready();
     assertFalse("The interrupted capture file is removed at the next start", capture(context, id).exists());
     assertEquals("No raw capture remains to transcribe or upload", 0, captures(context));
     assertTrue("No capture is active for the interrupted recording", call(VOICE + ".getRecordingMetrics({recordingId:" + JSONObject.quote(id) + "})").has("error"));
     assertTrue("Stop has nothing to save", call(VOICE + ".stopRecording()").has("error"));
     String request = "{recordingId:" + JSONObject.quote(id) + ",noteId:'voice-revoke-fixture',transcript:'never saved'}";
     assertTrue("The interrupted capture cannot be saved as note audio", call(VOICE + ".saveRecording(" + request + ")").has("error"));
     assertTrue("No note audio exists for the interrupted capture", call("Capacitor.Plugins.AlphaNoteAudio.describe({audioId:" + JSONObject.quote(id) + "})").has("error"));
     for (String suffix : new String[]{".audio", ".json", ".json.bak", ".pending"}) assertFalse(new File(context.getNoBackupFilesDir(), "note-audio/" + id + suffix).exists());
     assertEquals("Checking must not grant the permission", PackageManager.PERMISSION_DENIED, permission(context));
    }
    break;
   }
   case "regrant": {
    assertEquals("The runner grants RECORD_AUDIO again before this phase", PackageManager.PERMISSION_GRANTED, permission(context));
    try (BoundedActivityScenario<MainActivity> scenario = BoundedActivityScenario.launch(MainActivity.class)) { ready(); captureStopsAndDiscards(context); }
    finally { marker(context).delete(); new File(context.getFilesDir(), "voice-revoke").delete(); }
    break;
   }
   default: fail("Unknown voiceRevokePhase " + phase);
  }
 }
}
