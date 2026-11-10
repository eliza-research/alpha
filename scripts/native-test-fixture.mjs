/** AlphaPhone archive and SDK policy; upstream owns device/user/test lifecycles. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { androidEnv } from "./toolchain.mjs";
import { verifyPinnedUpstream } from "./pinned-upstream-source.mjs";

export async function runNativeFixture({
	scenario,
	appApk,
	testApk,
	output,
	details = {},
	...testOptions
}) {
	verifyPinnedUpstream(path.resolve(import.meta.dirname, ".."));
	const { runIsolatedAndroidUserTest } = await import(
		"../vendor/eliza/packages/app/scripts/lib/isolated-android-user-test.mjs"
	);
	const serial = process.env.ANDROID_SERIAL,
		avd = process.env.ALPHA_NATIVE_TEST_AVD,
		abi = process.env.ALPHA_NATIVE_TEST_ABI;
	assert.match(serial ?? "", /^emulator-\d+$/);
	assert.match(
		avd ?? "",
		/^[A-Za-z0-9_.-]+$/,
		"Explicit owned AVD name required",
	);
	assert.ok(
		["x86_64", "arm64-v8a"].includes(abi),
		"Explicit emulator ABI required",
	);
	assert.ok(appApk && testApk, "Matching archived app/test APK pair required");
	const app = JSON.parse(fs.readFileSync("app.config.json")).appId;
	assert.equal(app, "ai.elizaresearch.alphaphone");
	const apk = path.resolve(appApk),
		test = path.resolve(testApk),
		directory = path.resolve(output);
	const hash = (file) =>
		createHash("sha256").update(fs.readFileSync(file)).digest("hex");
	const manifest = JSON.parse(
		fs.readFileSync(path.join(path.dirname(apk), "apk-manifest.json")),
	);
	const variant = path
		.basename(apk)
		.match(/^(standalone|launcher)-debug\.apk$/)?.[1];
	assert.ok(
		variant &&
			path.basename(test) === variant + "-androidTest.apk" &&
			path.dirname(apk) === path.dirname(test) &&
			manifest[path.basename(apk)] === hash(apk) &&
			manifest[path.basename(test)] === hash(test),
		"Exact matching archived distribution required",
	);
	assert.ok(!fs.existsSync(directory), "Use a new evidence directory");
	const appSha256 = manifest[path.basename(apk)],
		testSha256 = manifest[path.basename(test)];
	const env = androidEnv(),
		cancellation = new AbortController(),
		cancel = () => cancellation.abort();
	process.once("SIGINT", cancel);
	process.once("SIGTERM", cancel);
	let report, failure;
	try {
		report = await runIsolatedAndroidUserTest({
			expectedTests: 1,
			requireWebView: true,
			instrumentationTimeoutMs: 240000,
			...testOptions,
			serial,
			env,
			adb: path.join(env.ANDROID_HOME, "platform-tools/adb"),
			aapt: path.join(env.ANDROID_HOME, "build-tools/36.0.0/aapt"),
			packageName: app,
			additionalInstrumentationRunners: [app + ".WorkflowNoticeProcessRunner"],
			testClass: app + "." + testOptions.testClass,
			requiredAbi: abi,
			expectedAvdName: avd,
			directory,
			homePackage:
				process.env.ALPHA_TEST_HOME_PACKAGE ?? "com.android.launcher3",
			userName: `${scenario}-${variant}-${Date.now()}`,
			signal: cancellation.signal,
			commandTimeoutMs: 120000,
			cleanupTimeoutMs: 120000,
			variants: [{ name: variant, apk, testApk: test }],
			preflightVariant: async (context) => {
				assert.equal(
					context.record.appSha256,
					appSha256,
					"App changed after archive admission",
				);
				assert.equal(
					context.record.testSha256,
					testSha256,
					"Test APK changed after archive admission",
				);
				await testOptions.preflightVariant?.(context);
			},
		});
	} catch (error) {
		failure = error;
		if (error.code !== "EEXIST")
			try {
				report = JSON.parse(
					fs.readFileSync(
						path.join(directory, "user-verification.json"),
						"utf8",
					),
				);
			} catch {
				/* No lifecycle report was admitted. */
			}
	} finally {
		process.removeListener("SIGINT", cancel);
		process.removeListener("SIGTERM", cancel);
		if (report)
			fs.writeFileSync(
				path.join(directory, "result.json"),
				JSON.stringify(
					{
						...details,
						...report,
						avd,
						abi,
						variant,
						scenario,
						appSha256,
						testSha256,
						passed: !failure,
					},
					null,
					2,
				) + "\n",
			);
	}
	if (failure) throw failure;
	console.log(directory);
	return report;
}
