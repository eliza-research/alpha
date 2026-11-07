import {Capacitor} from '@capacitor/core';
import {DailyApps,type Reminder} from '../daily';
import {createReminderCreationJournal,overdueReminders as sharedOverdue,undatedTodos as sharedTodos,reminderDueAt,isUndatedReminder,reminderRefusalMessage as sharedRefusalMessage,type ReminderCreation,type ReminderCreationStore,type ReminderRefusal} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/reminder-journal.ts';
import {reminderJournalStore} from './reminder-journal-store';
export type {ReminderCreation,ReminderRefusal};
export {REMINDER_REFUSALS as reminderRefusals,isReminderRefusal,reminderWallTime,reopenReminderSchedule as reopenSchedule,isUndatedReminder,reminderDueAt} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/reminder-journal.ts';
type Bag=Record<string,any>;
/** Alpha's installed creation journal: secure slot on Android, browser document otherwise. */
const journal=createReminderCreationJournal({
 store:reminderJournalStore<ReminderCreationStore>('reminder-creations:v1:device',async()=>(await import('../browser/reminder-creation-document')).reminderCreationDocument),
 list:async()=>(await DailyApps.listReminders()).reminders as never,
});
export const reminderCreations=journal.all;
export const retainReminderCreation=journal.retain;
/** Only the creating handler, before scheduleReminder was invoked. */
export const discardUndispatchedCreation=journal.discardUndispatched;
/** Never schedules; a saved row is never retired. */
export const retireRefusedCreation=(id:string,status:unknown,rows?:Reminder[])=>journal.retireRefused(id,status,rows as never);
export const checkReminderCreation=(id:string,rows?:Reminder[])=>journal.check(id,rows as never);
export const reconcileReminderCreations=journal.reconcile;

// ---- Reminder presentation (used by reminder-adapter and Home) ----
/** Due and not done: posted, or still scheduled after its due instant. Oldest first. */
export const overdueReminders=(rows:Reminder[],now?:number):Reminder[]=>sharedOverdue(rows as never[],now);
/** Open and completed undated to-dos, open first, in creation order. */
export const undatedTodos=(rows:Reminder[]):Reminder[]=>sharedTodos(rows as never[]);
const dueOf=reminderDueAt;
/**
 * One-off reminders are absolute instants (dueAt). Only the rendered wall time follows the
 * phone's current time zone, so a zone change moves the displayed hour, never the instant.
 * Repeats keep their civil time in recurrence.zone (see docs/calendar-reminder-contract.md).
 */
export function reminderEvents(rows:Reminder[],now=new Date()):Bag[]{
  return rows.filter(r=>!isUndatedReminder(r)&&(r.status === 'pending' || r.status === 'completed' || r.status === 'scheduled' || r.status === 'posted' || r.status === 'permission-denied' || r.status === 'scheduling-failed')).map(r => {
    const date = new Date(dueOf(r)), today = new Date(now); today.setHours(0,0,0,0);
    const day = new Date(date); day.setHours(0,0,0,0);
    return { id: 'reminder:' + r.id, alphaReminderId: r.id, reminderBody:r.body, reminderAt:r.at, reminderDueAt:dueOf(r), reminderOccurrence:r.occurrenceId, reminderRecurrence:r.recurrence, reminderHistory:r.history, reminderStatus:r.status, reminderTarget:r.target, off: Math.round((day.getTime()-today.getTime())/86400000), t: date.getHours()+date.getMinutes()/60, d: .25, title:r.title, cal:'personal', who:[], repeat:'none', alert:r.alertMinutes!==undefined?r.alertMinutes:r.recurrence?.leadMinutes || 0, notes:[r.body, r.snoozedAt && r.status==='scheduled' ? `Snoozed until ${new Date(r.at).toLocaleString()} · approximate delivery` : '', r.recurrence ? `${r.recurrence.rule} · ${r.recurrence.zone}. ${r.alertMinutes===null?'Next occurrence is saved with no alert after Done.':'Next occurrence is scheduled after Done.'} Future missing clock times use the first valid time after the gap; repeated clock times use the earlier offset.` : '', r.status === 'scheduling-failed' ? 'Saved, scheduling failed. Tap Snooze 10 minutes to retry.' : '', r.status === 'pending' ? 'No alert · saved on this device' : r.status === 'completed' ? 'Completed · no further alarm scheduled' : r.status === 'posted' ? 'Notification posted' : r.status === 'permission-denied' ? `Not delivered · notifications were disabled. Enable notifications in ${Capacitor.isNativePlatform()?'Android settings':'Settings'}, then edit this reminder to choose a new time and save.` : 'Scheduled · approximate delivery'].filter(Boolean).join('\n') };
  });
}
/** Specific, stable reason for a definite native refusal. Nothing was saved in every case. */
export function reminderRefusalMessage(status:ReminderRefusal,native=Capacitor.isNativePlatform()):string{
  return sharedRefusalMessage(status,{appName:'Alpha',settingsName:native?'Android settings':'Settings'});
}
