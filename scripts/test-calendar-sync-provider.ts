// Actual Cloud client and shared provider-port boundary; synthetic transport, no Google effects.
import assert from "node:assert/strict";
import {
	CloudProtocol,
	CloudProtocolError,
} from "../apps/app/src/runtime/cloud-protocol";
import { googleCalendarSyncPort } from "../apps/app/src/runtime/calendar-linked-provider";
const binding = {
	environment: "production" as const,
	userId: "user",
	organizationId: "org",
	connectionId: "11111111-1111-4111-8111-111111111111",
	providerAccountId: "google-user",
	calendarId: "primary",
	agentId: "agent",
	localSourceId: "local",
	localSourceRevision: "source",
};
let current = true,
	reads = 0;
const calls: any[] = [];
let credential: any = {
	credentialId: "session",
	token: "synthetic",
	userId: "user",
	organizationId: "org",
};
const event = {
	title: "QA",
	description: "",
	location: "",
	startAt: "2026-10-16",
	endAt: "2026-10-17",
	timeZone: null,
	isAllDay: true,
	attendees: [],
};
let stored: any = null,
	failure: any = null,
	changeOwner = false;
const client = new CloudProtocol(
	"production",
	async (input) => {
		calls.push(input);
		assert.equal(input.headers.Authorization, "Bearer synthetic");
		const url = new URL(input.url);
		assert.equal(url.origin, "https://api.eliza.app");
		if (changeOwner)
			credential = { ...credential, credentialId: "different-session" };
		if (failure) return { status: failure.status, data: failure.data };
		if (url.pathname.endsWith("/capabilities"))
			return {
				status: 200,
				data: {
					version: 1,
					calendarId: "primary",
					accountId: "google-user",
					read: true,
					write: true,
					idempotentCreate: true,
					conditionalWrites: true,
					providerExactlyOnce: false,
				},
			};
		if (input.method === "POST") {
			stored = {
				eventId: "saved",
				etag: '"1"',
				event: (input.body as {event:unknown}).event,
				visibility: "private",
				remindersDisabled: true,
			};
		}
		if (input.method === "PATCH") {
			assert.equal((input.body as {expectedEtag:string}).expectedEtag, '"1"');
			stored = { ...stored, etag: '"2"', event: (input.body as {event:unknown}).event };
		}
		if (input.method === "DELETE") {
			assert.equal(url.searchParams.get("expectedEtag"), '"2"');
			stored = null;
			return {
				status: 200,
				data: {
					version: 1,
					calendarId: "primary",
					deleted: true,
					providerExactlyOnce: false,
				},
			};
		}
		if (input.method === "GET") reads++;
		return {
			status: 200,
			data: {
				version: 1,
				calendarId: "primary",
				event: stored,
				providerExactlyOnce: false,
			},
		};
	},
	{
		read: async () => credential,
		write: async () => {},
		clear: async () => {},
	},
	async () => {},
);
const signal = new AbortController().signal;
const port = await googleCalendarSyncPort(
	client,
	binding,
	() => current,
	signal,
);
const row: any = {
	agentId: "agent",
	connectorAccountId: binding.connectionId,
	providerCalendarId: "primary",
	providerEventId: null,
	providerEtag: null,
	idempotencyKey: "retained-create",
};
assert.equal(await port.get(row), null);
const saved = await port.create(row, event);
assert.equal(saved.eventId, "saved");
assert.equal(calls.at(-1).body.accountId, "google-user");
assert.deepEqual(await port.get(row), saved);
assert.equal(calls.at(-1).method, "GET");
assert.equal(
	new URL(calls.at(-1).url).searchParams.get("idempotencyKey"),
	"retained-create",
);
row.providerEventId = saved.eventId;
row.providerEtag = saved.etag;
const updated = await port.update(row, { ...event, title: "Updated" });
assert.equal(updated.event.title, "Updated");
assert.equal(calls.at(-1).method, "PATCH");
failure = {
	status: 412,
	data: {
		code: "CALENDAR_SYNC_REVISION_CHANGED",
		outcome: "precondition_failed",
		error: "Google event changed.",
	},
};
await assert.rejects(
	port.update(row, event),
	(e: any) => e.outcome === "precondition_failed",
);
failure = {
	status: 502,
	data: { code: "CALENDAR_SYNC_UNAVAILABLE", outcome: "unknown" },
};
await assert.rejects(port.update(row, event), CloudProtocolError);
failure = null;
row.providerEtag = updated.etag;
await port.delete(row);
assert.equal(calls.at(-1).method, "DELETE");
const before = calls.length;
current = false;
await assert.rejects(port.create(row, event), { name: "AbortError" });
assert.equal(calls.length, before);
current = true;
await assert.rejects(port.get({ ...row, connectorAccountId: "other" }), {
	name: "AbortError",
});
assert.equal(calls.length, before);
changeOwner = true;
await assert.rejects(port.get(row), (e: any) => e.code === "account-changed");
assert.equal(reads, 3);
console.log(
	"PASS Calendar sync authenticated transport, conditional writes, lost-response lookup, identity fences and error classification",
);
