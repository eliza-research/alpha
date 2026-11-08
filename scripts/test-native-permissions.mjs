/** Product permission scenarios; shared lifecycles own the device and temporary user. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

/**
 * Each scenario runs one exact method in a fresh secondary emulator user whose
 * permission state this runner sets before the app process starts. Nothing is
 * restored afterwards because the user is removed with its grants.
 * `revokeWhileRecording` adds the phases a single process cannot observe:
 * Android kills the app when a runtime permission is revoked.
 */
export const cases = {
	camera: {
		testClass: "CameraFlowInstrumentedTest",
		method: "denyingCameraAllowsExplicitRetryWithoutFakePreview",
		gate: "cameraPermissionTest",
		value: "true",
		permissions: [["revoke", "CAMERA"]],
	},
	// Granted camera: the real CameraX preview, Ask about the live frame (nothing published), one
	// Take photo published to MediaStore, the exact item shared and asked about from Photos, and the
	// preview released on leaving Camera (MVP-13, MVP-30).
	"camera-capture": {
		testClass: "CameraFlowInstrumentedTest",
		method: "photoCapturePublishesReadableImageAndShowsRealViewer",
		gate: "cameraCapture",
		value: "1",
		permissions: [["grant", "CAMERA"]],
	},
	settings: {
		testClass: "SettingsNativeInstrumentedTest",
		method: "accountsHandoffAndLocationAccuracyReadback",
		gate: "settingsNative",
		value: "1",
		permissions: [
			["revoke", "ACCESS_FINE_LOCATION"],
			["grant", "ACCESS_COARSE_LOCATION"],
		],
	},
	channels: {
		testClass: "NotificationChannelsInstrumentedTest",
		method: "blockedChannelReadbackUserRecoveryAndRealNotification",
		gate: "notificationChannels",
		value: "1",
		permissions: [["grant", "POST_NOTIFICATIONS"]],
	},
	// Denied microphone: honest recovery state, Android app settings, typing still usable, no capture.
	voice: {
		testClass: "VoicePermissionDeniedInstrumentedTest",
		method: "deniedMicrophoneShowsSettingsRecoveryAndKeyboard",
		gate: "voicePermissionDenied",
		value: "1",
		permissions: [["revoke", "RECORD_AUDIO"]],
	},
	// Granted, revoked while the recorder is capturing, checked in a new process, granted again.
	"voice-revoke": {
		testClass: "VoicePermissionRevokeInstrumentedTest",
		method: "microphoneRevokedWhileRecordingPhase",
		gate: "voiceRevokePhase",
		value: "baseline",
		permissions: [["grant", "RECORD_AUDIO"]],
		revokeWhileRecording: {
			permission: "RECORD_AUDIO",
			runIdGate: "voiceRevokeRunId",
			marker: "files/voice-revoke/recording.json",
			phases: ["record", "verify", "regrant"],
		},
	},
	// The real recorder stops at its limit with the whole duration decodable (permission granted first).
	"voice-limit": {
		testClass: "LocalVoiceRecordingLimitInstrumentedTest",
		method: "nativeLocalDeadlineStopsBeforeAsrMaximum",
		gate: "localVoiceRecording",
		value: "1",
		permissions: [["grant", "RECORD_AUDIO"]],
	},
	// Result notice with notifications allowed: posted, redacted, tapped once across recreation.
	notice: {
		testClass: "HostedResultNoticeInstrumentedTest",
		method: "redactedNoticeTapSurvivesRecreationWithoutReplay",
		gate: "hostedNotice",
		value: "1",
		permissions: [["grant", "POST_NOTIFICATIONS"]],
	},
	// Notifications denied: the result stays in encrypted history and no notice is posted.
	"notice-denied": {
		testClass: "HostedResultNoticeInstrumentedTest",
		method: "deniedNotificationRetainsEncryptedHistory",
		gate: "hostedNoticeDenied",
		value: "1",
		permissions: [["revoke", "POST_NOTIFICATIONS"]],
	},
};

const RUNNER = "androidx.test.runner.AndroidJUnitRunner";

/**
 * Start the recording phase, wait for its marker, revoke the permission and
 * require Android to end that exact process mid-test. Never force-stops: a
 * process that survives revocation is a failure, not something to hide.
 */
export async function revokeWhileRecording(
	context,
	selected,
	{ runId, details, timeoutMs = 120000, pollMs = 200 },
) {
	const { run, androidUser, packageName, directory, variant } = context;
	const { permission, runIdGate, marker } = selected.revokeWhileRecording;
	const user = String(androidUser),
		name = "android.permission." + permission,
		testClass = packageName + "." + selected.testClass;
	const extras = (phase) => ["-e", selected.gate, phase, "-e", runIdGate, runId];
	let settled = false;
	const recording = run(
		"shell",
		"am",
		"instrument",
		"--user",
		user,
		"-w",
		"-r",
		"-e",
		"class",
		testClass + "#" + selected.method,
		...extras("record"),
		packageName + ".test/" + RUNNER,
	).then(
		(output) => ({ output }),
		(error) => ({ output: String(error.stdout ?? ""), error }),
	);
	void recording.then(() => {
		settled = true;
	});
	const pids = async () => {
		try {
			return (await run("shell", "pidof", packageName))
				.trim()
				.split(/\s+/)
				.filter(Boolean)
				.map(Number);
		} catch (error) {
			// pidof exits 1 with no output when nothing matches.
			if (error.code === 1 && !String(error.stdout ?? "").trim()) return [];
			throw error;
		}
	};
	const until = async (check, message) => {
		const deadline = performance.now() + timeoutMs;
		for (;;) {
			const value = await check();
			if (value) return value;
			assert.ok(performance.now() < deadline, message);
			await delay(pollMs);
		}
	};
	try {
		const recorded = await until(async () => {
			assert.ok(!settled, "Recording phase ended before the permission was revoked");
			try {
				// `exec-out run-as … cat` exits 0 and prints cat's own error when the marker is not
				// written yet, so that text is "not yet", not a marker to parse.
				const text = await run(
					"exec-out",
					"run-as",
					packageName,
					"--user",
					user,
					"cat",
					marker,
				);
				if (/No such file or directory/.test(text)) return null;
				return JSON.parse(text);
			} catch (error) {
				// Only a not-yet-written marker is retryable.
				if (
					error.code === 1 &&
					/No such file or directory/.test(
						String(error.stderr ?? "") + String(error.stdout ?? ""),
					)
				)
					return null;
				throw error;
			}
		}, "Recording phase never published its marker");
		assert.equal(recorded.runId, runId, "Stale recording marker");
		assert.ok(
			Number.isSafeInteger(recorded.pid) && recorded.pid > 1,
			"Recording marker has no process",
		);
		assert.ok(
			Number.isSafeInteger(recorded.bytes) && recorded.bytes > 0,
			"Recording marker shows an empty capture file",
		);
		assert.ok(
			(await pids()).includes(recorded.pid),
			"The recording process is not running",
		);
		// A phase that already ended was not recording when the permission changed.
		assert.ok(!settled, "Recording phase ended before the permission was revoked");
		await run("shell", "pm", "revoke", "--user", user, packageName, name);
		await until(
			async () => !(await pids()).includes(recorded.pid),
			"Revoking " + permission + " did not end the recording process",
		);
		const { output, error } = await recording;
		fs.writeFileSync(
			path.join(directory, variant + "-phase-record.log"),
			output + (error ? "\n" + String(error.stderr ?? "") : ""),
		);
		const { requireInstrumentationInterruption } = await import(
			"../vendor/eliza/packages/app/scripts/lib/instrumentation-result.mjs"
		);
		details.revocation = {
			mechanism: "pm-revoke",
			permission: name,
			recordingPid: recorded.pid,
			bytesBeforeRevoke: recorded.bytes,
			instrumentation: requireInstrumentationInterruption(
				output,
				testClass,
				selected.method,
			),
		};
	} finally {
		// Never overlap a still-running instrumentation with the next phase or cleanup.
		await recording;
	}
	await run(
		"shell",
		"pm",
		"clear-permission-flags",
		"--user",
		user,
		packageName,
		name,
		"user-set",
		"user-fixed",
	);
	await context.instrumentPhase("verify", extras("verify"));
	await run("shell", "pm", "grant", "--user", user, packageName, name);
	await context.instrumentPhase("regrant", extras("regrant"));
}

async function main() {
	const [scenario, appApk, testApk, output = "test-results/native-permission"] =
		process.argv.slice(2);
	assert.ok(
		Object.hasOwn(cases, scenario),
		"Choose " + Object.keys(cases).join(", "),
	);
	const selected = cases[scenario],
		runId = crypto.randomUUID().replaceAll("-", ""),
		details = {};
	const { runNativeFixture } = await import("./native-test-fixture.mjs");
	await runNativeFixture({
		scenario,
		appApk,
		testApk,
		output,
		details,
		testClass: selected.testClass,
		testMethod: selected.method,
		runnerArgs: [
			"-e",
			selected.gate,
			selected.value,
			...(selected.revokeWhileRecording
				? ["-e", selected.revokeWhileRecording.runIdGate, runId]
				: []),
		],
		evidence:
			"Permission UI scenario in an owned secondary emulator user. No physical-device acceptance.",
		prepareVariant: async ({ run, androidUser, packageName }) => {
			for (const [operation, name] of selected.permissions) {
				const permission = "android.permission." + name;
				await run(
					"shell",
					"pm",
					operation,
					"--user",
					String(androidUser),
					packageName,
					permission,
				);
				await run(
					"shell",
					"pm",
					"clear-permission-flags",
					"--user",
					String(androidUser),
					packageName,
					permission,
					"user-set",
					"user-fixed",
				);
			}
		},
		...(selected.revokeWhileRecording
			? {
					collectVariant: (context) =>
						revokeWhileRecording(context, selected, { runId, details }),
				}
			: {}),
	});
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
	await main();
