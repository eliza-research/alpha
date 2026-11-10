import assert from "node:assert/strict";
import { runNativeFixture } from "./native-test-fixture.ts";
const [appApk, testApk, output = "test-results/reminder-recurrence"] =
	process.argv.slice(2);
await runNativeFixture({
	scenario: "reminder-recurrence",
	appApk,
	testApk,
	output,
	testClass: "ReminderRecurrenceInstrumentedTest",
	expectedTests: 2,
	runnerArgs: ["-e", "recurrenceAlarm", "1"],
	instrumentationTimeoutMs: 960000,
	evidence:
		"Actual native reminder alarms and UI assertions in an owned secondary emulator user; no physical-device acceptance.",
	prepareVariant: async ({ run, androidUser, packageName }) => {
		assert.ok(
			Number((await run("shell", "getprop", "ro.build.version.sdk")).trim()) >=
				33,
			"Notification fixture requires Android 13+",
		);
		await run(
			"shell",
			"pm",
			"grant",
			"--user",
			String(androidUser),
			packageName,
			"android.permission.POST_NOTIFICATIONS",
		);
	},
});
