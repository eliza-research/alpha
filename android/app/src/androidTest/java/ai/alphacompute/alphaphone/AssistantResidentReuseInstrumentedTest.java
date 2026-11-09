package ai.alphacompute.alphaphone;

import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;
import androidx.lifecycle.Lifecycle;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/**
 * Dual-Activity resident reuse: opening and closing the ACTION_ASSIST surface repeatedly attaches
 * to the admitted running resident instead of starting it. The runtime observation, enrollment
 * and in-flight streams are synthetic (no packaged runtime, provider, account or inference is
 * used); the attach admission, per-surface ownership and Activity lifecycle are the production
 * code paths. This is emulator-class evidence only when run; it is not device acceptance and
 * does not prove a live runtime stream survives.
 */
@RunWith(AndroidJUnit4.class)
public class AssistantResidentReuseInstrumentedTest {
 private static final String ROOT="synthetic-root",GENERATION="synthetic-generation";
 private static JSONObject runtime(String state,boolean service,boolean socket) throws Exception {
  return new JSONObject().put("state",state).put("serviceActive",service).put("socketListening",socket);
 }
 private static AlphaLocalAgentPlugin agent(MainActivity activity) {
  return (AlphaLocalAgentPlugin) activity.getBridge().getPlugin("Agent").getInstance();
 }
 @Test public void repeatedAssistantInvocationsAttachWithoutRetiringHomeWorkOrEnrollment() throws Exception {
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  final JSONObject listening=runtime("listening",true,true),booting=runtime("booting",true,false),dead=runtime("dead",false,false);
  AtomicBoolean mainInvalidated=new AtomicBoolean();
  AtomicReference<AlphaLocalAgentPlugin> mainPlugin=new AtomicReference<>();
  try(BoundedActivityScenario<MainActivity> main=BoundedActivityScenario.launch(MainActivity.class)) {
   WebViewTestDriver.withActivity(MainActivity.class,activity->{
    AlphaLocalAgentPlugin plugin=agent(activity);mainPlugin.set(plugin);
    AlphaLocalAgentPlugin.enrollForTest(ROOT,"synthetic-owner-token","synthetic-owner",System.currentTimeMillis()+600_000);
    AlphaLocalAgentPlugin.launchedGenerationForTest(GENERATION);
    plugin.adoptStreamForTest("main-stream-000001",new ElizaAgentService.LocalStreamHandle(),()->mainInvalidated.set(true));
   });
   final long epoch=AlphaLocalAgentPlugin.lifecycleEpochForTest();
   assertEquals(1,mainPlugin.get().ownedWorkCount());
   for(int invocation=0;invocation<3;invocation++) {
    final String streamId="assist-stream-00000"+invocation;
    AtomicBoolean assistInvalidated=new AtomicBoolean();AtomicReference<String> refusal=new AtomicReference<>("not-run");
    Intent assist=new Intent(context,AlphaAssistActivity.class).setAction(Intent.ACTION_ASSIST);
    try(BoundedActivityScenario<AlphaAssistActivity> scenario=BoundedActivityScenario.launch(assist)) {
     WebViewTestDriver.withActivity(AlphaAssistActivity.class,activity->{
      AlphaLocalAgentPlugin plugin=agent(activity);
      assertNotSame("Each surface has its own plugin instance",mainPlugin.get(),plugin);
      refusal.set(String.valueOf(plugin.attachForTest(listening,ROOT,GENERATION)));
      plugin.adoptStreamForTest(streamId,new ElizaAgentService.LocalStreamHandle(),()->assistInvalidated.set(true));
     });
     assertEquals("Invocation "+invocation+" attaches to the running resident","null",refusal.get());
     assertEquals("Attach never advances the runtime epoch",epoch,AlphaLocalAgentPlugin.lifecycleEpochForTest());
     assertTrue("Attach keeps the owner enrollment",AlphaLocalAgentPlugin.enrollmentPresent());
     assertFalse("Opening the assistant does not retire Home work",mainInvalidated.get());
     assertEquals(1,mainPlugin.get().ownedWorkCount());
     WebViewTestDriver.withActivity(AlphaAssistActivity.class,android.app.Activity::finish);
     for(int i=0;i<50&&scenario.getState()!=Lifecycle.State.DESTROYED;i++)SystemClock.sleep(100);
     assertEquals(Lifecycle.State.DESTROYED,scenario.getState());
    }
    assertTrue("Closing the assistant cancels only its own stream",assistInvalidated.get());
    assertFalse("Closing the assistant does not retire Home work",mainInvalidated.get());
    assertEquals(1,mainPlugin.get().ownedWorkCount());
    assertEquals("Closing the assistant keeps the runtime epoch",epoch,AlphaLocalAgentPlugin.lifecycleEpochForTest());
    assertTrue("Closing the assistant keeps the owner enrollment",AlphaLocalAgentPlugin.enrollmentPresent());
   }
   // Anything other than the admitted running resident is refused, and a refusal changes nothing.
   AtomicReference<String> refusals=new AtomicReference<>();
   WebViewTestDriver.withActivity(MainActivity.class,activity->{
    AlphaLocalAgentPlugin plugin=agent(activity);
    refusals.set(String.join(",",
     String.valueOf(plugin.attachForTest(listening,ROOT,"other-generation")),
     String.valueOf(plugin.attachForTest(listening,"restarted-root",GENERATION)),
     String.valueOf(plugin.attachForTest(booting,ROOT,GENERATION)),
     String.valueOf(plugin.attachForTest(dead,ROOT,GENERATION)),
     String.valueOf(plugin.attachForTest(listening,ROOT,null))));
   });
   assertEquals("provider-changed,runtime-changed,runtime-not-running,runtime-not-running,provider-unadmitted",refusals.get());
   assertFalse("A refused attach leaves Home work alone",mainInvalidated.get());
   assertEquals(epoch,AlphaLocalAgentPlugin.lifecycleEpochForTest());
   assertTrue(AlphaLocalAgentPlugin.enrollmentPresent());
   // A surface that attaches again supersedes only its own earlier work.
   AtomicReference<String> again=new AtomicReference<>("not-run");
   WebViewTestDriver.withActivity(MainActivity.class,activity->again.set(String.valueOf(agent(activity).attachForTest(listening,ROOT,GENERATION))));
   assertEquals("null",again.get());
   assertTrue("Home's own earlier stream is superseded by its own attach",mainInvalidated.get());
   assertEquals(0,mainPlugin.get().ownedWorkCount());
   assertEquals(epoch,AlphaLocalAgentPlugin.lifecycleEpochForTest());
   assertTrue(AlphaLocalAgentPlugin.enrollmentPresent());
  } finally {
   AlphaLocalAgentPlugin.enrollForTest(null,null,null,0);
   AlphaLocalAgentPlugin.launchedGenerationForTest(null);
  }
 }
}
