package ai.alphacompute.thinapp;

import ai.eliza.plugins.messages.MmsResultReceiver;
import ai.eliza.plugins.messages.SmsRoleConfiguration;

/** Standalone {@code ROLE_SMS} MMS download and read-action receiver for {@code ai.alphacompute.messages}. */
public final class ThinMmsResultReceiver extends MmsResultReceiver {
    @Override protected SmsRoleConfiguration configuration() {
        return ThinTelephonyConfig.SMS_ROLE;
    }
}
