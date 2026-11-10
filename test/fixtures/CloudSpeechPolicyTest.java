package ai.elizaresearch.alphaphone;
import java.io.IOException;
public final class CloudSpeechPolicyTest {
 interface Checked {void run() throws Exception;}
 static void rejects(Checked operation) throws Exception {try{operation.run();}catch(IOException expected){return;}throw new AssertionError("Expected refusal");}
 public static void main(String[] args) throws Exception {
  // One build: every production build may reach the production host; staging needs test mocks.
  if(!"api.eliza.app".equals(CloudSpeechPolicy.host(false,"production")))throw new AssertionError();
  if(!"api.eliza.app".equals(CloudSpeechPolicy.host(true,"production")))throw new AssertionError();
  rejects(()->CloudSpeechPolicy.host(false,"staging"));
  rejects(()->CloudSpeechPolicy.host(false,"https://evil.invalid"));
  rejects(()->CloudSpeechPolicy.host(true,"https://evil.invalid"));
  rejects(()->CloudSpeechPolicy.host(false,null));
  if(!"api-staging.eliza.app".equals(CloudSpeechPolicy.host(true,"staging")))throw new AssertionError();
  CloudSpeechPolicy.requireProvider("cartesia");
  for(String provider:new String[]{null,"","elevenlabs","kokoro","Cartesia","cartesia,elevenlabs"})rejects(()->CloudSpeechPolicy.requireProvider(provider));
  System.out.println("PASS Cloud speech production host and Cartesia admission");
 }
}
