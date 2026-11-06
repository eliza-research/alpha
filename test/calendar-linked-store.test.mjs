import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "./support/strip-types.mjs";
const code = stripTypeScriptTypes(
	readFileSync("apps/app/src/runtime/calendar-linked-store.ts", "utf8"),
	{ mode: "strip" },
);
const { CalendarLinkedStore } = await import(
	"data:text/javascript;base64," + Buffer.from(code).toString("base64")
);
const engineCode = stripTypeScriptTypes(
	readFileSync(
		".eliza/client-features/packages/contracts/src/calendar-linked-sync.ts",
		"utf8",
	),
	{ mode: "strip" },
);
const { LinkedCalendarReconciler } = await import(
	"data:text/javascript;base64," + Buffer.from(engineCode).toString("base64")
);
const binding = {
	environment: "production",
	userId: "owner",
	organizationId: "org",
	connectionId: "google-grant",
	providerAccountId: "fixture-google-subject",
	calendarId: "primary",
	agentId: "alpha-agent",
	localSourceId: "local",
	localSourceRevision: "source-1",
};
function fixture() {
	const slots = new Map();
	let active = true,
		conflict = false;
	const storage = {
		async read(slot) {
			return structuredClone(slots.get(slot) ?? null);
		},
		async compareExchange(slot, expected, value) {
			if (
				conflict ||
				JSON.stringify(slots.get(slot) ?? null) !== JSON.stringify(expected)
			)
				return { status: "conflict" };
			slots.set(slot, structuredClone(value));
			return { status: "saved" };
		},
	};
	return {
		slots,
		storage,
		current: () => active,
		retire: () => {
			active = false;
		},
		conflict: () => {
			conflict = true;
		},
		open: (patch = {}) =>
			CalendarLinkedStore.open({ ...binding, ...patch }, () => active, storage),
	};
}
test("reopening preserves the provider checkpoint and idempotency key after an uncertain write", async () => {
	const f = fixture(),
		store = await f.open(),
		link = await store.link("event-1", "rev-1");
	const pending = await store.save(link, {
		state: "quarantined",
		pendingOperation: "create",
		lastErrorCode: "OUTCOME_UNKNOWN",
		lastErrorMessage: "",
	});
	const reopened = await f.open(),
		rows = await reopened.list();
	assert.deepEqual(rows, [pending]);
	assert.deepEqual(
		await reopened.link("event-1", "rev-2"),
		pending,
		"reopening never invents a fresh create operation",
	);
	assert.equal(rows[0].idempotencyKey, link.idempotencyKey);
});
test("a stale checkpoint cannot overwrite newer provider identity or a changed destination", async () => {
	const f = fixture(),
		a = await f.open(),
		link = await a.link("event", "r1"),
		b = await f.open();
	const next = await a.save(link, {
		providerEventId: "remote-1",
		providerEtag: '"v1"',
		state: "clean",
		pendingOperation: null,
	});
	await assert.rejects(
		b.save(link, { state: "dirty" }),
		/changed or need recovery/,
	);
	await assert.rejects(
		a.save(next, { connectorAccountId: "other-grant" }),
		/changed or need recovery/,
	);
	assert.deepEqual(await b.list(), [next]);
});
test("different owner, grant, calendar, agent and local-source generation get isolated checkpoints", async () => {
	const f = fixture(),
		store = await f.open();
	await store.link("local-event", "r1");
	for (const patch of [
		{ userId: "other" },
		{ organizationId: "other" },
		{ connectionId: "other" },
		{ providerAccountId: "other-google-subject" },
		{ calendarId: "other" },
		{ agentId: "other" },
		{ localSourceRevision: "other" },
		{ environment: "staging" },
	]) {
		const other = await f.open(patch);
		assert.notEqual(other.scope, store.scope);
		assert.deepEqual(await other.list(), []);
	}
	assert.equal(
		f.slots.size,
		1,
		"reading an empty destination does not write or migrate data",
	);
	f.retire();
	await assert.rejects(store.list(), (error) => error.name === "AbortError");
});
test("a storage conflict or unreadable checkpoint retains the original bytes", async () => {
	const f = fixture(),
		store = await f.open(),
		link = await store.link("event", "r1"),
		before = structuredClone([...f.slots]);
	f.conflict();
	await assert.rejects(
		store.save(link, { state: "paused" }),
		/changed or need recovery/,
	);
	assert.deepEqual([...f.slots], before);
	const slot = [...f.slots.keys()][0];
	f.slots.set(slot, {
		version: 1,
		owner: store.scope,
		links: [{ ...link, providerCalendarId: "wrong-calendar" }],
	});
	const corrupt = structuredClone(f.slots.get(slot));
	await assert.rejects(f.open(), /changed or need recovery/);
	assert.deepEqual(f.slots.get(slot), corrupt);
});
test("checkpoint revisions advance across equal or backwards wall-clock readings", async () => {
	const f = fixture(),
		store = await f.open(),
		link = await store.link("event", "r1"),
		past = new Date(0);
	const next = await store.save(link, { state: "paused" }, past);
	assert.ok(Date.parse(next.updatedAt) > Date.parse(link.updatedAt));
	await assert.rejects(
		store.save(next, { id: "new-id" }),
		/changed or need recovery/,
	);
});
test("the shared reconciler recovers an accepted create after reopening without a second write", async () => {
	const f = fixture(),
		store = await f.open(),
		link = await store.link("event", "opaque-r1");
	let remote = null,
		writes = 0;
	const event = {
		title: "QA",
		description: "",
		location: "",
		startAt: "2026-10-15T18:00:00Z",
		endAt: "2026-10-15T19:00:00Z",
		timeZone: "UTC",
		isAllDay: false,
		attendees: [],
	};
	const local = {
		async get() {
			return { eventId: "event", revision: "opaque-r1", event };
		},
		async applyProviderEvent() {
			throw Error("Not requested");
		},
		async delete() {
			throw Error("Not requested");
		},
	};
	const provider = {
		async get() {
			return remote;
		},
		async create(_link, content) {
			writes++;
			remote = { eventId: "accepted-event", etag: '"v1"', event: content };
			throw Error("Response lost after acceptance");
		},
		async update() {
			throw Error("Not requested");
		},
		async delete() {
			throw Error("Not requested");
		},
	};
	assert.equal(
		await new LinkedCalendarReconciler(store, local, provider).reconcile(link),
		"quarantined",
	);
	const reopened = await f.open(),
		engine = new LinkedCalendarReconciler(reopened, local, provider),
		pending = (await reopened.list())[0];
	assert.equal(pending.idempotencyKey, link.idempotencyKey);
	assert.equal(await engine.recoverDispatch(pending), true);
	const recovered = (await reopened.list())[0];
	assert.equal(recovered.providerEventId, "accepted-event");
	assert.equal(recovered.localRevision, "opaque-r1");
	assert.equal(await engine.reconcile(recovered), "clean");
	assert.equal(writes, 1);
});

test("new operation keys survive a grant reconnect without sharing old checkpoint data", async () => {
	const f = fixture(),
		first = await f.open(),
		a = await first.link("event", "r1"),
		reconnected = await f.open({ connectionId: "new-grant" });
	assert.deepEqual(await reconnected.list(), []);
	const b = await reconnected.link("event", "r1");
	assert.notEqual(a.id, b.id);
	assert.equal(a.idempotencyKey, b.idempotencyKey);
	const changedAgent = await f.open({ agentId: "new-agent" });
	assert.equal(
		(await changedAgent.link("event", "r1")).idempotencyKey,
		a.idempotencyKey,
	);
	const reset = await f.open({ localSourceRevision: "new-source" });
	assert.notEqual(
		(await reset.link("event", "r1")).idempotencyKey,
		a.idempotencyKey,
	);
});
