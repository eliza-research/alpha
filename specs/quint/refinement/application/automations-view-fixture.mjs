import assert from "node:assert/strict";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { stripTypeScriptTypes } from "../../../../test/support/strip-types.mjs";
import { bundledSource, captureSources, read } from "./support.mjs";

/** Reuse the existing adapter fixture without running its node:test registrations. */
export async function automationsViewFixture() {
	captureSources([fileURLToPath(import.meta.url)]);
	const testSource = read("test/automations-unified.test.mjs");
	const start = testSource.indexOf("function adapterFixture("),
		end = testSource.indexOf("\nconst wait=", start);
	assert.ok(
		start >= 0 && end > start,
		"Existing automations adapter fixture boundary",
	);
	const protocol = await bundledSource(
		"apps/app/src/runtime/automations-protocol.ts",
	);
	const clock = await bundledSource(
		"apps/app/src/runtime/workflow-local-time.ts",
	);
	const home = await bundledSource("apps/app/src/prototype/home-cards.ts");
	const transformed = (path) =>
		stripTypeScriptTypes(
			read(path)
				.replace(/^import .*;\n/gm, "")
				.replace(/export /g, ""),
			{ mode: "transform" },
		);
	const context = {
		...clock.exports,
		...home.exports,
		protocol: protocol.exports,
		transformed,
		fs: { readFileSync: (path) => read(path) },
		JSDOM,
		vm,
		crypto: webcrypto,
		Event,
		AbortController,
		queueMicrotask,
		console,
	};
	return vm.runInNewContext(
		"(" +
			testSource
				.slice(start, end)
				.replace(
					"setView:next=>view=next",
					"setView:next=>{view=next;shell.componentDidUpdate?.();}",
				) +
			")",
		context,
	);
}
export async function waitForAutomation(readiness) {
	for (let attempt = 0; attempt < 300; attempt++) {
		if (readiness()) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw Error("Automation fixture did not settle");
}
