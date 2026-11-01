import { getZonedDateParts } from "../../../../.eliza/client-features/plugins/plugin-calendar/src/internal/time";
import {
	calendarEventKey,
	calendarSourceKey,
	type AgentCalendarState,
} from "./agent-calendar";
/** Uses only the controller's current complete feed, never its future-only next-event query. */
export function homeCalendarSelection(
	state: AgentCalendarState | undefined,
	timeZone: string,
	hiddenSources: ReadonlySet<string>,
	now = new Date(),
) {
	const quiet = { event: null, verified: false, emptyLabel: "Calendar" };
	if (
		!state?.ownerKey ||
		state.status !== "ready" ||
		state.mutating ||
		state.feed?.state !== "complete"
	)
		return quiet;
	const p = getZonedDateParts(now, timeZone),
		today = Date.UTC(p.year, p.month - 1, p.day),
		monthStart = Date.UTC(p.year, p.month - 1, 1),
		monthEnd = Date.UTC(p.year, p.month, 1),
		weekStart = today - ((new Date(today).getUTCDay() + 6) % 7) * 86400000,
		weekEnd = weekStart + 7 * 86400000;
	const day = (value: string, allDay = false) => {
		const date = new Date(value);
		if (!Number.isFinite(date.getTime())) return NaN;
		const x = getZonedDateParts(date, allDay ? "UTC" : timeZone);
		return Date.UTC(x.year, x.month - 1, x.day);
	};
	const matchesSourceIdentity = (
		source: AgentCalendarState["calendars"][number],
		event: NonNullable<AgentCalendarState["feed"]>["events"][number],
	) =>
		source.provider === event.provider &&
		source.side === event.side &&
		source.grantId === event.grantId &&
		source.calendarId === event.calendarId &&
		(!event.connectorAccountId ||
			source.connectorAccountId === event.connectorAccountId);
	const visible = state.feed.events.filter(
		(event) =>
			event.status !== "cancelled" &&
			state.calendars.some(
				(source) =>
					source.includeInFeed === true &&
					["owner", "writer", "reader"].includes(source.accessRole) &&
					matchesSourceIdentity(source, event) &&
					!hiddenSources.has(calendarSourceKey(source)),
			),
	);
	// End dates are exclusive, including all-day civil dates. Use a civil-day
	// fraction for timed ends so midnight cannot leak into the following day.
	const bounds = (event: (typeof visible)[number]) => {
		const allDay = !!event.isAllDay;
		if (!Number.isFinite(Date.parse(event.endAt))) return { start: NaN, end: NaN };
		const endParts = getZonedDateParts(new Date(event.endAt), allDay ? "UTC" : timeZone);
		return {
			start: day(event.startAt, allDay),
			end: day(event.endAt, allDay) + (allDay ? 0 :
				(endParts.hour * 3600 + endParts.minute * 60 + endParts.second) * 1000),
		};
	};
	const rank = (event: (typeof visible)[number]) => {
		const { start, end } = bounds(event);
		return [[today, today + 86400000], [weekStart, weekEnd], [monthStart, monthEnd]]
			.findIndex(([begin, finish]) => start < finish && end > begin);
	};
	const upcoming = (event: (typeof visible)[number]) => event.isAllDay
		? day(event.endAt, true) > today
		: Date.parse(event.endAt) > now.getTime();
	const candidates = visible.filter(event => rank(event) >= 0);
	candidates.sort((a, b) => {
		const aUpcoming = upcoming(a), bUpcoming = upcoming(b);
		return rank(a) - rank(b) || Number(bUpcoming) - Number(aUpcoming) ||
			(aUpcoming ? Date.parse(a.startAt) - Date.parse(b.startAt) : Date.parse(b.startAt) - Date.parse(a.startAt)) ||
			calendarEventKey(a).localeCompare(calendarEventKey(b));
	});
	if (candidates.length)
		return { event: candidates[0], verified: true, emptyLabel: "" };
	// Unknown sources only prevent empty when their event belongs to the
	// existing Home periods. Undecidable bounds still cannot prove empty.
	if (
		state.feed.events.some((event) => {
			if (
				event.status === "cancelled" ||
				state.calendars.some((source) => matchesSourceIdentity(source, event))
			)
				return false;
			const { start, end } = bounds(event);
			return (
				!Number.isFinite(start) ||
				!Number.isFinite(end) ||
				end <= start ||
				Date.parse(event.endAt) <= Date.parse(event.startAt) ||
				rank(event) >= 0
			);
		})
	)
		return quiet;
	// An empty answer requires complete coverage of both the local week and month.
	const begin = Date.parse(state.feed.timeMin),
		end = Date.parse(state.feed.timeMax);
	return Number.isFinite(begin) &&
		Number.isFinite(end) &&
		begin <= now.getTime() &&
		(day(state.feed.timeMin) < Math.min(monthStart, weekStart) ||
			(day(state.feed.timeMin) === Math.min(monthStart, weekStart) &&
				(() => {
					const x = getZonedDateParts(new Date(state.feed.timeMin), timeZone);
					return x.hour === 0 && x.minute === 0 && x.second === 0;
				})())) &&
		day(state.feed.timeMax) >= Math.max(monthEnd, weekEnd)
		? { event: null, verified: true, emptyLabel: "Nothing planned" }
		: quiet;
}
