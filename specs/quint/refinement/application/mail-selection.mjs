import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { checkTraces, qset } from "../check-traces.mjs";
import {
	boundInputs,
	bundledSource,
	call,
	captureSources,
	checkpoint,
	trace,
} from "./support.mjs";

const driver = fileURLToPath(import.meta.url);
export async function checkMailSelection(extraSources = []) {
	const compiled = await bundledSource(
		"apps/app/src/runtime/mail-selection.ts",
	);
	const sources = [driver, ...compiled.sources, ...extraSources];
	captureSources(sources);
	const traces = [];
	async function scenario(name, outcome) {
		const slots = new Map(),
			sends = [0, 0],
			done = [];
		let approved = false,
			owner = true;
		const observe = () => ({
			"s.approved": approved,
			"s.owner": owner,
			"s.current": done.length,
			"s.sends": [...sends],
			"s.done": qset(done),
		});
		const t = trace(name, observe());
		const client = {
			gmailInboxCapabilities: async () => ({ mailboxMutations: true }),
			gmailRead: async (_grant, id) => {
				if (outcome === "owner-change") {
					owner = false;
					checkpoint(
						t,
						"owner retired before dispatch",
						call("leave"),
						observe(),
					);
				}
				return { message: { id }, historyId: "history-" + id };
			},
			gmailPrepareOperation: async (_grant, requestId, proposal) => {
				const review = { ...proposal, from: "owner@example.invalid" };
				const reviewDigest = createHash("sha256")
					.update(JSON.stringify(review))
					.digest("hex");
				return {
					review,
					receipt: {
						requestId,
						kind: proposal.kind,
						state: "prepared",
						reviewDigest,
						providerResult: null,
						rejectionCode: null,
					},
				};
			},
			gmailDispatchOperation: async (
				_grant,
				requestId,
				reviewDigest,
				proposal,
			) => {
				const index = ["one", "two"].indexOf(proposal.messageId);
				assert.ok(index >= 0);
				sends[index]++;
				checkpoint(
					t,
					"dispatch selected message once",
					call("dispatch"),
					observe(),
				);
				if (outcome === "unknown") throw Error("Connection lost");
				return {
					requestId,
					kind: proposal.kind,
					state: outcome === "rejected" ? "rejected" : "succeeded",
					reviewDigest,
					providerResult: { messageId: proposal.messageId },
					rejectionCode: null,
				};
			},
			gmailOperation: async () => {
				throw Error("Still unknown");
			},
		};
		const store = {
			read: async (key) => structuredClone(slots.get(key) ?? null),
			compareExchange: async (key, before, next) => {
				if (JSON.stringify(slots.get(key) ?? null) !== JSON.stringify(before))
					return { status: "conflict" };
				if (next === null) slots.delete(key);
				else slots.set(key, structuredClone(next));
				return { status: "saved" };
			},
		};
		const run = () =>
			compiled.exports.applyMailSelection({
				owner: "owner",
				grantId: "grant",
				client,
				store,
				ids: ["one", "two", "one"],
				action: "archive",
				signal: new AbortController().signal,
				current: () => owner,
				settlePriorSend: async () => {},
				applied: (id) => {
					done.push(["one", "two"].indexOf(id));
					checkpoint(
						t,
						"confirmed receipt applies selected message",
						call("succeeded"),
						observe(),
					);
				},
			});
		approved = true;
		checkpoint(t, "confirmed selection", call("approve"), observe());
		const result = await run();
		if (outcome === "unknown" || outcome === "rejected") {
			assert.ok(result.error);
			checkpoint(
				t,
				outcome,
				call(outcome === "unknown" ? "lost" : "rejected"),
				observe(),
			);
			if (outcome === "unknown") {
				await run();
				assert.deepEqual(sends, [1, 0], "pending receipt is never replayed");
			}
		}
		if (outcome === "success") {
			assert.equal(result.error, "");
			assert.deepEqual(result.completed, ["one", "two"]);
		}
		if (outcome === "owner-change") assert.deepEqual(sends, [0, 0]);
		traces.push(t);
	}
	await scenario("distinct messages dispatch once", "success");
	await scenario(
		"lost receipt stops later items and forbids replay",
		"unknown",
	);
	await scenario("rejection stops later items", "rejected");
	await scenario("owner change stops dispatch", "owner-change");
	return checkTraces(
		boundInputs({
			model: "MailSelection",
			sources,
			traces,
			scope: "bounded-orchestration",
			assumptions: [
				"Execute actual applyMailSelection and InboxOperation with CAS storage and controlled provider replies. Dispatch and applied checkpoints come from actual provider and receipt callbacks.",
				"Two distinct selected messages plus one duplicate. Provider transport, real account permissions and UI confirmation require separate acceptance. Recovery of an unknown provider result is not observed here.",
			],
		}),
	);
}
