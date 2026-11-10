package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.messages.SmsRoleConfiguration;

/**
 * Alpha's identity for the shared default-SMS-app components (plugin-native-messages): its message
 * notice channel, MMS result actions and file provider authority. The components are declared
 * disabled in the launcher manifest and enabled by {@link AlphaTelephonyRoles} only on the verified
 * Alpha AOSP image, so the SMS role can be offered nowhere else.
 */
final class AlphaSmsRole {
 private AlphaSmsRole() {}
 static final SmsRoleConfiguration CONFIGURATION = new SmsRoleConfiguration(AlphaTelephony.CONFIGURATION,
  "alpha-messages", "Messages", R.drawable.notification_icon,
  "ai.elizaresearch.alphaphone.MMS_DOWNLOADED", "ai.elizaresearch.alphaphone.MMS_RESPONSE_SENT", BuildConfig.APPLICATION_ID + ".mms",
  AlphaMmsResultReceiver.class, AlphaSmsComposeActivity.class, MainActivity.class);
}
