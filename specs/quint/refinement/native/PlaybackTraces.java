package ai.elizaresearch.alphaphone;
import ai.eliza.voice.*;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

public final class PlaybackTraces {
 static final class Output implements StreamingSpeechPlayback.Output {
  final String mode; int written; int calls; boolean released;
  Output(String mode) { this.mode = mode; }
  public void play() {}
  public int write(float[] samples, int offset, int length) { calls++; if (mode.equals("write-failure")) return -1; int count = mode.equals("partial") ? 1 : length; written += count; return count; }
  public long playedFrames() { return written; }
  public long presentationNs(long frame) { return VoiceLatencyTrials.UNSET; }
  public void setVolume(float volume) {}
  public void abort() {}
  public void stop() {}
  public void release() { released = true; }
 }
 static final class Listener implements StreamingSpeechPlayback.Listener {
  int callbacks; String callback = "none"; boolean first; boolean audible;
  public void firstFrame(long nanos) { first = true; }
  public void audible(long nanos, String clock) { audible = true; }
  public void ended(boolean silent) { callbacks++; callback = "ended"; }
  public void failed(String reason) { callbacks++; callback = "failed"; }
 }
 static JSONObject observation(StreamingSpeechPlayback player, Output output, Listener listener) throws Exception {
  return Trace.fields("started", Trace.read(player, "started"), "terminal", Trace.read(player, "terminal"),
    "stopped", player.stopped(), "queue", player.queuedSamples() / 2,
    "callbacks", listener.callbacks, "callback", listener.callback, "firstFrame", listener.first,
    "audibleReported", listener.audible);
 }
 public static void main(String[] args) throws Exception {
  JSONArray result = new JSONArray();
  for (String mode : new String[]{"complete", "partial", "open-failure", "write-failure", "stop-opening"}) {
   Output output = new Output(mode); Listener listener = new Listener();
   CountDownLatch opened = new CountDownLatch(1), releaseOpen = new CountDownLatch(1);
   StreamingSpeechPlayback player = new StreamingSpeechPlayback(24000, 16000, 0.05f, () -> {
    if (mode.equals("open-failure")) throw new IllegalStateException("open");
    if (mode.equals("stop-opening")) { opened.countDown(); if (!releaseOpen.await(5, TimeUnit.SECONDS)) throw new AssertionError("open barrier"); }
    return output;
   }, listener, System::nanoTime);
   Trace trace = new Trace("playback-" + mode, observation(player, output, listener));
   float[] pcm = {0.2f, 0.1f}; player.offer(pcm, false);
   trace.step("offer", observation(player, output, listener), true);
   player.offer(null, true); trace.step("complete", observation(player, output, listener));
   player.start();
   if (mode.equals("stop-opening")) {
    if (!opened.await(5, TimeUnit.SECONDS)) throw new AssertionError("missing open");
    trace.step("start", observation(player, output, listener));
    player.stop(); trace.step("stop", observation(player, output, listener));
    releaseOpen.countDown(); if (!player.join(5000)) throw new AssertionError("writer leak");
    trace.step("outputOpened", observation(player, output, listener), true);
   } else {
    if (!player.join(5000)) throw new AssertionError("writer leak");
    java.util.ArrayList<JSONObject> actions = new java.util.ArrayList<>();
    actions.add(Trace.action("start")); actions.add(Trace.action("outputOpened", !mode.equals("open-failure")));
    if (!mode.equals("open-failure")) {
     actions.add(Trace.action("take"));
     if (mode.equals("write-failure")) { actions.add(Trace.action("playbackFail", "output-write")); actions.add(Trace.action("writerReleased")); }
     else {
      if (mode.equals("partial")) { actions.add(Trace.action("write", 1)); actions.add(Trace.action("write", 1)); }
      else actions.add(Trace.action("write", 2));
      actions.add(Trace.action("beginDrain")); actions.add(Trace.action("advanceHead", output.written)); actions.add(Trace.action("finish"));
     }
    }
    trace.macro("writer joined", observation(player, output, listener), actions.toArray(new JSONObject[0]));
   }
   if (mode.equals("complete") || mode.equals("partial")) {
    if (!output.released || pcm[0] != 0 || pcm[1] != 0) throw new AssertionError("output/buffer cleanup");
   }
   result.put(trace.value);
  }
  System.out.println(new JSONObject().put("StreamingPlayback", result));
 }
}
