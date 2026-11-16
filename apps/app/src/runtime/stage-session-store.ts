import {Capacitor} from '@capacitor/core';
import type {CommsStageEntry} from './comms-bar';

/**
 * AC-30: where the comms stage was left, so process death or a permission loss returns the owner to
 * the same sheet height, stage view and stage history. Data only: restoring never runs an action,
 * sends, dials or opens a proposal. The Alpha request draft is not kept here (composerDraft owns it)
 * and neither are SMS drafts (sms-draft-store) or proposals (alpha-proposal-store).
 *
 * Android keeps it in the renderer secure slot `stage-session:v1`; the browser in the document
 * `alpha.browser.stage-session:v1`.
 */
export type StageSession = {
	chat: 'input' | 'sheet' | 'full';
	/** The share of the screen the owner dragged the open sheet to, or null for the fitted height. */
	sheetShare: number | null;
	view: string;
	stageFrom: CommsStageEntry[];
};

export const STAGE_SESSION_SLOT = 'stage-session:v1';
const VIEW = /^[a-z][a-z0-9-]{0,39}$/;
const STAGE_DEPTH = 8;

function entry(value: unknown): CommsStageEntry | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const item = value as Record<string, unknown>;
	if (Object.keys(item).some(key => key !== 'view' && key !== 'title' && key !== 'patch')) return null;
	if (typeof item.view !== 'string' || !VIEW.test(item.view) || typeof item.title !== 'string' || item.title.length > 80) return null;
	const patch = item.patch;
	if (patch !== null && (!patch || typeof patch !== 'object' || Array.isArray(patch))) return null;
	return {view: item.view, title: item.title, patch: patch === null ? null : {...(patch as Record<string, unknown>)}};
}

/** The exact stored shape, or null for anything else (a corrupt or foreign value starts fresh). */
export function stageSessionFrom(value: unknown): StageSession | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const session = value as Record<string, unknown>;
	const keys = Object.keys(session).sort().join(',');
	if (keys !== 'chat,sheetShare,stageFrom,v,view' || session.v !== 1) return null;
	if (session.chat !== 'input' && session.chat !== 'sheet' && session.chat !== 'full') return null;
	const share = session.sheetShare;
	if (share !== null && (typeof share !== 'number' || !(share > 0 && share <= 1))) return null;
	if (typeof session.view !== 'string' || !VIEW.test(session.view)) return null;
	if (!Array.isArray(session.stageFrom) || session.stageFrom.length > STAGE_DEPTH) return null;
	const stageFrom = session.stageFrom.map(entry);
	if (stageFrom.some(item => item === null)) return null;
	// Stage history exists only while the chat is open (ChatDock StageFromEmptyWhenClosed).
	if (session.chat === 'input' && stageFrom.length) return null;
	return {chat: session.chat, sheetShare: share as number | null, view: session.view, stageFrom: stageFrom as CommsStageEntry[]};
}

export function stageSessionValue(session: StageSession): Record<string, unknown> {
	return {v: 1, chat: session.chat, sheetShare: session.sheetShare, view: session.view, stageFrom: session.stageFrom.slice(-STAGE_DEPTH)};
}

export type StageSessionStore = {read(): Promise<StageSession | null>; write(session: StageSession | null): Promise<void>};

export function stageSessionStore(): StageSessionStore {
	if (Capacitor.getPlatform() === 'android') {
		const store = import('./native-connection').then(module => module.secureConnectionStore);
		return {
			read: async () => stageSessionFrom(await (await store).read<unknown>(STAGE_SESSION_SLOT).catch(() => null)),
			write: async session => {
				const secure = await store;
				if (session) await secure.write(STAGE_SESSION_SLOT, stageSessionValue(session));
				else await secure.remove(STAGE_SESSION_SLOT);
			},
		};
	}
	const document = import('../browser/json-domain-document').then(module => new module.BrowserJsonDomainDocument('alpha.browser.' + STAGE_SESSION_SLOT));
	return {
		read: async () => stageSessionFrom(await (await document).readJson<unknown>().catch(() => null)),
		write: async session => { await (await document).editJson<unknown>(() => session ? stageSessionValue(session) : null); },
	};
}
