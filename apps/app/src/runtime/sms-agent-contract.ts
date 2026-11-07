/** Shared reviewed upstream SMS contract (@elizaos/contracts/sms-send); admission requires the corresponding prepared pin. */
export {isSmsSend,validateSmsSend,validateSmsResult,smsBindingText,smsReceiptOutcome,SMS_SEND_CAPABILITY,type SmsSendOperation,type SmsSendResult} from '../../../../.eliza/client-features/packages/contracts/src/sms-send.ts';
import {smsBindingText,smsReceiptOutcome,type SmsSendOperation,type SmsSendResult} from '../../../../.eliza/client-features/packages/contracts/src/sms-send.ts';
export async function smsAgentHash(operation:SmsSendOperation){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(smsBindingText(operation))))].map(v=>v.toString(16).padStart(2,'0')).join('');}
export function smsDeviceStatus(result:SmsSendResult):'succeeded'|'failed'|'unknown'{const outcome=smsReceiptOutcome(result);return outcome==='applied'?'succeeded':outcome==='failed'?'failed':'unknown';}
