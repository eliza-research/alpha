import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { checkTraces } from "../check-traces.mjs";
import {
	boundInputs,
	call,
	captureSources,
	checkpoint,
	trace,
} from "./support.mjs";
import {
	createInboxFixture,
	inboxDriverSources,
} from "../services/inbox-coordinator-ports.mjs";

export async function checkMailDraftSelection(extraSources = []) {
	const sources = [
		fileURLToPath(import.meta.url),
		"specs/quint/refinement/services/inbox-coordinator-ports.mjs",
		...(await inboxDriverSources()),
		...extraSources,
	];
	captureSources(sources);
	const traces = [];
	for (const scenario of [
		"success",
		"changed",
		"conflict",
		"lost-reply",
		"retired",
	]) {
		const fixture = await createInboxFixture(),
			pair = fixture.createPair();
		await pair.bind();
		for (const subject of ["Selected draft", "Unrelated draft"]) {
			await pair.drafts.newEmail();
			pair.drafts.render().c.onSubj({ target: { value: subject } });
			pair.drafts.render().c.onBody({ target: { value: "Preserved content" } });
			await fixture.settle();
		}
		assert.equal(await pair.drafts.prepareSelection(), true);
		const key = [...fixture.slots.keys()].find((value) =>
			value.includes(":shelf:"),
		);
		const original = structuredClone(fixture.slots.get(key)),
			selected = original.items[0].draft.id,
			peer = original.items[1];
		let owner = true,
			writes = 0;
		const observe = () => {
			const shelf = fixture.slots.get(key),
				row = shelf.items.find((value) => value.draft.id === selected);
			return {
				"s.owner": owner,
				"s.storedVersion": !row ? 0 : row.draft.body === "Peer edit" ? 2 : 1,
				"s.peerKept": shelf.items.some(
					(value) => JSON.stringify(value) === JSON.stringify(peer),
				),
				"s.writes": writes,
			};
		};
		const t = trace(`local draft selection ${scenario}`, observe());
		try {
			checkpoint(
				t,
				"select exact saved version",
				call("selectDraft"),
				observe(),
			);
			checkpoint(t, "owner confirms selection", call("confirm"), observe());
			if (scenario === "retired") {
				owner = false;
				checkpoint(t, "retire owner", call("retire"), observe());
				assert.equal(
					await pair.drafts.removeSelection([selected], () => owner),
					false,
				);
			} else {
				if (scenario === "changed") {
					fixture.slots.get(key).items[0].draft.body = "Peer edit";
					checkpoint(
						t,
						"peer edits selected content",
						call("peerEdit"),
						observe(),
					);
				}
				let prepared = false;
				fixture.gates({
					store: async (event) => {
						if (event.key !== key) return;
						if (event.kind === "read" && !prepared) {
							prepared = true;
							checkpoint(
								t,
								"read selected version",
								call("prepare"),
								observe(),
							);
						}
						if (event.kind === "cas" && scenario === "conflict") {
							fixture.slots.get(key).items[0].draft.body = "Peer edit";
							checkpoint(
								t,
								"peer edits before compare-exchange",
								call("peerEdit"),
								observe(),
							);
							checkpoint(
								t,
								"conflicting revision is preserved",
								call("conflict"),
								observe(),
							);
						}
					},
					storeResult: async (event) => {
						if (event.key !== key) return;
						writes++;
						checkpoint(
							t,
							"compare-exchange removes only selected draft",
							call("commit"),
							observe(),
						);
						if (scenario === "lost-reply") throw Error("Reply lost");
					},
				});
				if (scenario === "changed" || scenario === "conflict")
					await assert.rejects(
						pair.drafts.removeSelection([selected], () => owner),
						/changed/i,
					);
				else {
					assert.equal(
						await pair.drafts.removeSelection([selected], () => owner),
						true,
					);
					checkpoint(
						t,
						"readback confirms exact deletion",
						call("readback"),
						observe(),
					);
				}
			}
			assert.equal(
				fixture.state.dispatches,
				0,
				"local draft deletion never sends mail",
			);
			traces.push(t);
		} finally {
			pair.dispose();
		}
	}
	return checkTraces(
		boundInputs({
			model: "MailDraftSelection",
			sources,
			traces,
			scope: "bounded-orchestration",
			assumptions: [
				"Execute actual prepared Inbox drafts controller with its existing CAS store fixture. Store callbacks expose read, commit and lost-reply boundaries.",
				"One selected and one unrelated draft. UI confirmation, native persistence and remote mail operations require separate integration evidence.",
			],
		}),
	);
}
