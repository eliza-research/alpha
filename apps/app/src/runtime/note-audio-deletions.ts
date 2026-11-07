import type {BrowserJsonDomainDocument} from '../browser/json-domain-document';
import {withAudioDeletionLock} from './note-audio-lock';
export {withAudioDeletionLock} from './note-audio-lock';
import {Capacitor} from '@capacitor/core';
import {secureConnectionStore} from './native-connection';
import {SECURE_NOTES_SLOT} from './notes-secure-store';
import {createNotesRecordingDeletionJournal,type NotesRecordingDeletion,type NotesRecordingDeletions} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-recording-deletion.ts';
/**
 * Voice-note deletion recovery rows. The row contract, journal protocol and readback are the
 * shared plugin-notes recording-deletion journal; Alpha keeps its installed slot and browser
 * document names. `permanent` marks a separately confirmed deletion that skipped a full Trash:
 * recovery finishes the erase instead of leaving a Trash entry.
 */
export type AudioDeletion=NotesRecordingDeletion;
const slot='notes-audio-deletions:v1:device',key='alpha.browser.notes-audio-deletions.v1';
const android=()=>Capacitor.getPlatform()==='android';
let document:Promise<BrowserJsonDomainDocument>|undefined;
export function audioDeletionDocument(){
 if(android())throw Error('Browser audio recovery is unavailable on this device');
 return document??=import('../browser/json-domain-document').then(({BrowserJsonDomainDocument})=>new BrowserJsonDomainDocument(key));
}
export async function audioDeletionRecovery(){const domain=await audioDeletionDocument();return {capture:domain.capture.bind(domain),reset:(expected:Parameters<typeof domain.reset>[0],signal?:AbortSignal)=>withAudioDeletionLock(()=>domain.reset(expected,signal),signal)};}
const journal=createNotesRecordingDeletionJournal({
 read:async()=>android()?secureConnectionStore.read<NotesRecordingDeletions>(slot):(await audioDeletionDocument()).readJson<NotesRecordingDeletions>(),
 async edit(change){
  if(android()){const raw=await secureConnectionStore.read<NotesRecordingDeletions>(slot);if((await secureConnectionStore.compareExchange(slot,raw,change(raw))).status!=='saved')throw Error('Audio deletion changed');}
  else await(await audioDeletionDocument()).editJson<NotesRecordingDeletions>(change);
 },
 async readSavedNotes(){
  const raw=android()?(await secureConnectionStore.read<{currentRaw:string}>(SECURE_NOTES_SLOT))?.currentRaw:await(await import('./browser-notes-document')).readBrowserNotesRaw();
  if(typeof raw!=='string')throw Error('Notes readback unavailable');
  return raw;
 },
});
/** The journal the shared recording effects use. */
export const audioDeletionJournal=journal;
/** Rows still awaiting confirmation, each bound to its exact reviewed revision. */
export const pendingAudioDeletions=journal.pending;
/** Add, replace (expected row first) or retire one row, with readback. */
export const changeAudioDeletion=journal.change;
/** Read authoritative storage, never an optimistic editor snapshot. No mutation/replay. */
export const audioDeletionNoteState=journal.noteState;
