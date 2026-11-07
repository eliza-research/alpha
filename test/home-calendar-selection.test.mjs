import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import vm from "node:vm";
const code = transformSync(readFileSync("apps/app/src/runtime/home-calendar-selection.ts", "utf8"), {loader:"ts",format:"cjs",target:"es2022"}).code;
const parts = (d, timeZone) => {
	const p = Object.fromEntries(
		new Intl.DateTimeFormat("en-US", {
			timeZone,
			year: "numeric",
			month: "numeric",
			day: "numeric",
			hour: "numeric",
			minute: "numeric",
			second: "numeric",
			hourCycle: "h23",
		})
			.formatToParts(d)
			.map((x) => [x.type, x.value]),
	);
	return {
		year: +p.year,
		month: +p.month,
		day: +p.day,
		hour: +p.hour,
		minute: +p.minute,
		second: +p.second,
	};
};
const sourceKey = (s) =>
	JSON.stringify([
		s.provider,
		s.side,
		s.grantId,
		s.connectorAccountId,
		s.calendarId,
	]);
const loaded={exports:{}};
vm.runInNewContext(code,{module:loaded,exports:loaded.exports,require:specifier=>{
 if(specifier==='./agent-calendar')return {calendarEventKey:e=>e.id,calendarSourceKey:sourceKey};
 if(specifier.endsWith('/internal/time'))return {getZonedDateParts:parts};
 throw Error('Unexpected selector dependency: '+specifier);
}});
const select=loaded.exports.homeCalendarSelection;
const source = {
	provider: "eliza",
	side: "owner",
	grantId: "g",
	connectorAccountId: null,
	calendarId: "primary",
	includeInFeed: true,
	selected: true,
	accessRole: "owner",
};
const now = new Date("2026-10-29T22:00:00Z");
const event = (id, date) => ({
	...source,
	id,
	title: id,
	status: "confirmed",
	startAt: date + "T16:00:00Z",
	endAt: date + "T17:00:00Z",
});
const model = (events) => ({
	ownerKey: "owner",
	status: "ready",
	mutating: false,
	calendars: [source],
	feed: {
		state: "complete",
		timeMin: "2026-10-01T00:00:00Z",
		timeMax: "2026-12-01T00:00:00Z",
		events,
	},
});
test("past today leads even though the next-event endpoint is empty", () => {
	const s = model([event("week", "2026-10-30"), event("today", "2026-10-29")]);
	s.next = { event: null };
	assert.equal(select(s, "UTC", new Set(), now).event.id, "today");
});
test("week then month fallback chooses chronological visible events", () => {
	assert.equal(
		select(
			model([event("month", "2026-10-31"), event("week", "2026-10-30")]),
			"UTC",
			new Set(),
			now,
		).event.id,
		"week",
	);
	const mid = new Date("2026-10-05T22:00:00Z");
	assert.equal(
		select(model([event("month", "2026-10-20")]), "UTC", new Set(), mid).event
			.id,
		"month",
	);
});
test("bootstrap, partial, mutation and failures stay neutral and never claim empty", () => {
	for (const status of [
		"disconnected",
		"loading",
		"partial",
		"error",
		"unavailable",
	]) {
		const s = { ...model([]), status };
		assert.deepEqual({...select(s, "UTC", new Set(), now)}, {
			event: null,
			verified: false,
			emptyLabel: "Calendar",
		});
	}
	assert.equal(
		select({ ...model([]), mutating: true }, "UTC", new Set(), now).verified,
		false,
	);
});
test("only a complete covering feed produces a real empty month", () => {
	assert.deepEqual({ ...select(model([]), "UTC", new Set(), now) }, {
		event: null,
		verified: true,
		emptyLabel: "Nothing planned",
	});
	const s = model([]);
	s.feed.timeMax = "2026-10-30T00:00:00Z";
	assert.equal(select(s, "UTC", new Set(), now).verified, false);
});
test("hidden, missing and withdrawn sources cannot supply a Home event", () => {
	const s = model([event("today", "2026-10-29")]);
	assert.equal(select(s, "UTC", new Set([sourceKey(source)]), now).event, null);
	s.calendars = [];
	assert.equal(select(s, "UTC", new Set(), now).event, null);
	s.calendars = [{ ...source, includeInFeed: false }];
	assert.equal(select(s, "UTC", new Set(), now).event, null);
});
test("background arrival updates the same controller snapshot; retired owner clears it", () => {
	const s = { ...model([]), status: "loading" };
	assert.equal(select(s, "UTC", new Set(), now).verified, false);
	Object.assign(s, model([event("arrived", "2026-10-29")]));
	assert.equal(select(s, "UTC", new Set(), now).event.id, "arrived");
	s.ownerKey = null;
	assert.equal(select(s, "UTC", new Set(), now).event, null);
});
test("all-day dates use civil dates and a week may cross the month boundary", () => {
	const s = model([
		{
			...event("all day", "2026-10-29"),
			isAllDay: true,
			endAt: "2026-10-30T00:00:00Z",
		},
	]);
	assert.equal(
		select(s, "America/Los_Angeles", new Set(), now).event.id,
		"all day",
	);
	assert.equal(
		select(
			model([event("Sunday", "2026-11-01")]),
			"UTC",
			new Set(),
			new Date("2026-10-31T23:00:00Z"),
		).event.id,
		"Sunday",
	);
});

test("a complete afternoon-only feed cannot prove an empty month or empty today", () => {
	const s = model([]);
	for (const begin of ["2026-10-29T14:00:00Z", "2026-10-01T00:01:00Z"]) {
		s.feed.timeMin = begin;
		assert.equal(select(s, "UTC", new Set(), now).verified, false);
	}
});
test("an event ending exactly at today midnight belongs only to yesterday", () => {
	const e = {
		...event("yesterday", "2026-10-28"),
		endAt: "2026-10-29T00:00:00Z",
	};
	assert.equal(select(model([e, event("today", "2026-10-29")]), "UTC", new Set(), now).event.id, "today");
	e.endAt = "2026-10-29T00:01:00Z";
	assert.equal(select(model([e]), "UTC", new Set(), now).event.id, "yesterday");
});

test("Oct 30 retains Oct 29 past-week event; past month is the next fallback", () => {
 const clock = new Date("2026-10-30T08:00:00Z");
 assert.equal(select(model([event("Thursday", "2026-10-29")]), "America/Los_Angeles", new Set(), clock).event.id, "Thursday");
 assert.equal(select(model([event("earlier month", "2026-10-10")]), "UTC", new Set(), clock).event.id, "earlier month");
});
test("each period prefers upcoming, otherwise the most recent past", () => {
 const clock = new Date("2026-10-30T08:00:00Z");
 const past = [event("Monday", "2026-10-26"), event("Thursday", "2026-10-29")];
 assert.equal(select(model(past), "UTC", new Set(), clock).event.id, "Thursday");
 assert.equal(select(model([...past, event("Saturday", "2026-10-31")]), "UTC", new Set(), clock).event.id, "Saturday");
});
test("week spilling before the month requires full week coverage to prove empty", () => {
 const s = model([]);
 assert.equal(select(s, "UTC", new Set(), new Date("2026-10-02T12:00:00Z")).verified, false);
});

test("a complete feed with an unknown source cannot prove an empty Home calendar", () => {
	for (const changedIdentity of [
		{ provider: "unrecognized-provider" },
		{ side: "unrecognized-side" },
		{ grantId: "another-grant" },
		{ calendarId: "another-calendar" },
		{ connectorAccountId: "another-account" },
	]) {
		const s = model([{ ...event("unverified", "2026-10-29"), ...changedIdentity }]);
		const before = structuredClone(s);
		assert.deepEqual({ ...select(s, "UTC", new Set(), now) }, {
			event: null,
			verified: false,
			emptyLabel: "Calendar",
		});
		assert.deepEqual(s, before);
	}
});
test("known hidden, withdrawn and unreadable sources retain their empty display policy", () => {
	for (const [catalog, hidden] of [
		[[source], new Set([sourceKey(source)])],
		[[{ ...source, includeInFeed: false }], new Set()],
		[[{ ...source, accessRole: "none" }], new Set()],
	]) {
		const s = { ...model([event("excluded", "2026-10-29")]), calendars: catalog };
		const before = structuredClone(s);
		assert.deepEqual({ ...select(s, "UTC", hidden, now) }, {
			event: null,
			verified: true,
			emptyLabel: "Nothing planned",
		});
		assert.deepEqual(s, before);
	}
});
test("an unknown source does not displace a verified visible Home event", () => {
	const known = event("verified today", "2026-10-29");
	const s = model([{ ...event("unverified", "2026-10-29"), calendarId: "unknown" }, known]);
	const before = structuredClone(s);
	const result = select(s, "UTC", new Set(), now);
	assert.equal(result.event.id, known.id);
	assert.equal(result.verified, true);
	assert.deepEqual(s, before);
});
test("a cancelled unknown-source row does not invalidate a complete empty calendar", () => {
	const s = model([{ ...event("cancelled", "2026-10-29"), calendarId: "unknown", status: "cancelled" }]);
	const before = structuredClone(s);
	assert.deepEqual({ ...select(s, "UTC", new Set(), now) }, {
		event: null,
		verified: true,
		emptyLabel: "Nothing planned",
	});
	assert.deepEqual(s, before);
});

test("valid unknown-source events outside every Home period do not block a verified empty card", () => {
	for (const date of ["2026-09-20", "2026-11-20"]) {
		const s = model([{ ...event("outside Home periods", date), calendarId: "unknown" }]);
		s.feed.timeMin = "2026-09-01T00:00:00Z";
		const before = structuredClone(s);
		assert.deepEqual({ ...select(s, "UTC", new Set(), now) }, {
			event: null,
			verified: true,
			emptyLabel: "Nothing planned",
		});
		assert.deepEqual(s, before);
	}
});
test("unknown-source events with malformed or reversed bounds cannot prove an empty card", () => {
	for (const brokenBounds of [
		{ startAt: "not-a-date" },
		{ endAt: "not-a-date" },
		{ startAt: "2026-10-29T18:00:00Z", endAt: "2026-10-29T17:00:00Z" },
		{ startAt: "2026-11-20T18:00:00Z", endAt: "2026-11-20T17:00:00Z" },
	]) {
		const s = model([{ ...event("undecidable", "2026-10-29"), calendarId: "unknown", ...brokenBounds }]);
		const before = structuredClone(s);
		assert.deepEqual({ ...select(s, "UTC", new Set(), now) }, {
			event: null,
			verified: false,
			emptyLabel: "Calendar",
		});
		assert.deepEqual(s, before);
	}
});
