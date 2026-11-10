package ai.elizaresearch.alphaphone;

import android.os.Bundle;
import android.os.SystemClock;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.json.JSONTokener;
import org.junit.Test;
import static org.junit.Assert.*;

/** Explicit public transport probe only. Never authorize, persist or expose its fresh CLI session. */
public final class PublicCloudTransportProbeInstrumentedTest {
 private static final String TRANSPORT_CODE_PATTERN="^ALPHA_TRANSPORT:(CLI_CREATE|CLI_POLL|IDENTITY|BALANCE|OTHER):(VALIDATE|CONNECT|WRITE|STATUS|READ|PARSE|RESOLVE):(-1|[1-5][0-9]{2}):[A-Za-z_$][A-Za-z0-9_$]*(?:[.][A-Za-z_$][A-Za-z0-9_$]*)*$";
 @Test public void freshSessionCreateAndPendingPoll() throws Exception {
  org.junit.Assume.assumeTrue("Requires explicit publicCloudProbe=1", "1".equals(InstrumentationRegistry.getArguments().getString("publicCloudProbe")));
  // Product sign-in is in-app (AlphaCloudSignInPlugin); the browser hand-off routes exist only in
  // test-mocks builds, as a diagnostic fallback for one release.
  org.junit.Assume.assumeTrue("The CLI session transport is a test-mocks diagnostic route only", BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)) {
   long ready=SystemClock.elapsedRealtime()+30000;
   boolean available=false;
   while(SystemClock.elapsedRealtime()<ready){
    if("true".equals(WebViewTestDriver.evaluateSensitive("Boolean(window.Capacitor?.Plugins?.AlphaConnection?.request)"))){available=true;break;}
    SystemClock.sleep(100);
   }
   assertTrue("Native connection bridge unavailable",available);
   // All request/response details remain inside this closure. The only retained value is sanitized metadata.
   assertEquals("Probe already ran in this document; no automatic repeat is permitted","true",WebViewTestDriver.evaluateSensitive("""
    (()=>{
     if(window.__alphaPublicCloudProbeStarted)return false;
     window.__alphaPublicCloudProbeStarted=true;
     window.__alphaPublicCloudProbeReport=null;
     const bridge=Capacitor.Plugins.AlphaConnection,rows=[];
     const fail=(stage,error)=>{
      const message=['Connection request failed','Request cancelled','Connection closed','Invalid request','Request already active','Probe request timed out'].includes(error?.message)?error.message:'Public Cloud request failed';
      const errorCode=error?.code==='PUBLIC_PROBE_TIMEOUT'?'PUBLIC_PROBE_TIMEOUT':'NATIVE_REQUEST_REJECTED';
      const exceptionCode=typeof error?.code==='string'&&new RegExp(__TRANSPORT_CODE_PATTERN__).test(error.code)?error.code:null;
      rows.push({stage,status:-1,errorCode,exceptionCode,message});
     };
     const request=async(url,method,body)=>{
      const requestId=crypto.randomUUID();let timer;
      try{
       const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{void bridge.cancel({requestId}).catch(()=>{});reject({code:'PUBLIC_PROBE_TIMEOUT',message:'Probe request timed out'});},25000);});
       return await Promise.race([bridge.request({requestId,url,method,headers:{Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body})}),timeout]);
      }finally{clearTimeout(timer);}
     };
     void(async()=>{
      let stage='create';
      try{
       const created=await request('https://api.eliza.app/api/auth/cli-session','POST','{}');
       const status=Number.isInteger(created?.status)?created.status:-1;
       rows.push({stage,status,errorCode:status>=200&&status<300?'NONE':'HTTP_STATUS',message:'Public session creation response'});
       if(status<200||status>=300)return;
       const sessionId=created?.data?.sessionId;
       if(typeof sessionId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)){
        rows.push({stage,status,errorCode:'INVALID_RESPONSE',message:'Fresh session response was invalid'});return;
       }
       stage='poll';
       // Exactly one GET for the ID returned by this invocation; never any supplied or saved ID.
       const polled=await request('https://api.eliza.app/api/auth/cli-session/'+sessionId,'GET');
       const pollStatus=Number.isInteger(polled?.status)?polled.status:-1;
       const pending=pollStatus===200&&polled?.data?.status==='pending';
       rows.push({stage,status:pollStatus,errorCode:pending?'NONE':'UNEXPECTED_RESPONSE',message:pending?'Pending status verified':'Fresh session did not return pending status'});
      }catch(error){fail(stage,error);}
      finally{window.__alphaPublicCloudProbeReport=JSON.stringify(rows);}
     })();
     return true;
    })()
    """.replace("__TRANSPORT_CODE_PATTERN__",JSONObject.quote(TRANSPORT_CODE_PATTERN))));
   String safe=null;
   long deadline=SystemClock.elapsedRealtime()+60000;
   while(SystemClock.elapsedRealtime()<deadline){
    String value=WebViewTestDriver.evaluateSensitive("window.__alphaPublicCloudProbeReport");
    Object decoded=new JSONTokener(value).nextValue();
    if(decoded instanceof String){safe=(String)decoded;break;}
    SystemClock.sleep(100);
   }
   assertNotNull("Public transport probe timed out; do not repeat automatically",safe);
   Bundle result=new Bundle();result.putString("publicCloudProbe",safe);
   InstrumentationRegistry.getInstrumentation().sendStatus(0,result);
   org.json.JSONArray rows=new org.json.JSONArray(safe);
   assertEquals("Probe must complete create and pending poll; inspect sanitized publicCloudProbe status",2,rows.length());
   JSONObject last=rows.getJSONObject(rows.length()-1);
   assertEquals("Probe did not reach its pending poll; inspect sanitized publicCloudProbe status","poll",last.getString("stage"));
   assertEquals("Native public transport failed; inspect sanitized publicCloudProbe status","NONE",last.getString("errorCode"));
  }
 }
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
