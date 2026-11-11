import assert from "node:assert/strict";
import { runNativeFixture } from "./native-test-fixture.ts";
const [appApk, testApk, output = "test-results/reminder-one-off"] =
	process.argv.slice(2);
await runNativeFixture({
	scenario: "reminder-one-off",
	appApk,
	testApk,
	output,
	testClass: "ReminderOneOffInstrumentedTest",
	testMethod: "actualOneOffAlarmSnoozeVisibleDoneHistoryAndReplaySafety",
	expectedTests: 1,
	runnerArgs: ["-e", "oneOffAlarm", "1"],
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
