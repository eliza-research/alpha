package ai.elizaresearch.alphaphone;

import ai.eliza.voice.SessionSpeech;
import ai.eliza.voice.LocalSpeechEngine;
import ai.eliza.voice.VoiceAssets;
import android.os.Bundle;
import android.os.SystemClock;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.Arrays;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import org.junit.Test;
import static org.junit.Assert.*;

/** Opt-in native cancellation acquisition; this is not streaming callback or audible-stop evidence. */
public final class SpeechSentenceCancellationInstrumentedTest {
 @Test public void nativeCancellationAndRecovery()throws Exception{
  org.junit.Assume.assumeTrue("Explicit real-model campaign required","1".equals(InstrumentationRegistry.getArguments().getString("speechSentenceCancellation")));
  ExecutorService worker=Executors.newSingleThreadExecutor();SessionSpeech engine=new SessionSpeech(VoiceAssets.install(InstrumentationRegistry.getInstrumentation().getTargetContext()).openInference(),true);
  AtomicBoolean cancelled=new AtomicBoolean();CountDownLatch entered=new CountDownLatch(1);
  try{
   Future<LocalSpeechEngine.Audio> pending=worker.submit(()->{entered.countDown();return engine.synthesize("The morning is bright. The garden is green. The evening is quiet.",cancelled::get);});
   assertTrue(entered.await(120,TimeUnit.SECONDS));long cancelAt=SystemClock.elapsedRealtime();cancelled.set(true);engine.cancel();
   // Reissue cancellation until the worker observes it; a call may still be entering native code.
   while(!pending.isDone()&&SystemClock.elapsedRealtime()-cancelAt<120000){engine.cancel();Thread.sleep(10);}
   try{LocalSpeechEngine.Audio audio=pending.get(1,TimeUnit.SECONDS);Arrays.fill(audio.samples,0);fail("Campaign did not interrupt synthesis before completion; retry with longer text");}
   catch(ExecutionException expected){assertTrue(expected.getCause() instanceof CancellationException);}
   Bundle timing=new Bundle();timing.putLong("nativeCancelToReturnMs",SystemClock.elapsedRealtime()-cancelAt);timing.putBoolean("physicalAudibleStopMeasured",false);InstrumentationRegistry.getInstrumentation().sendStatus(0,timing);
   LocalSpeechEngine.Audio recovered=worker.submit(()->engine.synthesize("The morning is bright.")).get(120,TimeUnit.SECONDS);assertTrue(recovered.samples.length>0);Arrays.fill(recovered.samples,0);
  }finally{cancelled.set(true);engine.cancel();worker.shutdown();if(worker.awaitTermination(120,TimeUnit.SECONDS))engine.close();else throw new AssertionError("Native worker did not drain; handles retained to avoid concurrent free");}
 }
}
