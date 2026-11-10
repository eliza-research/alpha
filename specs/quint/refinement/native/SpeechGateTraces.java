package ai.eliza.sense;

import ai.elizaresearch.alphaphone.Trace;
import java.util.*;
import org.json.*;

/** Read-only observations of the actual adaptive floor, ring and float sample storage. */
public final class SpeechGateTraces {
 float[] output;
 int outputs;
 int lastLevel=-120000;
 boolean lastSpeech;
 final SpeechGate gate=new SpeechGate(value->{output=value;outputs++;});
 final Trace trace;
 SpeechGateTraces(String name)throws Exception {trace=new Trace("listener-speech-gate-"+name,observe());}
 int integer(String name)throws Exception {return (int)Trace.read(gate,name);}
 static int scaled(double value){return (int)Math.round(1000*value);}
 static int sample(float value){return Math.round(32768f*value);}
 static JSONArray samples(float[] data,int frames){
  JSONArray values=new JSONArray();
  for(int f=0;f<frames;f++){
   int offset=f*SpeechGate.FRAME_SAMPLES,marker=sample(data[offset]);
   for(int i=0;i<SpeechGate.FRAME_SAMPLES;i++)if(sample(data[offset+i])!=marker)throw new AssertionError("Mixed PCM markers");
   values.put(marker);
  }
  return values;
 }
 JSONObject observe()throws Exception {
  short[][] ring=(short[][])Trace.read(gate,"preroll");JSONArray pre=new JSONArray();
  for(short[] frame:ring){short marker=frame[0];for(short value:frame)if(value!=marker)throw new AssertionError("Mixed ring markers");pre.put(marker);}
  float[] pcm=(float[])Trace.read(gate,"utterance");int count=integer("utteranceFrames");boolean tailZero=true;
  for(int i=count*SpeechGate.FRAME_SAMPLES;i<pcm.length;i++)if(pcm[i]!=0f)tailZero=false;
  return Trace.fields("floor",scaled(gate.noiseFloorDb()),"lastLevel",lastLevel,"lastSpeech",lastSpeech,
   "active",Trace.read(gate,"active"),"pre",pre,"preCount",integer("prerollCount"),"preNext",integer("prerollNext"),
   "utterance",samples(pcm,count),"speechRun",integer("speechRun"),"speechFrames",integer("speechFrames"),
   "silenceRun",integer("silenceRun"),"outputs",outputs,"lastOutput",output==null?new JSONArray():samples(output,output.length/SpeechGate.FRAME_SAMPLES),"tailZero",tailZero);
 }
 JSONObject accept(int marker){
  short[] frame=new short[SpeechGate.FRAME_SAMPLES];Arrays.fill(frame,(short)marker);
  double level=SpeechGate.levelDbfs(frame,0,frame.length);lastLevel=scaled(level);lastSpeech=gate.isSpeech(level);
  gate.accept(frame);Arrays.fill(frame,(short)-1);return Trace.action("accept",marker,lastLevel,lastSpeech,scaled(gate.noiseFloorDb()));
 }
 void batch(int marker,int count)throws Exception {
  List<JSONObject> actions=new ArrayList<>();for(int i=0;i<count;i++)actions.add(accept(marker));
  trace.macro("feed-"+marker+"-"+count,observe(),actions.toArray(JSONObject[]::new));
 }
 void reset()throws Exception {gate.reset();trace.step("reset",observe());}
 void invalid(short[] frame)throws Exception {
  try{gate.accept(frame);throw new AssertionError("Invalid frame accepted");}
  catch(IllegalArgumentException expected){trace.step("invalidFrame",observe());}
 }
 static JSONObject scenario(String mode)throws Exception {
  SpeechGateTraces test=new SpeechGateTraces(mode);
  switch(mode){
   case "minimum": test.batch(16000,2);test.batch(16000,1);test.batch(16000,12);test.batch(0,34);test.batch(0,1);break;
   case "short": test.batch(16000,14);test.batch(0,35);break;
   case "ring-wrap": test.batch(30,11);test.batch(0,7);test.batch(30,8);test.batch(16000,3);test.batch(10000,12);test.batch(0,35);break;
   case "opening-gap": test.batch(16000,2);test.batch(30,1);test.batch(16000,3);test.batch(0,35);break;
   case "mid-turn": test.batch(16000,10);test.batch(0,20);test.batch(16000,5);test.batch(0,35);break;
   case "max-length": for(int n=0;n<7;n++)test.batch(16000,50);test.batch(16000,49);test.batch(16000,1);test.batch(16000,1);break;
   case "max-trim": for(int n=0;n<7;n++)test.batch(16000,50);test.batch(16000,40);test.batch(0,10);break;
   case "reset-active": test.batch(0,8);test.batch(16000,15);test.reset();test.batch(16000,2);test.reset();break;
   case "adaptive": for(int n=0;n<8;n++)test.batch(104,50);test.batch(0,10);test.batch(110,15);test.batch(0,35);break;
   case "level-classes": test.batch(30,2);test.batch(103,1);test.batch(104,1);test.batch(110,1);test.batch(1000,1);test.batch(10000,12);test.batch(0,35);break;
   case "invalid": test.batch(16000,2);test.invalid(null);test.invalid(new short[319]);test.batch(16000,1);break;
   default: throw new AssertionError(mode);
  }
  return test.trace.value;
 }
 public static void main(String[]args)throws Exception {JSONArray traces=new JSONArray();for(String mode:args)traces.put(scenario(mode));System.out.println(traces);}
}
