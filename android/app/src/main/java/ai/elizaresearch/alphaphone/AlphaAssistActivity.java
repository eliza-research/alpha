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
 private Intent sanitizedIntent;
 private Intent bridgeLoadIntent;
 /** This launch's origin until the renderer takes it; see {@link #takeInvocation}. */
 /** Window event the renderer listens for: a new invocation reached the already open surface. */
 static final String INVOCATION_EVENT = "alpha:assist-invocation";
 @Override public void onCreate(Bundle state) {
  // A recreated activity (configuration change, process restore) is not a new invocation: the
  // launching package Android reports is still the original one, so it is ignored.
  sanitizedIntent = cleanIntent(state == null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE ? getLaunchedFromPackage() : null, false);
  setIntent(sanitizedIntent);
  super.onCreate(state);
 }
 @Override protected void load() {
  // Capacitor forwards getIntent() through onNewIntent during bridge load. Forward that exact
  // sanitized object without recording a second invocation with no Android caller.
  bridgeLoadIntent = getIntent() == sanitizedIntent ? sanitizedIntent : null;
  try { super.load(); }
  finally { bridgeLoadIntent = null; }
 }
 /** Android 15+ reports who sent each new intent to this single-task surface. */
 @RequiresApi(Build.VERSION_CODES.VANILLA_ICE_CREAM)
 @Override public void onNewIntent(Intent intent, ComponentCaller caller) {
  bridgeLoadIntent = null;
  newIntentCaller = caller == null ? null : caller.getPackage();
  super.onNewIntent(intent, caller);
 }
 @Override public void onNewIntent(Intent ignored) {
  Intent clean = ignored;
  if (ignored != null && ignored == bridgeLoadIntent && ignored == getIntent()) {
   bridgeLoadIntent = null;
  } else {
   clean = cleanIntent(newIntentCaller, true);
   newIntentCaller = null;
   sanitizedIntent = clean;
   setIntent(clean);
  }
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
