/**
 * Incremental Gmail grants (owner decision P-37, issue #421) are the shared
 * managed mailbox policy in @elizaos/plugin-inbox/mailbox. Alpha asks first for
 * read access only; mailbox changes are one incremental "modify" consent.
 */
export {
  GMAIL_MODIFY_CAPABILITIES,
  GMAIL_READ_CAPABILITY,
  gmailActionGrant,
  gmailCapabilitiesFor,
  gmailConsentCapabilities,
  gmailGrantChange,
  gmailGrantLabel,
  gmailGrantTier,
  gmailInboxAllows,
  gmailModifyIncomplete,
  gmailReadCacheKey,
  googleAccountAccessLabel,
  requiredGmailCapability,
  type GmailGrantRequest,
  type GmailGrantStep,
  type GmailGrantTier,
} from '../../../../.eliza/client-features/plugins/plugin-inbox/src/mailbox/grants.ts';
export type { GmailMailboxAction } from '../../../../.eliza/client-features/plugins/plugin-inbox/src/mailbox/types.ts';
