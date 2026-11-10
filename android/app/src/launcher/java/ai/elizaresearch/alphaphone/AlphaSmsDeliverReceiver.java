package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.messages.SmsDeliverReceiver;
import ai.eliza.plugins.messages.SmsRoleConfiguration;

/** SMS role on the Alpha AOSP image (shared SmsDeliverReceiver). SMS_DELIVER: stores each incoming text, then a private notice. Enabled only on the verified image. */
public final class AlphaSmsDeliverReceiver extends SmsDeliverReceiver {
 @Override protected SmsRoleConfiguration configuration() { return AlphaSmsRole.CONFIGURATION; }
}
