package ai.alphacompute.thinapp;

import ai.eliza.plugins.messages.MmsWapPushReceiver;
import ai.eliza.plugins.messages.SmsRoleConfiguration;

/** Standalone {@code ROLE_SMS} MMS WAP push receiver for {@code ai.alphacompute.messages}. */
public final class ThinMmsWapPushReceiver extends MmsWapPushReceiver {
    @Override protected SmsRoleConfiguration configuration() {
        return ThinTelephonyConfig.SMS_ROLE;
    }
}
