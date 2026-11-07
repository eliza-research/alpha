/** Shared reviewed dial handoff (@elizaos/contracts/phone-dial). A dial result is a handoff and never a placed call. */
export {isPhoneDial,validatePhoneDial,validatePhoneDialResult,phoneDialCapabilityAvailable,phoneDialReceiptOutcome,phoneDialResultText,telephonyDeviceCapabilities,PHONE_DIAL_CAPABILITY,CONTACT_LOOKUP_CAPABILITY,type PhoneDialOperation,type PhoneDialResult} from '../../../../.eliza/client-features/packages/contracts/src/phone-dial.ts';
import {phoneDialReceiptOutcome,type PhoneDialResult} from '../../../../.eliza/client-features/packages/contracts/src/phone-dial.ts';
/** The journal status for a dial result: succeeded only when the dial screen opened. */
export function dialDeviceStatus(result:PhoneDialResult):'succeeded'|'failed'{return phoneDialReceiptOutcome(result)==='applied'?'succeeded':'failed';}
