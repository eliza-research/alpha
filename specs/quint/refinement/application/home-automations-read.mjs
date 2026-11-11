import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { checkTraces } from "../check-traces.mjs";
import {
	boundInputs,
	call,
	captureSources,
	checkpoint,
	deferred,
	trace,
} from "./support.mjs";
import {
	automationsViewFixture,
	waitForAutomation,
} from "./automations-view-fixture.mjs";

export async function checkHomeAutomationsRead(extraSources = []) {
	const sources = [fileURLToPath(import.meta.url), ...extraSources];
	captureSources(sources);
	const fixture = await automationsViewFixture(),
		traces = [];
	for (const leaveEarly of [false, true]) {
		const gate = deferred(),
			requests = [];
		const request = async (path, method, _body, signal) => {
			requests.push({ path, method, signal });
			await gate.promise;
			return path === "/api/automations"
				? {
						automations: [
							{
								id: "workflow:flow",
								type: "workflow",
								title: "Owned routine",
								description: "Test",
								enabled: true,
								status: "active",
								workflowId: "flow",
								schedules: [],
							},
						],
					}
				: path.includes("scheduled-tasks")
					? { tasks: [] }
					: path.includes("reminders")
						? { reminders: [] }
						: { definitions: [] };
		};
		const app = fixture(request, {}, { view: null, deviceReminders: [] });
		let atHome = true;
		const observe = () => ({
			atHome,
			rows: app.home().homeWorkflowRows?.length ?? 0,
		});
		const t = trace(
			leaveEarly
				? "leaving Home retires the pending preload"
				: "Home reads workflows without opening Workflows",
			observe(),
		);
		await waitForAutomation(() => requests.length > 0);
		checkpoint(t, "Home starts read", call("start"), observe());
		if (leaveEarly) {
			atHome = false;
			app.setView("notes");
			app.home();
			checkpoint(
				t,
				"leave Home while the read is pending",
				call("leave"),
				observe(),
			);
			assert.ok(requests.every((r) => r.signal.aborted));
		}
		gate.resolve();
		if (!leaveEarly) {
			await waitForAutomation(() => app.home().homeWorkflowHasRows === true);
			checkpoint(
				t,
				"read completes with one owner row",
				call("finish", 1),
				observe(),
			);
		} else {
			await new Promise((resolve) => setImmediate(resolve));
			assert.equal(app.home().homeWorkflowRows?.length ?? 0, 0);
			checkpoint(
				t,
				"cancelled transport settles without publishing rows",
				null,
				observe(),
			);
		}
		assert.ok(requests.every((r) => r.method === "GET"));
		traces.push(t);
		app.close();
	}
	return checkTraces(
		boundInputs({
			model: "HomeAutomationsRead",
			sources,
			traces,
			scope: "bounded-orchestration",
			assumptions: [
				"Reuse the existing automations adapter fixture and execute normal Home render preloading with deferred read-only transport.",
				"Observe Home visibility and row count. Owner replacement, saved restoration and suspension remain covered by owning regression tests and need richer trace instrumentation.",
			],
		}),
	);
}
