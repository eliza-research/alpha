package ai.elizaresearch.alphaphone;

import com.getcapacitor.PluginCall;

/**
 * Capacitor can deliver a plugin call the page made just before the activity was destroyed after
 * the activity is gone. A permission request or an activity-result request then has no launcher
 * left: androidx unregisters every launcher when the activity is destroyed and throws
 * IllegalStateException from launch(). That happens on Capacitor's bridge thread, where Capacitor
 * rethrows it and the process ends. Such a request is rejected instead.
 */
final class LateLaunch {
 /** Fixed answer. It names no cause as certain and claims nothing about work the request would have led to. */
 static final String CLOSED="Android could not show this request; Alpha may have closed. Reopen Alpha and try again.";
 private LateLaunch(){}
 /** Runs a request that launches through the activity. False, after rejecting the call, when the launcher is gone. */
 static boolean ask(PluginCall call,Runnable launch){
  try{launch.run();return true;}
  catch(IllegalStateException closed){call.reject(CLOSED);return false;}
 }
}
