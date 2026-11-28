package ai.alphacompute.thinapp;

import ai.eliza.plugins.messages.SmsRoleConfiguration;
import ai.eliza.plugins.messages.SmsTelephonyConfiguration;
import ai.eliza.plugins.phone.TelecomCallConfiguration;
import android.content.Context;

/** Shared telephony, SMS-role, and Telecom call configurations for thin telephony apps. */
final class ThinTelephonyConfig {
    private static final String PREFS_NAME = "alpha-thin-sms-journal";
    private static final String KEY_ALIAS = "alpha-thin-sms-journal-v1";

    static final SmsTelephonyConfiguration CONFIGURATION = new SmsTelephonyConfiguration(
        "sms-send-ledger:v1:device",
        null,
        "alpha-sms-operation:v1:",
        BuildConfig.APPLICATION_ID + ".SMS_SENT",
        BuildConfig.APPLICATION_ID + ".SMS_DELIVERED",
        "alphaphone-sms",
        "operationId",
        "partIndex",
        "ai.alphacompute.feature.TELEPHONY",
        ThinSmsSendReceiver.class,
        context -> true,
        ThinTelephonyConfig::openStore
    ).withMmsFiles(BuildConfig.APPLICATION_ID + ".mms");

    static final SmsRoleConfiguration SMS_ROLE = new SmsRoleConfiguration(
        CONFIGURATION,
        "alpha-messages",
        "Messages",
        android.R.drawable.sym_action_chat,
        BuildConfig.APPLICATION_ID + ".MMS_DOWNLOADED",
        BuildConfig.APPLICATION_ID + ".MMS_RESPONSE_SENT",
        BuildConfig.APPLICATION_ID + ".mms",
        ThinMmsResultReceiver.class,
        ThinAppActivity.class,
        ThinAppActivity.class
    );

    static final TelecomCallConfiguration CALL_CONFIG = new TelecomCallConfiguration(
        "alpha-phone-calls",
        "Phone calls",
        "alphaphone-call",
        ThinCallActivity.class
    );

    private ThinTelephonyConfig() {}

    private static SmsTelephonyConfiguration.JournalStore openStore(Context context) {
        ThinEncryptedSlots slots = new ThinEncryptedSlots(context, PREFS_NAME, KEY_ALIAS);
        return new SmsTelephonyConfiguration.JournalStore() {
            @Override public String read(String slot) throws Exception {
                return slots.read(slot);
            }

            @Override public void write(String slot, String value) throws Exception {
                slots.write(slot, value);
            }
        };
    }
}
