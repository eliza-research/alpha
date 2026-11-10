package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.messages.SmsComposeActivity;
import ai.eliza.plugins.messages.SmsRoleConfiguration;

/** SMS role on the Alpha AOSP image (shared SmsComposeActivity). The compose screen is the review; only its Send press sends, journaled. Enabled only on the verified image. */
public final class AlphaSmsComposeActivity extends SmsComposeActivity {
 @Override protected SmsRoleConfiguration configuration() { return AlphaSmsRole.CONFIGURATION; }
}
