import {retireGmailBackground} from './gmail-background';
import type {GmailAccount} from './cloud-protocol';
import {disconnectGmailAccount, type GmailDisconnectOutcome} from './gmail-mailbox';

/** A Google grant can authorize Gmail and Calendar together. Never call this account deletion. */
export const GOOGLE_ACCOUNTS_CHANGED = 'alpha:google-accounts-changed';

export interface GoogleAccountsClient {
  initiateGoogle(signal: AbortSignal, calendarPermission?: 'read' | 'write', gmailPermission?: 'read' | 'modify' | 'send' | 'drafts' | 'mailbox', redirectUrl?: string): Promise<string>;
  gmailAccounts(signal: AbortSignal): Promise<GmailAccount[]>;
  disconnectGmail(connectionId: string, signal: AbortSignal): Promise<void>;
}
export interface GoogleAccountsBinding {
  client: GoogleAccountsClient;
  sessionId: string;
  credentialId: string;
}

export function notifyGoogleAccountsChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(GOOGLE_ACCOUNTS_CHANGED));
}

export function googleDisconnectConfirmation(label: string, serviceName = 'Cloud'): string {
  return `Disconnect ${label}?\n\n${serviceName} stops using Gmail and Calendar for this account. Your Google account, mail and calendar events are not deleted.`;
}

export function googleDisconnectMessage(outcome: GmailDisconnectOutcome, label: string): string {
  if (outcome === 'disconnected') return `${label} disconnected.`;
  if (outcome === 'still-connected') return `${label} is still connected. Try again.`;
  return `Couldn’t disconnect ${label}. Try again.`;
}

/** One captured Cloud session owns every request and result. Recreate after an account change. */
export function createGoogleAccounts(
  binding: GoogleAccountsBinding,
  current: () => GoogleAccountsBinding | null,
  changed: () => void = notifyGoogleAccountsChanged,
) {
  const {client, sessionId, credentialId} = binding;
  const check = (signal: AbortSignal) => {
    signal.throwIfAborted();
    const live = current();
    if (!live || live.client !== client || live.sessionId !== sessionId || live.credentialId !== credentialId) {
      throw new DOMException('The Cloud account changed. Check Google connections again.', 'AbortError');
    }
  };
  return {
    async list(signal: AbortSignal): Promise<GmailAccount[]> {
      check(signal);
      const accounts = await client.gmailAccounts(signal);
      check(signal);
      return accounts;
    },
    /** Returns the authorization URL only; authorization completion must be checked with list. */
    async connect(signal: AbortSignal, calendarPermission: 'read' | 'write' = 'read', gmailPermission: 'read' | 'modify' | 'send' | 'drafts' | 'mailbox' = 'read', redirectUrl?: string): Promise<string> {
      check(signal);
      const url = await client.initiateGoogle(signal, calendarPermission, gmailPermission, redirectUrl);
      check(signal);
      return url;
    },
    /** Caller owns confirmation. Reuse Gmail's one-request, read-back-verified grant revocation. */
    async disconnect(connectionId: string, signal: AbortSignal) {
      check(signal);
      if (!connectionId.trim()) throw new TypeError('Choose a Google connection to disconnect.');
      // Start retiring native callbacks/notices first, but never let local bookkeeping
      // delay or block the privacy-relevant remote revoke on this captured binding.
      const retirement = retireGmailBackground(connectionId);
      try {
        const result = await disconnectGmailAccount({
          async disconnectGmail(id, requestSignal) {
            check(requestSignal);
            await client.disconnectGmail(id, requestSignal);
            check(requestSignal);
          },
          async gmailAccounts(requestSignal) {
            check(requestSignal);
            const accounts = await client.gmailAccounts(requestSignal);
            check(requestSignal);
            return accounts;
          },
        }, connectionId, signal);
        check(signal);
        // Even an uncertain mutation needs a fresh account read on the other surfaces.
        changed();
        return result;
      } finally { await retirement.settled(); }
    },
  };
}
