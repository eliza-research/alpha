package ai.alphacompute.thinapp;

import ai.eliza.plugins.phone.TelecomCallConfiguration;
import ai.eliza.plugins.phone.TelecomCallService;

/** Standalone {@code ROLE_DIALER} {@link TelecomCallService} for {@code ai.alphacompute.phone}. */
public final class ThinInCallService extends TelecomCallService {
    @Override protected TelecomCallConfiguration configuration() {
        return ThinTelephonyConfig.CALL_CONFIG;
    }
}
