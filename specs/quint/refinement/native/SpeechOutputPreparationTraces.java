package ai.eliza.voice;

import ai.elizaresearch.alphaphone.Trace;
import org.json.*;

/** Actual lead trim, report-before-write wrapper, and controlled audio output port. */
public final class SpeechOutputPreparationTraces {
 static final class WriteFault extends RuntimeException {}
 static final class CallbackFault extends RuntimeException {}
 final SpeechLeadTrim trim;
 final float level;
 final FirstWriteSpeechOutput wrapper;
 final JSONArray events=new JSONArray();
 final Port port=new Port();
 final Trace trace;
 float[] caller=new float[0],returned=new float[0],delegateSamples;
 boolean sameInput,callbackOk,callbackAlreadyCleared=true,delegateOk;
 int result,writeResult;
 String outcome="none";
 final class Port implements StreamingSpeechPlayback.Output {
  int writes,plays,aborts,stops,releases;
  float volume;
  public void play(){plays++;}
  public int write(float[] samples,int offset,int length){
   if(samples!=delegateSamples||offset!=2||length!=3)throw new AssertionError("Write arguments changed");
   writes++;events.put("write");if(!delegateOk)throw new WriteFault();return result;
  }
  public long playedFrames(){return 37;}
  public long presentationNs(long frame){if(frame!=37)throw new AssertionError("Frame changed");return 900;}
  public void setVolume(float value){volume=value;}
  public void abort(){aborts++;}public void stop(){stops++;}public void release(){releases++;}
 }
 SpeechOutputPreparationTraces(String mode,int preRoll,float level,boolean report)throws Exception {
  this.level=level;trim=new SpeechLeadTrim(level,preRoll);wrapper=new FirstWriteSpeechOutput(port,report?this::report:null);
  trace=new Trace("speech-output-preparation-"+mode,observe());
  trace.value.put("init",Trace.action("initFor",preRoll,report));
 }
 void report(){
  events.put("first");
  try{callbackAlreadyCleared=Trace.read(wrapper,"first")==null;}catch(Exception failure){throw new AssertionError(failure);}
  if(!callbackOk)throw new CallbackFault();
 }
 float decode(int sample){
  return switch(sample){
   case 0 -> 0f;
   case 1 -> Math.nextDown(level);
   case -1 -> -Math.nextDown(level);
   case 2 -> level;
   case -2 -> -level;
   case 3 -> Math.nextUp(level);
   case -3 -> -Math.nextUp(level);
   case 4 -> level*2;
   case -4 -> -level*2;
   case 9 -> Float.NaN;
   case 10 -> Float.POSITIVE_INFINITY;
   case -10 -> Float.NEGATIVE_INFINITY;
   default -> throw new AssertionError("Unknown PCM class");
  };
 }
 int encode(float sample){
  for(int candidate:new int[]{0,1,-1,2,-2,3,-3,4,-4,9,10,-10})
   if(Float.floatToIntBits(sample)==Float.floatToIntBits(decode(candidate)))return candidate;
  throw new AssertionError("Unexpected PCM bits: "+Float.toHexString(sample));
 }
 JSONArray values(float[] data){JSONArray out=new JSONArray();for(float value:data)out.put(encode(value));return out;}
 JSONObject observe()throws Exception {
  return Trace.fields("preRoll",Trace.read(trim,"preRoll"),"threshold",encode((float)Trace.read(trim,"level")),
   "open",Trace.read(trim,"open"),"held",values((float[])Trace.read(trim,"held")),"returned",values(returned),"caller",values(caller),"sameInput",sameInput,
   "firstPending",Trace.read(wrapper,"first")!=null,"writes",port.writes,"outcome",outcome,"writeResult",writeResult,
   "events",new JSONArray(events.toList()),"callbackAlreadyCleared",callbackAlreadyCleared);
 }
 void trim(int... input)throws Exception {
  caller=new float[input.length];for(int i=0;i<input.length;i++)caller[i]=decode(input[i]);
  returned=trim.next(caller);sameInput=returned==caller;
  trace.step("trim",observe(),new JSONArray(input));
 }
 void write(boolean callback,String delegate,int answer)throws Exception {
  callbackOk=callback;delegateOk=delegate.equals("ok");result=answer;delegateSamples=new float[6];writeResult=0;
  try{writeResult=wrapper.write(delegateSamples,2,3);outcome="returned";}
  catch(CallbackFault failed){outcome="callback_failed";}
  catch(WriteFault failed){outcome="write_failed";}
  trace.step("write",observe(),callback,delegate,answer);
 }
 void delegates()throws Exception {
  wrapper.play();if(wrapper.playedFrames()!=37||wrapper.presentationNs(37)!=900)throw new AssertionError("Readback changed");
  wrapper.setVolume(0.25f);wrapper.abort();wrapper.stop();wrapper.release();
  if(port.plays!=1||port.aborts!=1||port.stops!=1||port.releases!=1||port.volume!=0.25f)throw new AssertionError("Output delegation changed");
  trace.stutter("actual transport delegates",observe());
 }
 static JSONObject scenario(String mode,float level,int productionLead)throws Exception {
  int preRoll=switch(mode){case "zero-lead" -> 0;case "long-lead" -> 4;case "production-lead" -> productionLead;default -> 3;};
  SpeechOutputPreparationTraces t=new SpeechOutputPreparationTraces(mode,preRoll,level,!mode.equals("no-callback"));
  switch(mode){
   case "bounded-lead": t.trim(0,1,0,-1);t.trim(0,2,3);t.trim(0,1);break;
   case "long-lead": t.trim(1,-1);t.trim(1,1,-1,1,0,0);t.trim(0,0,0,0,2,3);break;
   case "zero-lead": t.trim(0,1,0);t.trim(0,0,-2,3);break;
   case "float-classes": t.trim(9,1,0);t.trim(9,-10,10,2);t.trim(9,-10,10);break;
   case "empty": t.trim();t.trim(0,1);t.trim();t.trim(2);t.trim();break;
   case "exact-negative": t.trim(-1,-2,-3);t.trim(1,0);break;
   case "quiet-tail": t.trim(1,-1,1,0);t.trim(0,1);t.trim(0);break;
   case "first-report": t.write(true,"ok",3);t.write(true,"ok",1);t.write(true,"ok",0);t.delegates();break;
   case "failed-callback": t.write(false,"ok",3);t.write(false,"ok",1);break;
   case "failed-write": t.write(true,"fail",0);t.write(true,"ok",-1);break;
   case "no-callback": t.write(false,"ok",3);t.write(false,"ok",1);t.delegates();break;
   case "production-lead": {
    int[] quiet=new int[preRoll+4];
    for(int i=0;i<quiet.length;i++)quiet[i]=i%3-1;
    t.trim(quiet);t.trim(-1,1,0,2,3);t.trim(0,1);break;
   }
   case "combined": t.trim(0,1,0);t.write(true,"ok",3);t.trim(2,0,1);t.write(true,"ok",0);break;
   default: throw new AssertionError(mode);
  }
  return t.trace.value;
 }
 public static void main(String[] args)throws Exception {
  JSONArray traces=new JSONArray();
  float level=Float.parseFloat(args[0]);int productionLead=Integer.parseInt(args[1]);
  for(int i=2;i<args.length;i++)traces.put(scenario(args[i],level,productionLead));
  System.out.println(traces);
 }
}
