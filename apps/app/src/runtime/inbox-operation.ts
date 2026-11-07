import { reviewMailAttachment } from './inbox-attachment.ts';
import {
  InboxOperation as SharedInboxOperation,
  type InboxOperationDependencies as SharedDependencies,
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
}
