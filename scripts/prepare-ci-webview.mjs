// Product configuration for the shared disposable hosted WebView fixture.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { androidEnv } from "./toolchain.mjs";
import { requireHostedFixtureEnvironment } from "../vendor/eliza/packages/app/scripts/mobile/android/hosted-fixture/ci-emulator-display.mjs";
import { createHostedWebViewProvisioner } from "../vendor/eliza/packages/app/scripts/mobile/android/hosted-fixture/webview-provider.mjs";
export { candidate } from "../vendor/eliza/packages/app/scripts/mobile/android/hosted-fixture/webview-provider.mjs";

const provisioner = createHostedWebViewProvisioner({
	forbiddenPackagePrefixes: ["ai.elizaresearch.alphaphone", "ai.alphacompute."],
});
export async function main(options = {}) {
	const environment = options.environment ?? process.env;
	requireHostedFixtureEnvironment(environment, environment.ANDROID_SERIAL);
	const fixtureAcknowledgement = environment.ALPHA_DISPOSABLE_WEBVIEW_FIXTURE;
	if (fixtureAcknowledgement !== "api35-default-x86_64")
		throw new Error("Explicit disposable provider fixture required");
	return provisioner.main({
		...options,
		environment,
		fixtureAcknowledgement,
		sdkEnvironment: options.sdkEnvironment ?? androidEnv(),
		outputDirectory:
			options.outputDirectory ??
			path.resolve("test-results/ci-webview-provider"),
	});
}
if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
	await main();
