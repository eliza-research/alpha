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

export async function checkMailComposerPresentation(extraSources = []) {
	const sources = [
		fileURLToPath(import.meta.url),
		"specs/quint/refinement/services/inbox-coordinator-ports.mjs",
		...(await inboxDriverSources()),
		...extraSources,
	];
	captureSources(sources);
	const traces = [];
	for (const actions of [
		["close"],
		["askDiscard", "no"],
		["askDiscard", "yesDiscard"],
		["askSend", "no"],
		["askSend", "yesSend"],
		["askSend", "edit"],
	]) {
		const fixture = await createInboxFixture(),
			pair = fixture.createPair();
		await pair.bind();
		await pair.drafts.newEmail();
		let c = pair.drafts.render().c;
		c.onTo({ target: { value: "friend@example.invalid" } });
		pair.drafts.render().c.addRaw();
		pair.drafts.render().c.onSubj({ target: { value: "Fixture subject" } });
		pair.drafts.render().c.onBody({ target: { value: "Fixture body" } });
		await fixture.settle();
		const observe = () => ({
			"s.draft": !!pair.drafts.email(),
			"s.sends": fixture.state.dispatches,
		});
		const t = trace(actions.join(" then "), observe());
		try {
			for (const action of actions) {
				c = pair.drafts.render().c;
				if (action === "close") pair.drafts.close();
				if (action === "askDiscard") {
					c.discard();
					assert.equal(pair.drafts.render().c.confirm, true);
				}
				if (action === "no") {
					if (c.confirm) c.cancelDiscard();
					else pair.provider.render().provider.close();
				}
				if (action === "yesDiscard") c.confirmDiscard();
				if (action === "askSend") {
					c.send();
					await fixture.settle();
					assert.equal(pair.provider.render().provider.canConfirm, true);
				}
				if (action === "yesSend") pair.provider.render().provider.confirm();
				if (action === "edit")
					c.onBody({ target: { value: "Changed after review" } });
				await fixture.settle();
				checkpoint(t, action, call(action), observe());
			}
			if (actions.includes("edit")) {
				pair.provider.render().provider.confirm();
				await fixture.settle();
				assert.equal(
					fixture.state.dispatches,
					0,
					"changed content cannot use old approval",
				);
			}
			traces.push(t);
		} finally {
			pair.dispose();
		}
	}
	return checkTraces(
		boundInputs({
			model: "MailComposerPresentation",
			sources,
			traces,
			scope: "bounded-orchestration",
			assumptions: [
				"Execute the actual Inbox composer and review controllers. Confirmed send uses their journal and prepared-content check with a synthetic provider.",
				"Observe draft retention and provider dispatch count. DOM styling, concurrent shelf writes and real delivery remain separate tests and runtime evidence.",
			],
		}),
	);
}
