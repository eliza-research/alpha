/** Synthetic credential, PCM and provider ports. No credential or network is read. */
export const keyboardDictationCloudPorts = {
  'android/content/Context.java': 'package android.content; public class Context {}',
  'ai/alphacompute/alphaphone/AlphaLocalAgentPlugin.java': `package ai.alphacompute.alphaphone;
final class AlphaLocalAgentPlugin {
 static long epoch;
 static long credentialAuthorityEpoch(){return epoch;}
 static <T>T withCredentialAuthority(long captured, java.util.concurrent.Callable<T> body) throws Exception {
  if(captured!=epoch)throw new SecurityException("Synthetic authority changed");
  return body.call();
 }
}`,
  'ai/alphacompute/alphaphone/AlphaCredentialStore.java': `package ai.alphacompute.alphaphone;
final class AlphaCredentialStore {
 static String provider, credential;
 AlphaCredentialStore(android.content.Context context){}
 String readCredentialSlot(String slot) {return slot.equals("local-agent-provider:v1")?provider:credential;}
}`,
  'ai/alphacompute/alphaphone/LocalAgentProviderAdmission.java': `package ai.alphacompute.alphaphone;
final class LocalAgentProviderAdmission {
 static boolean validProviderToken(String token,int maximum){return token.matches("[!-~]{8,"+maximum+"}");}
 static void requireCloudVoiceSelection(String selected,String account) throws Exception {
  org.json.JSONObject row=new org.json.JSONObject(selected);
  if(!row.getString("provider").equals("elizacloud")||!account.equals(row.getString("credentialId")))
   throw new SecurityException("Synthetic route changed");
 }
}`,
  'ai/eliza/plugins/agent/runtime/NativeProviderSlot.java': `package ai.eliza.plugins.agent.runtime;
public final class NativeProviderSlot {
 public static String managementRevision(String selected,long authority){return selected+":"+authority;}
}`,
  'ai/eliza/plugins/passwords/PasswordSurfaces.java': `package ai.eliza.plugins.passwords;
public final class PasswordSurfaces {public static boolean showing; public static boolean visible(){return showing;}}`,
  'ai/eliza/voice/RecordingPcm.java': `package ai.eliza.voice;
public final class RecordingPcm {
 public static byte[] last;
 public static byte[] decode(java.io.File file,java.util.function.BooleanSupplier cancelled) throws Exception {
  if(cancelled.getAsBoolean())throw new java.io.IOException("Synthetic capture cancelled");
  last=new byte[]{3,4,5,6};return last;
 }
}`,
  'ai/eliza/voice/CartesiaSpeech.java': `package ai.eliza.voice;
import java.io.*;
import java.net.*;
public final class CartesiaSpeech {
 public interface Guard {void check() throws Exception;void opened(HttpURLConnection connection) throws Exception;}
 public static final Object HTTPS=new Object();
 public static String transcribe(String token,byte[] wav,Guard guard,Object transport) throws Exception {
  guard.check();
  HttpURLConnection connection=(HttpURLConnection)new URL("https://api.cartesia.ai/synthetic").openConnection();
  try {
   guard.opened(connection);connection.setInstanceFollowRedirects(false);
   connection.setRequestProperty("Authorization","Bearer "+token);
   guard.check();try(OutputStream output=connection.getOutputStream()){output.write(wav);}
   if(connection.getResponseCode()!=200)throw new IOException("Synthetic provider refused");
   Object text=new org.json.JSONObject(new String(connection.getInputStream().readAllBytes(),java.nio.charset.StandardCharsets.UTF_8)).get("transcript");
   if(!(text instanceof String))throw new IOException("Synthetic malformed response");
   guard.check();return (String)text;
  } finally {connection.disconnect();}
 }
}`,
};
