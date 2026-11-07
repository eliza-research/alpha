import { CloudProtocolError, type GmailAccount, type GmailInboxReceipt } from './cloud-protocol.ts';
import { AttachmentRefusedError, attachmentRefused } from './inbox-attachment.ts';

/** Mailbox helpers shared by Inbox and Settings. No provider content is stored here. */
/** `refused` is this app's own refusal of an attachment's bytes, name or size: Gmail answered, and a
 * retry would get the same file. */
export type GmailFailureKind = 'offline' | 'revoked' | 'stale' | 'unavailable' | 'refused';
export interface GmailFailure { kind: GmailFailureKind; message: string }

const messages: Record<GmailFailureKind, Record<'read' | 'operation', string>> = {
  offline: {
    read: 'Offline',
    // A request may have reached Gmail before the connection dropped, so this does not claim no change.
    operation: 'You appear to be offline. Gmail may not have received this change. When you are connected, check the saved receipt before trying again.',
  },
  revoked: {
    // Also a read 409 (authorization needed again), so this does not say the account was disconnected.
    read: 'Gmail needs to be reconnected.',
    operation: 'Gmail no longer allows this change for the selected account. Reconnect Gmail, then retry. Nothing was changed.',
  },
  stale: {
    read: 'This message changed in Gmail. Retry to load its current version.',
    operation: 'This message changed in Gmail since it was loaded. Retry to reload it; nothing was changed.',
  },
  refused: {
    read: 'This attachment does not match its type or is too large. It was not opened or saved.',
    operation: 'An attachment does not match its type or is too large, so this review was refused. Nothing was sent or changed.',
  },
  unavailable: {
    read: 'Gmail is unavailable right now. Retry, or check the connection.',
    operation: 'Mail operation unavailable. Check its receipt before trying again.',
  },
};

function online(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/** Classifies a failed Gmail request. Reads and reviewed operations interpret HTTP 409 differently:
 * the managed read routes use 409 for a grant that needs authorization again, while operation
 * review uses it for a message or draft that changed after it was loaded. */
export function classifyGmailFailure(error: unknown, context: 'read' | 'operation', isOnline = online()): GmailFailure {
  const result = (kind: GmailFailureKind): GmailFailure => ({ kind, message: messages[kind][context] });
  // A refusal is decided on this device from bytes already received, so it holds offline too.
  if (attachmentRefused(error)) return result('refused');
  if (!isOnline) return result('offline');
  // Duck-typed so errors from another module instance (tests, sandboxes) classify the same way.
  if (error instanceof CloudProtocolError || (!!error && typeof error === 'object' && (error as { name?: unknown }).name === 'CloudProtocolError')) {
    const failure = error as CloudProtocolError;
    if (failure.code !== 'http') return result('unavailable');
    const status = failure.status;
    if (status === 403 || status === 404) return result('revoked');
    if (status === 409) return result(context === 'read' ? 'revoked' : 'stale');
    return result('unavailable');
  }
  // Transport failures only; a TypeError from a programming fault is not reported as offline.
  if (error instanceof Error && /network|offline|timed out|failed to fetch|load failed|internet/i.test(error.message)) return result('offline');
  return result('unavailable');
}

/** CloudProtocol reports its own checks of a returned attachment (bytes against the declared type,
 * size, hash and name) as an invalid response. For an attachment download that response is the file
 * itself failing those checks, so it is rethrown as a refusal; every other failure is unchanged. */
export function attachmentReadFailure(error: unknown): unknown {
  const invalid = !!error && typeof error === 'object' && (error as { name?: unknown }).name === 'CloudProtocolError' && (error as { code?: unknown }).code === 'invalid-response';
  return invalid ? new AttachmentRefusedError() : error;
}

export function gmailReadable(account: GmailAccount): boolean {
  return account.connected && !!account.connectionId && account.grantedCapabilities.includes('google.gmail.triage');
}

/** Fired after a Gmail account is disconnected anywhere in the app so other surfaces re-check. */
export const GMAIL_ACCOUNTS_CHANGED = 'alpha:gmail-accounts-changed';

export type GmailDisconnectOutcome = 'disconnected' | 'still-connected' | 'unconfirmed';
interface DisconnectClient {
  disconnectGmail(connectionId: string, signal: AbortSignal): Promise<void>;
  gmailAccounts(signal: AbortSignal): Promise<GmailAccount[]>;
}
/** One explicit disconnect request, then a read-back. Never retried automatically: a lost
 * response is reported as unconfirmed so the user can check the current state. */
export async function disconnectGmailAccount(client: DisconnectClient, connectionId: string, signal: AbortSignal): Promise<{ outcome: GmailDisconnectOutcome; accounts: GmailAccount[] | null }> {
  try { await client.disconnectGmail(connectionId, signal); }
  catch (error) {
    if (signal.aborted) throw error;
    // A rejected request may still have been applied; read back before reporting.
    try {
      const accounts = await client.gmailAccounts(signal);
      const current = accounts.find(account => account.connectionId === connectionId);
      return { outcome: current && current.connected ? 'unconfirmed' : 'disconnected', accounts };
    } catch { if (signal.aborted) throw error; return { outcome: 'unconfirmed', accounts: null }; }
  }
  try {
    const accounts = await client.gmailAccounts(signal);
    const current = accounts.find(account => account.connectionId === connectionId);
    return { outcome: current?.connected ? 'still-connected' : 'disconnected', accounts };
  } catch (error) {
    if (signal.aborted) throw error;
    return { outcome: 'unconfirmed', accounts: null };
  }
}
export function disconnectMessage(outcome: GmailDisconnectOutcome, label: string): string {
  if (outcome === 'disconnected') return `${label} disconnected.`;
  if (outcome === 'still-connected') return `${label} is still connected. Try again.`;
  return `Couldn’t disconnect ${label}. Try again.`;
}

interface ReadStateClient {
  gmailPrepareOperation(grant: string, request: string, proposal: Record<string, unknown>, signal: AbortSignal): Promise<{ receipt: GmailInboxReceipt; review: Record<string, unknown> }>;
  gmailDispatchOperation(grant: string, request: string, digest: string, proposal: Record<string, unknown>, signal: AbortSignal): Promise<GmailInboxReceipt>;
}
const digest = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), b => b.toString(16).padStart(2, '0')).join('');
/** Marks one loaded message read or unread through the reviewed inbox-v1 operation. The label
 * change is idempotent, so it does not use the durable send/draft review slot, but it is still
 * dispatched exactly once: an uncertain outcome returns null and is never repeated here. */
export async function setGmailReadState(client: ReadStateClient, grantId: string, input: { messageId: string; expectedHistoryId: string; unread: boolean }, signal: AbortSignal): Promise<{ unread: boolean; historyId: string | null } | null> {
  const requestId = crypto.randomUUID(), kind = input.unread ? 'mark-unread' : 'mark-read';
  const proposal = { kind, messageId: input.messageId, expectedHistoryId: input.expectedHistoryId };
  const prepared = await client.gmailPrepareOperation(grantId, requestId, proposal, signal);
  const review = prepared.review;
  if (prepared.receipt.requestId !== requestId || prepared.receipt.kind !== kind || prepared.receipt.state !== 'prepared'
    || review.kind !== kind || review.messageId !== input.messageId || review.expectedHistoryId !== input.expectedHistoryId
    || prepared.receipt.reviewDigest !== await digest(JSON.stringify(review))) throw new Error('Server review does not match the requested read state');
  signal.throwIfAborted();
  const receipt = await client.gmailDispatchOperation(grantId, requestId, prepared.receipt.reviewDigest, proposal, signal);
  if (receipt.requestId !== requestId || receipt.kind !== kind) throw new Error('Unexpected read-state receipt');
  if (receipt.state !== 'succeeded') return null;
  const result = receipt.providerResult;
  if (!result || result.messageId !== input.messageId || result.unread !== input.unread) return null;
  return { unread: input.unread, historyId: typeof result.historyId === 'string' ? result.historyId : null };
}
