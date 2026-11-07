package ai.elizaresearch.alphaphone;

import android.app.ComponentCaller;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import androidx.annotation.RequiresApi;

/** User-invoked assistant surface. Never consumes caller text, URI, or assist context. */
public class AlphaAssistActivity extends MainActivity {
 /** Only the signature-permission-protected explicit child can request a warm Power origin. */
 protected boolean isProtectedPowerEntry() { return false; }
 @Override protected boolean isAssistantSurface() { return true; }
 private String newIntentCaller;
 /** This launch's origin until the renderer takes it; see {@link #takeInvocation}. */
 /** Window event the renderer listens for: a new invocation reached the already open surface. */
 static final String INVOCATION_EVENT = "alpha:assist-invocation";
 @Override public void onCreate(Bundle state) {
  // A recreated activity (configuration change, process restore) is not a new invocation: the
  // launching package Android reports is still the original one, so it is ignored.
  setIntent(cleanIntent(state == null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE ? getLaunchedFromPackage() : null, false));
  super.onCreate(state);
 }
 /** Android 15+ reports who sent each new intent to this single-task surface. */
 @RequiresApi(Build.VERSION_CODES.VANILLA_ICE_CREAM)
 @Override public void onNewIntent(Intent intent, ComponentCaller caller) {
  newIntentCaller = caller == null ? null : caller.getPackage();
  super.onNewIntent(intent, caller);
 }
 @Override public void onNewIntent(Intent ignored) {
  Intent clean = cleanIntent(newIntentCaller, true);
  newIntentCaller = null;
  setIntent(clean);
  super.onNewIntent(clean);
  // The surface may already be in front (no visibility change): tell the renderer to read it now.
  if (getBridge() != null) getBridge().triggerWindowJSEvent(INVOCATION_EVENT);
 }
 /** The only extra: a product-set launch flag the renderer may read. Caller extras are dropped. */
 static final String EXTRA_ASSISTANT = "alpha.assistant";
 /**
  * Legacy Agent read: no owner-bound session accompanies this method, so it is a navigation
  * hint only. ElizaSense owns authenticated, one-shot wake consumption.
  */
 synchronized String takeInvocation() {
  // Legacy Agent callers lack an owner-bound session; only the shared ElizaSense bridge
  // can consume a wake as microphone authority. Keep this old method as a UI-only hint.
  return "assist";
 }
 /**
  * The caller package is known only when the caller shared its identity (the listener does). The
  * origin comes from Android-reported caller identity only, never from caller extras.
  */
 private Intent cleanIntent(String caller, boolean warmIntent) {
  ai.eliza.plugins.system.SenseListenerClient sense = new ai.eliza.plugins.system.SenseListenerClient(this);
  // A new/recreated Power activity creates a new renderer bridge. It cannot borrow another
  // activity's owner/session or queue an invocation for a later bind. Only the same already
  // bound protected activity may offer a fresh Power invocation to shared ElizaSense.
  if (isProtectedPowerEntry() && warmIntent && getBridge() != null) {
   // A stale Activity may no longer own the current package lease. A rejected
   // offer must leave another Activity's listener/Power receipt untouched.
   sense.recordProtectedPower();
  } else {
   sense.recordInvocation(isProtectedPowerEntry() ? null : caller);
  }
  return new Intent(this, getClass()).setAction(Intent.ACTION_ASSIST).putExtra(EXTRA_ASSISTANT, true);
 }
}
