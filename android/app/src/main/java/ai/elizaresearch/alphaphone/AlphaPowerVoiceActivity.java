package ai.elizaresearch.alphaphone;

import android.os.Bundle;
import ai.eliza.plugins.system.SenseListenerClient;

/** Explicit STATUS_BAR_SERVICE-protected Power route; no caller extras or saved launch grant. */
public final class AlphaPowerVoiceActivity extends AlphaAssistActivity {
 @Override protected boolean isProtectedPowerEntry() { return true; }
 @Override public void onCreate(Bundle state) {
  // Mint before the first bridge loads, only for this fresh protected Activity. A restored
  // instance never inherits approval. Missing admission or microphone permission is surface-only.
  if(state==null){
   AlphaLocalAgentPlugin.PowerLaunchPin pin=AlphaLocalAgentPlugin.capturePowerLaunchPin(this);
   if(pin!=null)new SenseListenerClient(this).beginProtectedPowerLaunch(pin);
  }
  super.onCreate(state);
 }
 @Override public void onWindowFocusChanged(boolean focused){super.onWindowFocusChanged(focused);new SenseListenerClient(this).protectedPowerWindowFocusChanged(focused);}
 @Override public void onPause(){new SenseListenerClient(this).cancelProtectedPowerLaunch();super.onPause();}
 @Override public void onDestroy(){new SenseListenerClient(this).cancelProtectedPowerLaunch();super.onDestroy();}
}
