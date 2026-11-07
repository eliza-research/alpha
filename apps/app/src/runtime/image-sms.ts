/**
 * Alpha's Messages session on the AOSP image. The foreground-only session and the receipt labels
 * are the shared telephony profile's (`@elizaos/contracts/native-telephony-session`); Alpha keeps
 * only its name in the MMS-unavailable answer and these export names.
 */
import {
  createSmsSession as createSharedSmsSession,
  mmsProblemLabel as sharedMmsProblemLabel,
  mmsReceiptLabel,
  smsReceiptLabel,
} from '../../../../.eliza/client-features/packages/contracts/src/native-telephony-session.ts';
import type {AospTelephony, MmsReviewProblem} from './aosp-telephony';
export {mmsReceiptLabel};
export const receiptLabel = smsReceiptLabel;
export const mmsProblemLabel = (problem: MmsReviewProblem) => sharedMmsProblemLabel(problem, 'Alpha');
/** Provider content and page cursors exist only during the foreground Messages visit. */
export function createSmsSession(client: AospTelephony, image: boolean, onChange: () => void, onSendUpdated: (id: string) => void = () => {}, onMmsSendUpdated: (id: string) => void = () => {}) {
  return createSharedSmsSession(client, image, onChange, {onSendUpdated, onMmsSendUpdated});
}
