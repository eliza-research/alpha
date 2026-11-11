package ai.alphacompute.alphaphone;

import android.content.ComponentName;
import android.content.Context;
import android.content.pm.PackageManager;

/**
 * The dialer- and SMS-role components (and the MMS file provider) exist in the launcher manifest
 * disabled. They are enabled only while
 * {@link AlphaImageCapability} verifies the Alpha AOSP image, so a sideloaded launcher APK can never
 * be offered the dialer role, and an install that stops verifying (for example an image update that
 * drops the overlay) disables them again. Fresh image setup assigns the initial roles through
 * Android. Later changes stay under Android's owner-controlled role policy.
 */
final class AlphaTelephonyRoles {
 private AlphaTelephonyRoles() {}
 static final Class<?>[] DIALER = { AlphaInCallService.class, AlphaCallActivity.class, AlphaDialPadActivity.class };
 static final Class<?>[] SMS = { AlphaSmsDeliverReceiver.class, AlphaMmsWapPushReceiver.class, AlphaMmsResultReceiver.class, AlphaRespondViaMessageService.class, AlphaSmsComposeActivity.class, ai.eliza.plugins.messages.MmsFileProvider.class };
 static void sync(Context context) {
  boolean image = AlphaImageCapability.verified(context);
  int wanted = image ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED : PackageManager.COMPONENT_ENABLED_STATE_DEFAULT;
  syncComponents(context, wanted);
 }

 static boolean prepare(Context context) {
  return AlphaImageCapability.verified(context)
   && syncComponents(context, PackageManager.COMPONENT_ENABLED_STATE_ENABLED);
 }

 private static boolean syncComponents(Context context, int wanted) {
  PackageManager packages = context.getPackageManager();
  java.util.List<Class<?>> components = new java.util.ArrayList<>(java.util.Arrays.asList(DIALER));
  components.addAll(java.util.Arrays.asList(SMS));
  boolean ready = true;
  for (Class<?> component : components) {
   ComponentName name = new ComponentName(context, component);
   try {
    if (packages.getComponentEnabledSetting(name) != wanted) {
     packages.setComponentEnabledSetting(name, wanted, PackageManager.DONT_KILL_APP);
     ready &= packages.getComponentEnabledSetting(name) == wanted;
    }
   } catch (RuntimeException refused) {
    ready = false;
    android.util.Log.w("AlphaTelephonyRoles", "Role component state unchanged for " + component.getSimpleName());
   }
  }
  return ready;
 }
}
