// Product configuration for the shared disposable hosted WebView fixture.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { androidEnv } from "./toolchain.ts";
import { requireHostedFixtureEnvironment } from "../vendor/eliza/packages/app/scripts/mobile/android/hosted-fixture/ci-emulator-display.mjs";
import { createHostedWebViewProvisioner } from "../vendor/eliza/packages/app/scripts/mobile/android/hosted-fixture/webview-provider.mjs";
export { candidate } from "../vendor/eliza/packages/app/scripts/mobile/android/hosted-fixture/webview-provider.mjs";

const provisioner = createHostedWebViewProvisioner({
	forbiddenPackagePrefixes: ["ai.alphacompute.", "ai.elizaresearch."],
});
type FixtureOptions = NonNullable<Parameters<typeof provisioner.main>[0]> & {
	environment?: NodeJS.ProcessEnv;
	sdkEnvironment?: NodeJS.ProcessEnv & { ANDROID_HOME: string };
	outputDirectory?: string;
};
type ProvisionOptions = FixtureOptions & { fixtureAcknowledgement: string };
const provision = provisioner.main as (options: ProvisionOptions) => ReturnType<typeof provisioner.main>;

export async function main(options: FixtureOptions = {}) {
	const environment = options.environment ?? process.env;
	requireHostedFixtureEnvironment(environment, environment.ANDROID_SERIAL);
	const fixtureAcknowledgement = environment.ALPHA_DISPOSABLE_WEBVIEW_FIXTURE;
	if (fixtureAcknowledgement !== "api35-default-x86_64")
		throw new Error("Explicit disposable provider fixture required");
	return provision({
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
