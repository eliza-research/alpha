/**
 * AP-16 comms surfaces (docs/agentic-comms.md): the contract between the shell and the Phone,
 * Contacts and Messages views. A view declares `bar(st, api): CommsBarSpec` on its registerView
 * definition (Android adapters replace it the way they replace `render`). The shell reads it to draw
 * the one bottom bar, the stage, the live strip and the faint suggestion. Types and small registries
 * only: no DOM access and no imports.
 */
export type CommsApp = 'Messages' | 'Phone' | 'Contacts';
export type CommsTargetKind = 'list' | 'thread' | 'recents' | 'call' | 'incoming' | 'contact';
/** What the closed bar's field addresses: the person (SMS text), the list filter, or Alpha. */
export type CommsFieldKind = 'person' | 'filter' | 'alpha';
export type CommsLeftIcon = 'avatar' | 'call' | 'search' | 'keypad';
export type CommsStripActionId = 'mute' | 'end' | 'send' | 'answer' | 'decline';

export type CommsTarget = {
	kind: CommsTargetKind;
	app: CommsApp;
	/** Display name of the person on screen; null on lists, Recents and the keypad. */
	name: string | null;
	/** First name, for "Text <first>"; null when name is null. */
	first: string | null;
	/** Avatar initials; null when name is null. */
	initials: string | null;
};

export type CommsClosedField = {
	kind: CommsFieldKind;
	/** "Text Maya", "Search or ask", "Call or ask", "Ask during call" or "Ask about Maya". */
	placeholder: string;
	/** person and filter: the text the view owns (SMS body or list query). Ignored for 'alpha'. */
	value: string;
	/** person and filter: called with the field's whole text on every input. Null for 'alpha'. */
	onText: ((text: string) => void) | null;
	/** person: the view's own Send, the same path as its Send button. Null otherwise. */
	submit: ((event?: MouseEvent) => void) | null;
	canSubmit: boolean;
	/** person: 1600 for SMS. Null: no limit. */
	maxLength: number | null;
	/** AC-24 closed faint suggestion: a thread's suggested reply while the opt-in is on. Null otherwise. */
	suggestion: string | null;
	/** Puts `suggestion` into the field without sending. Null when suggestion is null. */
	acceptSuggestion: (() => void) | null;
};

export type CommsStripAction = { id: CommsStripActionId; label: string; run: (event?: MouseEvent) => void; pressed?: boolean };
export type CommsStrip = { title: string; subtitle: string; initials: string | null; live: boolean; actions: CommsStripAction[] };
export type CommsIncoming = { answer: () => void; decline: () => void; screen: (() => void) | null };

export type CommsBarSpec = {
	target: CommsTarget;
	closed: CommsClosedField;
	/** Open-state left slot (AC-08) and its TalkBack name (AC-29). `run` follows the shell's close. */
	left: { icon: CommsLeftIcon; label: string; initials: string | null; run: (() => void) | null };
	/** Sheet header context (AC-09), for example "Maya Chen · Messages". */
	context: string;
	/** Changes exactly when the subject on screen changes: `${view}:${target.kind}:${subjectId}`. */
	contextKey: string;
	strip: CommsStrip;
	/** AC-18: hangs up; non-null only while a call is live. */
	end: (() => void) | null;
	/** AC-21: non-null only while a call is ringing. */
	incoming: CommsIncoming | null;
	/** AC-19: an emergency call is on screen. */
	emergency: boolean;
	/** AC-13: canvas pixels the stage needs for its header, the last incoming message and the whole draft; null when no draft waits. */
	fit: (() => number | null) | null;
	/** AC-25: one or two sentences of facts from the view's own sources, or null. Never fixture text in production. */
	briefing: string | null;
};

/** AC-26: one action card with one button. Executed only by the owner's tap, through card.act like any chat card. */
export type CommsProposal = {
	id: string;
	kind: 'call' | 'screen' | 'other';
	title: string;
	detail: string;
	button: string;
	/** False for a proposal that only shows or notes something; AC-19 drops every proposal with acts true. */
	acts: boolean;
	act: { mod: string; fn: string };
	args: Record<string, unknown>;
};

export type CommsListView = 'messages' | 'contacts' | 'phone';
export type CommsListFilter = { query: string; label: string; by: 'owner' | 'alpha' };
export type CommsListFilterHandler = {
	apply: (filter: CommsListFilter) => boolean;
	clear: () => void;
	current: () => CommsListFilter | null;
};
const listFilters = new Map<CommsListView, CommsListFilterHandler>();
/** The list on screen registers how to filter it; null unregisters. The latest registration wins. */
export function setListFilterHandler(view: CommsListView, handler: CommsListFilterHandler | null): void {
	if (handler) listFilters.set(view, handler);
	else listFilters.delete(view);
}
/** AC-22: filters that list on the device. False when the list is not registered or refused it. */
export function applyListFilter(view: CommsListView, filter: CommsListFilter): boolean {
	return listFilters.get(view)?.apply(filter) ?? false;
}
export function clearListFilter(view: CommsListView): void {
	listFilters.get(view)?.clear();
}
export function currentListFilter(view: CommsListView): CommsListFilter | null {
	return listFilters.get(view)?.current() ?? null;
}

export type OpenSuggestionInput = { view: string | null; spec: CommsBarSpec | null; candidates: string[] };
let openSuggestionSource: ((input: OpenSuggestionInput) => string | null) | null = null;
/** AC-24 open state: the alpha package installs the source; without one there is no faint suggestion. */
export function setOpenSuggestionSource(next: ((input: OpenSuggestionInput) => string | null) | null): void {
	openSuggestionSource = next;
}
export function openSuggestion(input: OpenSuggestionInput): string | null {
	try {
		return openSuggestionSource ? openSuggestionSource(input) : null;
	} catch {
		return null;
	}
}

/** AC-05/AC-06: one entry of S.stageFrom. `patch` is the minimal view sub-state that restores the
 * previous stage (for example { thread: null } when a thread was staged over the Messages list). */
export type CommsStageEntry = { view: string; title: string; patch: Record<string, unknown> | null };

/** AC-26: what Component.propose / api.propose did. `replaced` lists the proposals it closed, so the
 * live path can decline them upstream. shown is false when AC-19 dropped an acting proposal. */
export type CommsProposeResult = { shown: boolean; replaced: CommsProposal[] };

/** AC-22: a list query that reads as a sentence is a question for Alpha, not a local filter. It is
 * still sent only by Enter (or the end of a dictated utterance); nothing is sent while typing. */
export function isAskSentence(text: string): boolean {
	const t = text.trim();
	if (!t) return false;
	if (/[?]$/.test(t)) return true;
	return t.split(/\s+/).length >= 4;
}

/** AC-26: a proposal card's lifecycle in the transcript. Only 'open' may act. */
export type CommsProposalState = 'open' | 'replaced' | 'done';
/** The one check every card dispatcher (shell cardAct and the live agent override) runs first:
 * a card that is not a proposal is unaffected; a proposal acts only while open. */
export function proposalCanAct(card: { type?: unknown; state?: unknown } | null | undefined): boolean {
	return !card || card.type !== 'proposal' || card.state === 'open';
}
