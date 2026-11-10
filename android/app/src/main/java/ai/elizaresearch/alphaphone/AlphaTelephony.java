package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.messages.SmsTelephonyConfiguration;

/**
 * Alpha Phone's identity for the shared reviewed SMS core (plugin-native-messages). Every value is
 * the one earlier Alpha releases wrote: the encrypted journal slot, the plaintext journal it migrates
 * from, the retired-ID filter namespace, and the receiver, actions, data scheme and extras that
 * in-flight sent and delivery PendingIntents name. Changing any of them would orphan installed
 * receipts or let a dropped operation ID be sent again.
 *
 * The capability profile is {@link AlphaImageCapability}: the release launcher installed on the
 * Alpha AOSP image with the product overlay and image feature (P-36, #420), never the launcher flavor
 * alone.
 *
 * Reviewed MMS sends hand their PDU to the platform through the shared MmsFileProvider the launcher
 * manifest declares at {@code <applicationId>.mms}, enabled only on the verified image while Alpha may
 * hold the SMS role; elsewhere the shared plugin reports MMS sends unavailable.
 */
final class AlphaTelephony {
 private AlphaTelephony() {}
 static final SmsTelephonyConfiguration CONFIGURATION = new SmsTelephonyConfiguration(
  "sms-send-ledger:v1:device", "alpha-sms-sends.journal", "alpha-sms-operation:v1:",
  "ai.elizaresearch.alphaphone.SMS_SENT", "ai.elizaresearch.alphaphone.SMS_DELIVERED",
  "alphaphone-sms", "operationId", "partIndex", AlphaImageCapability.featureName(BuildConfig.APPLICATION_ID),
  AlphaSmsSendReceiver.class, AlphaImageCapability::verified,
  context -> {
   AlphaCredentialStore store = new AlphaCredentialStore(context);
   return new SmsTelephonyConfiguration.JournalStore() {
    @Override public String read(String slot) throws Exception { return store.readCredentialSlot(slot); }
    @Override public void write(String slot, String value) throws Exception { store.writeCredentialSlot(slot, value); }
   };
  }).withMmsFiles(BuildConfig.APPLICATION_ID + ".mms");
}
