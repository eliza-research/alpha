package ai.alphacompute.alphaphone;

import ai.eliza.plugins.messages.vvm.VisualVoicemailClientService;
import ai.eliza.plugins.messages.vvm.VvmConfiguration;

/**
 * Alpha's carrier visual-voicemail source on the Alpha AOSP image (AP-08). Android binds this service
 * only for the default dialer; the shared client activates the carrier's service, syncs voicemail
 * over IMAP into Android's voicemail store and keeps its status row truthful. Declared disabled in
 * the launcher manifest; {@link AlphaTelephonyRoles} enables it only on the verified image.
 */
public final class AlphaVoicemailService extends VisualVoicemailClientService {
 static final VvmConfiguration CONFIGURATION = new VvmConfiguration(AlphaVoicemailReceiver.class);
 @Override protected VvmConfiguration configuration() { return CONFIGURATION; }
}
