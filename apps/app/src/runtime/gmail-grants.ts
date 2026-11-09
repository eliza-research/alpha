import type { GmailAccount, GmailInboxCapabilities } from './cloud-protocol.ts';
/**
 * Incremental Gmail grants (owner decision P-37, issue #421). Gmail is a communication provider in
 * both distributions, through Eliza Cloud. Alpha asks first for read access only. Mailbox changes
 * (send, provider drafts, archive/trash/read state) are asked for once, as one incremental "modify"
 * consent, and only when the user starts an approved mailbox action. Revoking either step, or
 * switching account or Cloud session, isolates what was read or prepared under the old grant.
 *
 * Capability names are Eliza Cloud's. Which Google OAuth scopes back them is Cloud's contract.
 */
export const GMAIL_READ_CAPABILITY = 'google.gmail.triage';
/** The modify step, requested together: Google shows one incremental consent, not three. */
export const GMAIL_MODIFY_CAPABILITIES: readonly string[] = Object.freeze(['google.gmail.send', 'google.gmail.drafts', 'google.gmail.mailbox']);
export type GmailGrantStep = 'read' | 'modify';
export type GmailGrantTier = 'none' | 'readonly' | 'modify';
export type GmailMailboxAction = 'send' | 'draft-create' | 'draft-replace' | 'draft-delete' | 'archive' | 'unarchive' | 'trash' | 'untrash' | 'mark-read' | 'mark-unread';

/** Cloud capabilities one initiation asks for. Read is always included: modify extends it. */
export function gmailCapabilitiesFor(step: GmailGrantStep): string[] {
  return ['google.basic_identity', GMAIL_READ_CAPABILITY, ...(step === 'modify' ? GMAIL_MODIFY_CAPABILITIES : [])];
}
/** The Cloud capability an approved mailbox action needs. */
export function requiredGmailCapability(kind: GmailMailboxAction): string {
  if (kind === 'send') return 'google.gmail.send';
  if (kind.startsWith('draft-')) return 'google.gmail.drafts';
  return 'google.gmail.mailbox';
}
const readable = (account: GmailAccount | null | undefined) => !!account && account.connected && !!account.connectionId && account.grantedCapabilities.includes(GMAIL_READ_CAPABILITY);
export function gmailGrantTier(account: GmailAccount | null | undefined): GmailGrantTier {
  if (!readable(account)) return 'none';
  return GMAIL_MODIFY_CAPABILITIES.every(capability => account!.grantedCapabilities.includes(capability)) ? 'modify' : 'readonly';
}
/** A short note under an account only when its access is partial. Full access needs no label. */
export function googleAccountAccessLabel(account:GmailAccount):string {
  const caps=account.grantedCapabilities;
  const gmailFull=gmailGrantTier(account)==='modify',gmailAny=readable(account);
  const calendarFull=caps.includes('google.calendar.write'),calendarAny=calendarFull||caps.includes('google.calendar.read');
  if(gmailFull&&calendarFull)return '';
  if(!gmailAny&&!calendarAny)return 'Not authorized';
  if(!calendarAny)return 'Gmail only';
  if(!gmailAny)return 'Calendar only';
  return 'Limited access';
}
/** Whether the server's per-account inbox capabilities allow this action now. */
export function gmailInboxAllows(caps: GmailInboxCapabilities | null | undefined, kind: GmailMailboxAction): boolean {
  if (!caps) return false;
  return kind === 'send' ? caps.send : kind.startsWith('draft-') ? caps.providerDrafts : caps.mailboxMutations;
}
/** True while any modify-step action is still unavailable for the selected account. */
export function gmailModifyIncomplete(caps: GmailInboxCapabilities | null | undefined): boolean {
  return !caps || !caps.send || !caps.providerDrafts || !caps.mailboxMutations;
}
/**
 * Decides one approved mailbox action. `granted`: prepare the review. `upgrade`: offer the single
 * modify consent; nothing is prepared or dispatched. `unreadable`: the account has no read grant.
 */
export function gmailActionGrant(account: GmailAccount | null | undefined, kind: GmailMailboxAction): 'granted' | 'upgrade' | 'unreadable' {
  if (!readable(account)) return 'unreadable';
  return account!.grantedCapabilities.includes(requiredGmailCapability(kind)) ? 'granted' : 'upgrade';
}
/**
 * Read-cache identity: provider content read under one key is shown only under the same key. It
 * binds the Cloud session, the Google connection and the presence of the read grant, so a revoked
 * read grant, a different account and a new session each start from nothing. Null: nothing may be shown.
 */
export function gmailReadCacheKey(sessionId: string | null | undefined, account: GmailAccount | null | undefined): string | null {
  if (!sessionId || !readable(account)) return null;
  return JSON.stringify([sessionId, account!.connectionId, GMAIL_READ_CAPABILITY]);
}
/**
 * What a re-read of the account list invalidates. Losing read access, or a different connection or
 * session, drops cached mail. Losing a modify capability drops unsent reviews prepared under it: a
 * review is never dispatched against a grant the user has since withdrawn.
 */
export function gmailGrantChange(before: { sessionId: string | null; account: GmailAccount | null | undefined }, after: { sessionId: string | null; account: GmailAccount | null | undefined }): { dropReadCache: boolean; withdrawn: string[] } {
  const previous = gmailReadCacheKey(before.sessionId, before.account), next = gmailReadCacheKey(after.sessionId, after.account);
  const dropReadCache = previous === null || previous !== next;
  const had = before.account?.grantedCapabilities ?? [], has = after.account && next ? after.account.grantedCapabilities : [];
  const withdrawn = GMAIL_MODIFY_CAPABILITIES.filter(capability => had.includes(capability) && (dropReadCache || !has.includes(capability)));
  return { dropReadCache, withdrawn };
}
