import {Capacitor} from '@capacitor/core';
import type {CommsProposal} from './comms-bar';

/**
 * AP-16 AC-30: what Alpha's comms surfaces keep across process death. `open` is the one open
 * proposal card (data only: it is restored as a card and never executed on restore); `briefed` is
 * the contextKey the last briefing was shown for (AC-25), so an unchanged screen is not briefed
 * again. Android keeps it in the secure slot `alpha-proposal:v1`; the browser keeps it in the
 * document `alpha.browser.alpha-proposal:v1`.
 */
export type StoredProposal = {text: string; card: CommsProposal & {type: 'proposal'; state: 'open'}};
export type AlphaProposalRecord = {v: 1; briefed: string | null; open: StoredProposal | null};
export const ALPHA_PROPOSAL_SLOT = 'alpha-proposal:v1';
export const emptyProposalRecord = (): AlphaProposalRecord => ({v: 1, briefed: null, open: null});

const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;
/** Only the exact shape is accepted: anything else reads as an empty record, so nothing malformed is shown. */
export function parseProposalRecord(value: unknown): AlphaProposalRecord {
	const empty = emptyProposalRecord();
	if (!value || typeof value !== 'object' || Array.isArray(value)) return empty;
	const record = value as Record<string, unknown>;
	if (record.v !== 1 || Object.keys(record).some(key => !['v', 'briefed', 'open'].includes(key))) return empty;
	if (record.briefed !== null && !text(record.briefed, 512)) return empty;
	return {v: 1, briefed: record.briefed as string | null, open: parseStoredProposal(record.open)};
}
function parseStoredProposal(value: unknown): StoredProposal | null {
	if (!value || typeof value !== 'object') return null;
	const {text: line, card} = value as {text?: unknown; card?: Record<string, unknown>};
	if (!text(line, 4000) || !card || typeof card !== 'object') return null;
	const act = card.act as {mod?: unknown; fn?: unknown} | undefined;
	if (card.type !== 'proposal' || card.state !== 'open' || !text(card.id, 256) || !card.id || !['call', 'screen', 'other'].includes(card.kind as string)
		|| !text(card.title, 500) || !text(card.detail, 2000) || !text(card.button, 60) || typeof card.acts !== 'boolean'
		|| !act || !text(act.mod, 64) || !text(act.fn, 64) || !card.args || typeof card.args !== 'object' || Array.isArray(card.args)) return null;
	let args: Record<string, unknown>;
	try { args = JSON.parse(JSON.stringify(card.args)); } catch { return null; }
	return {text: line, card: {type: 'proposal', state: 'open', id: card.id as string, kind: card.kind as CommsProposal['kind'], title: card.title as string,
		detail: card.detail as string, button: card.button as string, acts: card.acts as boolean, act: {mod: act.mod as string, fn: act.fn as string}, args}};
}

async function nativeStore() {
	const {secureConnectionStore} = await import('./native-connection');
	return {
		read: async () => { const raw = await secureConnectionStore.readRaw(ALPHA_PROPOSAL_SLOT); try { return parseProposalRecord(raw === null ? null : JSON.parse(raw)); } catch { return emptyProposalRecord(); } },
		write: async (record: AlphaProposalRecord) => {
			const value = JSON.stringify(record);
			for (let attempt = 0; attempt < 3; attempt++) {
				const current = await secureConnectionStore.readRaw(ALPHA_PROPOSAL_SLOT);
				if (current === value) return;
				if ((await secureConnectionStore.compareExchangeRaw(ALPHA_PROPOSAL_SLOT, current, value)).status === 'saved') return;
			}
		},
	};
}
async function browserStore() {
	const domain = new (await import('../browser/json-domain-document')).BrowserJsonDomainDocument('alpha.browser.' + ALPHA_PROPOSAL_SLOT);
	return {
		read: async () => { try { return parseProposalRecord(await domain.readJson<unknown>()); } catch { return emptyProposalRecord(); } },
		write: (record: AlphaProposalRecord) => domain.editJson<unknown>(() => record),
	};
}
let store: ReturnType<typeof browserStore> | null = null;
/** The record store for this install; reads never throw and fall back to an empty record. */
export function alphaProposalStore() {
	return store ??= Capacitor.getPlatform() === 'android' ? nativeStore() : browserStore();
}
