import { reviewMailAttachment } from './inbox-attachment.ts';
import {
  InboxOperation as SharedInboxOperation,
  inboxOperationKey,
  type InboxOperationClient,
  type InboxOperationDependencies as SharedDependencies,
  type InboxOperationRecord,
  type InboxOperationStore,
} from '../../../../.eliza/client-features/plugins/plugin-inbox/src/mailbox/operation-journal.ts';

export {
  composerContent,
  composerKind,
  inboxOperationKey,
  reviewBinding,
  reviewBindingRefusal,
  type ComposerEmail,
  type InboxOperationRecord,
  type ReviewBinding,
} from '../../../../.eliza/client-features/plugins/plugin-inbox/src/mailbox/operation-journal.ts';
export {
  attachmentBytes,
  checkOutgoingAttachments,
  outgoingAttachmentLimits,
  reviewOpaqueAttachment,
  type OpaqueMailAttachment,
} from '../../../../.eliza/client-features/plugins/plugin-inbox/src/mailbox/attachments.ts';

/** Alpha's operation journal dependencies; the attachment review defaults to this app's checks. */
export type InboxOperationDependencies = Omit<SharedDependencies, 'reviewAttachment'> & Partial<Pick<SharedDependencies, 'reviewAttachment'>>;

/** One durable selected-account intent, from @elizaos/plugin-inbox/mailbox. No recovery path dispatches an effect. */
export class InboxOperation extends SharedInboxOperation {
  constructor(deps: InboxOperationDependencies) {
    super({ reviewAttachment: reviewMailAttachment, ...deps });
  }
  /** The guarded receipt read for one owner's saved operations; see receiptReadGuard. */
  static receiptReads(read: InboxOperationClient['gmailOperation'], store: Pick<InboxOperationStore, 'read'>, owner: string): InboxOperationClient['gmailOperation'] {
    return receiptReadGuard(read, store, owner);
  }
}

export const regressedReceiptRefusal = 'Gmail reported this operation as not started after its outcome was already recorded. The saved receipt was kept and nothing was sent or changed again. Do not repeat it.';
/** Primitive receipt fields read by the regression check and its generated proof. */
type SavedReceiptPhase = { requestId: string; phase: string };
/** Whether a receipt read answers `prepared` for the request whose outcome the saved record already
 * holds. The journal would take such an answer for an unsent review and offer Confirm again. */
export function regressedReceipt(saved: SavedReceiptPhase | null | undefined, requestId: string, state: string): boolean {
  //@ verify
  //@ ensures saved === null ==> !\result
  //@ ensures saved !== null ==> (\result <==> (state === 'prepared' && saved.phase === 'observed' && saved.requestId === requestId))
  //@ ensures state !== 'prepared' ==> !\result
  //@ ensures saved !== null ==> (saved.requestId !== requestId ==> !\result)
  //@ ensures saved !== null ==> (saved.phase !== 'observed' ==> !\result)
  if (!saved) return false;
  return state === 'prepared' && saved.phase === 'observed' && saved.requestId === requestId;
}
/**
 * The receipt read the operation journal uses, for one owner's saved operations. Once an outcome
 * is recorded (`observed`), a `prepared` answer for the same request is refused before the journal
 * sees it: the saved receipt and phase stay, so the request can never be confirmed and dispatched
 * a second time, and a held cleanup stays held. Every other answer passes through unchanged.
 */
export function receiptReadGuard(read: InboxOperationClient['gmailOperation'], store: Pick<InboxOperationStore, 'read'>, owner: string): InboxOperationClient['gmailOperation'] {
  return async (grant, request, signal) => {
    const receipt = await read(grant, request, signal);
    if (receipt?.state !== 'prepared') return receipt;
    const saved = await store.read<InboxOperationRecord>(await inboxOperationKey(owner, grant));
    if (regressedReceipt(saved, request, receipt.state)) throw new Error(regressedReceiptRefusal);
    return receipt;
  };
}
