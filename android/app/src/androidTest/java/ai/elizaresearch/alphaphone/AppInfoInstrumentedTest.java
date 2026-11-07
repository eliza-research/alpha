package ai.elizaresearch.alphaphone;

import android.content.Intent;
import android.content.pm.ResolveInfo;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.view.accessibility.AccessibilityNodeInfo;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.json.JSONObject;
import org.json.JSONTokener;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/**
 * App info from the Apps drawer's long-press menu (AlphaSystemPlugin.openAppInfo) on a device:
 * it opens Settings' App details for exactly the named package, and refuses a removed app, an
 * unknown profile, Alpha itself and malformed input. Nothing about the app changes.
 */
@RunWith(AndroidJUnit4.class)
public class AppInfoInstrumentedTest {
 private static final String SETTINGS="com.android.settings";
 private static JSONObject call(String input)throws Exception{
  WebViewTestDriver.evaluate("window.__appInfo=null;Capacitor.Plugins.ElizaSystem.openAppInfo("+input+").then(()=>window.__appInfo=JSON.stringify({ok:true})).catch(e=>window.__appInfo=JSON.stringify({error:String(e&&e.message||e),code:e&&e.code||null}))");
  for(int i=0;i<100;i++){String raw=WebViewTestDriver.evaluate("window.__appInfo");if(!"null".equals(raw))return new JSONObject((String)new JSONTokener(raw).nextValue());SystemClock.sleep(100);}
  throw new AssertionError("openAppInfo did not answer");
 }
 private static String shell(String command)throws Exception{
  ParcelFileDescriptor out=InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand(command);
  try(FileInputStream in=new ParcelFileDescriptor.AutoCloseInputStream(out)){return new String(in.readAllBytes(),StandardCharsets.UTF_8);}
 }
 private static String foregroundPackage(){AccessibilityNodeInfo root=InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();return root==null?"":String.valueOf(root.getPackageName());}

 @Test public void opensAppDetailsForTheNamedPackageAndRefusesWhatIsNotThere()throws Exception{
  android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  List<ResolveInfo> launchers=context.getPackageManager().queryIntentActivities(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setPackage(SETTINGS),0);
  assertFalse("Settings has a launcher entry on this device",launchers.isEmpty());
  String activity=launchers.get(0).activityInfo.name;
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   for(int i=0;i<100&&!"true".equals(WebViewTestDriver.evaluate("Boolean(window.Capacitor?.Plugins?.ElizaSystem)"));i++)SystemClock.sleep(100);
   // Refusals first, while Alpha is in front.
   assertEquals("not-installed",call("{packageName:'org.example.absent',activityName:'org.example.absent.Main'}").optString("code"));
   assertEquals("profile-unavailable",call("{packageName:"+JSONObject.quote(SETTINGS)+",activityName:"+JSONObject.quote(activity)+",user:'987654321'}").optString("code"));
   assertEquals("Choose an installed app",call("{packageName:"+JSONObject.quote(SETTINGS)+",activityName:5}").optString("error"));
   assertEquals("Choose an installed app",call("{packageName:"+JSONObject.quote(context.getPackageName())+"}").optString("error"));
   assertEquals("Choose an installed app",call("{packageName:"+JSONObject.quote(SETTINGS)+",user:'not-a-serial'}").optString("error"));
   // The current user's entry: Settings' App details for exactly that package.
   assertTrue(call("{packageName:"+JSONObject.quote(SETTINGS)+",activityName:"+JSONObject.quote(activity)+"}").optBoolean("ok"));
   long end=SystemClock.elapsedRealtime()+10_000;
   while(!SETTINGS.equals(foregroundPackage())&&SystemClock.elapsedRealtime()<end)SystemClock.sleep(200);
   assertEquals("Settings is in front",SETTINGS,foregroundPackage());
   String activities=shell("dumpsys activity activities");
   assertTrue("App details for the named package: "+activities.substring(0,Math.min(2000,activities.length())),activities.contains("android.settings.APPLICATION_DETAILS_SETTINGS")&&activities.contains("package:"+SETTINGS));
   InstrumentationRegistry.getInstrumentation().getUiAutomation().performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK);
  }
 }
}
