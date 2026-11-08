import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
// The shared store (@elizaos/plugin-calendar/linked-sync) through Alpha's installed-key wrapper.
const { CalendarLinkedStore } = await import(
	"../apps/app/src/runtime/calendar-linked-store.ts"
);
const engineCode = stripTypeScriptTypes(
	readFileSync(
		".eliza/client-features/packages/contracts/src/calendar-linked-sync.ts",
		"utf8",
	),
	{ mode: "transform" },
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
	assert.match(
		a.idempotencyKey,
		/^alpha-calendar-sync:[a-f0-9]{64}:event$/,
		"installed provider keys keep Alpha's original prefix",
	);
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
// A checkpoint document exactly as Alpha's pre-migration store (main at 34a033cf)
// saved it for `binding`: slot, owner scope hash, source scope hash, field order and
// idempotency key. Literal bytes, so a serialization change cannot pass by symmetry.
const INSTALLED_SCOPE =
	"581b9e679c2820a3dededa8334ba1f456a3e90d7abf38b8d38fde7fda66268d4";
const INSTALLED_SOURCE_SCOPE =
	"4562e31a47db10c148f2117db7a583288855f447f3054cc032202903b7353eef";
const installedLink = (patch = {}) => ({
	id: "eef7d06c-d853-419f-b609-e463bf6c769f",
	agentId: "alpha-agent",
	localEventId: "event-1",
	connectorAccountId: "google-grant",
	providerCalendarId: "primary",
	providerEventId: "g1",
	providerEtag: "e1",
	localRevision: "r1",
	lastCommonSemanticHash: "a".repeat(64),
	state: "clean",
	pendingOperation: null,
	idempotencyKey: `alpha-calendar-sync:${INSTALLED_SOURCE_SCOPE}:event-1`,
	lastErrorCode: null,
	lastErrorMessage: null,
	createdAt: "2026-10-28T13:40:26.599Z",
	updatedAt: "2026-10-28T13:40:26.600Z",
	...patch,
});
test("checkpoint documents saved by the installed Alpha store keep their slot, scope hashes and keys", async () => {
	const f = fixture();
	const slot = `calendar-linked-sync:v1:${INSTALLED_SCOPE}`;
	// The second row uses the earlier per-link key form, which is still accepted.
	const legacy = installedLink({
		id: "0f3c2a51-6d0e-4b8a-9c2f-6a1e0d7b9c11",
		localEventId: "event-2",
		providerEventId: "g2",
		idempotencyKey: `alpha-calendar-sync:${INSTALLED_SCOPE}:0f3c2a51-6d0e-4b8a-9c2f-6a1e0d7b9c11`,
	});
	const installed = {
		version: 1,
		owner: INSTALLED_SCOPE,
		links: [installedLink(), legacy],
	};
	f.slots.set(slot, structuredClone(installed));
	const store = await f.open();
	assert.equal(store.scope, INSTALLED_SCOPE);
	assert.deepEqual(await store.list(), installed.links);
	assert.deepEqual(
		await store.link("event-1", "r2"),
		installed.links[0],
		"an installed link is reused, never recreated with a new key",
	);
	const saved = await store.save(installed.links[0], { state: "dirty" });
	assert.deepEqual([...f.slots.keys()], [slot], "no migration slot is written");
	assert.equal(saved.idempotencyKey, installed.links[0].idempotencyKey);
	assert.deepEqual(
		Object.keys(f.slots.get(slot).links[0]),
		Object.keys(installed.links[0]),
		"saved rows keep the installed field order",
	);
	const created = await store.link("event-3", "r1");
	assert.equal(
		created.idempotencyKey,
		`alpha-calendar-sync:${INSTALLED_SOURCE_SCOPE}:event-3`,
	);
	assert.deepEqual(
		Object.keys(created),
		Object.keys(installed.links[0]),
		"new rows serialize like installed rows",
	);
});
test("a checkpoint keyed with the shared default namespace is refused, not adopted", async () => {
	const f = fixture();
	f.slots.set(`calendar-linked-sync:v1:${INSTALLED_SCOPE}`, {
		version: 1,
		owner: INSTALLED_SCOPE,
		links: [
			installedLink({
				idempotencyKey: `calendar-sync:${INSTALLED_SOURCE_SCOPE}:event-1`,
			}),
		],
	});
	const before = structuredClone([...f.slots]);
	await assert.rejects(f.open(), /changed or need recovery/);
	assert.deepEqual([...f.slots], before, "original bytes are retained");
});
test("installed Calendar sync settings keep their storage names and record shape", async () => {
	const host = readFileSync("apps/app/src/runtime/calendar-sync-host.ts", "utf8");
	assert.match(host, /"alpha\.browser\.calendar-sync-config\.v1"/);
	assert.match(
		host,
		/"calendar-linked-sync:v1:7d1f8a65cde513c690bb719ba9fb6e93372b9f0dc6e8a92b40c18245f3b71df9"/,
	);
	assert.match(host, /idempotencyNamespace: ALPHA_CALENDAR_SYNC_NAMESPACE/);
	// The shared host's only runtime contracts import is the reconciler projected above.
	// Registered here, after the store tests, so they keep Node's default loader.
	registerHooks({
		resolve: (specifier, context, next) =>
			specifier === "@elizaos/contracts"
				? next(
						new URL(
							"../.eliza/client-features/packages/contracts/src/calendar-linked-sync.ts",
							import.meta.url,
						).href,
						context,
					)
				: next(specifier, context),
		// Shared modules use TypeScript parameter properties, which need transform mode.
		load: (url, context, next) =>
			url.includes("/.eliza/client-features/") && url.endsWith(".ts")
				? {
						format: "module",
						shortCircuit: true,
						source: stripTypeScriptTypes(
							readFileSync(new URL(url), "utf8"),
							{ mode: "transform" },
						),
					}
				: next(url, context),
	});
	const { readCalendarSyncSettings, calendarSyncSettingsSlot } = await import(
		"../.eliza/client-features/plugins/plugin-calendar/src/linked-sync/sync-host.ts"
	);
	const installed = {
		version: 1,
		scope: INSTALLED_SCOPE,
		binding: { ...binding },
		enabled: true,
	};
	assert.deepEqual(readCalendarSyncSettings(structuredClone(installed)), installed);
	assert.throws(
		() => readCalendarSyncSettings({ ...installed, extra: true }),
		/need recovery/,
	);
	const f = fixture();
	const slot =
		"calendar-linked-sync:v1:7d1f8a65cde513c690bb719ba9fb6e93372b9f0dc6e8a92b40c18245f3b71df9";
	f.slots.set(slot, structuredClone(installed));
	const settings = calendarSyncSettingsSlot(f.storage, slot);
	assert.deepEqual(await settings.read(), installed);
	await settings.edit((value) => (value ? { ...value, enabled: false } : null));
	assert.deepEqual([...f.slots.keys()], [slot]);
	assert.deepEqual(f.slots.get(slot), { ...installed, enabled: false });
});
