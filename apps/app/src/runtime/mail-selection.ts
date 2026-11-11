import {InboxOperation, type InboxOperationClient, type InboxOperationStore, type InboxOperationRecord} from './inbox-operation';
import {reviewMailAttachment} from './inbox-attachment';

export type MailSelectionAction = 'archive' | 'trash' | 'untrash' | 'unarchive' | 'star' | 'unstar';
export type MailSelectionClient = InboxOperationClient & {
  gmailInboxCapabilities(grant: string, signal: AbortSignal): Promise<{mailboxMutations: boolean; stars?: boolean}>;
  gmailRead(grant: string, id: string, signal: AbortSignal): Promise<{message: {id: string}; historyId: string | null}>;
};

/** One owner-confirmed selection uses the existing per-account operation journal. */
export async function applyMailSelection(options: {
  owner: string;
  grantId: string;
  client: MailSelectionClient;
  store: InboxOperationStore;
  ids: readonly string[];
  action: MailSelectionAction;
  signal: AbortSignal;
  current(): boolean;
  settlePriorSend(record: InboxOperationRecord): Promise<void>;
  applied(id: string): void;
}) {
  const completed: string[] = [];
  const current = () => !options.signal.aborted && options.current();
  const operation = new InboxOperation({...options, active: current, reviewAttachment: reviewMailAttachment});
  const abort = () => operation.stop();
  options.signal.addEventListener('abort', abort, {once: true});
  try {
    let prior = await operation.load();
    if (prior?.phase === 'dispatching' || ['dispatched','outcome-unknown'].includes(prior?.receipt?.state || ''))
      prior = await operation.refresh();
    if (prior?.proposal.kind === 'send' && prior.receipt?.state === 'succeeded')
      await options.settlePriorSend(prior);
    await operation.clear();
    for (const id of new Set(options.ids)) {
      options.signal.throwIfAborted();
      if (!current()) throw new DOMException('Mailbox changed', 'AbortError');
      const caps = await options.client.gmailInboxCapabilities(options.grantId, options.signal);
      if (!caps.mailboxMutations) throw Error('Reconnect Gmail to change these emails.');
      if ((options.action==='star'||options.action==='unstar')&&!caps.stars) throw Error('Star changes are not available on this connection yet.');
      const message = await options.client.gmailRead(options.grantId, id, options.signal);
      if (message.message.id !== id || !message.historyId) throw Error('This email could not be refreshed.');
      await operation.prepare({kind: options.action, messageId: id, expectedHistoryId: message.historyId});
      const result = await operation.confirm();
      if (result?.receipt?.state !== 'succeeded')
        throw Error(result?.receipt?.state === 'rejected' ? 'Gmail did not accept this change.' : 'This change needs a status check before continuing.');
      completed.push(id);
      options.applied(id);
      await operation.clear();
    }
    return {completed, error: ''};
  } catch (error) {
    return {completed, error: error instanceof Error ? error.message : 'The selected emails could not be updated.'};
  } finally {
    options.signal.removeEventListener('abort', abort);
    operation.stop();
  }
}
