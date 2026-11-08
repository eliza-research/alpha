package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.messages.RespondViaMessageService;
import ai.eliza.plugins.messages.SmsRoleConfiguration;

/** SMS role on the Alpha AOSP image (shared RespondViaMessageService). Quick replies open the compose review; nothing is sent here. Enabled only on the verified image. */
public final class AlphaRespondViaMessageService extends RespondViaMessageService {
 @Override protected SmsRoleConfiguration configuration() { return AlphaSmsRole.CONFIGURATION; }
}
