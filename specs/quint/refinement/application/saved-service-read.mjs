import assert from "node:assert/strict";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";
import { checkTraces } from "../check-traces.mjs";
import {
	boundInputs,
	bundledSource,
	call,
	captureSources,
	checkpoint,
	deferred,
	read,
	trace,
} from "./support.mjs";

export async function checkSavedServiceRead(extraSources = []) {
	const driver = fileURLToPath(import.meta.url),
		testPath = "test/agent-calendar-refresh-state.test.mjs";
	const calendarModule = await bundledSource(
		"apps/app/src/runtime/agent-calendar.ts",
	);
	const storage = await bundledSource(
		"apps/app/src/runtime/service-read-cache.ts",
	);
	const text = read(testPath),
		start = text.indexOf("async function fixture(){"),
		end = text.indexOf("\ntest(", start);
	const savedStart = text.indexOf("async function savedFixture(){"),
		savedEnd = text.indexOf("\nasync function settleLocal()", savedStart);
	assert.ok(
		start >= 0 && end > start && savedStart >= 0 && savedEnd > savedStart,
	);
	const saved = text
		.slice(savedStart, savedEnd)
		.replace(
			/const \{ServiceReadCache\}=await import\([^;]+;/,
			"const {ServiceReadCache}=storage;",
		);
	const context = {
		...calendarModule.exports,
		storage: storage.exports,
		assert,
		crypto: webcrypto,
		structuredClone,
		Promise,
		Date,
		setImmediate,
	};
	const make = vm.runInNewContext(
		text.slice(start, end) + "\n" + saved + "\nsavedFixture;",
		context,
	);
	const sources = [
		driver,
		testPath,
		...calendarModule.sources,
		...storage.sources,
		...extraSources,
	];
	captureSources(sources);
	const traces = [];
	for (const refused of [false, true]) {
		const f = await make(),
			held = deferred();
		const calendar = f.make({
			...f.api,
			getLifeOpsCalendarFeed: () => held.promise,
		});
		const observe = () => ({
			"s.shown": calendar.state.feed
				? calendar.state.savedAt
					? "saved"
					: "fresh"
				: "none",
		});
		const t = trace(
			refused
				? "refused access removes the saved presentation"
				: "saved rows become fresh only after authorized response",
			observe(),
		);
		const pending = calendar.refresh(f.window);
		checkpoint(t, "start current read", call("start"), observe());
		for (let i = 0; i < 5; i++)
			await new Promise((resolve) => setImmediate(resolve));
		assert.ok(calendar.state.savedAt);
		checkpoint(t, "restore same-owner cached rows", call("restore"), observe());
		if (refused)
			held.reject(Object.assign(Error("Access refused"), { status: 403 }));
		else held.resolve(f.feed);
		await pending;
		checkpoint(
			t,
			refused ? "access refused" : "fresh result",
			call(refused ? "refuse" : "fresh"),
			observe(),
		);

		traces.push(t);
		calendar.retire();
		f.retire();
	}
	const f = await make();
	const held = deferred(),
		entered = deferred();
	const entries = new Map();
	for (const entry of f.raw().entries)
		entries.set(entry.key, await f.cache.get(entry.key));
	const calendar = f.make(
		{
			...f.api,
			getLifeOpsCalendarFeed: async () => ({ ...f.feed, events: [] }),
		},
		{
			get: async (key) => {
				entered.resolve();
				await held.promise;
				return structuredClone(entries.get(key) ?? null);
			},
			put: async () => {},
		},
	);
	const observe = () => ({
		"s.shown": calendar.state.feed
			? calendar.state.savedAt
				? "saved"
				: "fresh"
			: "none",
	});
	const t = trace(
		"in-flight cached snapshot cannot replace fresh provider rows",
		observe(),
	);
	const pending = calendar.refresh(f.window);
	checkpoint(t, "start current read", call("start"), observe());
	await entered.promise;
	await pending;
	checkpoint(t, "fresh empty provider response", call("fresh"), observe());
	held.resolve();
	for (let i = 0; i < 6; i++)
		await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(calendar.state.feed.events, []);
	assert.equal(calendar.state.savedAt, null);
	checkpoint(
		t,
		"late valid saved snapshot is ignored",
		call("restore"),
		observe(),
	);
	traces.push(t);
	calendar.retire();
	f.retire();

	return checkTraces(
		boundInputs({
			model: "SavedServiceRead",
			sources,
			traces,
			scope: "bounded-orchestration",
			assumptions: [
				"Reuse the owning Calendar saved-read fixture and execute actual AgentCalendar plus ServiceReadCache. Observe saved, fresh and refused presentation states.",
				"This projection covers Calendar restoration and refusal. Credential changes, Inbox cache behavior, encrypted persistence and real network authorization retain separate regression and runtime obligations.",
			],
		}),
	);
}
