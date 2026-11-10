package ai.elizaresearch.alphaphone;
import org.json.JSONObject;
public final class PairedSpeechContractTest {
 interface Work{void run()throws Exception;}
 static void refuse(Work work)throws Exception{try{work.run();throw new AssertionError("Invalid response admitted");}catch(java.io.IOException expected){}}
 public static void main(String[] args)throws Exception{
  String id="06e7d3bc-e366-442b-a10a-d9d9dff74284";
  JSONObject asr=new JSONObject().put("ready",true).put("provider","local-inference").put("language","en").put("format","pcm16-wav").put("maxDurationSeconds",60);
  if(!PairedSpeechContract.asrReady(asr))throw new AssertionError();asr.put("provider","standalone-whisper.cpp");if(PairedSpeechContract.asrReady(asr))throw new AssertionError();
  if(!"words".equals(PairedSpeechContract.transcript(new JSONObject().put("text","words").put("provider","local-inference"))))throw new AssertionError();
  refuse(()->PairedSpeechContract.transcript(new JSONObject().put("text"," ").put("provider","local-inference")));
  refuse(()->PairedSpeechContract.transcript(new JSONObject().put("text","words").put("provider","other")));
  JSONObject body=PairedSpeechContract.ttsBody("Read exact words");if(body.length()!=1||!body.getString("text").equals("Read exact words"))throw new AssertionError();refuse(()->PairedSpeechContract.ttsBody("x".repeat(501)));
  PairedSpeechContract.ttsHeaders(id,id,"libelizainference-paradee","audio/wav");
  refuse(()->PairedSpeechContract.ttsHeaders(id,"other","libelizainference-paradee","audio/wav"));refuse(()->PairedSpeechContract.ttsHeaders(id,id,"standalone-kokoro","audio/wav"));refuse(()->PairedSpeechContract.ttsHeaders(id,id,"libelizainference-paradee","audio/mp3"));refuse(()->PairedSpeechContract.requestId("non-uuid"));
  System.out.println("PASS paired speech exact contract");
 }
}
