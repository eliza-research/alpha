package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.messages.MmsResultReceiver;
import ai.eliza.plugins.messages.SmsRoleConfiguration;

/** SMS role on the Alpha AOSP image (shared MmsResultReceiver). MMS download and response results (explicit intents only). Enabled only on the verified image. */
public final class AlphaMmsResultReceiver extends MmsResultReceiver {
 @Override protected SmsRoleConfiguration configuration() { return AlphaSmsRole.CONFIGURATION; }
}
