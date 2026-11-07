import { reviewMailAttachment as reviewUpstreamAttachment } from '../../../../.eliza/client-features/plugins/plugin-files/src/browser/attachment.ts';
import { refusingAttachmentReviewer } from '../../../../.eliza/client-features/plugins/plugin-inbox/src/mailbox/attachments.ts';
export * from '../../../../.eliza/client-features/plugins/plugin-files/src/browser/attachment.ts';
/** A file this app's own checks refused. It is a decision about the file, not a provider or network
 * failure, so it is never reported as Gmail being unavailable and retrying cannot change it. */
export { AttachmentRefusedError, attachmentRefused } from '../../../../.eliza/client-features/plugins/plugin-inbox/src/mailbox/failures.ts';

/** The upstream review, with its rejection typed. The message is unchanged. */
export const reviewMailAttachment = refusingAttachmentReviewer(reviewUpstreamAttachment);
