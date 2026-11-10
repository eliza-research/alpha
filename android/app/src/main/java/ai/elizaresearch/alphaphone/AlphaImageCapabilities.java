package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.messages.ImageCapability;
import android.content.Context;

/**
 * Alpha's inputs to the shared image admission (plugin-native-messages ImageCapability): its build
 * flags and the installed provisioning resource the Alpha image overlay sets. The decision itself is
 * shared; a provisioning capability, never an inference from HOME role or launcher flavor.
 */
final class AlphaImageCapabilities {
 private AlphaImageCapabilities(){}
 static final ImageCapability IMAGE=new ImageCapability(BuildConfig.IS_LAUNCHER,BuildConfig.DEBUG,
  BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS,R.bool.alpha_aosp_image_capability);
 /** A provisioned release launcher installed from a system partition (no image feature read). */
 static boolean aospImage(Context context){return IMAGE.provisioned(context);}
 // Provisioning is necessary but not sufficient: Telecom/SMS roles remain unavailable.
 static boolean roleEnabled(String role){return "home".equals(role)||"assistant".equals(role);}
 static boolean defaultAppEnabled(Context context,String role){return "dial".equals(role)&&aospImage(context);}
}
