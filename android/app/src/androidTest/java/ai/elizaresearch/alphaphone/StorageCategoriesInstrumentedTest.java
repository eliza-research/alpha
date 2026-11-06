package ai.elizaresearch.alphaphone;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.FileOutputStream;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/**
 * Every Browse category id the renderer sends (StorageCatalog.CATEGORY_IDS, kept equal to
 * runtime/files-storage.ts CATEGORIES by test/files-browser.test.mjs) is answered by the
 * native category path, and Downloads lists the files directly in Download/.
 */
@RunWith(AndroidJUnit4.class)
public class StorageCategoriesInstrumentedTest {
 private static File tempRoot(Context context){File root=new File(context.getCacheDir(),"storage-categories-"+System.nanoTime());assertTrue(root.mkdirs());return root;}
 private static void file(File file,String text)throws Exception{try(FileOutputStream out=new FileOutputStream(file)){out.write(text.getBytes("UTF-8"));}}

 @Test public void everyCategoryIdIsAnswered()throws Exception{
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  StorageBrowser browser=new StorageBrowser(tempRoot(context));
  for(String id:StorageCatalog.CATEGORY_IDS){JSONObject out=StorageCatalog.category(context.getContentResolver(),browser,id);assertNotNull(id,out.getJSONArray("entries"));assertTrue(id,out.getInt("count")>=out.getJSONArray("entries").length());assertTrue(id,out.has("truncated"));}
  try{StorageCatalog.category(context.getContentResolver(),browser,"recent");fail("an unknown category is refused");}catch(IllegalArgumentException expected){}
 }

 @Test public void downloadsListsTheDownloadFolderFilesNewestFirst()throws Exception{
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  File root=tempRoot(context),download=new File(root,StorageCatalog.DOWNLOAD_FOLDER);
  StorageBrowser browser=new StorageBrowser(root);
  assertEquals("no Download folder is an empty category",0,StorageCatalog.category(context.getContentResolver(),browser,"downloads").getInt("count"));
  assertTrue(download.mkdirs());
  File older=new File(download,"lease.pdf"),newer=new File(download,"notes.txt");
  file(older,"pdf");file(newer,"text");file(new File(download,".hidden"),"x");
  assertTrue(new File(download,"Folder").mkdir());file(new File(download,"Folder/inner.txt"),"x");
  assertTrue(older.setLastModified(1_700_000_000_000L));assertTrue(newer.setLastModified(1_800_000_000_000L));
  JSONObject category=StorageCatalog.category(context.getContentResolver(),browser,"downloads");
  assertEquals(2,category.getInt("count"));assertFalse(category.getBoolean("truncated"));
  org.json.JSONArray rows=category.getJSONArray("entries");
  assertEquals("only files directly in Download/, no folders or hidden entries",2,rows.length());
  JSONObject first=rows.getJSONObject(0),second=rows.getJSONObject(1);
  assertEquals("Download/notes.txt",first.getString("path"));
  assertEquals("Download/lease.pdf",second.getString("path"));
  assertFalse(first.getBoolean("directory"));
  assertEquals("application/pdf",second.getString("mimeType"));
  assertEquals(3,second.getLong("size"));
 }
}
