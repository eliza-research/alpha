package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.messages.ImageCapability;
import android.content.Context;

/**
 * Whether this install is Alpha Phone inside the Alpha AOSP image (owner decision P-36, issue #420).
 *
 * Phone, Contacts and SMS exist only there. The decision is the shared
 * {@link ImageCapability#admitted(Context)}: a release launcher build without the test-mocks switch
 * (scripts/stage-aosp.mjs refuses one), installed from a system partition (FLAG_SYSTEM; a sideloaded
 * or Play-style install never has it), with the Alpha product overlay's provisioning resource and the
 * image system feature {@code <package>.aosp_image} that scripts/stage-aosp.mjs writes into the image
 * product. MainActivity registers {@link AlphaTelephonyPlugin} only when this holds, and every
 * telephony method checks it again. Nothing the renderer, a URL, saved state or an agent sends can
 * turn it on.
 */
final class AlphaImageCapability {
 static final String UNAVAILABLE = "Phone, Contacts and Messages are available only on the Alpha Phone system image.";
 private AlphaImageCapability() {}

 static String featureName(String packageName) { return ImageCapability.featureName(packageName); }

 /** Read once per process by the shared capability: installation flags and system features do not change while it runs. */
 static boolean verified(Context context) { return AlphaImageCapabilities.IMAGE.admitted(context); }
}
