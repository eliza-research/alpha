import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createConsumerSourceResolver } from "../vendor/eliza/packages/app/scripts/lib/consumer-source-resolver.mjs";
import { verifyPinnedUpstream } from "../scripts/pinned-upstream-source.mjs";
import { randomBytes } from "node:crypto";
export async function loadPinnedRuntime() {
	if (process.env.ELIZA_DEV_ALLOW_TEST_MOCKS !== "1") throw new Error("Development runtime is disabled");
	// Authenticate on every build, before resolution, generated output or private state.
	const { directory: root, commit: head } = verifyPinnedUpstream(
		resolve(import.meta.dirname, ".."),
	);
	const { plugin: sourceResolver, resolvedSources } =
		createConsumerSourceResolver({
			sourceRoot: root,
			consumerRoots: [import.meta.dirname],
		});
	const built = await Bun.build({
		entrypoints: [resolve(import.meta.dirname, "runtime.ts")],
		outdir: resolve(import.meta.dirname, ".generated"),
		target: "bun",
		plugins: [sourceResolver],
	});
	if (!built.success) {
		for (const log of built.logs) console.error(log);
		throw new Error("Pinned runtime build failed");
	}
	writeFileSync(
		resolve(import.meta.dirname, ".generated/source-map.json"),
		JSON.stringify(
			{
				commit: head,
				modules: Object.fromEntries([...resolvedSources].sort()),
			},
			null,
			2,
		),
	);
	const state =
		process.env.ALPHA_ELIZA_DATA_DIR || resolve(import.meta.dirname, "state");
	mkdirSync(state, { recursive: true, mode: 0o700 });
	const saltFile = join(state, "secret-salt");
	if (!existsSync(saltFile))
		writeFileSync(saltFile, randomBytes(32).toString("hex"), {
			mode: 0o600,
			flag: "wx",
		});
	process.env.SECRET_SALT = readFileSync(saltFile, "utf8");
	return {
		module: await import("./.generated/runtime.js"),
		head,
		dataDir: state,
	};
}
