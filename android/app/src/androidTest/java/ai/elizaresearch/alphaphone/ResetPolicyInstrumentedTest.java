package ai.elizaresearch.alphaphone;

import android.content.Context;
import android.content.ContextWrapper;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.Until;
import java.io.File;
import java.util.UUID;
import org.junit.Test;
import static org.junit.Assert.*;

/** Non-destructive installed boundary checks. Real self-clear needs an external disposable runner. */
public final class ResetPolicyInstrumentedTest {
 @Test public void cancelledNativeReviewLeavesDataAndOffersNoMigrationPlugins()throws Exception {
  org.junit.Assume.assumeFalse(BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  assertFalse("No real reset pending before fixture",AlphaDataReset.RESET.pending(context));
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();
   String before=WebViewTestDriver.evaluate("localStorage.getItem('alpha.connection.selection.v1')");
   WebViewTestDriver.evaluate("window.__resetResult=null;Capacitor.Plugins.AlphaReset.review().then(v=>window.__resetResult=v)");
   UiDevice device=UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
   assertTrue("Native disclosure visible",device.wait(Until.hasObject(By.text("Reset Alpha data?")),10000));
   assertTrue("No backup or undo is disclosed",device.hasObject(By.textContains("There is no backup or undo")));
   device.findObject(By.text("Cancel")).click();
   long end=android.os.SystemClock.elapsedRealtime()+10000;
   while(android.os.SystemClock.elapsedRealtime()<end&&!"\"cancelled\"".equals(WebViewTestDriver.evaluate("window.__resetResult?.status")))android.os.SystemClock.sleep(50);
   assertEquals("\"cancelled\"",WebViewTestDriver.evaluate("window.__resetResult?.status"));
   assertEquals(before,WebViewTestDriver.evaluate("localStorage.getItem('alpha.connection.selection.v1')"));
   assertFalse("Cancel cannot persist reset authority",AlphaDataReset.RESET.pending(context));
   assertEquals("false",WebViewTestDriver.evaluate("Capacitor.isPluginAvailable('ElizaPasswordTransfer')"));
   WebViewTestDriver.evaluate("window.__migration=null;Promise.all([Capacitor.Plugins.AlphaNoteDocuments.importText(),Capacitor.Plugins.AlphaNoteDocuments.exportText({text:'fixture'})]).then(v=>window.__migration=v.map(x=>x.status))");
   end=android.os.SystemClock.elapsedRealtime()+10000;String statuses="null";
   while(android.os.SystemClock.elapsedRealtime()<end){statuses=WebViewTestDriver.evaluate("window.__migration");if(!"null".equals(statuses))break;android.os.SystemClock.sleep(50);}
   assertEquals("[\"unsupported\",\"unsupported\"]",statuses);
  }
 }
 @Test public void durableMarkerSurvivesReopenOnlyInsideIsolatedFixtureDirectory()throws Exception {
  Context real=InstrumentationRegistry.getInstrumentation().getTargetContext();
  File directory=new File(real.getCacheDir(),"reset-marker-fixture-"+UUID.randomUUID());assertTrue(directory.mkdirs());
  Context fixture=new ContextWrapper(real){@Override public Context createDeviceProtectedStorageContext(){return this;}@Override public File getNoBackupFilesDir(){return directory;}};
  try{
   assertFalse(AlphaDataReset.RESET.pending(fixture));AlphaDataReset.RESET.record(fixture);assertTrue(AlphaDataReset.RESET.pending(fixture));
   Context reopened=new ContextWrapper(real){@Override public Context createDeviceProtectedStorageContext(){return this;}@Override public File getNoBackupFilesDir(){return directory;}};
   assertTrue(AlphaDataReset.RESET.pending(reopened));assertFalse("Real application startup remains unaffected",AlphaDataReset.RESET.pending(real));
  }finally{for(File file:directory.listFiles())assertTrue(file.delete());assertTrue(directory.delete());}
 }
}
