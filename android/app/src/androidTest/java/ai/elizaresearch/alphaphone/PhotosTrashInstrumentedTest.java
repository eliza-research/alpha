package ai.elizaresearch.alphaphone;

import android.content.*;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.*;
import android.provider.MediaStore;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.*;
import java.util.UUID;
import static org.junit.Assert.*;

/** Real app-owned MediaStore fixture, prototype controls and independent bytes.
 * Never touches media not created by this test. No broad media permission. */
@RunWith(AndroidJUnit4.class)
public final class PhotosTrashInstrumentedTest {
 private String host(String script)throws Exception{return WebViewTestDriver.evaluate(script);}
 private void ready(String script)throws Exception{for(int i=0;i<200;i++){if("true".equals(host("Boolean("+script+")")))return;SystemClock.sleep(100);}fail("Owned Photos control missing");}
 private void click(String label)throws Exception{String q="[...document.querySelectorAll('button')].find(e=>e.getAttribute('aria-label')==="+JSONObject.quote(label)+")";ready(q);host("("+q+").click()");}
 private void photos()throws Exception{host(AppNavigation.request("Photos"));ready(AppNavigation.selected("Photos"));}
 private void media(String id)throws Exception{String q="document.querySelector('[data-owned-media-id=\"native-camera-"+id+"\"]')";ready(q);host(q+".click()");}
 private Bundle include(){Bundle b=new Bundle();b.putInt(MediaStore.QUERY_ARG_MATCH_TRASHED,MediaStore.MATCH_INCLUDE);return b;}
 private boolean trashed(ContentResolver resolver,Uri uri){try(Cursor row=resolver.query(uri,new String[]{MediaStore.MediaColumns.IS_TRASHED},include(),null)){assertNotNull(row);assertTrue("Exact fixture still exists",row.moveToFirst());return row.getInt(0)==1;}}
 private void state(ContentResolver resolver,Uri uri,boolean value)throws Exception{for(int i=0;i<150;i++){if(trashed(resolver,uri)==value)return;SystemClock.sleep(100);}fail("Actual Android trash flag did not change");}
 private byte[] bytes(ContentResolver resolver,Uri uri)throws Exception{try(InputStream input=resolver.openInputStream(uri)){assertNotNull(input);return input.readAllBytes();}}
 private JSONObject nativeCall(String method,JSONObject args)throws Exception{
  host("window.__photoTrashResult=null;Capacitor.nativePromise('AlphaPhotos',"+JSONObject.quote(method)+","+args+").then(r=>{delete r.image;delete r.path;if(r.items)r.items.forEach(i=>{delete i.image;delete i.path});window.__photoTrashResult=r},()=>window.__photoTrashResult={rejected:true})");
  ready("window.__photoTrashResult!==null");String encoded=host("JSON.stringify(window.__photoTrashResult)");return new JSONObject(new JSONArray("["+encoded+"]").getString(0));
 }
 @Test public void ownedPhotoTrashUndoAndRecreatedRestorePreserveExactBytes()throws Exception{
  assertTrue("Real native trash requires Android11+",Build.VERSION.SDK_INT>=30);
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();ContentResolver resolver=context.getContentResolver();
  ContentValues values=new ContentValues();values.put(MediaStore.MediaColumns.DISPLAY_NAME,"alpha-trash-"+UUID.randomUUID()+".jpg");values.put(MediaStore.MediaColumns.MIME_TYPE,"image/jpeg");values.put(MediaStore.MediaColumns.RELATIVE_PATH,"Pictures/AlphaPhone-tests");values.put(MediaStore.MediaColumns.IS_PENDING,1);
  Uri uri=resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,values);assertNotNull(uri);
  try{
   Bitmap bitmap=Bitmap.createBitmap(64,64,Bitmap.Config.ARGB_8888);bitmap.eraseColor(0xff3185aa);
   try(OutputStream output=resolver.openOutputStream(uri)){assertNotNull(output);assertTrue(bitmap.compress(Bitmap.CompressFormat.JPEG,95,output));}finally{bitmap.recycle();}
   values.clear();values.put(MediaStore.MediaColumns.IS_PENDING,0);assertEquals(1,resolver.update(uri,values,null,null));
   String id=Long.toString(ContentUris.parseId(uri));byte[] original=bytes(resolver,uri);assertTrue(original.length>100);
   try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
    AppNavigation.liveMode();photos();media(id);click("Delete photo");state(resolver,uri,true);
    ready("[...document.querySelectorAll('button')].some(e=>e.textContent==='Undo')");
    host("[...document.querySelectorAll('button')].find(e=>e.textContent==='Undo').click()");state(resolver,uri,false);
    assertArrayEquals("Undo restores the original file byte for byte",original,bytes(resolver,uri));
    JSONObject first=nativeCall("read",new JSONObject().put("id",id));assertFalse(first.optBoolean("rejected"));
    media(id);click("Delete photo");state(resolver,uri,true);
    assertTrue("Trashed media cannot be read/shared as an active item",nativeCall("read",new JSONObject().put("id",id)).optBoolean("rejected"));
    scenario.recreate();AppNavigation.liveMode();photos();click("Albums");click("Recently deleted");
    state(resolver,uri,true);media(id);state(resolver,uri,false);
    assertArrayEquals("Restore after actual Activity recreation preserves exact bytes",original,bytes(resolver,uri));
    JSONObject restored=nativeCall("read",new JSONObject().put("id",id));assertFalse(restored.optBoolean("rejected"));
    assertNotEquals("Restoration gets a new durable selected-media revision",first.getString("revision"),restored.getString("revision"));
    assertTrue("Stale mutation cannot trash the restored asset",nativeCall("setTrashed",new JSONObject().put("id",id).put("revision",first.getString("mutationRevision")).put("trashed",true)).optBoolean("rejected"));
    state(resolver,uri,false);assertArrayEquals(original,bytes(resolver,uri));
   }
  }finally{resolver.delete(uri,include());context.getSharedPreferences("alpha-owned-media-versions",0).edit().remove(Long.toString(ContentUris.parseId(uri))).commit();}
 }
 private Uri fixture(ContentResolver resolver)throws Exception{
  ContentValues values=new ContentValues();values.put(MediaStore.MediaColumns.DISPLAY_NAME,"alpha-album-"+UUID.randomUUID()+".jpg");values.put(MediaStore.MediaColumns.MIME_TYPE,"image/jpeg");values.put(MediaStore.MediaColumns.RELATIVE_PATH,"Pictures/AlphaPhone-tests");values.put(MediaStore.MediaColumns.IS_PENDING,1);
  Uri uri=resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,values);assertNotNull(uri);
  try{Bitmap bitmap=Bitmap.createBitmap(32,32,Bitmap.Config.ARGB_8888);bitmap.eraseColor(0xffd28039);try(OutputStream output=resolver.openOutputStream(uri)){assertNotNull(output);assertTrue(bitmap.compress(Bitmap.CompressFormat.JPEG,95,output));}finally{bitmap.recycle();}values.clear();values.put(MediaStore.MediaColumns.IS_PENDING,0);assertEquals(1,resolver.update(uri,values,null,null));return uri;}catch(Exception failure){resolver.delete(uri,include());throw failure;}
 }
 private String key(Uri uri){return Long.toString(ContentUris.parseId(uri));}
 private JSONObject metadata(Uri uri)throws Exception{return nativeCall("read",new JSONObject().put("id",key(uri)));}
 private JSONObject trash(Uri uri,JSONObject row,boolean desired)throws Exception{JSONObject result=nativeCall("setTrashed",new JSONObject().put("id",key(uri)).put("revision",row.getString("mutationRevision")).put("trashed",desired));assertFalse("Native mutation verified",result.optBoolean("rejected"));return result;}
 private boolean contains(JSONArray rows,String id)throws Exception{for(int i=0;i<rows.length();i++)if(rows.getJSONObject(i).getString("id").equals(id))return true;return false;}
 private void cleanup(Context context,java.util.List<Uri> fixtures,Throwable primary){
  AssertionError errors=null;ContentResolver resolver=context.getContentResolver();
  for(Uri uri:fixtures)try{
   Bundle query=include();query.putString(ContentResolver.QUERY_ARG_SQL_SELECTION,"_id=? AND media_type=1 AND owner_package_name=?");query.putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS,new String[]{key(uri),context.getPackageName()});
   boolean exists;try(Cursor row=resolver.query(MediaStore.Files.getContentUri("external"),new String[]{"_id"},query,null)){assertNotNull("Cleanup can inspect its owned fixture",row);exists=row.moveToFirst();}
   if(exists)assertEquals("Delete only remaining exact fixture",1,resolver.delete(uri,include()));
   assertTrue("Remove only fixture revision",context.getSharedPreferences("alpha-owned-media-versions",0).edit().remove(key(uri)).commit());
  }catch(Exception|AssertionError error){if(errors==null)errors=new AssertionError("Owned media fixture cleanup failed");errors.addSuppressed(error);}
  if(errors!=null){if(primary!=null)primary.addSuppressed(errors);else throw errors;}
 }
 @Test public void favoriteAlbumFiltersBeforePagingAndSurvivesRecreation()throws Exception{
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();ContentResolver resolver=context.getContentResolver();java.util.List<Uri> fixtures=new java.util.ArrayList<>();Throwable primary=null;
  try{Uri chosen=fixture(resolver);fixtures.add(chosen);byte[] original=bytes(resolver,chosen);
   try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
    AppNavigation.liveMode();photos();media(key(chosen));click("Favorite");ready("document.querySelector('button[aria-label=\"Remove from favorites\"]')");
    JSONObject favorited=metadata(chosen);assertTrue(favorited.getBoolean("favorite"));
    for(int i=0;i<25;i++)fixtures.add(fixture(resolver));
    assertFalse("Favorite is older than first ordinary page",contains(nativeCall("list",new JSONObject()).getJSONArray("items"),key(chosen)));
    assertTrue("Native favorite filter runs before page limit",contains(nativeCall("list",new JSONObject().put("album","favorites")).getJSONArray("items"),key(chosen)));
    scenario.recreate();AppNavigation.liveMode();photos();click("Albums");click("Favorites");media(key(chosen));click("Remove from favorites");ready("document.querySelector('button[aria-label=\"Favorite\"]')");
    assertFalse(metadata(chosen).getBoolean("favorite"));assertFalse(contains(nativeCall("list",new JSONObject().put("album","favorites")).getJSONArray("items"),key(chosen)));
    assertArrayEquals("Favorite edits preserve original media bytes",original,bytes(resolver,chosen));
   }
  }catch(Exception|AssertionError failure){primary=failure;throw failure;}finally{cleanup(context,fixtures,primary);}
 }
 @Test public void permanentDeleteConfirmsImmutableTrashAndPreservesNewAndRestoredItems()throws Exception{
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();ContentResolver resolver=context.getContentResolver();java.util.List<Uri> fixtures=new java.util.ArrayList<>();Throwable primary=null;
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();photos();
   // Refuse destructive flow if a prior user/test already owns trash. Never delete it.
   assertEquals("Disposable fixture requires empty app-owned trash",0,nativeCall("summary",new JSONObject()).getInt("trash"));
   Uri restored=fixture(resolver);fixtures.add(restored);Uri remove=fixture(resolver);fixtures.add(remove);Uri later=fixture(resolver);fixtures.add(later);byte[] original=bytes(resolver,restored);
   JSONObject trashedRow=trash(restored,metadata(restored),true);
   JSONObject prepared=nativeCall("prepareDeleteTrash",new JSONObject().put("all",true));assertEquals(1,prepared.getInt("count"));
   trash(restored,trashedRow,false);trash(remove,metadata(remove),true);
   JSONObject partial=nativeCall("deletePreparedTrash",new JSONObject().put("confirmation",prepared.getString("confirmation")));
   assertEquals("partial",partial.getString("status"));assertEquals(0,partial.getJSONArray("deletedIds").length());assertEquals("Restored snapshot is classified as skipped: "+partial,1,partial.getJSONArray("skippedIds").length());assertEquals(key(restored),partial.getJSONArray("skippedIds").getString(0));state(resolver,restored,false);state(resolver,remove,true);
   assertTrue("Confirmation is single-use",nativeCall("deletePreparedTrash",new JSONObject().put("confirmation",prepared.getString("confirmation"))).optBoolean("rejected"));
   scenario.recreate();AppNavigation.liveMode();photos();click("Albums");click("Recently deleted");click("Delete all forever");click("Cancel");state(resolver,remove,true);
   click("Delete all forever");ready("document.querySelector('button[aria-label=\"Delete forever\"]')");
   trash(later,metadata(later),true);click("Delete forever");
   ready("!document.querySelector('button[aria-label=\"Delete forever\"]')");
   Bundle absentQuery=include();absentQuery.putString(ContentResolver.QUERY_ARG_SQL_SELECTION,"_id=? AND media_type=1 AND owner_package_name=?");absentQuery.putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS,new String[]{key(remove),context.getPackageName()});
   try(Cursor row=resolver.query(MediaStore.Files.getContentUri("external"),new String[]{"_id"},absentQuery,null)){assertNotNull(row);assertFalse("Confirmed exact owned fixture is permanently deleted",row.moveToFirst());}
   state(resolver,later,true);state(resolver,restored,false);assertArrayEquals("Restored bytes remain untouched",original,bytes(resolver,restored));
   ready("document.querySelector('[data-owned-media-id=\"native-camera-"+key(later)+"\"]')");
  }catch(Exception|AssertionError failure){primary=failure;throw failure;}finally{cleanup(context,fixtures,primary);}
 }

 private void albumName(String name)throws Exception{ready("document.querySelector('input[aria-label=\"Album name\"]')");host("(()=>{const e=document.querySelector('input[aria-label=\"Album name\"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,"+JSONObject.quote(name)+");e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()");}
 private JSONObject namedAlbum(String name)throws Exception{JSONArray albums=nativeCall("albums",new JSONObject()).getJSONArray("items");for(int i=0;i<albums.length();i++)if(albums.getJSONObject(i).getString("name").equals(name))return albums.getJSONObject(i);throw new AssertionError("Exact fixture album missing");}
 @Test public void customAlbumCreateRenameMembershipRestoreAndDeleteAreDurableAndKeepMedia()throws Exception{
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();ContentResolver resolver=context.getContentResolver();java.util.List<Uri> fixtures=new java.util.ArrayList<>();Throwable primary=null;String name="Album fixture "+UUID.randomUUID(),renamed=name+" renamed";String createdAlbumId=null;
  try{Uri photo=fixture(resolver);fixtures.add(photo);byte[] original=bytes(resolver,photo);
   try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
    AppNavigation.liveMode();photos();media(key(photo));click("Photo info");click("Add to album");click("New album");albumName(name);click("Save album");ready("!document.querySelector('[aria-label=\"Album management\"]')");
    JSONObject first=namedAlbum(name);createdAlbumId=first.getString("id");assertEquals(1,first.getInt("count"));assertEquals(key(photo),first.getJSONArray("memberIds").getString(0));
    click("Back from photo");click("Albums");click(name);media(key(photo));click("Back from photo");click("Manage album");albumName(renamed);click("Save album");ready("!document.querySelector('[aria-label=\"Album management\"]')");
    assertTrue("Stale album edit is rejected",nativeCall("changeAlbum",new JSONObject().put("operation","rename").put("id",first.getString("id")).put("revision",first.getString("revision")).put("name","Must not appear")).optBoolean("rejected"));
    scenario.recreate();AppNavigation.liveMode();photos();click("Albums");click(renamed);media(key(photo));
    JSONObject trashed=trash(photo,metadata(photo),true);assertEquals("Trashed membership is hidden",0,nativeCall("list",new JSONObject().put("album","custom:"+first.getString("id"))).getJSONArray("items").length());
    trash(photo,trashed,false);assertTrue("Restoring the same original asset restores membership",contains(nativeCall("list",new JSONObject().put("album","custom:"+first.getString("id"))).getJSONArray("items"),key(photo)));
    // Re-read selected metadata after its generation changed, then explicit removal.
    click("Back from photo");media(key(photo));click("Photo info");click("Add to album");click("Remove from "+renamed);ready("!document.querySelector('[aria-label=\"Album management\"]')");assertEquals(0,namedAlbum(renamed).getInt("count"));
    click("Photo info");click("Add to album");click("Add to "+renamed);ready("!document.querySelector('[aria-label=\"Album management\"]')");assertEquals(1,namedAlbum(renamed).getInt("count"));
    click("Back from photo");click("Manage album");click("Delete album");click("Close album management");assertEquals(1,namedAlbum(renamed).getInt("count"));
    click("Manage album");click("Delete album");click("Confirm delete album");ready("!document.querySelector('[aria-label=\"Album management\"]')");
    JSONArray remaining=nativeCall("albums",new JSONObject()).getJSONArray("items");for(int i=0;i<remaining.length();i++)assertNotEquals(first.getString("id"),remaining.getJSONObject(i).getString("id"));
    assertArrayEquals("Album deletion never deletes or rewrites media",original,bytes(resolver,photo));assertFalse(metadata(photo).optBoolean("rejected"));
   }
  }catch(Exception|AssertionError failure){primary=failure;throw failure;}finally{
   cleanup(context,fixtures,primary);
   synchronized(AlphaPhotosPlugin.ALBUMS_LOCK){
    android.content.SharedPreferences preferences=context.getSharedPreferences("alpha-owned-albums",0);JSONArray existing=new JSONArray(preferences.getString("albums","[]")),keep=new JSONArray();for(int i=0;i<existing.length();i++){JSONObject album=existing.getJSONObject(i);if(!album.getString("id").equals(createdAlbumId)&&!album.getString("name").equals(name)&&!album.getString("name").equals(renamed))keep.put(album);}assertTrue(preferences.edit().putString("albums",keep.toString()).commit());
   }
  }
 }

 private String assistant(String script)throws Exception{
  java.util.concurrent.CountDownLatch done=new java.util.concurrent.CountDownLatch(1);java.util.concurrent.atomic.AtomicReference<String> value=new java.util.concurrent.atomic.AtomicReference<>();
  WebViewTestDriver.withActivity(AlphaAssistActivity.class,activity->activity.getBridge().getWebView().evaluateJavascript(script,result->{value.set(result);done.countDown();}));assertTrue("Assistant bridge answered",done.await(8,java.util.concurrent.TimeUnit.SECONDS));return value.get();
 }
 private void blockedAlbumWorkers(int expected)throws Exception{
  for(int attempt=0;attempt<100;attempt++){int count=0;for(java.util.Map.Entry<Thread,StackTraceElement[]> entry:Thread.getAllStackTraces().entrySet()){if(entry.getKey().getState()!=Thread.State.BLOCKED)continue;for(StackTraceElement frame:entry.getValue())if(frame.getClassName().contains("AlphaPhotosPlugin")&&frame.getMethodName().contains("changeAlbum")){count++;break;}}if(count>=expected)return;SystemClock.sleep(50);}fail("Real native album workers did not reach the shared mutation gate");
 }
 @Test public void twoActivityAlbumWritesPersistAndLateReceiptCannotCloseNewManager()throws Exception{
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();ContentResolver resolver=context.getContentResolver();java.util.List<Uri> fixtures=new java.util.ArrayList<>();Throwable primary=null;String prefix="Album race "+UUID.randomUUID();java.util.Set<String> names=new java.util.HashSet<>(java.util.Arrays.asList(prefix+" main",prefix+" assist",prefix+" renamed"));
  try{Uri photo=fixture(resolver);fixtures.add(photo);byte[] original=bytes(resolver,photo);
   try(BoundedActivityScenario<MainActivity> main=BoundedActivityScenario.launch(MainActivity.class)){
    AppNavigation.liveMode();photos();media(key(photo));JSONObject row=metadata(photo);
    JSONObject args=new JSONObject().put("operation","create").put("name",prefix+" main").put("mediaId",key(photo)).put("mediaRevision",row.getString("mutationRevision"));
    try(BoundedActivityScenario<AlphaAssistActivity> assist=BoundedActivityScenario.launch(new Intent(context,AlphaAssistActivity.class).setAction(Intent.ACTION_ASSIST))){
     for(int i=0;i<100&&!"true".equals(assistant("Boolean(window.Capacitor?.nativePromise)"));i++)SystemClock.sleep(100);
     synchronized(AlphaPhotosPlugin.ALBUMS_LOCK){
      host("window.__albumConcurrent=null;Capacitor.nativePromise('AlphaPhotos','changeAlbum',"+args+").then(r=>window.__albumConcurrent=r,()=>window.__albumConcurrent={rejected:true})");
      args.put("name",prefix+" assist");assistant("window.__albumConcurrent=null;Capacitor.nativePromise('AlphaPhotos','changeAlbum',"+args+").then(r=>window.__albumConcurrent=r,()=>window.__albumConcurrent={rejected:true})");
      blockedAlbumWorkers(2);
     }
     ready("window.__albumConcurrent!==null");assertEquals("false",host("!!window.__albumConcurrent.rejected"));
     for(int i=0;i<100&&"false".equals(assistant("window.__albumConcurrent!==null"));i++)SystemClock.sleep(100);
     assertEquals("true",assistant("window.__albumConcurrent?.status==='saved'"));assertEquals(1,namedAlbum(prefix+" main").getInt("count"));assertEquals(1,namedAlbum(prefix+" assist").getInt("count"));
    }
    // Actual UI requests a rename, native worker waits while the user leaves and
    // opens a different sheet. No fake renderer promise or native result hook.
    main.recreate();AppNavigation.liveMode();photos();click("Albums");click(prefix+" main");click("Manage album");albumName(prefix+" renamed");
    synchronized(AlphaPhotosPlugin.ALBUMS_LOCK){
     click("Save album");blockedAlbumWorkers(1);
     host(AppNavigation.request("Home"));ready(AppNavigation.selected("Home"));photos();
     // Return to Library using the real Back controls, then select the fixture.
     host("document.querySelector('button[aria-label=\"Back to albums\"]')?.click()");click("Library");media(key(photo));click("Photo info");
     ready("document.querySelector('[aria-label=\"Album management\"]')");
    }
    for(int i=0;i<100;i++){JSONArray albums=nativeCall("albums",new JSONObject()).getJSONArray("items");boolean found=false;for(int j=0;j<albums.length();j++)if(albums.getJSONObject(j).getString("name").equals(prefix+" renamed"))found=true;if(found)break;SystemClock.sleep(100);}
    assertEquals(1,namedAlbum(prefix+" renamed").getInt("count"));
    assertEquals("Late successful receipt leaves the newly opened manager intact","true",host("Boolean(document.querySelector('[aria-label=\"Album management\"]'))"));
    assertEquals("Fresh info sheet remains usable","true",host("Boolean(document.querySelector('button[aria-label=\"Add to album\"]'))"));assertArrayEquals(original,bytes(resolver,photo));
   }
  }catch(Exception|AssertionError failure){primary=failure;throw failure;}finally{cleanup(context,fixtures,primary);synchronized(AlphaPhotosPlugin.ALBUMS_LOCK){android.content.SharedPreferences preferences=context.getSharedPreferences("alpha-owned-albums",0);JSONArray existing=new JSONArray(preferences.getString("albums","[]")),keep=new JSONArray();for(int i=0;i<existing.length();i++){JSONObject album=existing.getJSONObject(i);if(!names.contains(album.getString("name")))keep.put(album);}assertTrue(preferences.edit().putString("albums",keep.toString()).commit());}}
 }

}
