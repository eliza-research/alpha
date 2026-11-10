package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.filesystem.browser.StorageCatalog;
import ai.eliza.plugins.filesystem.browser.StorageBrowser;
import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Environment;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.util.Arrays;
import java.util.UUID;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;
import static org.junit.Assume.assumeTrue;

/**
 * Files on Android 10 (API 29): legacy storage is in effect, the storage permissions are declared,
 * access reads as granted once both are granted, and the storage browser can then create and remove
 * a uniquely named folder in shared storage. Permissions are only granted here, never revoked
 * (revoking a runtime permission kills the app process, which is this test's process).
 */
@RunWith(AndroidJUnit4.class)
public class StorageLegacyAccessInstrumentedTest {
 @Test public void api29UsesLegacyStorageWithTheTwoStoragePermissions()throws Exception{
  assumeTrue("API 29 only",Build.VERSION.SDK_INT==Build.VERSION_CODES.Q);
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  assertTrue("requestLegacyExternalStorage is in effect",Environment.isExternalStorageLegacy());
  assertTrue(StorageCatalog.legacy());
  assertEquals("unsupported",StorageCatalog.access());
  String[] requested=context.getPackageManager().getPackageInfo(context.getPackageName(),PackageManager.GET_PERMISSIONS).requestedPermissions;
  String[] legacyPermissions={Manifest.permission.READ_EXTERNAL_STORAGE,Manifest.permission.WRITE_EXTERNAL_STORAGE};
  assertTrue(Arrays.asList(requested).containsAll(Arrays.asList(legacyPermissions)));
  for(String permission:legacyPermissions)InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(context.getPackageName(),permission);
  assertEquals("granted",StorageCatalog.access(context));
  StorageBrowser browser=new StorageBrowser(Environment.getExternalStorageDirectory(),".Trash-alpha");
  String name="AlphaLegacy-"+UUID.randomUUID();
  File folder=new File(Environment.getExternalStorageDirectory(),StorageCatalog.DOWNLOAD_FOLDER+"/"+name);
  try{
   browser.createFolder(StorageCatalog.DOWNLOAD_FOLDER,name);
   assertTrue("a folder is created in shared storage",folder.isDirectory());
   assertTrue(browser.list(StorageCatalog.DOWNLOAD_FOLDER).stream().anyMatch(row->row.name.equals(name)&&row.directory));
  }finally{folder.delete();}
 }

 @Test public void api30AndLaterKeepAllFilesAccess(){
  assumeTrue("API 30+",Build.VERSION.SDK_INT>=Build.VERSION_CODES.R);
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  assertFalse(StorageCatalog.legacy());
  assertEquals(Environment.isExternalStorageManager()?"granted":"denied",StorageCatalog.access());
  assertEquals(StorageCatalog.access(),StorageCatalog.access(context));
  assertNotEquals("WRITE_EXTERNAL_STORAGE is never granted above API 29",PackageManager.PERMISSION_GRANTED,context.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE));
 }
}
