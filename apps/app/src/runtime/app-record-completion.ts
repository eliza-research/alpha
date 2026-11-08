import { normalizeEffectReceipts } from '../../../../.eliza/client-features/packages/core/src/types/effects.ts';

export const NOTES_INVALIDATED_EVENT = 'alpha:canonical-notes-invalidated';
export const CALENDAR_INVALIDATED_EVENT = 'alpha:canonical-calendar-invalidated';

export interface AppRecordInvalidation {
  event: typeof NOTES_INVALIDATED_EVENT | typeof CALENDAR_INVALIDATED_EVENT;
  revision?: number;
}

const noteMutations = new Set([
  'notes.note.create', 'notes.note.update', 'notes.note.patch', 'notes.note.delete',
  'notes.create-note', 'notes.update-note', 'notes.delete-note', 'notes.restore-note',
]);
const calendarMutations = new Set([
  'calendar.event.create', 'calendar.event.update', 'calendar.event.delete',
]);

/** Refresh hints from canonical effects, never completion or retry authority.
 * The caller verifies the active session before emitting these local events.
 * One reply produces at most one hint per domain, including partial failures
 * whose returned receipts prove that a record already changed. */
export function appRecordInvalidations(results: readonly unknown[] | undefined): AppRecordInvalidation[] {
  if (!Array.isArray(results)) return [];
  let notes = false;
  let notesRevision: number | undefined;
  let unknownNotesRevision = false;
  let calendar = false;
  for (const result of results) {
    if (!result || typeof result !== 'object' || !('effectReceipts' in result)) continue;
    let receipts: ReturnType<typeof normalizeEffectReceipts>;
    try { receipts = normalizeEffectReceipts(result.effectReceipts); }
    catch { continue; }
    for (const receipt of receipts) {
      if (receipt.outcome !== 'applied') continue;
      if (receipt.commit.kind === 'durable' && (
        receipt.resource.kind === 'notes.note' && noteMutations.has(receipt.operation) ||
        receipt.resource.kind === 'notes.note-collection' && receipt.operation === 'notes.clear-notes'
      )) {
        notes = true;
        const version = receipt.resource.version;
        if (typeof version === 'string' && /^(0|[1-9]\d*)$/.test(version)) {
          const revision = Number(version);
          if (Number.isSafeInteger(revision)) notesRevision = Math.max(notesRevision ?? 0, revision);
          else unknownNotesRevision = true;
        } else unknownNotesRevision = true;
      }
      if (receipt.resource.kind === 'calendar.event' && calendarMutations.has(receipt.operation) && receipt.commit.kind === 'durable') calendar = true;
      if (['calendar.approval', 'calendar.approval_request'].includes(receipt.resource.kind) &&
          (receipt.operation === 'calendar.approval.resolve' || calendarMutations.has(receipt.operation)) && receipt.commit.kind === 'provider_accepted' &&
          receipt.artifacts.some(artifact => artifact.kind === 'calendar.event')) calendar = true;
    }
  }
  const invalidations: AppRecordInvalidation[] = [];
  if (notes) invalidations.push({ event: NOTES_INVALIDATED_EVENT, ...(unknownNotesRevision || notesRevision === undefined ? {} : { revision: notesRevision }) });
  if (calendar) invalidations.push({ event: CALENDAR_INVALIDATED_EVENT });
  return invalidations;
}
