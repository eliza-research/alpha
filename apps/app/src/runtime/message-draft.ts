/**
 * The composer draft of one open SMS thread and the agent's suggested reply (specs/quint/native/
 * MessageThreads.qnt). A suggestion is only ever a draft: it lands in an empty composer for the
 * newest unanswered inbound message, is retired when a newer message arrives, and never replaces
 * what the owner typed. Sending is the owner's tap and the native review, outside this file.
 */
export type DraftState = {
  /** Who wrote the composer text: the owner, an automatic suggestion, or a draft the owner asked Alpha for. */
  draft: 'none' | 'owner' | 'agent' | 'asked';
  text: string;
  /** The inbound message an agent draft answers. */
  base: string | null;
  suggest: 'idle' | 'running' | 'failed';
  /** The inbound message the running or failed request was made for. */
  ticket: string | null;
  /** The inbound message whose suggestion the owner dismissed; it is not suggested again. */
  declined: string | null;
};
export const emptyDraft = (): DraftState => ({draft: 'none', text: '', base: null, suggest: 'idle', ticket: null, declined: null});

/** `latest` is the newest message's id when it is inbound and unanswered, otherwise null. */
export function threadChanged(state: DraftState, latest: string | null): DraftState {
  if (state.draft === 'agent' && state.base !== latest) return {...emptyDraft(), declined: state.declined};
  if (state.suggest !== 'idle' && state.ticket !== latest) return {...state, suggest: 'idle', ticket: null};
  return state;
}
export function canSuggest(state: DraftState, latest: string | null, ready: boolean): boolean {
  return ready && !!latest && state.draft === 'none' && state.suggest === 'idle' && state.declined !== latest;
}
export function suggestionRequested(state: DraftState, latest: string | null, ready: boolean): DraftState {
  return canSuggest(state, latest, ready) ? {...state, suggest: 'running', ticket: latest} : state;
}
/** A reply for anything but the current request, the current message and an empty composer is dropped. */
export function suggestionReplied(state: DraftState, ticket: string, latest: string | null, ready: boolean, text: string | null): DraftState {
  if (state.suggest !== 'running' || ticket !== state.ticket) return state;
  if (ticket !== latest || state.draft !== 'none' || !ready) return {...state, suggest: 'idle', ticket: null};
  return text ? {...state, draft: 'agent', text, base: ticket, suggest: 'idle', ticket: null} : {...state, suggest: 'failed'};
}
/** Typing takes ownership; a running suggestion can no longer land. Emptying the field clears the draft. */
export function typed(state: DraftState, text: string): DraftState {
  const declined = state.draft === 'agent' ? state.base : state.declined;
  return text ? {draft: 'owner', text, base: null, suggest: 'idle', ticket: null, declined} : {...emptyDraft(), declined};
}
export function suggestionDismissed(state: DraftState): DraftState {
  if (state.draft === 'asked') return {...emptyDraft(), declined: state.declined};
  return state.draft === 'agent' ? {...emptyDraft(), declined: state.base} : state;
}
/**
 * A draft the owner asked Alpha to write for the open conversation. It lands in an empty composer or
 * replaces an automatic suggestion, and never replaces what the owner typed. Unlike a suggestion it
 * answers no particular message, so a newer message does not retire it; it is still only a draft.
 */
export function askedDraftPlaced(state: DraftState, text: string, ready: boolean): DraftState {
  if (!ready || !text || state.draft === 'owner') return state;
  return {draft: 'asked', text, base: null, suggest: 'idle', ticket: null, declined: state.draft === 'agent' ? state.base : state.declined};
}
/**
 * After a confirmed review. Accepted by the phone: the composer clears. `failed`: the draft stays for
 * another try. `unknown`: the draft stays bound to the same operation, so Send again reads that
 * operation back and can never send a second copy.
 */
export function reviewFinished(state: DraftState, result: 'sent' | 'failed' | 'unknown'): DraftState {
  return result === 'sent' ? {...emptyDraft(), declined: state.declined} : state;
}
/** Leaving readiness (lock, background, lost access) stops a running suggestion and keeps the text. */
export function readinessLost(state: DraftState): DraftState {
  return state.suggest === 'running' ? {...state, suggest: 'idle', ticket: null} : state;
}
