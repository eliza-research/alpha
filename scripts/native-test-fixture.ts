/** AlphaPhone archive and SDK policy; upstream owns device/user/test lifecycles. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { androidEnv } from "./toolchain.ts";
import { verifyPinnedUpstream } from "./pinned-upstream-source.ts";
import { isAndroidAbi } from "./android-abis.ts";

type Instrumentation = typeof import("../vendor/eliza/packages/app/scripts/lib/instrumentation-result.mjs");
type DeviceLease = typeof import("../vendor/eliza/packages/app/scripts/lib/device-lease.ts");
type Phase = (name: string, args?: string[]) => Promise<ReturnType<Instrumentation["requireInstrumentationSuccess"]>>;
export type IsolatedUserState = {
	user: number | null;
	ownerRestored: boolean;
	cleanupDeferred: boolean;
	removed: boolean;
};
export type NativeFixtureContext = {
	variant: string;
	packageName: string;
	adb: string;
	env: NodeJS.ProcessEnv;
	serial: string;
	directory: string;
	androidUser: number;
	signal?: AbortSignal;
	run: (...args: string[]) => Promise<string>;
	deviceLease: Awaited<ReturnType<DeviceLease["acquireDeviceLease"]>>;
	record: { appSha256: string; testSha256: string };
	instrumentPhase?: Phase;
};
type ApkPair = { apk: string; testApk: string; additionalInstrumentationRunners?: string[] };
type PinnedPair = { appSha256: string; testSha256: string };
// This subset matches the options the pinned JavaScript runner accepts for leased user campaigns.
export type IsolatedAndroidTest = (options: Pick<NativeFixtureContext,
	"serial" | "adb" | "env" | "packageName" | "androidUser" | "deviceLease" | "directory" | "signal"
> & {
	aapt: string;
	testClass: string;
	testMethod?: string;
	runner?: string;
	additionalInstrumentationRunners?: string[];
	expectedTests?: number;
	requiredAbi: string;
	expectedAvdName: string;
	commandTimeoutMs: number;
	instrumentationTimeoutMs: number;
	cleanupTimeoutMs: number;
	evidence: string;
	variants: (ApkPair & { name: string; upgrade?: ApkPair })[];
	companionApks?: { packageName: string; apk: string; sha256: string }[];
	runnerArgs: string[];
	upgradeRunnerArgs?: string[];
	preflightVariant?: (context: { record: PinnedPair & { upgrade?: PinnedPair } }) => void;
	prepareVariant?: () => void | Promise<void>;
	beforeUpgrade?: () => void;
	afterUpgrade?: () => void;
	collectVariant?: () => void;
}) => Promise<unknown>;
type ActiveContext = NativeFixtureContext & { instrumentPhase: Phase };
type FixtureOptions = {
	scenario: string;
	appApk: string;
	testApk: string;
	output: string;
	details?: Record<string, unknown>;
	testClass: string;
	testMethod?: string;
	expectedTests?: number;
	runnerArgs?: string[];
	requireWebView?: boolean;
	instrumentationTimeoutMs?: number;
	evidence?: string;
	preflightVariant?: (context: NativeFixtureContext) => Promise<void>;
	prepareVariant?: (context: ActiveContext) => Promise<void>;
	collectVariant?: (context: ActiveContext) => Promise<void>;
	cleanupVariant?: (context: NativeFixtureContext) => Promise<void>;
};

export function fixtureCommandError(error: unknown) {
	return error !== null && typeof error === "object"
		? error as { code?: unknown; stdout?: unknown; stderr?: unknown }
		: {};
}

export async function runNativeFixture({
	scenario,
	appApk,
	testApk,
	output,
	details = {},
	...testOptions
}: FixtureOptions) {
	verifyPinnedUpstream(path.resolve(import.meta.dirname, ".."));
	const { runIsolatedAndroidUserTest } = await import(
		"../vendor/eliza/packages/app/scripts/lib/isolated-android-user-test.mjs"
	);
	const serial = process.env.ANDROID_SERIAL,
		avd = process.env.ALPHA_NATIVE_TEST_AVD,
		abi = process.env.ALPHA_NATIVE_TEST_ABI;
	assert.ok(serial && /^emulator-\d+$/.test(serial), "Explicit emulator serial required");
	assert.match(
		avd ?? "",
		/^[A-Za-z0-9_.-]+$/,
		"Explicit owned AVD name required",
	);
	assert.ok(
		isAndroidAbi(abi),
		"Explicit emulator ABI required",
	);
	assert.ok(appApk && testApk, "Matching archived app/test APK pair required");
	const app = JSON.parse(fs.readFileSync("app.config.json", "utf8")).appId;
	assert.equal(app, "ai.alphacompute.alphaphone");
	const apk = path.resolve(appApk),
		test = path.resolve(testApk),
		directory = path.resolve(output);
	const hash = (file: string) =>
		createHash("sha256").update(fs.readFileSync(file)).digest("hex");
	const manifest: Record<string, string> = JSON.parse(
		fs.readFileSync(path.join(path.dirname(apk), "apk-manifest.json"), "utf8"),
	);
	const variant = path
		.basename(apk)
		.match(/^(launcher)-debug\.apk$/)?.[1];
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
	let report: Awaited<ReturnType<typeof runIsolatedAndroidUserTest>> | undefined;
	let failure: unknown;
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
			preflightVariant: async (context: NativeFixtureContext) => {
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
		if (fixtureCommandError(error).code !== "EEXIST")
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
