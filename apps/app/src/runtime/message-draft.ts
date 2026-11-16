/**
 * The draft slot of one SMS thread and the agent's suggested reply (specs/quint/native/
 * MessageThreads.qnt, docs/agentic-comms.md AC-10/13-16/24). The slot holds one pending text with
 * its provenance. An automatic suggestion is only ever offered (faint text in the bar): it is held
 * here but is not the field's text until the owner accepts it. A draft the owner asked Alpha for
 * replaces the slot and keeps the previous text for one Undo. Sending is the owner's tap and the
 * native review, outside this file.
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
  /** The slot content a replacement by Alpha displaced, for one Undo. */
  undo: {draft: 'owner' | 'agent' | 'asked'; text: string} | null;
};
export const emptyDraft = (): DraftState => ({draft: 'none', text: '', base: null, suggest: 'idle', ticket: null, declined: null, undo: null});

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
  return text ? {draft: 'owner', text, base: null, suggest: 'idle', ticket: null, declined, undo: null} : {...emptyDraft(), declined};
}
/** Accepting the faint suggestion (AC-24) or Edit on a draft bubble (AC-16): the text becomes the owner's. */
export function draftAdopted(state: DraftState): DraftState {
  return {...state, draft: 'owner', undo: null};
}
export function suggestionDismissed(state: DraftState): DraftState {
  if (state.draft === 'asked') return {...emptyDraft(), declined: state.declined};
  return state.draft === 'agent' ? {...emptyDraft(), declined: state.base} : state;
}
/**
 * A draft the owner asked Alpha to write for the thread (AC-14). It replaces whatever the slot holds,
 * the owner's own text included; the previous text is kept for one Undo. Unlike a suggestion it
 * answers no particular message, so a newer message does not retire it; it is still only a draft.
 */
export function askedDraftPlaced(state: DraftState, text: string, ready: boolean): DraftState {
  if (!ready || !text) return state;
  const undo = state.draft !== 'none' && state.text ? {draft: state.draft, text: state.text} : null;
  return {draft: 'asked', text, base: null, suggest: 'idle', ticket: null, declined: state.draft === 'agent' ? state.base : state.declined, undo};
}
/**
 * Undo of Alpha's last replacement: the displaced text comes back with its provenance. A restored
 * suggestion answers the message it was declined for when it was replaced. No undo: unchanged.
 */
export function draftUndone(state: DraftState): DraftState {
  const undo = state.undo;
  if (!undo) return state;
  return {...state, draft: undo.draft, text: undo.text, base: undo.draft === 'agent' ? state.declined : null, suggest: 'idle', ticket: null, undo: null};
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
/**
 * AC-13: canvas pixels the stage needs for its header, the newest inbound message and the whole draft
 * bubble (offsetHeight and scrollHeight, never client rectangles); null when no draft bubble shows.
 */
export function draftStageFit(root: ParentNode = document): number | null {
  const app = root.querySelector('[data-alpha-layer="app"]');
  const bubble = app?.querySelector<HTMLElement>('[data-alpha-draft-bubble]');
  if (!app || !bubble) return null;
  const header = app.querySelector<HTMLElement>('[data-alpha-stage-header]'), last = app.querySelector<HTMLElement>('[data-alpha-stage-last]');
  return (header?.offsetHeight ?? 0) + (last ? last.offsetHeight + 18 : 0) + bubble.scrollHeight + 22;
}
