package ai.alphacompute.alphaphone;

import android.os.Bundle;
import android.os.SystemClock;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.json.JSONTokener;
import org.junit.Test;
import static org.junit.Assert.*;

/** Explicit owned-account read probe only. Never persists or exposes the owned key. */
public final class PublicCloudTransportProbeInstrumentedTest {
 private static final String TRANSPORT_CODE_PATTERN="^ALPHA_TRANSPORT:(CLI_CREATE|CLI_POLL|IDENTITY|BALANCE|OTHER):(VALIDATE|CONNECT|WRITE|STATUS|READ|PARSE|RESOLVE):(-1|[1-5][0-9]{2}):[A-Za-z_$][A-Za-z0-9_$]*(?:[.][A-Za-z_$][A-Za-z0-9_$]*)*$";
 @Test public void ownedCredentialIdentityAndBalance() throws Exception {
  org.junit.Assume.assumeTrue("Requires explicit ownedCloudRead=1", "1".equals(InstrumentationRegistry.getArguments().getString("ownedCloudRead")));
  java.io.File input=new java.io.File(InstrumentationRegistry.getInstrumentation().getTargetContext().getFilesDir(),"alpha-owned-cloud-key.private.json");
  byte[] bytes=null;
  try {
   // Read only the fixed private transfer file, never product credential slots.
   if(!input.isFile()||java.nio.file.Files.isSymbolicLink(input.toPath())||input.length()>16384)throw new IllegalStateException("Owned Cloud input unavailable");
   try(java.io.InputStream stream=new java.io.FileInputStream(input)){bytes=stream.readNBytes(16385);}
   if(bytes.length>16384)throw new IllegalStateException("Owned Cloud input unavailable");
   String token;
   try{
    JSONObject value=new JSONObject(new String(bytes,java.nio.charset.StandardCharsets.UTF_8));
    Object raw=value.opt("apiKey");
    if(!(raw instanceof String))throw new IllegalArgumentException();
    token=(String)raw;
    if(token.length()<8||token.length()>16384)throw new IllegalArgumentException();
    for(int i=0;i<token.length();i++)if(token.charAt(i)<=0x20||token.charAt(i)>=0x7f)throw new IllegalArgumentException();
   }catch(Exception invalid){throw new IllegalStateException("Owned Cloud input invalid");}
   try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)) {
    long ready=SystemClock.elapsedRealtime()+30000;boolean available=false;
    while(SystemClock.elapsedRealtime()<ready){
     if("true".equals(WebViewTestDriver.evaluateSensitive("Boolean(window.Capacitor?.Plugins?.AlphaConnection?.request)"))){available=true;break;}
     SystemClock.sleep(100);
    }
    assertTrue("Native connection bridge unavailable",available);
    String script="""
     ((token)=>{
      if(window.__alphaOwnedCloudReadStarted)return false;
      window.__alphaOwnedCloudReadStarted=true;window.__alphaOwnedCloudReadReport=null;
      const bridge=Capacitor.Plugins.AlphaConnection,rows=[];
      void(async()=>{
       try{
        for(const [endpoint,path] of [['identity','/api/v1/user'],['entitlement','/api/v1/subscription/entitlement']]){
         const requestId=crypto.randomUUID();let timer;
         try{
          const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{void bridge.cancel({requestId}).catch(()=>{});reject({code:'OWNED_PROBE_TIMEOUT'});},25000);});
          const response=await Promise.race([bridge.request({requestId,url:'https://api.eliza.app'+path,method:'GET',headers:{Accept:'application/json',Authorization:'Bearer '+token}}),timeout]);
          const status=Number.isInteger(response?.status)?response.status:-1;
          rows.push({endpoint,status,exceptionCode:null,message:status===200?'Authenticated read succeeded':'Authenticated read returned non-success status'});
         }catch(error){
          const exceptionCode=typeof error?.code==='string'&&new RegExp(__TRANSPORT_CODE_PATTERN__).test(error.code)?error.code:null;
          rows.push({endpoint,status:-1,exceptionCode,message:error?.code==='OWNED_PROBE_TIMEOUT'?'Authenticated read timed out':'Authenticated read failed'});
         }finally{clearTimeout(timer);}
        }
       }finally{token=null;window.__alphaOwnedCloudReadReport=JSON.stringify(rows);}
      })();
      return true;
     })(__OWNED_CREDENTIAL__)
     """.replace("__TRANSPORT_CODE_PATTERN__",JSONObject.quote(TRANSPORT_CODE_PATTERN)).replace("__OWNED_CREDENTIAL__",JSONObject.quote(token));
    token=null;
    assertEquals("Owned read already ran in this document; no automatic repeat","true",WebViewTestDriver.evaluateSensitive(script));
    script=null;
    String safe=null;long deadline=SystemClock.elapsedRealtime()+60000;
    while(SystemClock.elapsedRealtime()<deadline){
     Object decoded=new JSONTokener(WebViewTestDriver.evaluateSensitive("window.__alphaOwnedCloudReadReport")).nextValue();
     if(decoded instanceof String){safe=(String)decoded;break;}
     SystemClock.sleep(100);
    }
    assertNotNull("Owned Cloud read timed out; no automatic repeat",safe);
    Bundle result=new Bundle();result.putString("ownedCloudRead",safe);
    InstrumentationRegistry.getInstrumentation().sendStatus(0,result);
    org.json.JSONArray rows=new org.json.JSONArray(safe);
    assertEquals("Owned Cloud read must finish both endpoints",2,rows.length());
    for(int i=0;i<rows.length();i++)assertEquals("Authenticated read failed; inspect sanitized ownedCloudRead status",200,rows.getJSONObject(i).getInt("status"));
   }
  }finally{
   if(bytes!=null)java.util.Arrays.fill(bytes,(byte)0);
   if(input.exists()&&!input.delete())throw new IllegalStateException("Owned Cloud input cleanup failed");
  }
 }

}
