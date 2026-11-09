package ai.alphacompute.alphaphone;

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

/**
 * Opt-in native cancellation acquisition; this is not audible-stop evidence. Cancellation goes
 * through engine.cancel() alone (the supplier stays false) after the first streamed chunk proves
 * native synthesis is running, and must return well before an uncancelled run of the same text.
 */
public final class SpeechSentenceCancellationInstrumentedTest {
 static final String TEXT="The morning is bright. The garden is green. The evening is quiet.";
 @Test public void nativeCancellationAndRecovery()throws Exception{
  org.junit.Assume.assumeTrue("Explicit real-model campaign required","1".equals(InstrumentationRegistry.getArguments().getString("speechSentenceCancellation")));
  ExecutorService worker=Executors.newSingleThreadExecutor();SessionSpeech engine=new SessionSpeech(VoiceAssets.install(InstrumentationRegistry.getInstrumentation().getTargetContext()).openInference(),true);
  try{
   assertTrue("Streaming speech required to observe native entry",engine.supportsStreaming());
   // Uncancelled baseline: the native time left after the first chunk is what cancellation must cut short.
   AtomicLong firstChunkAt=new AtomicLong();long baselineStart=SystemClock.elapsedRealtime();
   worker.submit(()->{engine.synthesizeStream(TEXT,()->false,(samples,complete)->{firstChunkAt.compareAndSet(0,SystemClock.elapsedRealtime());Arrays.fill(samples,0);return true;});return null;}).get(240,TimeUnit.SECONDS);
   long baselineEnd=SystemClock.elapsedRealtime(),remainingMs=baselineEnd-firstChunkAt.get();
   assertTrue("Uncancelled synthesis leaves too little after its first chunk ("+remainingMs+" ms); retry with longer text",remainingMs>=1000);
   CountDownLatch entered=new CountDownLatch(1);
   Future<Void> pending=worker.submit(()->{engine.synthesizeStream(TEXT,()->false,(samples,complete)->{entered.countDown();Arrays.fill(samples,0);return true;});return null;});
   assertTrue(entered.await(120,TimeUnit.SECONDS));long cancelAt=SystemClock.elapsedRealtime();engine.cancel();
   // Reissue cancellation until the worker observes it; a call may still be entering native code.
   while(!pending.isDone()&&SystemClock.elapsedRealtime()-cancelAt<120000){engine.cancel();Thread.sleep(10);}
   try{pending.get(1,TimeUnit.SECONDS);fail("Campaign did not interrupt synthesis before completion; retry with longer text");}
   catch(ExecutionException expected){assertTrue(String.valueOf(expected.getCause()),expected.getCause() instanceof CancellationException);}
   long cancelToReturnMs=SystemClock.elapsedRealtime()-cancelAt;
   Bundle timing=new Bundle();timing.putLong("nativeCancelToReturnMs",cancelToReturnMs);timing.putLong("uncancelledAfterFirstChunkMs",remainingMs);timing.putLong("uncancelledTotalMs",baselineEnd-baselineStart);timing.putBoolean("physicalAudibleStopMeasured",false);InstrumentationRegistry.getInstrumentation().sendStatus(0,timing);
   // A no-op native cancel still ends in CancellationException after the full run; only the time shows it.
   assertTrue("Native cancel took "+cancelToReturnMs+" ms against "+remainingMs+" ms of uncancelled synthesis",cancelToReturnMs<remainingMs/2);
   LocalSpeechEngine.Audio recovered=worker.submit(()->engine.synthesize("The morning is bright.")).get(120,TimeUnit.SECONDS);assertTrue(recovered.samples.length>0);Arrays.fill(recovered.samples,0);
  }finally{engine.cancel();worker.shutdown();if(worker.awaitTermination(120,TimeUnit.SECONDS))engine.close();else throw new AssertionError("Native worker did not drain; handles retained to avoid concurrent free");}
 }
}
