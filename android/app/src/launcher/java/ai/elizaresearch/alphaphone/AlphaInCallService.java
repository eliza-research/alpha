package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.phone.TelecomCallConfiguration;
import ai.eliza.plugins.phone.TelecomCallService;

/**
 * Alpha's InCallService for the dialer role on the Alpha AOSP image (#420). The call lifecycle,
 * notification and controls are the shared TelecomCallService. Declared disabled in the launcher
 * manifest; {@link AlphaTelephonyRoles} enables it only on the verified image, so Telecom can bind
 * it only once the owner has chosen Alpha as the phone app there.
 */
public final class AlphaInCallService extends TelecomCallService {
 static final TelecomCallConfiguration CONFIGURATION = new TelecomCallConfiguration("alpha-phone-calls", "Phone calls", "alphaphone-call", AlphaCallActivity.class);
 @Override protected TelecomCallConfiguration configuration() { return CONFIGURATION; }
}
