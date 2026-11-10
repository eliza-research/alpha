package ai.elizaresearch.alphaphone;

import android.app.Instrumentation;
import android.content.Intent;
import android.net.Uri;
import android.os.SystemClock;
import android.view.KeyEvent;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

/** Observes the real outgoing intent without blocking or substituting Android's chooser. */
final class ShareFlowAssertions {
 interface Action { void run() throws Exception; }
 static void opensExactItemAndCancels(Action action, byte[] expected, String mime) throws Exception {
  Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();
  AtomicReference<Intent> outgoing=new AtomicReference<>();
  Instrumentation.ActivityMonitor monitor=new Instrumentation.ActivityMonitor(){
   @Override public Instrumentation.ActivityResult onStartActivity(Intent intent){
    if(Intent.ACTION_CHOOSER.equals(intent.getAction()))outgoing.set(new Intent(intent));
    return null;
   }
  };
  instrumentation.addMonitor(monitor);
  try {
   action.run();
   long deadline=SystemClock.elapsedRealtime()+15000;
   while(outgoing.get()==null&&SystemClock.elapsedRealtime()<deadline)SystemClock.sleep(100);
   assertNotNull("Actual Android chooser was launched",outgoing.get());
   Intent send=outgoing.get().getParcelableExtra(Intent.EXTRA_INTENT);
   assertNotNull(send);assertEquals(Intent.ACTION_SEND,send.getAction());assertEquals(mime,send.getType());
   Uri uri=send.getParcelableExtra(Intent.EXTRA_STREAM);assertNotNull(uri);assertEquals("content",uri.getScheme());
   assertTrue("Recipient gets read access",(send.getFlags()&Intent.FLAG_GRANT_READ_URI_PERMISSION)!=0);
   assertEquals("Recipient never gets write access",0,send.getFlags()&Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
   assertNotNull(send.getClipData());assertEquals(1,send.getClipData().getItemCount());assertEquals(uri,send.getClipData().getItemAt(0).getUri());
   try(java.io.InputStream input=instrumentation.getTargetContext().getContentResolver().openInputStream(uri)){
    assertNotNull(input);assertArrayEquals("Share original item bytes, not preview or another selection",expected,input.readAllBytes());
   }
   boolean visible=false;
   while(SystemClock.elapsedRealtime()<deadline){
    try(android.os.ParcelFileDescriptor fd=instrumentation.getUiAutomation().executeShellCommand("dumpsys activity activities");java.io.FileInputStream input=new java.io.FileInputStream(fd.getFileDescriptor())){
     String state=new String(input.readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);
     visible=state.lines().anyMatch(line->line.contains("topResumedActivity")&&line.contains("ChooserActivity"));
    }
    if(visible)break;SystemClock.sleep(100);
   }
   assertTrue("System share sheet is actually foreground",visible);
   instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
   awaitMainForeground();
  } finally { instrumentation.removeMonitor(monitor); }
 }
 private static void awaitMainForeground()throws Exception{
  long deadline=SystemClock.elapsedRealtime()+15000;
  while(SystemClock.elapsedRealtime()<deadline){
   try(android.os.ParcelFileDescriptor fd=InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand("dumpsys activity activities");java.io.FileInputStream input=new java.io.FileInputStream(fd.getFileDescriptor())){
    String state=new String(input.readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);
    if(state.lines().anyMatch(line->line.contains("topResumedActivity")&&line.contains("ai.elizaresearch.alphaphone/.MainActivity")))return;
   }
   SystemClock.sleep(100);
  }
  fail("Cancelling or returning from sharing must foreground Alpha before continuing");
 }
 private static java.util.List<android.view.accessibility.AccessibilityNodeInfo> nodes(){
  java.util.List<android.view.accessibility.AccessibilityNodeInfo> out=new java.util.ArrayList<>();
  android.view.accessibility.AccessibilityNodeInfo root=InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();
  if(root!=null)out.add(root);for(int i=0;i<out.size();i++){var node=out.get(i);for(int c=0;c<node.getChildCount();c++){var child=node.getChild(c);if(child!=null)out.add(child);}}return out;
 }
 static void receivesInSeparateApp(Action action,byte[] expected)throws Exception{
  action.run();boolean chosen=false;long deadline=SystemClock.elapsedRealtime()+15000;
  while(!chosen&&SystemClock.elapsedRealtime()<deadline){
   for(var node:nodes())if("Alpha share verification".contentEquals(node.getText()==null?"":node.getText())){
    for(int i=0;node!=null&&i<6;i++,node=node.getParent())if(node.isClickable()&&node.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK)){chosen=true;break;}
    if(chosen)break;
   }
   if(!chosen){for(var node:nodes())if(node.isScrollable())node.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_SCROLL_FORWARD);SystemClock.sleep(200);}
  }
  assertTrue("Select the test-only local recipient through Android's real chooser",chosen);
  byte[] hash=java.security.MessageDigest.getInstance("SHA-256").digest(expected);StringBuilder hex=new StringBuilder();for(byte b:hash)hex.append(String.format(java.util.Locale.ROOT,"%02x",b&255));
  String marker="SHA-256: "+hex;boolean received=false;deadline=SystemClock.elapsedRealtime()+15000;
  while(!received&&SystemClock.elapsedRealtime()<deadline){
   for(var node:nodes()){
    String text=String.valueOf(node.getText());
    if(text.contains("Read access verified")&&text.contains(marker)){
     assertFalse("Recipient must run outside the sender UID",text.contains("Receiver UID: "+android.os.Process.myUid()));received=true;break;
    }
   }
   if(!received)SystemClock.sleep(100);
  }
  assertTrue("Recipient reads exactly the original bytes through Android's URI grant",received);
  InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
  awaitMainForeground();
 }

}
