package ai.elizaresearch.alphaphone;

import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import org.junit.Test;
import static org.junit.Assert.*;

/** Calls already queued on Capacitor must settle after their Activity closes. */
public final class HostedResultsLifecycleInstrumentedTest {
 private static final class Call extends PluginCall {
  int rejected;
  Call(){super(null,"AlphaHostedResults","closed-fixture","test",new JSObject());}
  @Override public void reject(String message){assertEquals("Result bridge closed; reopen the app to continue.",message);rejected++;}
  @Override public void resolve(){fail("Closed bridge cannot report success");}
  @Override public void resolve(JSObject value){resolve();}
 }
 @Test public void queuedCallsAfterDestroyRejectWithoutStartingWork(){
  AlphaHostedResultsPlugin plugin=new AlphaHostedResultsPlugin();plugin.handleOnDestroy();
  Call[] calls=new Call[7];for(int i=0;i<calls.length;i++)calls[i]=new Call();
  plugin.beginBackground(calls[0]);plugin.configureBackground(calls[1]);plugin.syncInbox(calls[2]);plugin.inboxHistory(calls[3]);plugin.publishResult(calls[4]);plugin.pendingResult(calls[5]);plugin.consumeResult(calls[6]);
  for(Call call:calls)assertEquals("Each stale call settles exactly once",1,call.rejected);
 }
}
