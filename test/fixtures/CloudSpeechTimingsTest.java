package ai.elizaresearch.alphaphone;

import java.util.List;
import java.util.Map;

public final class CloudSpeechTimingsTest {
 static final class Clock implements CloudSpeechTimings.Clock { long ms;public long nanos(){return ms*1_000_000L;} }
 static void check(boolean value,String label){if(!value)throw new AssertionError(label);}
 @SuppressWarnings("unchecked") static List<Map<String,Object>> rows(CloudSpeechTimings timings){return (List<Map<String,Object>>)timings.snapshot().get("records");}
 @SuppressWarnings("unchecked") static Map<String,Long> marks(Map<String,Object> row){return (Map<String,Long>)row.get("marks");}
 @SuppressWarnings("unchecked") static Map<String,Long> phases(Map<String,Object> row){return (Map<String,Long>)row.get("phases");}
 public static void main(String[] args){
  Clock clock=new Clock();CloudSpeechTimings timings=new CloudSpeechTimings(clock);
  CloudSpeechTimings.Record tts=timings.begin("tts");
  clock.ms=12;timings.mark(tts,"worker-start");clock.ms=15;timings.mark(tts,"upload-start");
  clock.ms=44;timings.mark(tts,"upload-end");clock.ms=244;timings.mark(tts,"headers");
  timings.response(tts,200,"cartesia","auth;dur=2.5;desc=\"bearer-secret\", admission;dur=11, synthesis;dur=165, moderation;dur=20, private-user;dur=999");
  timings.moderation(tts,"approved-hit");clock.ms=275;timings.mark(tts,"body-end");clock.ms=280;timings.mark(tts,"prepared");
  check(rows(timings).get(0).get("outcome").equals("active"),"prepared speech is still waiting for playback");
  clock.ms=330;timings.mark(tts,"playback-start");clock.ms=1330;timings.mark(tts,"playback-end");timings.finish(tts,"completed");
  Map<String,Object> first=rows(timings).get(0);Map<String,Long> p=phases(first);
  check(p.get("queueMs")==12&&p.get("uploadMs")==29&&p.get("responseWaitMs")==200&&p.get("downloadMs")==31,"network phases");
  check(p.get("prepareMs")==5&&p.get("playbackStartMs")==50&&p.get("playbackMs")==1000,"playback phases");
  check(first.get("status").equals(200)&&first.get("provider").equals("cartesia"),"bounded response metadata");
  check(first.get("elapsedMs").equals(1330L)&&first.get("outcome").equals("completed"),"completion");
  check(first.get("server").equals(Map.of("auth",2.5,"admission",11.0,"synthesis",165.0,"moderation",20.0)),"server durations only");
  check(first.get("moderation").equals("approved-hit"),"bounded moderation outcome");String snapshot=timings.snapshot().toString();check(!snapshot.contains("bearer-secret")&&!snapshot.contains("private-user"),"no headers or descriptions retained");
  // Immutable snapshot, first terminal outcome, and late callbacks cannot revise history.
  marks(first).put("uploaded-secret",42L);clock.ms=2000;timings.mark(tts,"body-end");timings.finish(tts,"cancelled");
  check(!marks(rows(timings).get(0)).containsKey("uploaded-secret"),"snapshot isolation");
  check(rows(timings).get(0).get("outcome").equals("completed"),"terminal first wins");
  CloudSpeechTimings.Record stt=timings.begin("stt");
  clock.ms=2020;timings.mark(stt,"worker-start");clock.ms=2030;timings.mark(stt,"decode-start");clock.ms=2100;timings.mark(stt,"decode-end");
  // Clock regressions, unknown stages and old stages may not distort a phase.
  clock.ms=2090;timings.mark(stt,"upload-start");timings.mark(stt,"secret");timings.mark(stt,"worker-start");
  check(!marks(rows(timings).get(1)).containsKey("upload-start"),"regressing timestamp refused");
  clock.ms=2120;timings.mark(stt,"upload-start");clock.ms=2140;timings.mark(stt,"upload-end");clock.ms=2500;timings.mark(stt,"headers");
  timings.response(stt,503,"credential-secret","auth;dur=NaN,admission;dur=-2,synthesis;dur=9999999999999999999999999999999999999,private;dur=1");
  timings.finish(stt,"failed");Map<String,Object> failed=rows(timings).get(1);
  check(phases(failed).get("decodeMs")==70&&failed.get("outcome").equals("failed"),"failed request retains complete phases");
  check(failed.get("provider").equals("unknown")&&failed.get("status").equals(503)&&((Map<?,?>)failed.get("server")).isEmpty(),"unknown provider and invalid server durations redacted");
  CloudSpeechTimings.Record cancelled=timings.begin("stt");timings.response(cancelled,999,"private","auth;dur=1".repeat(500));timings.finish(cancelled,"cancelled");
  Map<String,Object> cancelledRow=rows(timings).get(2);check(cancelledRow.get("outcome").equals("cancelled")&&!cancelledRow.containsKey("status")&&((Map<?,?>)cancelledRow.get("server")).isEmpty(),"cancelled/invalid/oversize response bounded");
  for(int i=0;i<110;i++)timings.begin("stt");check(rows(timings).size()==100,"bounded history");
  clock.ms+=CloudSpeechTimings.MAX_MS+1;Map<String,Object> bounded=rows(timings).get(99);
  check(bounded.get("elapsedMs").equals(CloudSpeechTimings.MAX_MS)&&Boolean.TRUE.equals(bounded.get("bounded")),"duration bound disclosed");
  try{timings.begin("private-route");throw new AssertionError("route admitted");}catch(IllegalArgumentException expected){}
  System.out.println("PASS Cloud speech timing: monotonic stages, network/playback phases, bounds, redaction, outcomes");
 }
}
