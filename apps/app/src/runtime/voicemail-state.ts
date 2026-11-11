/**
 * One open voicemail in the Phone view (specs/quint/native/Voicemail.qnt): its audio, playback and
 * transcript. Every reply carries the ticket it was requested under, so a reply for a voicemail that
 * was closed, replaced or deleted changes nothing. Transcription follows the owner's speech setting;
 * an unavailable on-device recognizer is reported as unavailable and never sent to the cloud instead.
 */
export type TranscriptEngine = 'device' | 'cloud' | 'carrier';
export type OpenVoicemail = {
  id: string | null;
  /** Changes whenever a different voicemail (or none) is open. */
  ticket: number;
  audio: 'none' | 'fetching' | 'ready' | 'failed';
  transcript: 'none' | 'running' | 'done' | 'failed' | 'unavailable';
  text: string;
  engine: TranscriptEngine | null;
  playback: 'idle' | 'playing' | 'paused';
  heard: boolean;
  confirmDelete: boolean;
};
export const closedVoicemail = (ticket = 0): OpenVoicemail =>
  ({id: null, ticket, audio: 'none', transcript: 'none', text: '', engine: null, playback: 'idle', heard: false, confirmDelete: false});

/** Opening a voicemail; a carrier transcript, when the carrier supplied one, is shown as it is. */
export function opened(state: OpenVoicemail, id: string, heard: boolean, carrierTranscript: string | null): OpenVoicemail {
  if (state.id === id) return state;
  const next = {...closedVoicemail(state.ticket + 1), id, heard};
  return carrierTranscript ? {...next, transcript: 'done', text: carrierTranscript, engine: 'carrier'} : next;
}
/** Closed, deleted here or elsewhere, or the list no longer holds it. */
export const closed = (state: OpenVoicemail): OpenVoicemail => state.id === null ? state : closedVoicemail(state.ticket + 1);
export function audioRequested(state: OpenVoicemail, ready: boolean): OpenVoicemail {
  return ready && state.id !== null && (state.audio === 'none' || state.audio === 'failed') ? {...state, audio: 'fetching'} : state;
}
export function audioReplied(state: OpenVoicemail, ticket: number, ok: boolean): OpenVoicemail {
  return state.audio === 'fetching' && ticket === state.ticket ? {...state, audio: ok ? 'ready' : 'failed'} : state;
}
/**
 * `mode` is the owner's speech setting. On-device with no recognizer available answers
 * `unavailable`; it never becomes a cloud request.
 */
export function transcriptRequested(state: OpenVoicemail, ready: boolean, mode: 'local' | 'cloud', localAvailable: boolean): OpenVoicemail {
  if (!ready || state.id === null || state.audio !== 'ready' || !['none', 'failed', 'unavailable'].includes(state.transcript)) return state;
  if (mode === 'local' && !localAvailable) return {...state, transcript: 'unavailable', text: '', engine: null};
  return {...state, transcript: 'running', text: '', engine: mode === 'local' ? 'device' : 'cloud'};
}
export function transcriptReplied(state: OpenVoicemail, ticket: number, text: string | null): OpenVoicemail {
  if (state.transcript !== 'running' || ticket !== state.ticket) return state;
  return text ? {...state, transcript: 'done', text} : {...state, transcript: 'failed', text: '', engine: null};
}
/** Playing marks the voicemail heard. Nothing plays during a call. */
export function played(state: OpenVoicemail, ready: boolean, inCall: boolean): OpenVoicemail {
  return ready && !inCall && state.id !== null && state.audio === 'ready' && state.playback !== 'playing' ? {...state, playback: 'playing', heard: true} : state;
}
export const paused = (state: OpenVoicemail): OpenVoicemail => state.playback === 'playing' ? {...state, playback: 'paused'} : state;
export const ended = (state: OpenVoicemail): OpenVoicemail => state.playback === 'playing' ? {...state, playback: 'idle'} : state;
export const callStarted = paused;
/** Lock, background or lost access: playback stops and a pending delete confirmation closes. */
export const readinessLost = (state: OpenVoicemail): OpenVoicemail =>
  state.playback === 'idle' && !state.confirmDelete ? state : {...state, playback: 'idle', confirmDelete: false};
export const deleteAsked = (state: OpenVoicemail, ready: boolean): OpenVoicemail => ready && state.id !== null ? {...state, confirmDelete: true} : state;
export const deleteCancelled = (state: OpenVoicemail): OpenVoicemail => state.confirmDelete ? {...state, confirmDelete: false} : state;
/** The confirmed delete's result: gone, or kept with the confirmation closed. */
export const deleteFinished = (state: OpenVoicemail, ok: boolean): OpenVoicemail => !state.confirmDelete ? state : ok ? closed(state) : {...state, confirmDelete: false};
