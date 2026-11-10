package ai.elizaresearch.alphaphone;

import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;

/**
 * The one way a plugin hands work to its own worker. Capacitor can deliver a bridge call the page
 * made just before the activity was destroyed after handleOnDestroy has stopped that worker, and a
 * bounded worker can be full. Executor.execute then throws RejectedExecutionException on the bridge
 * thread, which kills the process (AlphaDevicePlugin, round 8, a326b8dd). Here the refusal runs
 * instead, so the call is answered and nothing is thrown. No Capacitor types: host-tested by javac.
 */
final class PluginWorkers {
 private PluginWorkers(){}
 /** True when the worker accepted the work; otherwise refused has run on the calling thread. */
 static boolean submit(Executor worker,Runnable work,Runnable refused){
  try{worker.execute(work);return true;}
  catch(RejectedExecutionException stopped){refused.run();return false;}
 }
}
