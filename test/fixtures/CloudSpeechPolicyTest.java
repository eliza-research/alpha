package ai.elizaresearch.alphaphone;
import java.io.IOException;
public final class CloudSpeechPolicyTest {
 interface Checked {void run() throws Exception;}
 static void rejects(Checked operation) throws Exception {try{operation.run();}catch(IOException expected){return;}throw new AssertionError("Expected refusal");}
 public static void main(String[] args) throws Exception {
  if(!"api.eliza.app".equals(CloudSpeechPolicy.host("cloud",false,"production")))throw new AssertionError();
  rejects(()->CloudSpeechPolicy.host("cloud",false,"staging"));
  rejects(()->CloudSpeechPolicy.host("cloud",false,"https://evil.invalid"));
  rejects(()->CloudSpeechPolicy.host("native",false,"production"));
  rejects(()->CloudSpeechPolicy.host("unknown",false,"production"));
  if(!"api-staging.eliza.app".equals(CloudSpeechPolicy.host("native",true,"staging")))throw new AssertionError();
  CloudSpeechPolicy.requireProvider("cloud","cartesia");
  for(String provider:new String[]{null,"","elevenlabs","kokoro","Cartesia","cartesia,elevenlabs"})rejects(()->CloudSpeechPolicy.requireProvider("cloud",provider));
  System.out.println("PASS Cloud speech production host and Cartesia admission");
 }
}
