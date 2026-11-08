import {DailyApps} from '../daily';
import {createReminderActionJournal,type PendingReminderAction,type PendingReminderActions} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/reminder-journal.ts';
import {reminderJournalStore} from './reminder-journal-store';
/** Selected-reminder cancel, complete, snooze and edit requests awaiting a durable receipt. */
export type PendingReminderDeletion=PendingReminderAction;
// Keep the installed slot and document: they hold every pending reminder action.
const journal=createReminderActionJournal({
 store:reminderJournalStore<PendingReminderActions>('reminder-deletions:v1:device',async()=>(await import('../browser/reminder-action-document')).reminderActionDocument),
 receipt:input=>DailyApps.reminderOperationReceipt(input) as never,
});
export const pendingReminderDeletions=journal.all;
export const retainReminderDeletion=journal.retain;
/** Only the creating live handler may call this before it has invoked operateReminder. */
export const discardUndispatchedReminderDeletion=journal.discardUndispatched;
export const acknowledgeReminderDeletion=journal.acknowledge;
/** Reconciliation never executes a mutation. */
export const reconcileReminderDeletions=journal.reconcile;
