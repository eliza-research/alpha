package ai.elizaresearch.alphaphone;
import android.content.*;
import androidx.core.content.FileProvider;
import androidx.test.platform.app.InstrumentationRegistry;
import android.app.UiAutomation;
import android.os.SystemClock;
import android.view.accessibility.AccessibilityNodeInfo;
import androidx.lifecycle.Lifecycle;
import java.io.*;
import java.nio.file.Files;
import java.util.UUID;
import org.junit.Test;
import static org.junit.Assert.*;
public final class PdfViewerInstrumentedTest {
 private final UiAutomation ui=InstrumentationRegistry.getInstrumentation().getUiAutomation();
 private AccessibilityNodeInfo find(AccessibilityNodeInfo node,String text,boolean description,int[] count){
  if(node==null)return null;
  try{
   assertTrue("Bounded PDF accessibility hierarchy",++count[0]<=1000);
   CharSequence value=description?node.getContentDescription():node.getText();
   if(node.isVisibleToUser()&&value!=null&&value.toString().contains(text))return AccessibilityNodeInfo.obtain(node);
   for(int i=0;i<node.getChildCount();i++){AccessibilityNodeInfo found=find(node.getChild(i),text,description,count);if(found!=null)return found;}
   return null;
  }finally{node.recycle();}
 }
 private AccessibilityNodeInfo find(String text,boolean description){return find(ui.getRootInActiveWindow(),text,description,new int[]{0});}
 private void awaitText(String text,boolean description,long timeout){
  long end=SystemClock.elapsedRealtime()+timeout;
  do{AccessibilityNodeInfo node=find(text,description);if(node!=null){node.recycle();return;}SystemClock.sleep(100);}while(SystemClock.elapsedRealtime()<end);
  fail("PDF accessibility text missing: "+text);
 }
 private void page(int number){awaitText("Page "+number+" of 2",false,15000);awaitText("PDF page "+number+" of 2",true,15000);}
 private void click(String text){
  long end=SystemClock.elapsedRealtime()+15000;
  do{AccessibilityNodeInfo node=find(text,false);if(node!=null)try{if(node.isEnabled()&&node.isClickable()&&node.performAction(AccessibilityNodeInfo.ACTION_CLICK))return;}finally{node.recycle();}SystemClock.sleep(100);}while(SystemClock.elapsedRealtime()<end);
  fail("PDF control could not be clicked: "+text);
 }

 @Test public void pagesAndRecreationUseIsolatedViewer()throws Exception{
  org.junit.Assume.assumeTrue("Explicit isolated PDF UI campaign","1".equals(InstrumentationRegistry.getArguments().getString("isolatedPdfNative")));
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();File folder=new File(context.getCacheDir(),"mail-attachments");assertTrue(folder.isDirectory()||folder.mkdirs());File file=new File(folder,"pdf-ui-"+UUID.randomUUID()+".pdf");
  try{
   try(InputStream input=InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("inbox-fixtures/two-page.pdf")){Files.write(file.toPath(),input.readAllBytes());}
   Intent intent=new Intent(context,AlphaMailPdfActivity.class).setData(FileProvider.getUriForFile(context,context.getPackageName()+".mailattachments",file));
   try(BoundedActivityScenario<AlphaMailPdfActivity> scenario=BoundedActivityScenario.launch(intent)){
    page(1);click("Next page");page(2);scenario.recreate();page(2);click("Previous page");page(1);click("Close PDF");
    long closedBy=SystemClock.elapsedRealtime()+5000;
    while(scenario.getState()!=Lifecycle.State.DESTROYED&&SystemClock.elapsedRealtime()<closedBy)SystemClock.sleep(100);
    assertEquals("Close PDF destroys its Activity",Lifecycle.State.DESTROYED,scenario.getState());
    AccessibilityNodeInfo remaining=find("Close PDF",false);try{assertNull("Closed PDF control is gone",remaining);}finally{if(remaining!=null)remaining.recycle();}
   }
  }finally{assertTrue(!file.exists()||file.delete());}
 }
}
