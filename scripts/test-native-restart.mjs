/** Product restart assertions; shared lifecycles own APKs, lease, and temporary user. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { runNativeFixture } from "./native-test-fixture.mjs";

const cases = {
	"text-scale": {
		testClass: "TextScaleInstrumentedTest",
		method: "textScaleProcessRestartPhase",
		gate: "textScalePhase",
		restore: "verify",
		scope:
			"Persisted text zoom and real glyph geometry; distinct PID asserted by native test",
	},
	tree: {
		testClass: "FilesTreeRestartInstrumentedTest",
		method: "processPhase",
		gate: "treePhase",
		restore: "verify",
		scope:
			"Real persisted SAF folder grant, list, preview and scoped write; distinct PID asserted by native test",
	},
	bookmark: {
		testClass: "BrowserContinuityInstrumentedTest",
		method: "bookmarkProcessRestartPhase",
		gate: "bookmarkPhase",
		restore: "verify",
		afterRestore: "verifyRemoved",
		scope:
			"Real HTTPS bookmark persistence and removal across two new processes; native profile cleanup",
	},
	signin: {
		testClass: "BrowserSigninsInstrumentedTest",
		method: "signinProcessRestartPhase",
		gate: "signinPhase",
		restore: "verify",
		scope:
			"Normal-tab sign-in cookie and storage survive a new process while a private tab's do not (P-04); real HTTPS page, synthetic cookie, no account",
	},
	inbox: {
		testClass: "InboxDraftInstrumentedTest",
		method: "processPhase",
		gate: "inboxPhase",
		runId: "inboxRunId",
		pid: "inboxFixturePid",
		restore: "restore",
		scope:
			"Synthetic Cloud protocol and real encrypted drafts; no mail or provider network",
	},
	notes: {
		testClass: "NotesDocumentInstrumentedTest",
		method: "documentProcessRestartPhase",
		gate: "notesDocumentPhase",
		runId: "notesDocumentRunId",
		pid: "notesDocumentPid",
		restore: "restore",
		scope: "Development fixture only: explicit test-mocks APK required; real SAF grants, exact document bytes and persisted local notes",
	},
	document: {
		testClass: "SelectedDocumentInstrumentedTest",
		method: "documentProcessRestartPhase",
		gate: "documentPhase",
		restore: "verify",
		scope:
			"Real SAF grant restoration and revocation; distinct PID asserted by native test",
	},
	// MVP-25: the legacy localStorage Notes layout migrates into the encrypted slot in a new
	// process, as after an upgrade; the exact legacy and current bytes are read back.
	"notes-secure-migration": {
		testClass: "NotesSecureStorageInstrumentedTest",
		method: "secureMigrationProcessRestartPhase",
		gate: "notesSecureMigrationPhase",
		restore: "verify",
		scope:
			"Synthetic legacy Notes layout migrated in a new process; exact bytes read back from the Keystore-encrypted slot",
	},
	// The crash phase kills its own process through the real default handler: the runner requires
	// that interruption, confirms no app process is left, and reads the log back in a new process.
	"crash-log": {
		testClass: "SettingsCrashLogInstrumentedTest",
		method: "realCrashSurvivesRestartAndShowsInSettings",
		gate: "crashLogPhase",
		crash: "crash",
		restore: "readback",
		scope:
			"A real uncaught exception recorded by class only, read back and shown in Settings by a new process",
	},
	// PRD AP-15: 200% system font kept by a new process, and the first screen read in TalkBack order.
	accessibility: {
		testClass: "AccessibilityLifecycleInstrumentedTest",
		method: "processRestartPhase",
		gate: "accessibilityPhase",
		restore: "verify",
		scope:
			"200% system font kept by a new process: measured text scale and the TalkBack order of the first screen (Home and Settings, or the required sign-in page of a signed-out flag-off build); distinct PID asserted by native test",
	},
	// F18: Display > Theme survives a new process (the browser spec covers storage only).
	theme: {
		testClass: "SettingsFlowInstrumentedTest",
		method: "themeProcessRestartPhase",
		gate: "themePhase",
		restore: "verify",
		scope: "Dark theme chosen in Settings and applied by a new process",
	},
	// J03: a reviewed note's linked source reopens the exact bytes in a new process.
	"source-reference": {
		testClass: "SelectedDocumentInstrumentedTest",
		method: "sourceReferenceProcessRestartPhase",
		gate: "sourceReferencePhase",
		restore: "verify",
		scope:
			"Retained SAF source reference reopened with exact bytes after a process restart",
	},
};
const [scenario, appApk, testApk, output = "test-results/native-restart"] =
	process.argv.slice(2);
assert.ok(
	Object.hasOwn(cases, scenario),
	"Choose " + Object.keys(cases).join(", "),
);
const selected = cases[scenario],
	runId = crypto.randomUUID();
const phaseArgs = (name) => [
	"-e",
	selected.gate,
	name,
	...(selected.runId ? ["-e", selected.runId, runId] : []),
];

const details = { runId, scope: selected.scope };
await runNativeFixture({
	scenario,
	appApk,
	testApk,
	output,
	details,
	testClass: selected.testClass,
	testMethod: selected.method,
	runnerArgs: phaseArgs("prepare"),
	evidence:
		selected.scope +
		"; owned secondary emulator user, not physical-device acceptance.",
	collectVariant: async (context) => {
		const { androidUser: user, packageName: app, directory, variant } = context;
		const stop = () =>
			context.run("shell", "am", "force-stop", "--user", String(user), app);
		await stop();
		if (selected.crash) {
			const testClass = app + "." + selected.testClass;
			let output;
			try {
				output = await context.run(
					"shell",
					"am",
					"instrument",
					"--user",
					String(user),
					"-w",
					"-r",
					"-e",
					"class",
					testClass + "#" + selected.method,
					...phaseArgs(selected.crash),
					app + ".test/androidx.test.runner.AndroidJUnitRunner",
				);
			} catch (error) {
				output = String(error.stdout ?? "");
			}
			fs.writeFileSync(
				path.join(directory, variant + "-phase-" + selected.crash + ".log"),
				output,
			);
			const { requireInstrumentationInterruption } = await import(
				"../vendor/eliza/packages/app/scripts/lib/instrumentation-result.mjs"
			);
			let left;
			try {
				left = (await context.run("shell", "pidof", app)).trim();
			} catch (error) {
				// pidof exits 1 with no output when nothing matches.
				if (error.code !== 1 || String(error.stdout ?? "").trim()) throw error;
				left = "";
			}
			details.crash = {
				instrumentation: requireInstrumentationInterruption(
					output,
					testClass,
					selected.method,
				),
				processExited: left === "",
			};
			assert.equal(left, "", "The crashed process must be gone before readback");
			// Proven above without it; the stop only keeps every phase boundary the same.
			await stop();
		}
		await context.instrumentPhase(
			selected.restore,
			phaseArgs(selected.restore),
		);
		if (selected.afterRestore) {
			await stop();
			await context.instrumentPhase(
				selected.afterRestore,
				phaseArgs(selected.afterRestore),
			);
		}

		if (selected.pid) {
			const pid = (label) => {
				const log = fs.readFileSync(path.join(directory, label), "utf8");
				const matches = [
					...log.matchAll(
						new RegExp(
							"^INSTRUMENTATION_RESULT: " + selected.pid + "=(\\d+)\\r?$",
							"gm",
						),
					),
				];
				assert.equal(
					matches.length,
					1,
					"Exactly one process identity required per phase",
				);
				const value = Number(matches[0][1]);
				assert.ok(
					Number.isSafeInteger(value) && value > 0,
					"Valid process identity required",
				);
				return value;
			};
			details.processes = {
				prepare: pid(variant + ".log"),
				restore: pid(variant + "-phase-" + selected.restore + ".log"),
			};
			assert.notEqual(
				details.processes.prepare,
				details.processes.restore,
				"Process restart not proven",
			);
		}
	},
	cleanupVariant: async (context) => {
		const { androidUser: user, packageName: app } = context;
		if (!context.instrumentPhase) return; // Partial installation: upstream owns package cleanup.
		await context.run("shell", "am", "force-stop", "--user", String(user), app);
		await context.instrumentPhase("cleanup", phaseArgs("cleanup"));
	},
});
