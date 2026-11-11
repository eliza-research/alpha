import { test } from "node:test";
import assert from "node:assert/strict";
import {tsImport} from "tsx/esm/api";
const {NotesStartupCache} = await tsImport("../apps/app/src/runtime/notes-startup-cache.ts", import.meta.url);
const {ServiceReadCache} = await tsImport("../apps/app/src/runtime/service-read-cache.ts", import.meta.url);

const account = {
	environment: "production",
	userId: "owner-a",
	organizationId: "org-a",
	credentialId: "credential-a",
};
const scope = '["https://agent.example","owner-a","agent-a"]';
const row = {
	id: "note-first",
	title: "First note",
	body: "The complete saved note.",
	kind: "text",
	when: "Nov 10",
};

function fixture() {
	let raw = null,
		writes = 0,
		active = true,
		currentOwner = account,
		currentScope = scope,
		painted = 0;
	const cache = new ServiceReadCache(
		JSON.stringify(account),
		{
			read: async () => structuredClone(raw),
			compareExchange: async (before, next) => {
				assert.deepEqual(before, raw);
				raw = structuredClone(next);
				writes++;
				return "saved";
			},
		},
		() => 1_000,
	);
	const hooks = {
		resolveOwner: async () => currentOwner,
		current: (binding) =>
			active &&
			JSON.stringify(binding.owner) === JSON.stringify(currentOwner) &&
			(!currentScope || binding.scope === currentScope),
		changed: () => {
			painted++;
		},
	};
	const preview = new NotesStartupCache(hooks, async () => cache);
	return {
		cache,
		hooks,
		preview,
		seed: (rows) => cache.put("notes:last-list:v1", { scope, rows }),
		get writes() {
			return writes;
		},
		get painted() {
			return painted;
		},
		account(value) {
			currentOwner = value;
		},
		scope(value) {
			currentScope = value;
		},
		retire() {
			active = false;
			preview.retire();
		},
	};
}

test("startup restores full read-only rows from the existing account cache", async () => {
	const f = fixture(),
		saved = { ...row, body: "full text ".repeat(2000) };
	await f.seed([saved]);
	const writes = f.writes;
	await f.preview.restore();
	assert.deepEqual(f.preview.rows, [saved]);
	assert.equal(f.writes, writes, "restoring a preview performs no write");
	assert.equal(f.painted, 1);
	f.preview.rows[0].title = "mutated caller copy";
	assert.equal(f.preview.rows[0].title, saved.title);
});

test("a fresh accepted read wins over an older startup read", async () => {
	const f = fixture();
	await f.seed([row]);
	const get = f.cache.get.bind(f.cache);
	let release, entered;
	const started = new Promise((resolve) => {
		entered = resolve;
	});
	f.cache.get = async (key) => {
		const result = await get(key);
		entered();
		await new Promise((resolve) => {
			release = resolve;
		});
		return result;
	};
	const restore = f.preview.restore();
	await started;
	const updated = { ...row, title: "Updated" };
	f.preview.remember({ owner: account, scope }, [updated], 2);
	release();
	await restore;
	assert.deepEqual(f.preview.rows, [updated]);
});

test("a different selected agent cannot display the saved rows", async () => {
	const f = fixture();
	await f.seed([row]);
	f.scope("another-agent");
	await f.preview.restore();
	assert.deepEqual(f.preview.rows, []);
	assert.equal(f.painted, 0);
});

test("account changes during a local read retire its result", async () => {
	const f = fixture();
	await f.seed([row]);
	let reads = 0;
	f.hooks.resolveOwner = async () =>
		++reads === 1 ? account : { ...account, userId: "owner-b" };
	await f.preview.restore();
	assert.deepEqual(f.preview.rows, []);
});

test("sign-out hides already-restored rows immediately", async () => {
	const f = fixture();
	await f.seed([row]);
	await f.preview.restore();
	f.account(null);
	assert.deepEqual(f.preview.rows, []);
});

test("unmount prevents a delayed local read from painting", async () => {
	const f = fixture();
	await f.seed([row]);
	let resolveOwner;
	f.hooks.resolveOwner = () =>
		new Promise((resolve) => {
			resolveOwner = resolve;
		});
	const pending = f.preview.restore();
	f.retire();
	resolveOwner(account);
	await pending;
	assert.deepEqual(f.preview.rows, []);
	assert.equal(f.painted, 0);
});

test("malformed or duplicate cached rows are refused as a whole", async () => {
	for (const rows of [
		[row, { ...row }],
		[{ ...row, id: 17 }],
		[{ ...row, body: null }],
	]) {
		const f = fixture();
		await f.seed(rows);
		await f.preview.restore();
		assert.deepEqual(f.preview.rows, []);
	}
});

test("the actual Notes view shows cached rows without making them editable", async () => {
	const { compileCanonicalNotesUi, createCanonicalNotesUiFixture } =
		await import(
			"../specs/quint/refinement/application/canonical-notes-feedback.mjs"
		);
	const compiled = await compileCanonicalNotesUi();
	const f = await createCanonicalNotesUiFixture(compiled);
	try {
		f.ui.hooks.preview = () => [{ ...row, id: "note-one" }];
		const pending = f.run("refresh");
		assert.equal(f.ui.list[0].title, row.title);
		assert.equal(f.ui.controller.revision, null);
		assert.equal(f.ui.controller.hasViewNote("note-one"), false);
		const view = f.ui.decorate({ none: true }, f.api, {});
		assert.equal(view.none, false);
		assert.equal(view.createDisabled, true);
		assert.equal(view.selectionBusy, true);
		f.ui.select("note-one");
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(f.ui.open, null);
		assert.equal(f.requests.length, 1);
		const note = {
			id: "note-one",
			title: "Current title",
			body: "Current body",
			color: "yellow",
			createdAt: "2026-11-11T00:00:00Z",
			updatedAt: "2026-11-11T00:00:00Z",
		};
		await f.resolveRequest({ revision: 2, notes: [note], trash: [] });
		await pending.promise;
		assert.equal(f.ui.list[0].title, note.title);
		assert.equal(
			f.ui.decorate({ none: false }, f.api, {}).createDisabled,
			false,
		);
	} finally {
		await f.close();
	}
});

test("saved presentation retains folders, pins, checklist text, dates and voice duration", async () => {
	const f = fixture();
	const checklist = {
		...row,
		kind: "list",
		pinned: true,
		folderId: "folder-work",
		items: [{ t: "Keep this item", done: false }],
		updatedAt: "2026-11-11T00:00:00Z",
	};
	const voice = {
		...row,
		id: "voice-second",
		kind: "voice",
		audio: { durationMs: 11000 },
	};
	f.preview.remember({ owner: account, scope }, [checklist, voice], 2);
	await f.cache.get("notes:last-list:v1");
	const restored = new NotesStartupCache(f.hooks, async () => f.cache);
	await restored.restore();
	assert.deepEqual(restored.rows[0], checklist);
	assert.equal(restored.rows[1].dur, 11);
	assert.equal(
		restored.rows[1].audio,
		undefined,
		"an audio handle never enters the startup preview",
	);
});

test("a delayed older tab cannot replace a newer saved Notes revision", async () => {
	const f = fixture();
	f.preview.remember(
		{ owner: account, scope },
		[{ ...row, title: "Newer" }],
		3,
	);
	await f.cache.get("notes:last-list:v1");
	f.preview.remember(
		{ owner: account, scope },
		[{ ...row, title: "Older" }],
		2,
	);
	await f.cache.get("notes:last-list:v1");
	const restored = new NotesStartupCache(f.hooks, async () => f.cache);
	await restored.restore();
	assert.equal(restored.rows[0].title, "Newer");
});
