package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.messages.MmsWapPushReceiver;
import ai.eliza.plugins.messages.SmsRoleConfiguration;

/** SMS role on the Alpha AOSP image (shared MmsWapPushReceiver). MMS notifications: one download per new transaction. Enabled only on the verified image. */
public final class AlphaMmsWapPushReceiver extends MmsWapPushReceiver {
 @Override protected SmsRoleConfiguration configuration() { return AlphaSmsRole.CONFIGURATION; }
}
