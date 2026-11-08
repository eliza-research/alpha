import test from "node:test";
import assert from "node:assert/strict";
import { exercise } from "./fixtures/isolated-native-campaign.mjs";
for (const kind of [
	"inbox",
	"notes",
	"document",
	"text-scale",
	"bookmark",
	"notes-secure-migration",
	"crash-log",
	"theme",
	"source-reference",
]) {
	test(`${kind} restart owns its user and APKs and executes prepare, restore and cleanup`, () => {
		const r = exercise("pass", kind);
		assert.equal(r.code, 0, r.stderr);
		assert.equal(r.record.passed, true);
		assert.equal(r.record.userLifecycle.removed, true);
		assert.equal(r.state.created, false);
		assert.equal(r.state.user, "0");
		assert.deepEqual(r.state.files, {});
		const calls = r.commands.filter((a) => a.includes("instrument"));
		assert.equal(calls.length, ["bookmark", "crash-log"].includes(kind) ? 4 : 3);
		assert.ok(calls.every((a) => a[a.indexOf("--user") + 1] === "10"));
		const positions = r.commands.flatMap((a, i) =>
			a.includes("instrument") ? [i] : [],
		);
		for (let n = 1; n < positions.length; n++)
			assert.ok(
				r.commands
					.slice(positions[n - 1] + 1, positions[n])
					.some(
						(a) =>
							a.includes("force-stop") && a[a.indexOf("--user") + 1] === "10",
					),
				"Every phase boundary stops only the owned user's package",
			);
		const gate = {
			inbox: "inboxPhase",
			notes: "notesDocumentPhase",
			document: "documentPhase",
			"text-scale": "textScalePhase",
			bookmark: "bookmarkPhase",
			"notes-secure-migration": "notesSecureMigrationPhase",
			"crash-log": "crashLogPhase",
			theme: "themePhase",
			"source-reference": "sourceReferencePhase",
		}[kind];
		assert.deepEqual(
			calls.map((a) => a[a.indexOf(gate) + 1]),
			kind === "crash-log"
				? ["prepare", "crash", "readback", "cleanup"]
				: [
						"prepare",
						["inbox", "notes"].includes(kind) ? "restore" : "verify",
						...(kind === "bookmark" ? ["verifyRemoved"] : []),
						"cleanup",
					],
		);
		if (["inbox", "notes"].includes(kind))
			assert.deepEqual(r.record.processes, { prepare: 100, restore: 200 });
		if (kind === "crash-log") {
			// The crash phase is a raw instrumentation that must end in the process crash.
			assert.equal(r.record.crash.processExited, true);
			assert.equal(r.commands.filter((a) => a.includes("pidof")).length, 1);
		}
	});
	// Failure handling is shared by all configurations; exercise it once.
	if (kind === "inbox") for (const mode of [
		"summary-only",
		"wrong-method",
		"wrong-count",
		"missing-start",
		"duplicate",
		"wrong-terminal",
		"skipped",
		"existing",
		"archive-pin",
	])
		test(`${kind} restart refuses ${mode}`, () => {
			const r = exercise(mode, kind);
			assert.notEqual(r.code, 0);
			if (["existing", "archive-pin"].includes(mode))
				assert.ok(
					!r.commands.some(
						(a) => a[0] === "install" || a.includes("create-user"),
					),
				);
			else {
				assert.equal(r.record.passed, false);
				assert.equal(r.record.userLifecycle.cleanupDeferred, true);
				assert.equal(r.state.created, true);
				assert.equal(r.state.user, "0");
			}
		});
}
for (const kind of ["inbox"])
	for (const mode of ["same-pid", "missing-pid", "duplicate-pid"])
		test(`${kind} requires unambiguous different process identities: ${mode}`, () => {
			const r = exercise(mode, kind);
			assert.notEqual(r.code, 0);
			assert.equal(r.record.passed, false);
			assert.equal(r.state.created, false);
			assert.equal(
				r.commands.filter((a) => a.includes("instrument")).length,
				3,
			);
		});
for (const mode of ["crash-completes", "crash-survives"])
	test(`crash-log refuses a crash phase that ${mode === "crash-completes" ? "did not crash" : "left a process"} and never reads back`, () => {
		const r = exercise(mode, "crash-log");
		assert.notEqual(r.code, 0);
		assert.equal(r.record.passed, false);
		const phases = r.commands
			.filter((a) => a.includes("instrument"))
			.map((a) => a[a.indexOf("crashLogPhase") + 1]);
		assert.ok(!phases.includes("readback"), "No readback after an unproven crash");
		assert.equal(phases.at(-1), "cleanup");
	});
test("restart retains the fixture user when owned process termination is uncertain", () => {
	const r = exercise("stop-failure", "inbox");
	assert.notEqual(r.code, 0);
	assert.equal(r.record.userLifecycle.cleanupDeferred, true);
	assert.equal(r.state.created, true);
	assert.ok(!r.commands.some((a) => a[0] === "uninstall"));
});

for (const kind of ["inbox", "bookmark"])
	test(`${kind} failed preparation still runs verified cleanup`, () => {
		const r = exercise("prepare-failure", kind);
		assert.notEqual(r.code, 0);
		assert.equal(r.record.passed, false);
		assert.equal(r.state.created, false);
		assert.equal(r.record.userLifecycle.removed, true);
		assert.equal(r.commands.filter((a) => a.includes("instrument")).length, 2);
	});

for (const kind of ["document"])
	test(`${kind} transport failure stops owned packages before cleanup`, () => {
		const r = exercise("timeout", kind);
		assert.notEqual(r.code, 0);
		assert.equal(r.record.passed, false);
		assert.match(r.log, /INSTRUMENTATION_STATUS/);
		const calls = r.commands,
			first = calls.findIndex((a) => a.includes("instrument"));
		assert.ok(
			calls
				.slice(first + 1)
				.some((a) => a.includes("force-stop") && a.includes("--user")),
		);
	});
