import type { ReadCacheOwner } from "./service-read-cache-store";

export const HOME_STARTUP_CACHE = "alpha.home.overview.v1";
let credentialEpoch = 0;
type Values = Record<string, unknown>;
export type HomeCacheContext = {
	owner: ReadCacheOwner | null;
	scope: string | null;
	restoring: boolean;
	allowed: boolean;
};
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const textFields = [
	"homeCalendarFooter",
	"homeCalendarLabel",
	"homeCalendarTime",
	"homeCalendarTitle",
	"homeCalendarSource",
	"homeCalendarOrigin",
	"homeCalendarDescription",
	"homeCalendarNext",
	"homeCalendarNextSource",
	"homePeopleVisibility",
	"homeInboxCount",
	"homeInboxTitle",
	"homeInboxStatus",
	"homeInboxDescription",
	"homeInboxState",
	"homeAttentionLabel",
	"homeWorkflowFreshness",
	"homeWorkflowDescription",
	"homeWorkflowTitle",
	"homeWorkflowTime",
	"homeWorkflowLabel",
	"homeBriefTitle",
	"homeBriefStatus",
	"homeBriefLabel",
] as const;
const booleanFields = [
	"homeShowCalendar",
	"homeShowInbox",
	"homeShowWorkflows",
	"homeGoogleConnected",
	"homeCalendarHasEvent",
	"homeCalendarHasMeta",
	"homeCalendarOverdue",
	"homeCalendarStale",
	"homeCalendarHasNext",
	"homeCalendarVideo",
	"homeInboxHasRows",
	"homeWorkflowHasRows",
	"homeBriefHas",
	"homeBriefFailed",
] as const;
const rowFields = {
	homeInboxRows: ["subject", "from"],
	homeWorkflowRows: ["name", "status"],
	homeCalendarPeople: ["ini"],
} as const;
const dayKey = (date: Date) =>
	`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
const ownerKey = (owner: ReadCacheOwner) =>
	JSON.stringify([
		owner.environment,
		owner.userId,
		owner.organizationId,
		owner.credentialId,
	]);

/** A read-only rendering cache. It contains displayed text, never action callbacks,
 * provider keys, message bodies or mutation authority. The normal source owners
 * still replace these values after their reads complete. */
export class HomeStartupCache {
	private saved = "";
	private pending = "";
	constructor(
		private readonly storage: StoragePort,
		private readonly context: () => HomeCacheContext,
		private readonly now = () => new Date(),
	) {}

	read(): Values | null {
		try {
			const context = this.context();
			if (!context.allowed) return null;
			const raw = this.storage.getItem(HOME_STARTUP_CACHE);
			if (!raw) return null;
			const record = JSON.parse(raw),
				date = this.now();
			if (
				record.version !== 1 ||
				record.day !== dayKey(date) ||
				record.zone !== Intl.DateTimeFormat().resolvedOptions().timeZone ||
				!Array.isArray(record.owner) ||
				record.owner.length !== 4 ||
				!record.owner.every(
					(part: unknown) => typeof part === "string" && part.length > 0,
				) ||
				typeof record.scope !== "string" ||
				!record.scope ||
				this.storage.getItem("alpha.connection.cloud-service.v1") !==
					record.owner[0] ||
				(context.owner &&
					ownerKey(context.owner) !== JSON.stringify(record.owner)) ||
				(context.scope && context.scope !== record.scope) ||
				(!context.owner && !context.restoring)
			)
				return null;
			const value = record.values;
			if (!value || typeof value !== "object" || Array.isArray(value))
				return null;
			for (const field of textFields)
				if (field in value && typeof value[field] !== "string") return null;
			for (const field of booleanFields)
				if (field in value && typeof value[field] !== "boolean") return null;
			for (const [field, columns] of Object.entries(rowFields)) {
				if (
					field in value &&
					(!Array.isArray(value[field]) ||
						!value[field].every(
							(row: Values) =>
								row &&
								typeof row === "object" &&
								columns.every((column) => typeof row[column] === "string"),
						))
				)
					return null;
			}
			this.saved = raw;
			return this.pick(value);
		} catch {
			return null;
		}
	}

	remember(values: Values): void {
		const context = this.context();
		if (!context.allowed || !context.owner || !context.scope) return;
		const date = this.now(),
			owner = JSON.parse(ownerKey(context.owner));
		const raw = JSON.stringify({
			version: 1,
			owner,
			scope: context.scope,
			day: dayKey(date),
			zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
			values: this.pick(values),
		});
		if (raw === this.saved || raw === this.pending) return;
		const epoch = credentialEpoch;
		let previous: string | null;
		try {
			previous = this.storage.getItem(HOME_STARTUP_CACHE);
		} catch {
			return;
		}
		this.pending = raw;
		queueMicrotask(() => {
			if (this.pending !== raw || epoch !== credentialEpoch) return;
			this.pending = "";
			const current = this.context();
			if (
				!current.allowed ||
				!current.owner ||
				ownerKey(current.owner) !== JSON.stringify(owner) ||
				current.scope !== context.scope
			)
				return;
			try {
				if (this.storage.getItem(HOME_STARTUP_CACHE) !== previous) return;
				this.storage.setItem(HOME_STARTUP_CACHE, raw);
				this.saved = raw;
			} catch {
				/* Live sources still work. */
			}
		});
	}

	private pick(values: Values): Values {
		const result: Values = {};
		for (const field of [...textFields, ...booleanFields])
			if (field in values) result[field] = values[field];
		for (const [field, columns] of Object.entries(rowFields)) {
			if (Array.isArray(values[field]))
				result[field] = values[field].map((row) =>
					Object.fromEntries(
						columns.map((column) => [column, row[column] ?? ""]),
					),
				);
		}
		return result;
	}
}

/** Called before credential replacement/removal, including cancelled sign-ins. */
export function clearHomeStartupCache(): void {
	credentialEpoch++;
	try {
		localStorage.removeItem(HOME_STARTUP_CACHE);
	} catch {
		/* Optional presentation cache. */
	}
}
