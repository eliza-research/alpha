/**
 * AP-16 (docs/agentic-comms.md): what Alpha adds to the Phone, Messages and Contacts surfaces.
 * - AC-24 open state: the one faint next request, chosen from the view's own suggestions.
 * - AC-25: the briefing, the view's own facts, shown once per screen subject when the chat opens.
 * - AC-21: "Screen it" proposed for a call that rings while the chat is open.
 * - AC-30: the open proposal card and the last briefed subject survive process death; a restored
 *   card is data only and is never executed on restore.
 * Everything here reads the view's `bar(st, api)` spec (runtime/comms-bar.ts) and writes only
 * through the shell's `api.note` and `api.propose`. Nothing is sent, dialed or written to a provider.
 */
import {setOpenSuggestionSource, type CommsBarSpec, type CommsProposal, type OpenSuggestionInput} from '../runtime/comms-bar';
import {alphaProposalStore, parseProposalRecord, type AlphaProposalRecord, type StoredProposal} from '../runtime/alpha-proposal-store';
import {isMvpView} from './mvp-features';

type Shell = any;

/** The comms spec of the view on screen, or null when it is not an admitted comms view (D2). A throw counts as null. */
export function activeCommsSpec(shell: Shell, views: Shell): CommsBarSpec | null {
	const view = shell.S().view;
	if (!view || !isMvpView(view)) return null;
	const bar = views[view]?.bar;
	if (typeof bar !== 'function') return null;
	try { return bar(shell.vget(view), shell.api(view)) || null; } catch { return null; }
}

/** Feature prompts, never a specific next step (AC-24). Compared without case or end punctuation. */
const FEATURE_PHRASES = new Set(['set a reminder', 'create a note', 'add a contact', 'plan my afternoon', 'what needs me', 'take a note',
	'any new texts', 'who called', 'check voicemail', 'call someone', 'send a text', 'search contacts', 'make a call', 'new message']);
const phrase = (text: string) => text.trim().toLowerCase().replace(/[\s.?!]+$/, '');
/**
 * AC-24 open state: the first candidate that names something specific on screen: the person's
 * name, a digit, or a capitalised word other than its first word. Feature phrases never qualify.
 */
export function pickOpenSuggestion(input: OpenSuggestionInput): string | null {
	const names = [input.spec?.target.first, input.spec?.target.name].filter((name): name is string => !!name).map(name => name.toLowerCase());
	for (const candidate of input.candidates) {
		if (typeof candidate !== 'string') continue;
		const text = candidate.trim();
		if (!text || text.length > 120 || FEATURE_PHRASES.has(phrase(text))) continue;
		const lower = text.toLowerCase();
		if (names.some(name => lower.includes(name)) || /\d/.test(text) || text.split(/\s+/).slice(1).some(word => /^[A-Z][a-z]/.test(word))) return text;
	}
	return null;
}

/** AC-25: the briefing to show now, or null. Only when the chat has just opened on a subject not yet briefed. */
export function briefingDue(opened: boolean, spec: CommsBarSpec | null, briefed: string | null): string | null {
	if (!opened || !spec?.briefing?.trim() || spec.contextKey === briefed) return null;
	return spec.briefing.trim();
}

/** AC-21: the one "Screen it" proposal for a ringing call. */
export function screenProposal(spec: CommsBarSpec): CommsProposal {
	return {id: 'screen:' + spec.contextKey, kind: 'screen', title: 'Screen it', detail: spec.target.name || 'Incoming call', button: 'Screen it', acts: true,
		act: {mod: 'phone', fn: 'screenIncoming'}, args: {}};
}

/** The open proposal card to keep across process death (AC-30), or null. Live ones (args.proposalId) are re-offered by the agent's pending-action recovery instead. */
export function openProposalOf(msgs: Shell[]): StoredProposal | null {
	for (let index = msgs.length - 1; index >= 0; index--) {
		const card = msgs[index]?.card;
		if (card?.type !== 'proposal') continue;
		if (card.state !== 'open' || card.args?.proposalId) return null;
		return parseProposalRecord({v: 1, briefed: null, open: {text: String(msgs[index].text || ''), card}}).open;
	}
	return null;
}

const chatOpen = (chat: unknown) => chat === 'sheet' || chat === 'full';

export function installCommsAlpha(Component: Shell, views: Shell) {
	setOpenSuggestionSource(pickOpenSuggestion);
	const p = Component.prototype, mount = p.componentDidMount, update = p.componentDidUpdate, unmount = p.componentWillUnmount, render = p.renderVals;
	function persist(shell: Shell) {
		if (!shell.commsRecord) return;
		const record: AlphaProposalRecord = {v: 1, briefed: shell.commsRecord.briefed, open: openProposalOf(shell.S().msgs || [])};
		const value = JSON.stringify(record);
		if (value === shell.commsRecordWritten) return;
		shell.commsRecordWritten = value;
		shell.commsRecordWrite = Promise.resolve(shell.commsRecordWrite).then(async () => (await alphaProposalStore()).write(record)).catch(() => {});
	}
	p.componentDidMount = function () {
		mount?.call(this);
		this.commsLive = true;
		void alphaProposalStore().then(store => store.read()).then(record => {
			if (!this.commsLive) return;
			this.commsRecord = record;this.commsRecordWritten = JSON.stringify(record);
			const open = record.open;
			// Data only: the card is shown again and acts only on a new tap.
			if (open && !(this.S().msgs || []).some((message: Shell) => message.card?.id === open.card.id)) {
				this.setState((previous: Shell) => (previous.msgs || []).some((message: Shell) => message.card?.id === open.card.id) ? null
					: {msgs: [...(previous.msgs || []), {id: 'restored-proposal:' + open.card.id, from: 'agent', text: open.text, card: {...open.card}}]});
			}
		}).catch(() => { if (this.commsLive) this.commsRecord = {v: 1, briefed: null, open: null}; });
	};
	p.componentDidUpdate = function (...args: Shell[]) {
		update?.apply(this, args);
		const S = this.S(), open = chatOpen(S.chat), opened = open && !this.commsChatWasOpen;
		this.commsChatWasOpen = open;
		const spec = activeCommsSpec(this, views);
		if (opened) this.commsBriefingDue = true;
		if (!open) this.commsBriefingDue = false;
		if (this.commsBriefingDue && this.commsRecord) {
			this.commsBriefingDue = false;
			const briefing = briefingDue(true, spec, this.commsRecord.briefed);
			if (briefing && spec) {
				this.commsRecord = {...this.commsRecord, briefed: spec.contextKey};
				this.api(S.view).note(briefing, {quiet: false, briefing: true});
			}
		}
		if (spec?.incoming?.screen && open) {
			if (this.commsScreenProposed !== spec.contextKey) { this.commsScreenProposed = spec.contextKey; this.api(S.view).propose(screenProposal(spec)); }
		} else if (!spec?.incoming) this.commsScreenProposed = undefined;
		persist(this);
	};
	p.componentWillUnmount = function () { this.commsLive = false; unmount?.call(this); };
	// The proposal card's one button shows only while it can act and no review rows replace it.
	p.renderVals = function () {
		const out = render.call(this);
		out.msgs = (out.msgs || []).map((m: Shell) => m.c?.type !== 'proposal' ? m : {...m,
			proposalAsk: m.c.state === 'open' && !m.c.reviewUnavailable && !m.c.reviewing?.open,
			proposalTone: m.c.kind === 'call' ? 'var(--alpha-call-green)' : 'var(--acc)'});
		return out;
	};
}
