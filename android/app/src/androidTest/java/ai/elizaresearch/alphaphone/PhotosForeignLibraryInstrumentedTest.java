package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.media.MediaLibraryKey;

import android.os.*;
import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.*;
import static org.junit.Assert.*;

/** Read-only witness over a separate UID's exact synthetic catalog. Host owns permission changes
 * and companion cleanup. No grants, writes, arbitrary media paths or production bypasses here. */
@RunWith(AndroidJUnit4.class)
public class PhotosForeignLibraryInstrumentedTest {
 private String js(String code)throws Exception{return WebViewTestDriver.evaluate(code);}
 private JSONObject call(String method,JSONObject args)throws Exception{
  js("window.__foreignPhotosReply=null;Capacitor.nativePromise('AlphaPhotos',"+JSONObject.quote(method)+","+args+").then(value=>window.__foreignPhotosReply={value},error=>window.__foreignPhotosReply={error:String(error?.message||error)})");
  for(int i=0;i<150;i++){
   String encoded=js("JSON.stringify(window.__foreignPhotosReply)");
   if(!"\"null\"".equals(encoded)&&!"null".equals(encoded))return new JSONObject(new JSONArray("["+encoded+"]").getString(0));
   SystemClock.sleep(100);
  }
  throw new AssertionError("Photos bridge timeout: "+method);
 }
 private JSONObject success(String method,JSONObject args)throws Exception{JSONObject reply=call(method,args);assertFalse(reply.toString(),reply.has("error"));return reply.getJSONObject("value");}
 @Test public void foreignLibraryPhase()throws Exception{
  Bundle args=InstrumentationRegistry.getArguments();
  org.junit.Assume.assumeTrue("Explicit foreign Photos campaign","owned-disposable-alpha-media".equals(args.getString("photosForeignAcknowledgement")));
  int user=android.os.Process.myUid()/100000;assertTrue(user>0);assertEquals(user,Integer.parseInt(args.getString("photosForeignUser","-1")));assertTrue(Build.VERSION.SDK_INT>=34);
  String run=args.getString("photosForeignRun");assertEquals(run,UUID.fromString(run).toString());
  String scope=args.getString("photosForeignScope");assertTrue(Set.of("full","partial","denied").contains(scope));
  String encodedIds=args.getString("photosForeignIds");assertNotNull(encodedIds);assertTrue(encodedIds.length()<=32768);assertTrue(encodedIds.matches("[A-Za-z0-9_-]+"));
  JSONArray expectedArray=new JSONArray(new String(android.util.Base64.decode(encodedIds,android.util.Base64.URL_SAFE|android.util.Base64.NO_WRAP|android.util.Base64.NO_PADDING),java.nio.charset.StandardCharsets.UTF_8));assertTrue(expectedArray.length()<=320);
  boolean initial="1".equals(args.getString("photosForeignInitial"));if(initial){assertEquals("denied",scope);assertEquals(0,expectedArray.length());}else assertTrue(expectedArray.length()>24);
  Set<String> expected=new HashSet<>();for(int i=0;i<expectedArray.length();i++){String id=expectedArray.getString(i);MediaLibraryKey.parse(id);assertTrue(expected.add(id));}
  int count=Integer.parseInt(args.getString("photosForeignCount"));assertTrue(count>=0&&count<=expected.size());
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();
   JSONObject access=success("libraryAccess",new JSONObject());assertEquals(scope,access.getString("scope"));
   Set<String> seen=new HashSet<>(),cursors=new HashSet<>();String cursor="";int pages=0;JSONObject selected=null;
   do{
    JSONObject page=success("listPermitted",new JSONObject().put("before",cursor).put("query",run).put("kind","all").put("thumbnails",false));
    assertEquals(scope,page.getJSONObject("access").getString("scope"));JSONArray rows=page.getJSONArray("items");assertTrue(rows.length()<=24);
    for(int i=0;i<rows.length();i++){
     JSONObject row=rows.getJSONObject(i);String id=row.getString("id");assertTrue("Only ledger-owned synthetic rows",expected.contains(id));assertTrue("No duplicate across pages",seen.add(id));
     assertFalse("Media belongs to companion UID",row.getBoolean("owned"));assertTrue(row.getString("name").startsWith("alpha-foreign-"+run+"-"));
     if(scope.equals("partial"))assertEquals("image",row.getString("kind"));
     if(selected==null&&row.getString("kind").equals("image"))selected=row;
    }
    cursor=page.getString("next");assertTrue(++pages<=15);if(!cursor.isEmpty())assertTrue("Fresh opaque page cursor",cursors.add(cursor));
   }while(!cursor.isEmpty());
   assertEquals("Complete permitted catalog across pages",count,seen.size());if(count>24)assertTrue(pages>1);
   if(scope.equals("denied")){
    for(String id:expected)assertTrue("No bytes after revocation",call("readPermitted",new JSONObject().put("id",id).put("pixels",false)).has("error"));
   }else{
    assertNotNull(selected);JSONObject read=success("readPermitted",new JSONObject().put("id",selected.getString("id")).put("revision",selected.getString("revision")).put("pixels",true));
    assertEquals(selected.getString("revision"),read.getString("revision"));assertTrue(read.getString("image").startsWith("data:image/jpeg;base64,"));
    assertTrue("Wrong selected revision is rejected",call("readPermitted",new JSONObject().put("id",selected.getString("id")).put("revision","stale-fixture-revision").put("pixels",true)).has("error"));
   }
   Bundle result=new Bundle();result.putString("photosForeignScope",scope);result.putString("photosForeignCount",Integer.toString(seen.size()));result.putString("photosForeignPid",Integer.toString(android.os.Process.myPid()));
   if(selected!=null){result.putString("photosForeignSelectedId",selected.getString("id"));result.putString("photosForeignSelectedRevision",selected.getString("revision"));}
   InstrumentationRegistry.getInstrumentation().addResults(result);
  }
 }
}
