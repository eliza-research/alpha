/**
 * Startup backstop for a permanent voice deletion (a full Trash refused the restorable copy
 * and the person confirmed "Delete forever without Trash") that process death interrupted.
 * The plan, the renderer lease and the cross-view claims are the shared plugin-notes
 * recording-deletion module. Alpha binds only its installed claim name; the lease length must
 * equal NotesDeletionLease.LEASE_MS, which the Android native passes use (MVP-15).
 */
import {createNotesDeletionClaims} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-recording-deletion.ts';
export {planInterruptedPermanentDeletion,PERMANENT_DELETION_LEASE_MS,leasedDeletionRow,sameDeletionRow,deletionLeaseDue,type PermanentDeletionEvidence,type PermanentDeletionStep,type DeletionLease} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-recording-deletion.ts';

const claims=createNotesDeletionClaims('alpha.notes-deletion-claim.v1:');
export const claimDeletion=claims.claim;
export const releaseDeletionClaim=claims.release;
/** True when another live view of this origin holds the claim on this row. */
export const deletionClaimedElsewhere=claims.claimedElsewhere;
