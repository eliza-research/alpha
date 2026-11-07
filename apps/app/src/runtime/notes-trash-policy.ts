import type {NoteRecord} from './notes-store';
import type {NotesTarget} from './notes-contract';
import {createNotesTrashPolicy,NOTES_TRASH_FULL_CODE,type NotesTrashDocument as SharedDocument,type NotesTrashEntry as SharedEntry,type NotesTrashPlan as SharedPlan} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-trash-policy.ts';
export {NOTES_TRASH_FULL_CODE,NotesTrashFull,isNotesTrashFull} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-trash-policy.ts';

/** Product deletion policy: a deleted note stays restorable in Recently deleted for exactly 30 days (PLAN.md decision N2). */
export const NOTES_TRASH_RETENTION_MS=30*24*60*60*1000;
export const NOTES_TRASH_MAX_ENTRIES=10000;
export const NOTES_TRASH_MAX_BYTES=30*1024*1024;
/**
 * The generic retention policy is the elizaOS Notes Trash module; Alpha
 * supplies the product inputs: 30 days, its limits, its note kinds and voice recordings.
 */
const policy=createNotesTrashPolicy<NoteRecord,NotesTarget>({retentionMs:NOTES_TRASH_RETENTION_MS,maxEntries:NOTES_TRASH_MAX_ENTRIES,maxBytes:NOTES_TRASH_MAX_BYTES,kinds:['text','list','voice','link'],recordingKind:'voice'});
export const notesTrashPolicy=policy;

/**
 * One trashed note. `id` is the deletion operation id; for agent and voice deletions it
 * equals the shared store tombstone's operationId. `target` is the reviewed revision of
 * the exact record at deletion, so a restore can prove it reinstated the same note.
 * `audio` is present only when the recording itself was moved to the audio trash under
 * the same operation id.
 */
export type NotesTrashEntry=SharedEntry<NoteRecord,NotesTarget>;
export type NotesTrashDocument=SharedDocument<NoteRecord,NotesTarget>;
export type NotesTrashPlan=SharedPlan<NoteRecord,NotesTarget>;

export function emptyNotesTrash():NotesTrashDocument{return policy.empty();}
export function validateNotesTrash(value:unknown):NotesTrashDocument{return policy.validate(value);}
/**
 * Expired exactly when 30 full days of wall-clock time have elapsed since deletion
 * (epoch milliseconds, so time-zone and DST changes have no effect). A clock moved
 * backwards delays the purge rather than advancing it: early erasure is the
 * unrecoverable failure, so deletedAt is never rewritten from a possibly wrong clock.
 */
export function notesTrashExpired(entry:Pick<NotesTrashEntry,'deletedAt'>,now:number){return policy.expired(entry,now);}
/** Whole days left, rounded up: 30 right after deletion, 1 during the final day, 0 once due. */
export function notesTrashDaysLeft(entry:Pick<NotesTrashEntry,'deletedAt'>,now:number){return policy.daysLeft(entry,now);}
export function notesTrashDaysLabel(entry:Pick<NotesTrashEntry,'deletedAt'>,now:number){
 const days=notesTrashDaysLeft(entry,now);
 return days===0?'Deleting permanently':days===1?'1 day left':`${days} days left`;
}
/** The compact days-left mark a Recently deleted row shows ("29d"). */
export function notesTrashDaysShort(entry:Pick<NotesTrashEntry,'deletedAt'>,now:number){return `${notesTrashDaysLeft(entry,now)}d`;}

/**
 * Record a deletion before it is committed. A newer deletion of the same note replaces an older,
 * stale entry. The shared policy refuses an entry over the product limits with NotesTrashFull.
 */
export function addNotesTrashEntry(doc:NotesTrashDocument,entry:NotesTrashEntry):NotesTrashDocument{return policy.add(doc,entry);}
/**
 * True only when a valid new entry is refused by the entry or byte limit. Limits admit additions
 * only: reading, restoring and removing entries of a document that already exceeds them is never refused.
 */
export function notesTrashOverflows(doc:NotesTrashDocument,entry:NotesTrashEntry):boolean{
 try{policy.add(doc,entry);return false;}
 catch(error){return (error as {code?:unknown})?.code===NOTES_TRASH_FULL_CODE;}
}
export function removeNotesTrashEntries(doc:NotesTrashDocument,ids:Iterable<string>):NotesTrashDocument{return policy.remove(doc,ids);}

/**
 * Decide what maintenance must do, from authoritative saved note ids.
 * - stale: the note is live again (undo, restore, or a deletion that never committed). Only the trash row goes.
 * - expired: deleted at least 30 days ago and still absent. Its content is purged.
 * Pure and idempotent: applying the plan and planning again yields nothing to do.
 */
export function planNotesTrash(doc:NotesTrashDocument,liveNoteIds:ReadonlySet<string>,now:number):NotesTrashPlan{return policy.plan(doc,liveNoteIds,now);}

/** Reinsert the exact saved record near its old position. Refuses to replace a live note with the same id. */
export function restoreNotesTrashEntry(list:NoteRecord[],entry:NotesTrashEntry):NoteRecord[]{return policy.restore(list,entry);}

/** Newest deletion first, for presentation. */
export function sortedNotesTrash(doc:NotesTrashDocument){return policy.sorted(doc);}
