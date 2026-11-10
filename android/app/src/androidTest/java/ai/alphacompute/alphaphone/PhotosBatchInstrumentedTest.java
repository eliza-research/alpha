package ai.alphacompute.alphaphone;

import android.app.Instrumentation;
import android.content.*;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.*;
import android.provider.MediaStore;
import android.view.*;
import android.view.accessibility.AccessibilityNodeInfo;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;
import static ai.alphacompute.alphaphone.PhotosTestFixture.*;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class PhotosBatchInstrumentedTest {
 private String js(String script)throws Exception{return WebViewTestDriver.evaluate(script);}
 private void until(String script)throws Exception{for(int i=0;i<150;i++){if("true".equals(js("Boolean("+script+")")))return;SystemClock.sleep(100);}fail("Photos batch condition: "+script);}
 private void click(String label)throws Exception{String node="document.querySelector('button[aria-label='+"+JSONObject.quote(JSONObject.quote(label))+"+']')";until(node+" && getComputedStyle("+node+").pointerEvents!==\"none\"");js(node+".click()");}

 private Bundle include(){Bundle b=new Bundle();b.putInt(MediaStore.QUERY_ARG_MATCH_TRASHED,MediaStore.MATCH_INCLUDE);return b;}
 private int flag(ContentResolver resolver,Uri uri,String column){try(Cursor row=resolver.query(uri,new String[]{column},include(),null)){assertNotNull(row);assertTrue(row.moveToFirst());return row.getInt(0);}}
 private void state(ContentResolver resolver,Uri uri,String column,int expected){for(int i=0;i<150;i++){if(flag(resolver,uri,column)==expected)return;SystemClock.sleep(100);}fail("Exact synthetic photo flag did not change: "+column);}
 private JSONObject nativeCall(String method,JSONObject args)throws Exception{
  js("window.__photoBatchResult=null;Capacitor.nativePromise('AlphaPhotos',"+JSONObject.quote(method)+","+args+").then(r=>{delete r.image;delete r.path;window.__photoBatchResult=r},()=>window.__photoBatchResult={rejected:true})");
  until("window.__photoBatchResult!==null");return new JSONObject(new JSONArray("["+js("JSON.stringify(window.__photoBatchResult)")+"]").getString(0));
 }
 private JSONObject item(Uri uri)throws Exception{return nativeCall("read",new JSONObject().put("id",Long.toString(ContentUris.parseId(uri))));}
 private void choose(Uri first,Uri second)throws Exception{touch(first,600);until("document.querySelector('button[aria-label=\"Cancel selection\"]')");touch(second,0);}
 private void undo()throws Exception{until("[...document.querySelectorAll('button')].some(e=>e.textContent==='Undo')");js("[...document.querySelectorAll('button')].find(e=>e.textContent==='Undo').click()");}
 @Test public void selectedFavoritePartialTrashUndoAndRecreatedRecoveryPreserveOwnedBytes()throws Exception{
  org.junit.Assume.assumeTrue("Explicit disposable Photos batch fixture", "1".equals(InstrumentationRegistry.getArguments().getString("photosBatch")));
  assertTrue(Build.VERSION.SDK_INT>=30);
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();ContentResolver resolver=context.getContentResolver();List<Uri> fixtures=new ArrayList<>();Throwable primary=null;
  try{
   for(int color:new int[]{0xffd45133,0xff227733,0xff3355cc})fixtures.add(fixture(resolver,"alpha-batch-",color));
   Uri first=fixtures.get(0),second=fixtures.get(1),neighbor=fixtures.get(2);byte[] firstBytes=bytes(resolver,first),secondBytes=bytes(resolver,second),neighborBytes=bytes(resolver,neighbor);
   try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
    AppNavigation.liveMode();js(AppNavigation.request("Photos"));until(AppNavigation.selected("Photos"));AppNavigation.declineStartupAccess();
    choose(first,second);click("Favorite selected");state(resolver,first,"is_favorite",1);state(resolver,second,"is_favorite",1);until("document.body.innerText.includes('2 favorited')");assertEquals(0,flag(resolver,neighbor,"is_favorite"));
    // The stale revision must be rejected individually without rolling back a
    // different, successfully trashed selection or silently touching the stale row.
    choose(first,second);ContentValues changed=new ContentValues();changed.put("is_favorite",0);assertEquals(1,resolver.update(second,changed,null,null));click("Delete selected");
    state(resolver,first,"is_trashed",1);state(resolver,second,"is_trashed",0);until("document.body.innerText.includes('1 moved to Recently deleted; 1 not verified')");
    assertTrue(item(first).optBoolean("rejected"));assertEquals(0,flag(resolver,neighbor,"is_trashed"));undo();state(resolver,first,"is_trashed",0);until("document.body.innerText.includes('1 restored')");assertArrayEquals(firstBytes,bytes(resolver,first));
    // Native receipts identify the exact no-op and stale row; duplicate input is
    // rejected before any write, rather than accidentally applying twice.
    JSONObject a=item(first),b=item(second);JSONArray receiptItems=new JSONArray().put(new JSONObject().put("id",a.getString("id")).put("revision",a.getString("mutationRevision"))).put(new JSONObject().put("id",b.getString("id")).put("revision","stale"));
    JSONObject partial=nativeCall("changeMany",new JSONObject().put("operation","favorite").put("items",receiptItems));assertEquals("partial",partial.getString("status"));JSONArray outcomes=partial.getJSONArray("outcomes");assertEquals(a.getString("id"),outcomes.getJSONObject(0).getString("id"));assertEquals("unchanged",outcomes.getJSONObject(0).getString("status"));assertEquals(b.getString("id"),outcomes.getJSONObject(1).getString("id"));assertEquals("stale",outcomes.getJSONObject(1).getString("status"));
    assertTrue(nativeCall("changeMany",new JSONObject().put("operation","trash").put("items",new JSONArray().put(receiptItems.getJSONObject(0)).put(receiptItems.getJSONObject(0)))).optBoolean("rejected"));assertEquals(0,flag(resolver,first,"is_trashed"));
    // Reselect after refresh, then leave trash durable across real recreation.
    scenario.recreate();AppNavigation.liveMode();js(AppNavigation.request("Photos"));until(AppNavigation.selected("Photos"));AppNavigation.declineStartupAccess();choose(first,second);click("Delete selected");state(resolver,first,"is_trashed",1);state(resolver,second,"is_trashed",1);until("document.body.innerText.includes('2 moved to Recently deleted')");
    scenario.recreate();AppNavigation.liveMode();js(AppNavigation.request("Photos"));until(AppNavigation.selected("Photos"));AppNavigation.declineStartupAccess();click("Albums");click("Recently deleted");touch(first,0);state(resolver,first,"is_trashed",0);touch(second,0);state(resolver,second,"is_trashed",0);
    assertArrayEquals(firstBytes,bytes(resolver,first));assertArrayEquals(secondBytes,bytes(resolver,second));assertArrayEquals(neighborBytes,bytes(resolver,neighbor));assertEquals(0,flag(resolver,neighbor,"is_favorite"));assertEquals(0,flag(resolver,neighbor,"is_trashed"));assertNotEquals(a.getString("revision"),item(first).getString("revision"));
   }
  }catch(Exception|AssertionError failure){primary=failure;throw failure;}
  finally{
   AssertionError cleanup=null;for(Uri uri:fixtures)try{assertEquals("Delete only this exact synthetic fixture",1,resolver.delete(uri,include()));assertTrue(context.getSharedPreferences("alpha-owned-media-versions",0).edit().remove(Long.toString(ContentUris.parseId(uri))).commit());}catch(Exception|AssertionError failure){if(cleanup==null)cleanup=new AssertionError("Photo batch fixture cleanup failed");cleanup.addSuppressed(failure);}if(cleanup!=null){if(primary!=null)primary.addSuppressed(cleanup);else throw cleanup;}
  }
 }
}
