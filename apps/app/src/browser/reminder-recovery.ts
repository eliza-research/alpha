import {reminderActionDocument} from './reminder-action-document';
import {reminderCreationDocument} from './reminder-creation-document';
import {reminderDocument} from './reminder-store';
import {openDomainRecovery} from './domain-recovery';
export function openReminderRecovery(){openDomainRecovery(reminderDocument,'reminders','Browser reminder recovery','Download a backup first.');}

export function openReminderCreationRecovery(){openDomainRecovery(reminderCreationDocument,'reminder creation history','Recovery','Download history first.');}

export function openReminderActionRecovery(){openDomainRecovery(reminderActionDocument,'reminder action history','Recovery','Download history first.');}
