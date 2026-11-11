import { NOTE_ID_REGEXP } from "../../../../.eliza/client-features/plugins/plugin-notes/src/note-id.ts";
import type { ReadCacheOwner } from "./service-read-cache-store";
import type { ServiceReadCache } from "./service-read-cache";

export interface NotesPreviewRow {
	id: string;
	title: string;
	body: string;
	kind: string;
	when: string;
	pinned?: boolean;
	folderId?: string;
	dur?: number;
	items?: Array<{ t: string; done: boolean }>;
	domain?: string;
	createdAt?: string | number;
	updatedAt?: string | number;
	modifiedAt?: string | number;
}
export interface NotesPreviewBinding {
	owner: ReadCacheOwner;
	scope: string;
}
type Preview = { scope: string; rows: NotesPreviewRow[]; revision?: number };
const key = "notes:last-list:v1";

function rowsFrom(value: unknown): NotesPreviewRow[] | null {
	if (!Array.isArray(value)) return null;
	const rows: NotesPreviewRow[] = [];
	const ids = new Set<string>();
	for (const row of value) {
		if (
			!row ||
			typeof row !== "object" ||
			typeof row.id !== "string" ||
			!NOTE_ID_REGEXP.test(row.id) ||
			ids.has(row.id) ||
			!["title", "body", "kind", "when"].every(
				(field) => typeof row[field] === "string",
			)
		)
			return null;
		ids.add(row.id);
		const saved: NotesPreviewRow = {
			id: row.id,
			title: row.title,
			body: row.body,
			kind: row.kind,
			when: row.when,
		};
		if (row.pinned != null) {
			if (typeof row.pinned !== "boolean") return null;
			saved.pinned = row.pinned;
		}
		for (const field of ["folderId", "domain"] as const) {
			if (row[field] != null) {
				if (typeof row[field] !== "string") return null;
				saved[field] = row[field];
			}
		}
		for (const field of ["createdAt", "updatedAt", "modifiedAt"] as const) {
			if (row[field] != null) {
				if (typeof row[field] !== "string" && !Number.isFinite(row[field]))
					return null;
				saved[field] = row[field];
			}
		}
		const duration =
			row.dur ??
			(typeof row.audio?.durationMs === "number"
				? row.audio.durationMs / 1000
				: undefined);
		if (duration !== undefined) {
			if (!Number.isFinite(duration) || duration < 0) return null;
			saved.dur = duration;
		}
		if (row.items != null) {
			if (
				!Array.isArray(row.items) ||
				!row.items.every(
					(item: { t?: unknown; done?: unknown } | null) =>
						item &&
						typeof item.t === "string" &&
						(item.done === undefined || typeof item.done === "boolean"),
				)
			)
				return null;
			saved.items = row.items.map((item: { t: string; done?: boolean }) => ({
				t: item.t,
				done: item.done === true,
			}));
		}
		rows.push(saved);
	}
	return rows;
}

/** Read-only startup presentation. A cached row never enters the Notes controller. */
export class NotesStartupCache {
	private epoch = 0;
	private value: {
		binding: NotesPreviewBinding;
		rows: NotesPreviewRow[];
	} | null = null;
	constructor(
		private readonly hooks: {
			resolveOwner(): Promise<ReadCacheOwner | null>;
			current(binding: NotesPreviewBinding): boolean;
			changed(): void;
		},
		private readonly openCache: (
			owner: ReadCacheOwner,
		) => Promise<ServiceReadCache>,
	) {}

	get rows(): NotesPreviewRow[] {
		return this.value && this.hooks.current(this.value.binding)
			? structuredClone(this.value.rows)
			: [];
	}

	async restore(): Promise<void> {
		const ticket = ++this.epoch;
		try {
			const owner = await this.hooks.resolveOwner();
			if (!owner || ticket !== this.epoch) return;
			const cache = await this.openCache(owner);
			const saved = await cache.get<Preview>(key);
			const confirmedOwner = await this.hooks.resolveOwner();
			const rows = rowsFrom(saved?.value?.rows);
			const scope = saved?.value?.scope;
			if (
				ticket !== this.epoch ||
				JSON.stringify(confirmedOwner) !== JSON.stringify(owner) ||
				!rows ||
				typeof scope !== "string"
			)
				return;
			const identity: unknown = JSON.parse(scope);
			if (
				!Array.isArray(identity) ||
				identity.length !== 3 ||
				!identity.every(
					(value) => typeof value === "string" && value.length > 0,
				)
			)
				return;
			const binding = { owner, scope };
			if (!this.hooks.current(binding)) return;
			this.value = { binding, rows };
			this.hooks.changed();
		} catch {
			// A missing local read leaves the live Notes read and loading state intact.
		}
	}

	remember(
		binding: NotesPreviewBinding,
		value: unknown,
		revision: number,
	): void {
		const rows = rowsFrom(value);
		if (
			!rows ||
			!Number.isSafeInteger(revision) ||
			revision < 0 ||
			!this.hooks.current(binding)
		)
			return;
		++this.epoch;
		this.value = { binding, rows };
		void this.openCache(binding.owner)
			.then((cache) => {
				if (!this.hooks.current(binding)) return;
				return cache.put(
					key,
					{ scope: binding.scope, rows, revision },
					undefined,
					(previous) => {
						const saved = previous as Preview | undefined;
						return (
							saved?.scope !== binding.scope ||
							!Number.isSafeInteger(saved.revision) ||
							(saved.revision ?? 0) <= revision
						);
					},
				);
			})
			.catch(() => {});
	}

	retire(): void {
		++this.epoch;
		this.value = null;
	}
}
