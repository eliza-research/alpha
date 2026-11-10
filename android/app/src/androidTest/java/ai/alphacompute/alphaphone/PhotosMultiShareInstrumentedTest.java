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
public class PhotosMultiShareInstrumentedTest {
 private String js(String script)throws Exception{return WebViewTestDriver.evaluate(script);}
 private void until(String script)throws Exception{for(int i=0;i<150;i++){if("true".equals(js("Boolean("+script+")")))return;SystemClock.sleep(100);}fail("Photos multi-share condition: "+script);}
 private void click(String label)throws Exception{String node="document.querySelector('button[aria-label='+"+JSONObject.quote(JSONObject.quote(label))+"+']')";until(node+" && getComputedStyle("+node+").pointerEvents!==\"none\"");js(node+".click()");}
 private void mainForeground()throws Exception{for(int i=0;i<100;i++){java.util.concurrent.atomic.AtomicBoolean focused=new java.util.concurrent.atomic.AtomicBoolean();WebViewTestDriver.withActivity(MainActivity.class,a->focused.set(a.hasWindowFocus()));if(focused.get())return;SystemClock.sleep(100);}fail("System chooser returned to the real main Activity");}
 private void chooserForeground()throws Exception{
  // ActivityMonitor observes dispatch before the chooser owns focus. Back at
  // that point can reach the launcher Activity instead of cancelling sharing.
  android.app.UiAutomation ui=InstrumentationRegistry.getInstrumentation().getUiAutomation();
  for(int attempt=0;attempt<150;attempt++){
   AccessibilityNodeInfo root=ui.getRootInActiveWindow();
   if(root!=null&&"com.android.intentresolver".contentEquals(root.getPackageName()))return;
   SystemClock.sleep(100);
  }
  fail("System chooser acquired input focus before cancellation");
 }
 private List<AccessibilityNodeInfo> nodes(){List<AccessibilityNodeInfo> out=new ArrayList<>();AccessibilityNodeInfo root=InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();if(root!=null)out.add(root);for(int i=0;i<out.size();i++){AccessibilityNodeInfo node=out.get(i);for(int j=0;j<node.getChildCount();j++){AccessibilityNodeInfo child=node.getChild(j);if(child!=null)out.add(child);}}return out;}
 private boolean press(AccessibilityNodeInfo node){for(int i=0;node!=null&&i<6;i++,node=node.getParent())if(node.isClickable()&&node.performAction(AccessibilityNodeInfo.ACTION_CLICK))return true;return false;}
 @Test public void longPressSharesOnlyTwoExactOwnedItemsAndCancellationKeepsOriginals()throws Exception{
  Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();Context context=instrumentation.getTargetContext();ContentResolver resolver=context.getContentResolver();List<Uri> fixtures=new ArrayList<>();AtomicReference<Intent> chooser=new AtomicReference<>();
  Instrumentation.ActivityMonitor monitor=new Instrumentation.ActivityMonitor(){@Override public Instrumentation.ActivityResult onStartActivity(Intent intent){if(Intent.ACTION_CHOOSER.equals(intent.getAction()))chooser.set(new Intent(intent));return null;}};
  boolean monitorAdded=false;Throwable primary=null;
  try{for(int color:new int[]{0xffdd3333,0xff33bb66,0xff2233cc})fixtures.add(fixture(resolver,"alpha-multishare-",color));byte[] first=bytes(resolver,fixtures.get(0)),second=bytes(resolver,fixtures.get(1)),neighbor=bytes(resolver,fixtures.get(2));
   try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
    AppNavigation.liveMode();js(AppNavigation.request("Photos"));until(AppNavigation.selected("Photos"));AppNavigation.declineStartupAccess();touch(fixtures.get(0),600);until("document.querySelector('button[aria-label=\"Cancel selection\"]')");touch(fixtures.get(1),0);
    instrumentation.addMonitor(monitor);monitorAdded=true;click("Share selected");for(int i=0;i<150&&chooser.get()==null;i++)SystemClock.sleep(100);assertNotNull("Real chooser opened",chooser.get());Intent send=chooser.get().getParcelableExtra(Intent.EXTRA_INTENT);assertEquals(Intent.ACTION_SEND_MULTIPLE,send.getAction());assertEquals("image/jpeg",send.getType());ArrayList<Uri> sent=send.getParcelableArrayListExtra(Intent.EXTRA_STREAM);assertEquals(new HashSet<>(fixtures.subList(0,2)),new HashSet<>(sent));assertEquals(2,sent.size());assertEquals(2,send.getClipData().getItemCount());assertTrue((send.getFlags()&Intent.FLAG_GRANT_READ_URI_PERMISSION)!=0);assertEquals(0,send.getFlags()&Intent.FLAG_GRANT_WRITE_URI_PERMISSION);for(int i=0;i<2;i++)assertEquals(sent.get(i),send.getClipData().getItemAt(i).getUri());
    chooserForeground();WebViewTestDriver.pressBack();mainForeground();until("document.querySelector('button[aria-label=\"Share selected\"]')");assertArrayEquals(first,bytes(resolver,fixtures.get(0)));assertArrayEquals(second,bytes(resolver,fixtures.get(1)));assertArrayEquals(neighbor,bytes(resolver,fixtures.get(2)));
    chooser.set(null);click("Share selected");boolean picked=false;for(int i=0;i<100&&!picked;i++){for(AccessibilityNodeInfo node:nodes())if("Alpha share verification".equals(String.valueOf(node.getText()))&&press(node)){picked=true;break;}if(!picked)SystemClock.sleep(150);}assertTrue("Actual cross-UID recipient chosen",picked);
    String h1=hash(first),h2=hash(second),h3=hash(neighbor);boolean received=false;for(int i=0;i<100&&!received;i++){for(AccessibilityNodeInfo node:nodes()){String text=String.valueOf(node.getText());if(text.contains("Read access verified")&&text.contains("Item count: 2")&&text.contains(h1)&&text.contains(h2)){assertFalse(text.contains(h3));assertFalse(text.contains("Receiver UID: "+android.os.Process.myUid()));received=true;break;}}if(!received)SystemClock.sleep(100);}assertTrue("Recipient reads exactly the selected originals, no neighbor",received);WebViewTestDriver.pressBack();mainForeground();
    until("document.querySelector('button[aria-label=\"Share selected\"]')");chooser.set(null);ContentValues changed=new ContentValues();changed.put("is_favorite",1);assertEquals(1,resolver.update(fixtures.get(1),changed,null,null));click("Share selected");until("document.body.innerText.includes('A selected item changed or is unavailable')");assertNull("Stale selection never opens a partial share",chooser.get());click("Cancel selection");assertArrayEquals(first,bytes(resolver,fixtures.get(0)));assertArrayEquals(second,bytes(resolver,fixtures.get(1)));assertArrayEquals(neighbor,bytes(resolver,fixtures.get(2)));
   }
  }catch(Exception|AssertionError failure){primary=failure;throw failure;}
  finally{
   if(monitorAdded)instrumentation.removeMonitor(monitor);
   AssertionError cleanup=null;for(Uri uri:fixtures)try{assertEquals("Delete only this exact synthetic fixture",1,resolver.delete(uri,null,null));}catch(Exception|AssertionError failure){if(cleanup==null)cleanup=new AssertionError("Photo multi-share fixture cleanup failed");cleanup.addSuppressed(failure);}if(cleanup!=null){if(primary!=null)primary.addSuppressed(cleanup);else throw cleanup;}
  }
 }
}
