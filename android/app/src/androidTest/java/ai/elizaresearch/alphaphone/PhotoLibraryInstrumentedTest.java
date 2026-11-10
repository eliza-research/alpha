package ai.elizaresearch.alphaphone;

import android.content.*;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.*;
import android.provider.MediaStore;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.*;
import static org.junit.Assert.*;

/**
 * Device library catalog over real MediaStore rows (issue 408): grant, paged catalog with
 * stable ids across a larger fixture set, search, inspect, external edit and external delete
 * detection, and incremental change reads. Creates and removes only its own uniquely named
 * fixtures. Permission downgrade/revoke kills the app process, so it needs a separate
 * permission campaign; reboot, Android 14 selected-only grants and work profiles likewise.
 */
@RunWith(AndroidJUnit4.class)
public class PhotoLibraryInstrumentedTest {
 private static final int FIXTURES = 60;
 private String js(String script) throws Exception { return WebViewTestDriver.evaluate(script); }
 private void until(String script) throws Exception { for (int i = 0; i < 150; i++) { if ("true".equals(js("Boolean(" + script + ")"))) return; SystemClock.sleep(100); } fail("Photo library condition: " + script); }
 private JSONObject call(String method, JSONObject args) throws Exception {
  js("window.__libraryResult=null;Capacitor.nativePromise('AlphaPhotoLibrary'," + JSONObject.quote(method) + "," + args + ").then(r=>{window.__libraryResult=r},e=>window.__libraryResult={rejected:true,code:e&&e.code||''})");
  until("window.__libraryResult!==null");
  return new JSONObject(new JSONArray("[" + js("JSON.stringify(window.__libraryResult)") + "]").getString(0));
 }
 private Uri fixture(ContentResolver resolver, String prefix, int index) throws Exception {
  ContentValues values = new ContentValues();
  values.put("_display_name", prefix + String.format(Locale.ROOT, "%03d", index) + ".jpg");
  values.put("mime_type", "image/jpeg");
  values.put("relative_path", "Pictures/AlphaPhone-library-tests");
  values.put("is_pending", 1);
  Uri uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
  assertNotNull(uri);
  write(resolver, uri, 0xff000000 | (index * 40503));
  values.clear(); values.put("is_pending", 0);
  assertEquals(1, resolver.update(uri, values, null, null));
  return uri;
 }
 private void write(ContentResolver resolver, Uri uri, int color) throws Exception {
  Bitmap bitmap = Bitmap.createBitmap(32, 24, Bitmap.Config.ARGB_8888);
  bitmap.eraseColor(color);
  try (java.io.OutputStream out = resolver.openOutputStream(uri, "wt")) { assertNotNull(out); assertTrue(bitmap.compress(Bitmap.CompressFormat.JPEG, 90, out)); }
  finally { bitmap.recycle(); }
 }
 private String id(JSONArray items, Uri uri) throws Exception {
  String row = ":" + ContentUris.parseId(uri);
  for (int i = 0; i < items.length(); i++) if (items.getJSONObject(i).getString("id").endsWith(row)) return items.getJSONObject(i).getString("id");
  fail("Fixture missing from catalog: " + uri); return "";
 }
 private JSONObject one(JSONArray items, String id) throws Exception {
  for (int i = 0; i < items.length(); i++) if (items.getJSONObject(i).getString("id").equals(id)) return items.getJSONObject(i);
  fail("Missing " + id); return null;
 }

 @Test public void pagedCatalogStableIdsSearchAndExternalChanges() throws Exception {
  org.junit.Assume.assumeTrue("Explicit disposable device-library fixture", "1".equals(InstrumentationRegistry.getArguments().getString("photoLibrary")));
  org.junit.Assume.assumeTrue("READ_MEDIA_* grants need Android 13+", Build.VERSION.SDK_INT >= 33);
  Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
  ContentResolver resolver = context.getContentResolver();
  android.app.UiAutomation automation = InstrumentationRegistry.getInstrumentation().getUiAutomation();
  automation.grantRuntimePermission(context.getPackageName(), "android.permission.READ_MEDIA_IMAGES");
  automation.grantRuntimePermission(context.getPackageName(), "android.permission.READ_MEDIA_VIDEO");
  String prefix = "alpha-library-" + UUID.randomUUID().toString().substring(0, 8) + "-";
  List<Uri> fixtures = new ArrayList<>();
  try {
   for (int i = 0; i < FIXTURES; i++) fixtures.add(fixture(resolver, prefix, i));
   try (BoundedActivityScenario<MainActivity> scenario = BoundedActivityScenario.launch(MainActivity.class)) {
    AppNavigation.liveMode();
    JSONObject scope = call("scope", new JSONObject());
    assertEquals("full", scope.getString("scope"));
    assertFalse("emulator must be unlocked", scope.getBoolean("locked"));

    // Page the uniquely named fixtures 25 at a time: every fixture once, newest first, no gaps.
    List<String> ids = new ArrayList<>();
    String cursor = "";
    JSONArray last = null;
    long generation = 0;
    String version = "";
    for (int pages = 0; pages < 10; pages++) {
     JSONObject page = call("page", new JSONObject().put("query", prefix).put("limit", 25).put("before", cursor).put("thumbnails", pages == 0));
     assertFalse(page.optBoolean("rejected"));
     JSONArray items = page.getJSONArray("items");
     if (pages == 0) { assertTrue(items.getJSONObject(0).getString("image").startsWith("data:image/jpeg;base64,")); generation = page.getLong("generation"); version = page.getString("version"); last = items; }
     for (int i = 0; i < items.length(); i++) {
      String id = items.getJSONObject(i).getString("id");
      assertTrue(id, id.matches("^m:[a-zA-Z0-9_-]+:i:[1-9][0-9]*$"));
      ids.add(id);
     }
     cursor = page.getString("next");
     if (cursor.isEmpty()) break;
    }
    assertEquals(FIXTURES, ids.size());
    assertEquals(FIXTURES, new HashSet<>(ids).size());
    // Ids are stable across a fresh read.
    JSONObject again = call("page", new JSONObject().put("query", prefix).put("limit", 25));
    for (int i = 0; i < Math.min(24,ids.size()); i++) assertEquals(ids.get(i), again.getJSONArray("items").getJSONObject(i).getString("id"));
    // LIKE wildcards in the query are literal.
    assertEquals(0, call("page", new JSONObject().put("query", prefix.replace('-', '_') + "%")).getJSONArray("items").length());

    Uri edited = fixtures.get(FIXTURES - 1), removed = fixtures.get(FIXTURES - 2);
    String editedId = id(last, edited), removedId = id(last, removed);
    JSONObject inspected = call("inspect", new JSONObject().put("id", editedId));
    assertEquals(one(last, editedId).getString("revision"), inspected.getString("revision"));
    assertTrue(inspected.getString("image").startsWith("data:image/jpeg;base64,"));

    // External edit and delete, as another gallery app would make them.
    SystemClock.sleep(1100);
    write(resolver, edited, 0xff123456);
    assertEquals(1, resolver.delete(removed, null, null));
    fixtures.remove(removed);
    JSONObject validation = call("validate", new JSONObject().put("items", new JSONArray()
     .put(new JSONObject().put("id", editedId).put("revision", one(last, editedId).getString("revision")))
     .put(new JSONObject().put("id", removedId).put("revision", one(last, removedId).getString("revision")))));
    JSONArray results = validation.getJSONArray("items");
    assertEquals("changed", results.getJSONObject(0).getString("status"));
    assertNotEquals(one(last, editedId).getString("revision"), results.getJSONObject(0).getJSONObject("item").getString("revision"));
    assertEquals("missing", results.getJSONObject(1).getString("status"));
    assertEquals("LIBRARY_MISSING", call("inspect", new JSONObject().put("id", removedId)).optString("code"));

    JSONObject changes = call("changes", new JSONObject().put("version", version).put("generation", generation));
    assertTrue("Canonical catalog changes require a bounded page refresh", changes.getBoolean("reset"));

    // The Photos UI shows the actual scope on the Device library tile.
    js(AppNavigation.request("Photos"));
    until(AppNavigation.selected("Photos"));
    until("document.body.innerText.includes('Device library')&&document.body.innerText.includes('Full access')");
   }
  } finally {
   for (Uri uri : fixtures) { try { resolver.delete(uri, null, null); } catch (RuntimeException ignored) { /* already gone */ } }
  }
 }
}
