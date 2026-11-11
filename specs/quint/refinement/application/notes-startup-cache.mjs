import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { checkTraces } from "../check-traces.mjs";
import {
	boundInputs,
	bundledSource,
	call,
	captureSources,
	checkpoint,
	deferred,
	trace,
} from "./support.mjs";

const driver = fileURLToPath(import.meta.url);
export async function checkNotesStartupCache(extraSources = []) {
	const compiled = await bundledSource(
		"apps/app/src/runtime/notes-startup-cache.ts",
	);
	const storage = await bundledSource(
		"apps/app/src/runtime/service-read-cache.ts",
	);
	const sources = [
		driver,
		...compiled.sources,
		...storage.sources,
		...extraSources,
	];
	captureSources(sources);
	const traces = [];
	async function scenario(name, actions) {
		let owner = 0,
			agent = 0,
			active = true,
			raw = null,
			holdRead = null,
			pending = null;
		let storedRevision = 0;
		const accounts = [0, 1].map((id) => ({
			environment: "production",
			userId: `owner-${id}`,
			organizationId: "org",
			credentialId: "credential",
		}));
		const scope = (id) =>
			JSON.stringify(["https://agent.example", "owner-0", `agent-${id}`]);
		const row = {
			id: "note-first",
			title: "Saved note",
			body: "Complete text",
			kind: "text",
			when: "Nov 11",
		};
		const store = {
			read: async () => structuredClone(raw),
			compareExchange: async (before, next) => {
				if (JSON.stringify(before) !== JSON.stringify(raw)) return "conflict";
				raw = structuredClone(next);
				return "saved";
			},
		};
		const cache = new storage.exports.ServiceReadCache(
			JSON.stringify(accounts[0]),
			store,
			() => 1000,
		);
		const oldGate = deferred(),
			oldReached = deferred();
		let oldPaused = false;
		const olderCache = new storage.exports.ServiceReadCache(
			JSON.stringify(accounts[0]),
			{
				read: store.read,
				compareExchange: async (before, next) => {
					if (!oldPaused) {
						oldPaused = true;
						oldReached.resolve();
						await oldGate.promise;
					}
					return store.compareExchange(before, next);
				},
			},
			() => 1000,
		);
		const olderWriter = new compiled.exports.NotesStartupCache(
			{
				resolveOwner: async () => accounts[0],
				current: () => true,
				changed() {},
			},
			async () => olderCache,
		);
		await cache.put("notes:last-list:v1", { scope: scope(0), rows: [row] });
		const originalGet = cache.get.bind(cache);
		cache.get = async (key) => {
			const result = await originalGet(key);
			if (holdRead) await holdRead.promise;
			return result;
		};
		const preview = new compiled.exports.NotesStartupCache(
			{
				resolveOwner: async () => accounts[owner],
				current: (binding) =>
					active &&
					binding.owner.userId === accounts[owner].userId &&
					binding.scope === scope(agent),
				changed() {},
			},
			async () => cache,
		);
		const writer = new compiled.exports.NotesStartupCache(
			{
				resolveOwner: async () => accounts[0],
				current: () => true,
				changed() {},
			},
			async () => cache,
		);
		const observe = () => ({
			"s.owner": owner,
			"s.agent": agent,
			"s.active": active,
			visible: preview.rows.length > 0,
			"s.storedRevision": storedRevision,
		});
		const t = trace(name, observe());
		for (const action of actions) {
			if (action === "startRestore") {
				holdRead = deferred();
				pending = preview.restore();
				await new Promise((resolve) => setImmediate(resolve));
			}
			if (action === "finishRestore") {
				holdRead.resolve();
				await pending;
				holdRead = null;
			}
			if (action === "changeOwner") owner = 1 - owner;
			if (action === "changeAgent") agent = 1 - agent;
			if (action === "retire") {
				active = false;
				preview.retire();
			}
			if (action === "acceptFresh")
				preview.remember(
					{ owner: accounts[owner], scope: scope(agent) },
					[{ ...row, title: "Current note" }],
					2,
				);
			if (action === "queueOlderWrite") {
				olderWriter.remember(
					{ owner: accounts[0], scope: scope(0) },
					[{ ...row, title: "Older note" }],
					1,
				);
				await oldReached.promise;
			}
			if (action === "newerTabWrite") {
				writer.remember(
					{ owner: accounts[owner], scope: scope(agent) },
					[{ ...row, title: "Newer note" }],
					2,
				);
				await originalGet("notes:last-list:v1");
				storedRevision = (await originalGet("notes:last-list:v1")).value
					.revision;
			}
			if (action === "finishWrite") {
				oldGate.resolve();
				await olderCache.get("notes:last-list:v1");
				const saved = await originalGet("notes:last-list:v1");
				storedRevision = saved.value.revision;
				assert.equal(saved.value.rows[0].title, "Newer note");
			}
			if (
				actions.includes("acceptFresh") &&
				(action === "acceptFresh" || action === "finishRestore")
			) {
				assert.deepEqual(preview.rows, [{ ...row, title: "Current note" }]);
			}
			checkpoint(t, action, call(action), observe());
		}
		traces.push(t);
	}
	await scenario(
		"saved rows are immediately available without write authority",
		["startRestore", "finishRestore"],
	);
	await scenario("account replacement hides saved rows", [
		"startRestore",
		"finishRestore",
		"changeOwner",
	]);
	await scenario("agent replacement refuses an in-flight restore", [
		"startRestore",
		"changeAgent",
		"finishRestore",
	]);
	await scenario("unmount refuses an in-flight restore", [
		"startRestore",
		"retire",
		"finishRestore",
	]);
	await scenario("accepted live rows win over a delayed restore", [
		"startRestore",
		"acceptFresh",
		"finishRestore",
	]);
	await scenario("older tab cannot replace the newer persisted revision", [
		"queueOlderWrite",
		"newerTabWrite",
		"finishWrite",
	]);
	return checkTraces(
		boundInputs({
			model: "NotesStartupCache",
			sources,
			traces,
			scope: "bounded-component",
			assumptions: [
				"Execute actual NotesStartupCache and ServiceReadCache with deferred reads and compare-exchange storage.",
				"Observe owner, agent, activity, visible rows and persisted revision. Internal pending-read tickets are unobserved; actual IndexedDB and provider authorization need separate integration evidence.",
			],
		}),
	);
}
