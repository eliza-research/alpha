import {createNotesDeletionLock} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-recording-deletion.ts';
/** Serialize deletion, restoration and reviewed recovery across same-origin views. The lock name is installed identity. */
export const withAudioDeletionLock=createNotesDeletionLock('alpha.notes-audio-effects.v1');
