/** Mailbox helpers shared by Inbox and Settings come from @elizaos/plugin-inbox/mailbox. No provider content is stored here. */
export {
  attachmentReadFailure,
  classifyGmailFailure,
  disconnectGmailAccount,
  disconnectMessage,
  type GmailDisconnectOutcome,
  type GmailFailure,
  type GmailFailureKind,
} from '../../../../.eliza/client-features/plugins/plugin-inbox/src/mailbox/failures.ts';
export { gmailReadable } from '../../../../.eliza/client-features/plugins/plugin-inbox/src/mailbox/grants.ts';
export { MailReadStateGuard, mailReadStateMessage, setGmailReadState } from '../../../../.eliza/client-features/plugins/plugin-inbox/src/mailbox/read-state.ts';

/** Fired after a Gmail account is disconnected anywhere in the app so other surfaces re-check. */
export const GMAIL_ACCOUNTS_CHANGED = 'alpha:gmail-accounts-changed';
