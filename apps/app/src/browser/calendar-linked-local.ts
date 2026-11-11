import {
	syncAttendees,
	localAttendees,
	syncRecurrence,
	localRecurrence,
	type CalendarAttendeeResolver,
} from "./calendar-sync-fields";
import type {
	LinkedCalendarLocalPort,
	LinkedCalendarLocalSnapshot,
	LinkedCalendarSemanticEvent,
} from "../../../../.eliza/client-features/packages/contracts/src/calendar-linked-sync";
import {
	calendarDocument,
	initialCalendarState,
	type BrowserCalendarState,
} from "./calendar-store";
import {
	calendarRecord,
	replaceCalendarRecord,
	type CalendarRecord,
} from "./calendar-records";
import {
	calendarDeletionPending,
	stageCalendarDeletion,
} from "./calendar-deletions";
import {
	browserDeletionOwner,
	browserDeletionOwnerCurrent,
} from "../runtime/deletion-owner";
import { revision } from "./revision";

function semantic(
	row: CalendarRecord,
	resolve?: CalendarAttendeeResolver,
): LinkedCalendarSemanticEvent {
	if (
		row.calendarId !== "local" ||
		!row.revision ||
		!Number.isFinite(row.begin) ||
		!Number.isFinite(row.end) ||
		row.end <= row.begin
	)
		throw Error("This local event needs recovery before syncing.");
	if (row.allDay && (row.begin % 86400000 !== 0 || row.end % 86400000 !== 0))
		throw Error("The all-day event dates need review.");
	const timeZone = row.allDay
		? null
		: row.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
	if (timeZone) new Intl.DateTimeFormat("en-US", { timeZone }).format();
	return {
		title: row.title,
		description: row.body,
		location: row.location,
		startAt: row.allDay
			? new Date(row.begin).toISOString().slice(0, 10)
			: new Date(row.begin).toISOString(),
		endAt: row.allDay
			? new Date(row.end).toISOString().slice(0, 10)
			: new Date(row.end).toISOString(),
		timeZone,
		isAllDay: !!row.allDay,
		attendees: syncAttendees(row, resolve),
		recurrence: syncRecurrence(row),
	};
}
/** Real browser calendar storage, with the same source/revision and Undo guards as manual edits.
 * The controller must supply its current, explicitly enabled owner/Google binding. */
export function browserCalendarSyncPort(
	sourceRevision: string,
	current: () => boolean,
	resolve?: CalendarAttendeeResolver,
): LinkedCalendarLocalPort<string> {
	const check = (data?: BrowserCalendarState) => {
		if (!current() || (data && data.sourceRevision !== sourceRevision))
			throw new DOMException("Calendar sync source changed", "AbortError");
	};
	const selected = (data: BrowserCalendarState, id: string) => {
		check(data);
		const row = calendarRecord(data.events, id);
		if (row && calendarDeletionPending(data, id))
			throw Error(
				"Deletion pending",
			);
		return row;
	};
	const snapshot = (
		row: CalendarRecord,
	): LinkedCalendarLocalSnapshot<string> => ({
		eventId: row.id,
		revision: row.revision,
		event: semantic(row, resolve),
	});
	return {
		async get(id) {
			check();
			const data = await calendarDocument.read(initialCalendarState);
			check(data);
			const row = selected(data, id);
			return row ? snapshot(row) : null;
		},
		async applyProviderEvent(id, event, expectedRevision) {
			check();
			const begin = Date.parse(event.startAt),
				end = Date.parse(event.endAt);
			if (
				!event.title.trim() ||
				event.title.length > 4000 ||
				!Number.isFinite(begin) ||
				!Number.isFinite(end) ||
				end <= begin ||
				event.deleted
			)
				throw Error(
					"Unsupported event",
				);
			if (
				event.isAllDay &&
				(!/^\d{4}-\d{2}-\d{2}$/.test(event.startAt) ||
					!/^\d{4}-\d{2}-\d{2}$/.test(event.endAt))
			)
				throw Error("Review whole all-day dates before syncing.");
			if (!event.isAllDay && !event.timeZone)
				throw Error(
					"Missing time zone",
				);
			if (event.timeZone)
				new Intl.DateTimeFormat("en-US", { timeZone: event.timeZone }).format();
			const result = await calendarDocument.edit(
				initialCalendarState,
				(data) => {
					const before = selected(data, id);
					if (!before || before.revision !== expectedRevision)
						throw Error("The local event changed before sync could apply.");
					semantic(before, resolve);
					const recurrence = localRecurrence(event.recurrence, event.isAllDay),
						attendees = localAttendees(before, event.attendees, resolve);
					const next = {
						...before,
						...recurrence,
						...attendees,
						title: event.title,
						body: event.description,
						location: event.location,
						begin,
						end,
						allDay: event.isAllDay,
						...(!event.isAllDay && event.timeZone
							? { timeZone: event.timeZone }
							: {}),
						revision: revision(),
					};
					const result = snapshot(next);
					replaceCalendarRecord(data.events, next);
					return result;
				},
			);
			check();
			window.dispatchEvent(new Event("alpha:calendar-document-changed"));
			return result;
		},
		async delete(id, expectedRevision) {
			check();
			const owner = browserDeletionOwner();
			await calendarDocument.edit(initialCalendarState, (data) => {
				const before = selected(data, id);
				if (!before) return;
				if (
					before.revision !== expectedRevision ||
					!browserDeletionOwnerCurrent(owner)
				)
					throw Error("The local event or owner changed before deletion.");
				semantic(before, resolve);
				stageCalendarDeletion(
					data,
					before,
					before.repeat && before.repeat !== "none" ? "series" : "event",
					owner,
				);
			});
			check();
			window.dispatchEvent(new Event("alpha:deletions-changed"));
			window.dispatchEvent(new Event("alpha:calendar-document-changed"));
		},
	};
}
