import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { checkTraces, qset } from "../check-traces.mjs";
import {
	boundInputs,
	call,
	captureSources,
	checkpoint,
	trace,
} from "./support.mjs";
import {
	automationsViewFixture,
	waitForAutomation,
} from "./automations-view-fixture.mjs";

export async function checkWorkflowRecoverySelection(extraSources = []) {
	const sources = [fileURLToPath(import.meta.url), ...extraSources];
	captureSources(sources);
	const fixture = await automationsViewFixture(),
		traces = [];
	for (const outcome of [
		"success",
		"cancel",
		"unknown",
		"rejected",
		"bad-restore",
	]) {
		const records = [0, 1].map((id) => ({
			id: `trigger:item-${id}`,
			type: "coordinator_text",
			title: `Item ${id}`,
			description: "Owned test",
			enabled: false,
			status: "paused",
			schedules: [
				{ triggerType: "cron", cronExpression: "0 8 * * *", timezone: "UTC" },
			],
			triggerId: `item-${id}`,
			trigger: {
				id: `item-${id}`,
				displayName: `Item ${id}`,
				instructions: "Owned test",
				revision: String(id + 1).repeat(64),
				enabled: false,
				triggerType: "cron",
				cronExpression: "0 8 * * *",
			},
		}));
		const stored = new Map(
			records.map((row, id) => [id, structuredClone(row)]),
		);
		const removed = new Set(),
			sends = [0, 0],
			restores = [];
		let confirmedArchives = 0;
		let restoredInactive = false,
			recording = true;
		const observe = () => ({
			"s.sends": [...sends],
			"s.current": confirmedArchives,
			"s.removed": qset([...removed]),
			"s.retained": qset([...stored.keys()]),
			"s.restoredInactive": restoredInactive,
		});
		const t = trace(`workflow recovery ${outcome}`, observe());
		const request = async (path, method = "GET", body) => {
			if (method === "GET") {
				if (path === "/api/automations")
					return {
						automations: [...stored.values()].filter(
							(row) => !removed.has(Number(row.triggerId.slice(-1))),
						),
					};
				if (path === "/api/triggers?removed=1")
					return {
						recovery: true,
						triggers: [...stored.values()]
							.filter((row) => removed.has(Number(row.triggerId.slice(-1))))
							.map((row) => ({ ...row.trigger, removedAt: 1 })),
					};
				if (path === "/api/workflow/status")
					return {
						engine: "smthrs",
						status: "ready",
						lifecycleMutationProtocol: 1,
					};
				if (path === "/api/workflow/removed-workflows")
					return { workflows: [] };
				if (path.includes("scheduled-tasks")) return { tasks: [] };
				if (path.includes("reminders")) return { reminders: [] };
				if (path.includes("definitions")) return { definitions: [] };
			}
			const match = path.match(
				/^\/api\/triggers\/item-(\d)\/(archive|restore)$/,
			);
			assert.ok(match, path);
			const id = Number(match[1]);
			assert.deepEqual(body, {
				expectedRevision: stored.get(id).trigger.revision,
			});
			if (match[2] === "restore") {
				const saved = {
					...stored.get(id).trigger,
					enabled: outcome === "bad-restore" && id === 1,
				};
				restores.push({
					id,
					body: structuredClone(body),
					response: structuredClone(saved),
				});
				stored.get(id).trigger = saved;
				stored.get(id).enabled = saved.enabled;
				removed.delete(id);
				return { ok: true, trigger: saved };
			}
			sends[id]++;
			if (recording)
				checkpoint(t, "dispatch owned archive", call("dispatch"), observe());
			if (outcome === "unknown") throw Error("Lost response");
			if (outcome === "rejected")
				throw Object.assign(Error("Refused"), { status: 403 });
			removed.add(id);
			confirmedArchives++;
			if (recording)
				checkpoint(
					t,
					"provider confirms preserved archived record",
					call("saved"),
					observe(),
				);
			return { ok: true, trigger: { ...records[id].trigger, removedAt: 1 } };
		};
		const app = fixture(request, {}, { deviceReminders: [] });
		try {
			app.render();
			await waitForAutomation(
				() =>
					app.render().cards.length === 2 && !app.render().automation.loading,
			);
			app.render().startSelection();
			app.render().selectAll();
			app.render().prepareRecovery();
			assert.ok(app.render().recoveryReview);
			checkpoint(t, "review selected records", call("review"), observe());
			if (outcome === "cancel") {
				app.render().recoveryReview.close();
				checkpoint(t, "cancel review", call("cancel"), observe());
				assert.deepEqual(sends, [0, 0]);
			} else {
				checkpoint(t, "confirm selected records", call("approve"), observe());
				app.render().recoveryReview.confirm();
				await waitForAutomation(
					() => !app.render().batchBusy && !app.render().automation.loading,
				);
				if (outcome === "success" || outcome === "bad-restore") {
					assert.deepEqual(sends, [1, 1]);
					recording = false;
					app.render().openDeleted();
					app.render();
					await waitForAutomation(
						() =>
							app.render().cards.length === 2 &&
							!app.render().automation.loading,
					);
					app.render().startSelection();
					app.render().selectAll();
					app.render().prepareRecovery();
					app.render().recoveryReview.confirm();
					await waitForAutomation(
						() =>
							removed.size === 0 &&
							!app.render().batchBusy &&
							!app.render().automation.loading,
					);

					assert.deepEqual(
						restores.map((row) => row.id),
						[0, 1],
					);
					if (outcome === "bad-restore") {
						assert.match(
							app.render().automation.message,
							/unknown|could not be confirmed/i,
						);
						assert.equal(restores[1].response.enabled, true);
					} else {
						assert.doesNotMatch(
							app.render().automation.message,
							/unknown|could not|failed|refused/i,
						);
						app.render().endSelection();
						app.back();
						app.render();
						await waitForAutomation(
							() =>
								app.render().cards.length === 2 &&
								!app.render().automation.loading,
						);
						const cards = app.render().cards;
						assert.deepEqual(
							cards.map((card) => card.name),
							["Item 0", "Item 1"],
						);
						restoredInactive = cards.every((card) => card.on === false);
						assert.equal(restoredInactive, true);
						checkpoint(
							t,
							"restore both records inactive",
							call("restore"),
							observe(),
						);
					}
				} else {
					assert.deepEqual(sends, [1, 0]);
					checkpoint(
						t,
						outcome,
						call(outcome === "unknown" ? "unknown" : "rejected"),
						observe(),
					);
				}
			}
			traces.push(t);
		} finally {
			app.close();
		}
	}
	return checkTraces(
		boundInputs({
			model: "WorkflowRecoverySelection",
			sources,
			traces,
			scope: "bounded-orchestration",
			assumptions: [
				"Execute the actual Workflows selection, confirmation, archive and restore adapter with exact revision checks and controlled provider records.",
				"Two inactive prompt records. Current counts confirmed archives. Restore is observed after both provider replies. Native notification delivery and actual remote persistence remain separate.",
			],
		}),
	);
}
