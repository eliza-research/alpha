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

export async function checkContentLinks(extraSources = []) {
	const compiled = await bundledSource(
		"apps/app/src/prototype/content-links.tsx",
	);
	const sources = [driver, ...compiled.sources, ...extraSources];
	captureSources(sources);
	const traces = [];
	async function scenario(name, actions) {
		const requests = [];
		let view = 0,
			origin = 0,
			opened = 0;
		const host = {
			live: true,
			S: () => ({ view: String(view) }),
			toast() {},
			async browserOpenContentLink(url, signal) {
				const id = requests.length + 1;
				const gate = deferred();
				origin = view;
				requests.push({ gate, signal });
				await gate.promise;
				return () => {
					opened = id;
					view = 2;
				};
			},
		};
		const observe = () => ({
			"s.view": view,
			"s.origin": origin,
			"s.pending":
				!!host.contentLinkAbort && !host.contentLinkAbort.signal.aborted,
			"s.live": host.live,
			"s.token": requests.length,
			"s.selected": requests.length,
			"s.opened": opened,
		});
		const t = trace(name, observe());
		const pending = [];
		for (const [action, id] of actions) {
			if (action === "click")
				pending.push(
					compiled.exports.openContentLink(
						host,
						"https://example.org/selected",
					),
				);
			if (action === "leave") view = 1;
			if (action === "retire") {
				host.live = false;
				host.contentLinkAbort?.abort();
			}
			if (action === "finish") {
				requests[id - 1].gate.resolve();
				await pending[id - 1];
			}
			checkpoint(t, action, call(action, ...(id ? [id] : [])), observe());
		}
		for (const request of requests) request.gate.resolve();
		await Promise.all(pending);
		if (actions.some(([action]) => action === "retire"))
			checkpoint(
				t,
				"late completion cannot present on retired host",
				null,
				observe(),
			);
		traces.push(t);
	}
	await scenario("current selection opens Browser", [["click"], ["finish", 1]]);
	await scenario("late result preserves changed view", [
		["click"],
		["leave"],
		["finish", 1],
	]);
	await scenario("new selection cancels previous presentation", [
		["click"],
		["click"],
		["finish", 1],
		["finish", 2],
	]);
	await scenario("retired host cancels selected presentation", [
		["click"],
		["retire"],
	]);
	return checkTraces(
		boundInputs({
			model: "ContentLinks",
			sources,
			traces,
			scope: "bounded-component",
			assumptions: [
				"Execute the actual openContentLink function with deferred Browser presentation callbacks and AbortSignals.",
				"Two links and three view classes. URL loading, the platform Browser and document rendering require separate integration evidence.",
			],
		}),
	);
}
