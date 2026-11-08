import type { LinkedCalendarSemanticEvent } from "../../../../.eliza/client-features/packages/contracts/src/calendar-linked-sync";
import type { CalendarRecord } from "./calendar-records";
import type { CalendarRepeat } from "./calendar-recurrence";
const rules: Record<string, string> = {
	daily: "RRULE:FREQ=DAILY",
	weekdays: "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
	weekly: "RRULE:FREQ=WEEKLY",
};
const email = (value: string) =>
	/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(value) && value.length <= 320;
export type CalendarAttendeeResolver = (id: string) => string | undefined;
function address(id: string, resolve?: CalendarAttendeeResolver) {
	const value = resolve?.(id) || id;
	if (!email(value))
		throw Error(
			"This attendee needs an email address before syncing. Nothing changed.",
		);
	return value.toLowerCase();
}
export function syncAttendees(
	row: CalendarRecord,
	resolve?: CalendarAttendeeResolver,
): LinkedCalendarSemanticEvent["attendees"] {
	const seen = new Set<string>();
	return (row.who || []).map((id) => {
		const value = address(id, resolve);
		if (seen.has(value))
			throw Error(
				"Two local attendees resolve to the same email address. Review the guest list.",
			);
		seen.add(value);
		return {
			email: value,
			optional: row.attendeeOptions?.[id]?.optional === true,
		};
	});
}
export function localAttendees(
	before: CalendarRecord,
	attendees: LinkedCalendarSemanticEvent["attendees"],
	resolve?: CalendarAttendeeResolver,
) {
	const known = new Map(
		(before.who || []).map((id) => [address(id, resolve), id]),
	);
	const who: string[] = [],
		attendeeOptions: NonNullable<CalendarRecord["attendeeOptions"]> = {};
	for (const attendee of attendees) {
		if (!email(attendee.email) || who.length >= 100)
			throw Error("Review the Google guest list before syncing.");
		const normalized = attendee.email.toLowerCase(),
			id = known.get(normalized) || normalized;
		if (who.includes(id)) throw Error("Google returned duplicate attendees.");
		who.push(id);
		attendeeOptions[id] = { optional: attendee.optional === true };
	}
	return { who, attendeeOptions };
}
export function syncRecurrence(row: CalendarRecord): string[] {
	if (row.seriesId)
		throw Error(
			"Sync the series rather than an individual occurrence. Nothing changed.",
		);
	const repeat = row.repeat || "none";
	// Deleted dates mean nothing once an event no longer repeats. Older edits kept them.
	if (repeat === "none") return [];
	const rule = rules[repeat];
	if (!rule)
		throw Error(
			"This repeat rule cannot be synced without losing fields. Nothing changed.",
		);
	const recurrence = [rule];
	if (row.excluded?.length) {
		const values = [...new Set(row.excluded)]
			.sort((a, b) => a - b)
			.map((value) => {
				if (
					!Number.isFinite(value) ||
					value % 1000 !== 0 ||
					(row.allDay && value % 86400000 !== 0)
				)
					throw Error("Review the excluded occurrence dates.");
				return row.allDay
					? new Date(value).toISOString().slice(0, 10).replaceAll("-", "")
					: new Date(value)
							.toISOString()
							.replaceAll("-", "")
							.replaceAll(":", "")
							.replace(".000", "");
			});
		recurrence.push(
			(row.allDay ? "EXDATE;VALUE=DATE:" : "EXDATE:") + values.join(","),
		);
	}
	return recurrence;
}
/** Only rules the existing local expansion engine can represent are applied. Unsupported bytes stay at Google. */
export function localRecurrence(
	lines: readonly string[] | undefined,
	allDay: boolean,
): { repeat: CalendarRepeat; excluded: number[] } {
	if (!lines?.length) return { repeat: "none", excluded: [] };
	let repeat: CalendarRepeat | undefined;
	const excluded: number[] = [];
	for (const line of lines) {
		if (line.startsWith("RRULE:")) {
			if (repeat)
				throw Error("Multiple recurrence rules need review. Nothing changed.");
			const parts = line.slice(6).split(";"),
				values = new Map<string, string>();
			for (const part of parts) {
				const pair = part.split("=");
				if (pair.length !== 2 || values.has(pair[0]))
					throw Error("This Google repeat rule cannot be represented locally.");
				values.set(pair[0], pair[1]);
			}
			const freq = values.get("FREQ");
			if (values.size === 1 && freq === "DAILY") repeat = "daily";
			else if (values.size === 1 && freq === "WEEKLY") repeat = "weekly";
			else if (
				values.size === 2 &&
				freq === "WEEKLY" &&
				values.get("BYDAY")?.split(",").sort().join() ===
					["MO", "TU", "WE", "TH", "FR"].sort().join()
			)
				repeat = "weekdays";
			else
				throw Error(
					"This Google repeat rule cannot be represented locally without losing fields. Nothing changed.",
				);
		} else {
			const prefix = allDay ? "EXDATE;VALUE=DATE:" : "EXDATE:";
			if (!line.startsWith(prefix))
				throw Error(
					"This Google recurrence metadata cannot be represented locally. Nothing changed.",
				);
			for (const raw of line.slice(prefix.length).split(",")) {
				const match = (
					allDay
						? /^(\d{4})(\d{2})(\d{2})$/
						: /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/
				).exec(raw);
				if (!match) throw Error("This Google exclusion date needs review.");
				const value = Date.parse(
					`${match[1]}-${match[2]}-${match[3]}T${match[4] || "00"}:${match[5] || "00"}:${match[6] || "00"}Z`,
				);
				if (
					!Number.isFinite(value) ||
					new Date(value)
						.toISOString()
						.replaceAll("-", "")
						.replaceAll(":", "")
						.replace(".000", "") !== (allDay ? raw + "T000000Z" : raw)
				)
					throw Error("This Google exclusion date is invalid.");
				excluded.push(value);
			}
		}
	}
	if (!repeat)
		throw Error(
			"Google recurrence is missing its repeat rule. Nothing changed.",
		);
	return { repeat, excluded: [...new Set(excluded)].sort((a, b) => a - b) };
}
/** Normalize supported equivalent rules for comparison, retaining every unsupported line verbatim. */
export function canonicalSyncRecurrence(
	lines: readonly string[],
	allDay: boolean,
): string[] {
	try {
		const local = localRecurrence(lines, allDay);
		return syncRecurrence({ ...local, allDay } as CalendarRecord);
	} catch {
		return [...lines];
	}
}
