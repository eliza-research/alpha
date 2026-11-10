package ai.alphacompute.alphaphone;

import ai.eliza.plugins.system.reset.ResetAuthorization;
import ai.eliza.voice.LiveCaptureAdmission;
import ai.eliza.voice.SpeechPcmQueue;
import ai.eliza.voice.SpeechAudioFocusPolicy;
import ai.eliza.plugins.media.SelectedPhotoCopy;

import ai.eliza.sense.IndicatorLease;
import ai.eliza.sense.ListenerPolicy;
import ai.eliza.sense.CrashLoopBreaker;
import java.io.ByteArrayInputStream;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

public final class ComponentTraces {
 static JSONObject authorization(ResetAuthorization value) throws Exception {
  return Trace.fields("review", Trace.read(value, "active"), "confirmed", Trace.read(value, "confirmed"), "authGeneration", Trace.read(value, "generation"));
 }
 static JSONArray reset() throws Exception {
  JSONArray result = new JSONArray();
  for (int confirm : new int[]{0, 1, 2}) for (int ticket : new int[]{0, 1, 2})
   for (boolean accepted : new boolean[]{false, true}) for (boolean retire : new boolean[]{false, true}) {
    ResetAuthorization value = new ResetAuthorization();
    Trace trace = new Trace("authorization-" + confirm + ticket + accepted + retire, authorization(value));
    value.begin(); trace.step("beginReview", authorization(value));
    value.confirm(confirm); trace.step("confirm", authorization(value), confirm);
    if (retire) { value.retire(); trace.step("retireActivity", authorization(value)); }
    boolean allowed = value.authenticate(ticket, accepted);
    trace.step("authenticate", authorization(value).put("s.authorizedRequest", allowed), ticket, accepted, true);
    result.put(trace.value);
   }
  return result;
 }
 static JSONArray speech() throws Exception {
  JSONArray result = new JSONArray();
  for (boolean cancelBeforeAttach : new boolean[]{false, true}) {
   LiveCaptureAdmission admission = new LiveCaptureAdmission();
   Trace trace = new Trace("capture-late-attach-" + cancelBeforeAttach, Trace.fields("captureOpen", false));
   LiveCaptureAdmission.Ticket ticket = admission.begin("assistant", 1);
   trace.step("acquireCapture", Trace.fields("opening", admission.current(ticket)), "assistant");
   if (cancelBeforeAttach) { admission.cancelAll(); trace.step("releaseCapture", Trace.fields("captureOpen", false)); }
   int[] cancellations = {0}; boolean attached = admission.attach(ticket, () -> cancellations[0]++);
   trace.step("captureOpened", Trace.fields("captureOpen", attached), 1);
   admission.cancelAll(); trace.step("releaseCapture", Trace.fields("captureOpen", admission.current(ticket)));
   if (cancellations[0] != 1 || admission.events(ticket)) throw new AssertionError("capture cancellation contract");
   result.put(trace.value);
  }
  for (boolean cancel : new boolean[]{false, true}) {
   SpeechPcmQueue queue = new SpeechPcmQueue(48000);
   Trace trace = new Trace("pcm-queue-" + cancel, Trace.fields("queued", queue.queuedSamples() / 24000));
   trace.step("requestSpeech", Trace.fields("queued", queue.queuedSamples() / 24000), true);
   float[][] buffers = {new float[24000], new float[24000], new float[24000]};
   for (int i = 0; i < 3; i++) {
    java.util.Arrays.fill(buffers[i], 0.5f);
    queue.offer(buffers[i], 0, TimeUnit.NANOSECONDS);
    trace.step("offer", Trace.fields("queued", queue.queuedSamples() / 24000), 1, true);
   }
   if (buffers[2][0] != 0) throw new AssertionError("full queue must zero refused buffer");
   if (cancel) {
    queue.close(); trace.step("stop", Trace.fields("queued", queue.queuedSamples(), "cleared", queue.closed()));
    if (buffers[0][0] != 0 || buffers[1][0] != 0) throw new AssertionError("close must zero pending buffers");
   } else {
    for (int i = 0; i < 2; i++) {
     float[] next = queue.take(0, TimeUnit.NANOSECONDS);
     trace.step("take", Trace.fields("queued", queue.queuedSamples() / 24000));
     java.util.Arrays.fill(next, 0); trace.step("finishChunk", Trace.fields("queued", queue.queuedSamples() / 24000));
    }
    queue.complete(); trace.step("complete", Trace.fields("queued", queue.queuedSamples()));
    if (queue.take(0, TimeUnit.NANOSECONDS) != SpeechPcmQueue.END) throw new AssertionError("missing END");
    queue.close(); trace.step("releaseSpeech", Trace.fields("queued", queue.queuedSamples()));
   }
   result.put(trace.value);
  }
  for (boolean forCall : new boolean[]{false, true}) {
   SpeechAudioFocusPolicy focus = new SpeechAudioFocusPolicy();
   Trace trace = new Trace("focus-loss-" + forCall, Trace.fields("focus", "idle"));
   focus.granted(true); trace.step("requestSpeech", Trace.fields("focus", Trace.read(focus, "state").toString().toLowerCase()), true);
   focus.changed(SpeechAudioFocusPolicy.Event.LOSS_TRANSIENT_CAN_DUCK);
   trace.step("duck", Trace.fields("focus", Trace.read(focus, "state").toString().toLowerCase()));
   focus.changed(SpeechAudioFocusPolicy.Event.GAIN);
   trace.step("regain", Trace.fields("focus", Trace.read(focus, "state").toString().toLowerCase()));
   SpeechAudioFocusPolicy.Action action = focus.changed(SpeechAudioFocusPolicy.Event.LOSS);
   boolean stops = SpeechAudioFocusPolicy.stopsCapture(action, forCall ? SpeechAudioFocusPolicy.Mode.IN_CALL : SpeechAudioFocusPolicy.Mode.NORMAL);
   trace.step("loseFocus", Trace.fields("focus", Trace.read(focus, "state").toString().toLowerCase(), "callActive", stops), forCall);
   result.put(trace.value);
  }
  return result;
 }
 static JSONArray media() throws Exception {
  JSONArray result = new JSONArray();
  for (String invalidation : new String[]{"none", "revoke", "pause", "lock", "source"}) {
   NativeReadEpoch epoch = new NativeReadEpoch();
   boolean[] allowed = {true}; String[] revision = {"r0"};
   Trace trace = new Trace("photo-read-" + invalidation, Trace.fields("epoch", epoch.get(), "loaded", false));
   trace.step("grant", Trace.fields("epoch", epoch.get()), "selected");
   trace.step("selectMedia", Trace.fields("epoch", epoch.get()));
   long captured = epoch.get(); trace.step("beginRead", Trace.fields("requestEpoch", captured));
   if (!invalidation.equals("none")) {
    epoch.incrementAndGet();
    if (invalidation.equals("source")) revision[0] = "r1";
    else allowed[0] = false;
    trace.step("invalidate", Trace.fields("epoch", epoch.get()), invalidation);
   }
   boolean[] loaded = {false};
   SelectedPhotoCopy.Source source = new SelectedPhotoCopy.Source() {
    public SelectedPhotoCopy.Metadata inspect() { return new SelectedPhotoCopy.Metadata("image.png", "image/png", 3, revision[0], "selected:1"); }
    public java.io.InputStream open() { return new ByteArrayInputStream(new byte[]{1, 2, 3}); }
   };
   SelectedPhotoCopy.Guard guard = () -> { if (!epoch.current(captured, "r0", revision[0], allowed[0])) throw new SecurityException("retired read"); };
   try { loaded[0] = SelectedPhotoCopy.read(source, guard).bytes.length == 3; } catch (SecurityException expected) { }
   trace.step("readComplete", Trace.fields("loaded", loaded[0]), captured, 0);
   if (loaded[0]) {
    trace.step("review", Trace.fields("loaded", true));
    boolean[] published = {false};
    SelectedPhotoCopy.publish(guard, () -> published[0] = true, () -> {});
    trace.step("publish", Trace.fields("published", published[0]));
   }
   result.put(trace.value);
  }
  return result;
 }
 static JSONObject lease(IndicatorLease value) throws Exception {
  return Trace.fields("generation", Trace.read(value, "generation"), "live", Trace.read(value, "live"),
    "acknowledged", Trace.read(value, "acknowledged"), "expiresAt", Trace.read(value, "expiresAt"),
    "surface", Trace.read(value, "surfaceVisible"), "chip", Trace.read(value, "chipVisible"), "recording", Trace.read(value, "recordingObserved"));
 }
 static String loss(IndicatorLease.Loss loss) { return loss.name().toLowerCase().replace('_', '-'); }
 static JSONArray leases() throws Exception {
  JSONArray result = new JSONArray();
  for (boolean surface : new boolean[]{false, true}) for (boolean chip : new boolean[]{false, true})
   for (boolean recording : new boolean[]{false, true}) for (String display : new String[]{"on", "off", "doze", "unknown"})
    for (String reason : new String[]{"none", "fullscreen", "shade", "transition"}) {
     IndicatorLease value = new IndicatorLease();
     Trace trace = new Trace("lease-" + surface + chip + recording + display + reason, lease(value));
     long token = value.acquire(0); trace.step("acquire", lease(value));
     boolean accepted = value.renew(token, 0, 0, surface, chip, recording, display, reason);
     trace.step("renew", lease(value).put("s.lastRenewAccepted", accepted), token, surface, chip, recording, display, reason);
     trace.step("processFrame", lease(value).put("s.lastCheck", loss(value.verdict(0, 0, false, true))));
     trace.step("advance", lease(value), 3000);
     accepted = value.renew(token, 3000, 0, true, true, true, "on", "none");
     trace.step("renew", lease(value).put("s.lastRenewAccepted", accepted), token, true, true, true, "on", "none");
     value.revoke(token); trace.step("revoke", lease(value), token);
     result.put(trace.value);
    }
  for (boolean death : new boolean[]{false, true}) {
   IndicatorLease value = new IndicatorLease(); Trace trace = new Trace("lease-generation-" + death, lease(value));
   long old = value.acquire(0); trace.step("acquire", lease(value));
   long current = value.acquire(0); trace.step("acquire", lease(value));
   boolean accepted = value.renew(old, 0, 0, true, true, true);
   trace.step("renew", lease(value).put("s.lastRenewAccepted", accepted), old, true, true, true, "on", "none");
   if (death) value.binderDied(current); else value.revoke(current);
   trace.step(death ? "binderDied" : "revoke", lease(value), current);
   result.put(trace.value);
  }
  for (int count = 0; count <= 3; count++) for (boolean open : new boolean[]{false, true})
   for (int wall : new int[]{0, 599999, 600000, 600001}) for (boolean permission : new boolean[]{false, true})
    for (boolean reboot : new boolean[]{false, true}) {
     long[] exits = new long[count];
     Trace trace = new Trace("crash-history-" + count + open + wall + permission + reboot, Trace.fields("exits", new JSONArray()));
     trace.step("loadSavedHistory", Trace.fields("exits", new JSONArray(exits)), count, open);
     trace.step("wallTime", Trace.fields("wall", wall), wall);
     if (reboot) trace.step("changeBoot", Trace.fields("boot", 1), 1);
     boolean unclean = permission && CrashLoopBreaker.uncleanExit(open, 0, reboot ? 1 : 0, 0, 0);
     exits = CrashLoopBreaker.onProcessStart(exits, unclean, wall);
     trace.step("processStarts", Trace.fields("exits", new JSONArray(exits), "tripped", CrashLoopBreaker.tripped(exits, wall)), permission);
     result.put(trace.value);
    }
  return result;
 }
 static JSONObject listener(ListenerPolicy.Inputs value) {
  ListenerPolicy.State state = ListenerPolicy.decide(value, 0);
  String name;
  switch (state) {
   case OFF: name = "off"; break;
   case STOPPED_AFTER_ERRORS: name = "stopped-errors"; break;
   case STOPPED_INDICATOR_LOST: name = "stopped-indicator-lost"; break;
   case PAUSED_OTHER_USER: name = "other-user"; break;
   case WAITING_FOR_UNLOCK: name = "waiting-unlock"; break;
   case PAUSED_FULLSCREEN: name = "paused-indicator"; break;
   default: name = state.name().toLowerCase().replace('_', '-');
  }
  return Trace.fields("decision", name, "microphone", ListenerPolicy.holdsMicrophone(state), "analyzing", ListenerPolicy.processesAudio(state));
 }
 static void environment(ListenerPolicy.Inputs value, String kind, boolean enabled) {
  switch (kind) {
   case "permission": value.recordAudioGranted = enabled; break;
   case "notification": value.notificationsVisible = enabled; break;
   case "foreground": value.userForeground = enabled; break;
   case "unlock": value.userUnlocked = enabled; break;
   case "speech": value.speechUnavailable = !enabled; break;
   case "call": value.inCall = enabled; break;
   case "otherMic": value.otherAppRecording = enabled; break;
   case "silenced": value.micSilenced = enabled; break;
   default: throw new AssertionError(kind);
  }
 }
 static JSONArray listeners() {
  JSONArray result = new JSONArray(); String[] kinds = {"permission", "notification", "foreground", "unlock", "speech", "call", "otherMic", "silenced"};
  for (String first : kinds) for (String second : kinds) for (boolean a : new boolean[]{false, true}) for (boolean b : new boolean[]{false, true}) {
   ListenerPolicy.Inputs value = new ListenerPolicy.Inputs();
   value.recordAudioGranted = value.notificationsVisible = value.userForeground = value.userUnlocked = true;
   Trace trace = new Trace("listener-" + first + a + second + b, listener(value));
   value.consentVersion = 1; value.enabled = true; trace.step("enable", listener(value));
   trace.step("acquireLease", listener(value));
   value.indicatorLeaseValid = true; trace.step("renewLease", listener(value), true);
   environment(value, first, a); trace.step("environment", listener(value), first, a);
   environment(value, second, b); trace.step("environment", listener(value), second, b);
   boolean held = ListenerPolicy.holdsMicrophone(ListenerPolicy.decide(value, 0));
   value.indicatorLeaseValid = false;
   value.indicatorLost |= ListenerPolicy.latchesIndicatorLoss(held, false, false);
   trace.step("loseLease", listener(value));
   trace.step("acquireLease", listener(value));
   value.indicatorLeaseValid = true; trace.step("renewLease", listener(value), true);
   result.put(trace.value);
  }
  return result;
 }
 public static void main(String[] args) throws Exception {
  System.out.println(new JSONObject().put("ResetRecovery", reset()).put("SpeechResources", speech())
    .put("MediaLifecycle", media()).put("ListenerLeaseRecovery", leases()).put("AlwaysOnListener", listeners()));
 }
}
