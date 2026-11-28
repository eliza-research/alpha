package ai.alphacompute.alphaphone;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.UserManager;

/** The image's text Ask Alpha entry. Android owns the invoking task. */
public class AlphaAssistActivity extends Activity {
 boolean admittedCaller() { return true; }

 static boolean unlocked(Context context) {
  KeyguardManager lock = context.getSystemService(KeyguardManager.class);
  UserManager users = context.getSystemService(UserManager.class);
  return lock != null && users != null && users.isUserUnlocked() && !lock.isDeviceLocked() && !lock.isKeyguardLocked();
 }

 @Override protected void onCreate(Bundle state) {
  super.onCreate(state);
  try {
   Intent incoming = getIntent();
   if (state == null && incoming != null && Intent.ACTION_ASSIST.equals(incoming.getAction())
     && AlphaImageCapability.verified(this) && AlphaSenseAdmission.available(this) && unlocked(this) && admittedCaller()) {
    if (!ai.alphacompute.alphaphone.overlay.AlphaVoiceInteractionService.showOverlay(this, "sense", null, true)) {
     MainActivity.openTextAsk(this);
    }
   }
  } finally {
   finish();
  }
 }
}
