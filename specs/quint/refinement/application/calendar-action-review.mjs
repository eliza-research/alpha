import assert from "node:assert/strict";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { checkTraces } from "../check-traces.mjs";
import {
	boundInputs,
	call,
	captureSources,
	checkpoint,
	root,
	trace,
} from "./support.mjs";

export async function checkCalendarActionReview(extraSources = []) {
	const built = await build({
		absWorkingDir: root,
		entryPoints: ["apps/app/src/runtime/calendar-action-confirmation.ts"],
		bundle: true,
		write: false,
		format: "cjs",
		platform: "node",
		metafile: true,
	});
	const sources = [
		fileURLToPath(import.meta.url),
		...Object.keys(built.metafile.inputs),
    "apps/app/src/runtime/calendar-approval.ts",
    "apps/app/src/runtime/connection-ui.tsx",
    "apps/app/src/prototype/calendar-approval-adapter.ts",
    "apps/app/src/prototype/calendar-approval-review.ts",
    "test/calendar-approval-ui.test.mjs",
		...extraSources,
	];
	captureSources(sources);
	const traces = [];
	for (const approved of [false, true]) {
		const dom = new JSDOM(
			'<div class="os"><button id="origin">Edit</button></div>',
			{ pretendToBeVisual: true },
		);
		const module = { exports: {} };
		const context = {
			module,
			exports: module.exports,
			window: dom.window,
			document: dom.window.document,
			HTMLElement: dom.window.HTMLElement,
			Element: dom.window.Element,
			MutationObserver: dom.window.MutationObserver,
			getComputedStyle: dom.window.getComputedStyle,
			queueMicrotask,
			setTimeout,
			clearTimeout,
			requestAnimationFrame: (callback) => callback(),
		};
		vm.runInNewContext(built.outputFiles[0].text, context);
		dom.window.document.getElementById("origin").focus();
		let kind = "";
		const observe = () => ({
			pending: dom.window.document.querySelector('[role="dialog"]') ? kind : "",
		});
		const t = trace(
			approved ? "confirm Calendar save once" : "cancel Calendar save",
			observe(),
		);
		kind = "save";
		const pending = module.exports.confirmCalendarAction(
			"Save event?",
			"Selected event",
			"Save",
		);
		checkpoint(t, "review exact action", call("request", "save"), observe());
		const buttons = [
			...dom.window.document.querySelectorAll('[role="dialog"] button'),
		];
		assert.deepEqual(
			buttons.map((button) => button.textContent),
			["Cancel", "Save"],
		);
		buttons[approved ? 1 : 0].click();
		assert.equal(await pending, approved);
		checkpoint(
			t,
			approved ? "confirm action" : "cancel action",
			call(approved ? "confirm" : "cancel"),
			observe(),
		);
		// A retired DOM control cannot settle this promise a second time.
		buttons[1].click();
		assert.equal(dom.window.document.querySelector('[role="dialog"]'), null);
		traces.push(t);
		dom.window.close();
	}
	return checkTraces(
		boundInputs({
			model: "CalendarActionReview",
			sources,
			traces,
			scope: "bounded-component",
			assumptions: [
				"Execute the real Calendar confirmation modal and shared focus/inert implementation in JSDOM. Observe modal request and terminal choice.",
				"Provider write counts, owner replacement, deletion-receipt suppression and real visual layout remain separate controller and browser obligations.",
			],
		}),
	);
}
