import {deletedNoteOrigins as receiptsRetire,type NoteDeletionReceiptsPort} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/note-deleted-origins.ts';
import {calendarDocument} from './calendar-store';
import {reminderDocument} from './reminder-store';
import type {CalendarDeletionState} from './calendar-deletions';
import type {ReminderDeletionState} from './reminder-deletions';
import {browserDeletionOwnerVisible} from '../runtime/deletion-owner';

/** Alpha's browser deletion documents as the shared Notes deletion-receipt port. */
const receipts:NoteDeletionReceiptsPort={
 reminders:()=>reminderDocument.read<ReminderDeletionState>(()=>({sourceRevision:'',reminders:[]})),
 events:()=>calendarDocument.read<CalendarDeletionState>(()=>({sourceRevision:'',events:[]})),
 visible:browserDeletionOwnerVisible,
};
/** Durable terminal receipts, never absence from a filtered calendar range or pending list. */
export function deletedNoteOrigins(){return receiptsRetire(receipts);}
