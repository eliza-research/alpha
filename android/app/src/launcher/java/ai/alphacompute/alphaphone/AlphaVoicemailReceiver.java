package ai.alphacompute.alphaphone;

import ai.eliza.plugins.messages.vvm.VisualVoicemailReceiver;
import ai.eliza.plugins.messages.vvm.VvmConfiguration;

/**
 * Fetch and sync requests for Alpha's own voicemail rows, and the result of the activation SMS.
 * Not exported; declared disabled and enabled with {@link AlphaVoicemailService} on the verified image only.
 */
public final class AlphaVoicemailReceiver extends VisualVoicemailReceiver {
 @Override protected VvmConfiguration configuration() { return AlphaVoicemailService.CONFIGURATION; }
}
