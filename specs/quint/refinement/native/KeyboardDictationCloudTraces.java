package ai.elizaresearch.alphaphone;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import org.json.*;

/** Closed transport boundaries execute the unchanged native transcription class. */
public final class KeyboardDictationCloudTraces {
 static final JSONArray traces = new JSONArray();
 static KeyboardDictationCloud operation;
 static Trace trace;
 static String route, phase, mutation;
 static int requests, sent;
 static boolean authority, provider, account, password, expired, cancelled, disconnected, accepted;
 static boolean httpOk, validText, providerHeader;
 static void require(boolean value) { if (!value) throw new AssertionError("Closed dictation fixture failed"); }
 static JSONObject observe() throws Exception {
  boolean connection = Trace.read(operation,"connection") != null;
  byte[] wav = ai.eliza.voice.RecordingPcm.last;
  boolean zeroed = wav != null;
  if (wav != null) for (byte value : wav) zeroed &= value == 0;
  return Trace.fields("route",route,"phase",phase,"authority",authority,"provider",provider,
   "account",account,"password",password,"expired",expired,"cancelled",cancelled,"connection",connection,
   "requests",requests,"sent",sent,"zeroed",zeroed,"disconnected",disconnected,"accepted",accepted);
 }
 static void mutate(String kind) throws Exception {
  switch(kind) {
   case "authority": AlphaLocalAgentPlugin.epoch++; authority=false; break;
   case "provider": AlphaCredentialStore.provider=new JSONObject(AlphaCredentialStore.provider).put("revision",2).toString(); provider=false; break;
   case "account": AlphaCredentialStore.credential=new JSONObject(AlphaCredentialStore.credential).put("credentialId","other-synthetic-account").toString(); account=false; break;
   case "password": ai.eliza.plugins.passwords.PasswordSurfaces.showing=true; password=true; break;
   case "expiry": AlphaCredentialStore.credential=new JSONObject(AlphaCredentialStore.credential).put("expiresAt",1L).toString(); expired=true; break;
   case "cancel": operation.cancel(); cancelled=true; break;
   default: throw new AssertionError(kind);
  }
  trace.step("mutate",observe(),kind);
 }
 static void scenario(boolean direct, String before, String during, boolean status, boolean text, boolean header) throws Exception {
  route=direct?"direct":"cloud"; phase="ready"; mutation=during;
  authority=provider=account=true; password=expired=cancelled=disconnected=accepted=false;
  requests=sent=0; httpOk=status; validText=text; providerHeader=header;
  ai.eliza.plugins.passwords.PasswordSurfaces.showing=false;
  ai.eliza.voice.RecordingPcm.last=null;
  AlphaLocalAgentPlugin.epoch++;
  AlphaCredentialStore.provider=new JSONObject().put("provider",direct?"cerebras":"elizacloud")
   .put("cartesiaKey","synthetic-direct-token").put("credentialId","synthetic-account").toString();
  AlphaCredentialStore.credential=new JSONObject().put("credentialId","synthetic-account").put("token","synthetic-cloud-token").toString();
  operation=new KeyboardDictationCloud(null);
  trace=new Trace(route+" before="+before+" response="+during+" status="+status+" text="+text+" header="+header,observe());
  trace.value.put("init",Trace.action(direct?"initDirect":"initCloud"));
  if(before!=null) mutate(before);
  try {String result=operation.transcribe(null); require(result.equals("Synthetic draft")); accepted=true;}
  catch(IOException|SecurityException expected) {}
  phase="done";
  if(requests==0) trace.step("rejectBeforeRequest",observe());
  else trace.step("settle",observe(),status,text,header);
  traces.put(trace.value);
 }
 public static void main(String[] args) throws Exception {
  URL.setURLStreamHandlerFactory(protocol -> new URLStreamHandler() {
   protected URLConnection openConnection(URL url) {
    require(protocol.equals("https"));
    require(url.getHost().equals(route.equals("direct")?"api.cartesia.ai":CloudDeployment.PRODUCTION_API_HOST));
    requests++;
    return new HttpURLConnection(url) {
     public void connect() {}
     public boolean usingProxy() {return false;}
     public void disconnect() {disconnected=true;}
     public OutputStream getOutputStream() {
      require(getRequestProperty("Authorization").equals("Bearer "+(route.equals("direct")?"synthetic-direct-token":"synthetic-cloud-token")));
      require(!getInstanceFollowRedirects()); sent++; return new ByteArrayOutputStream();
     }
     public int getResponseCode() throws IOException {
      try {phase="response"; trace.step("begin",observe()); if(mutation!=null)mutate(mutation);}
      catch(Exception error) {throw new IOException(error);}
      return httpOk?200:503;
     }
     public String getHeaderField(String key) {return providerHeader?"cartesia":"other";}
     public InputStream getInputStream() {
      String value=validText?"\"Synthetic draft\"":"17";
      return new ByteArrayInputStream(("{\"transcript\":"+value+"}").getBytes(StandardCharsets.UTF_8));
     }
    };
   }
  });
  for(boolean direct : new boolean[]{false,true}) {
   scenario(direct,null,null,true,true,true);
   for(String kind:new String[]{"authority","provider","account","password","expiry","cancel"}) {
    scenario(direct,kind,null,true,true,true);
    scenario(direct,null,kind,true,true,true);
   }
   scenario(direct,null,null,false,true,true);
   scenario(direct,null,null,true,false,true);
  }
  scenario(false,null,null,true,true,false);
  System.out.println(traces);
 }
}
