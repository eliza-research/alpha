package ai.alphacompute.alphaphone;
import android.content.*;
import android.os.SystemClock;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import static org.junit.Assert.*;
/** Notes has no product import or export through documents: both refuse and saved Notes stay unchanged. */
public final class NotesDocumentInstrumentedTest {
 private void until(String expression)throws Exception{long end=SystemClock.elapsedRealtime()+20000;while(SystemClock.elapsedRealtime()<end){if("true".equals(NotesSecureFixture.evaluate("Boolean("+expression+")")))return;SystemClock.sleep(100);}fail("Notes document flow timed out: "+expression+"; state="+NotesSecureFixture.evaluate("JSON.stringify({view:document.documentElement.dataset.activeView,storage:document.documentElement.dataset.notesStorageState,importDisabled:document.querySelector('button[aria-label=\"Import text note\"]')?.disabled,shareDisabled:document.querySelector('button[aria-label=\"Share note\"]'))?.disabled,cancellationNotice:document.body.textContent.includes('Document selection cancelled.'),observedCancellationNotice:window.__notesCancelNoticeSeen===true,observedReceipt:window.__notesReceiptSeen===true,documentHidden:document.hidden})"));}
 @Test public void productRefusesImportAndExport()throws Exception{
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();NotesSecureFixture.evaluate(AppNavigation.request("Notes"));until("window.__alphaTestNavigation?.status==='complete'");
   String before=NotesSecureFixture.evaluate("JSON.stringify(__notesEnvelope)");
   assertEquals("No product import control","false",NotesSecureFixture.evaluate("!!document.querySelector('button[aria-label=\"Import text note\"]')"));
   android.app.Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();java.util.concurrent.atomic.AtomicInteger outgoing=new java.util.concurrent.atomic.AtomicInteger();
   android.app.Instrumentation.ActivityMonitor monitor=new android.app.Instrumentation.ActivityMonitor(){@Override public android.app.Instrumentation.ActivityResult onStartActivity(Intent intent){outgoing.incrementAndGet();return new android.app.Instrumentation.ActivityResult(android.app.Activity.RESULT_CANCELED,null);}};
   instrumentation.addMonitor(monitor);
   try{
    NotesSecureFixture.evaluate("window.__notesMigrationPolicy=null;Promise.all([Capacitor.Plugins.AlphaNoteDocuments.importText(),Capacitor.Plugins.AlphaNoteDocuments.exportText({text:'synthetic refused text'})]).then(v=>window.__notesMigrationPolicy=v.map(x=>x.status))");
    until("window.__notesMigrationPolicy!==null");assertEquals("[\"unsupported\",\"unsupported\"]",NotesSecureFixture.evaluate("window.__notesMigrationPolicy"));assertEquals("No document activity launched",0,outgoing.get());
    assertEquals("Saved Notes unchanged",before,NotesSecureFixture.evaluate("JSON.stringify(__notesEnvelope)"));
   }finally{instrumentation.removeMonitor(monitor);}
  }
 }

}
