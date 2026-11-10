/**
 * Shared owner-approved telephony actions (@elizaos/contracts/telephony-actions): a call placed after
 * approval, a text to a contact by name, contact changes, and reads of the thread or voicemail the
 * owner has open. Advertised on the verified Alpha image only.
 */
export {
  isTelephonyAction, telephonyActionCapabilities, validateTelephonyAction,
  PHONE_CALL_CAPABILITY, CONTACT_WRITE_CAPABILITY, SMS_COMPOSE_CAPABILITY, MESSAGES_READ_CAPABILITY, VOICEMAIL_READ_CAPABILITY, VOICEMAIL_DELETE_CAPABILITY,
  type TelephonyActionOperation,
} from '../../../../.eliza/client-features/packages/contracts/src/telephony-actions.ts';
