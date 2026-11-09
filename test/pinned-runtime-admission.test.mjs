import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { CORE_STATE_MANIFEST } from "../scripts/core-state-patch.mjs";
import { writeCoreStateFixture } from "./fixtures/core-state-root.mjs";

function fixture(t) {
	const priorFlag=process.env.ELIZA_DEV_ALLOW_TEST_MOCKS;
	process.env.ELIZA_DEV_ALLOW_TEST_MOCKS="1";
	t.after(()=>{if(priorFlag===undefined)delete process.env.ELIZA_DEV_ALLOW_TEST_MOCKS;else process.env.ELIZA_DEV_ALLOW_TEST_MOCKS=priorFlag;});
	const root = fs.mkdtempSync(
		path.join(os.tmpdir(), "alpha-source-admission-"),
	);
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const upstream = path.join(root, "vendor/eliza");
	const write = (name, text) => {
		const file = path.join(root, name);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, text);
	};
	write("package.json", '{"type":"module"}');
	write("vendor/eliza/package.json", '{"workspaces":["packages/*"]}');
	write("vendor/eliza/turbo.json", '{"tasks":{}}');
	write("vendor/eliza/.gitignore", "hidden/\n");
	write(
		"vendor/eliza/packages/example/package.json",
		'{"name":"@elizaos/example"}',
	);
	write("vendor/eliza/packages/example/src.ts", "export const value = 1;\n");
	fs.mkdirSync(path.join(upstream, "plugins"));
	for (const file of [
		"backend/loader.ts",
		"scripts/verify-upstream.mjs",
		"scripts/pinned-upstream-source.mjs",
		...[
			"immutable-workspace-source.mjs",
			"committed-source.mjs",
			"consumer-source-resolver.mjs",
		].map((name) => "vendor/eliza/packages/app/scripts/lib/" + name),
	])
		write(file, fs.readFileSync(file, "utf8"));
	const git = (...args) =>
		execFileSync("git", args, {
			cwd: upstream,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
	writeCoreStateFixture(root, upstream, "0".repeat(40), true);
	git("init");
	git("add", ".");
	git(
		"-c",
		"user.name=Fixture",
		"-c",
		"user.email=fixture@example.invalid",
		"commit",
		"-m",
		"Fixture source",
	);
	const commit = git("rev-parse", "HEAD");
	write("upstream.lock.json", JSON.stringify({ commit }));
	const patchManifest = JSON.parse(fs.readFileSync(path.join(root, CORE_STATE_MANIFEST), "utf8"));
	write(CORE_STATE_MANIFEST, JSON.stringify({ ...patchManifest, baseCommit: commit }));
	return { root, upstream, write, git };
}

for (const mutation of [
	"tracked edit",
	"skip-worktree edit",
	"ignored addition",
	"wrong commit",
])
	test(`both consumers reject ${mutation} before building or creating private state`, async (t) => {
		const f = fixture(t);
		if (mutation === "skip-worktree edit")
			f.git("update-index", "--skip-worktree", "packages/example/src.ts");
		if (mutation.endsWith("edit"))
			f.write(
				"vendor/eliza/packages/example/src.ts",
				"export const value = 2;\n",
			);
		if (mutation === "ignored addition")
			f.write("vendor/eliza/hidden/injected.ts", "export const extra = true;");
		if (mutation === "wrong commit")
			f.write("upstream.lock.json", JSON.stringify({ commit: "0".repeat(40) }));
		const { loadPinnedRuntime } = await import(
			pathToFileURL(path.join(f.root, "backend/loader.ts"))
		);
		await assert.rejects(
			loadPinnedRuntime(),
			/Unexpected runtime source change|Unexpected untracked runtime source|Prepared runtime base commit changed/,
		);
		const gate = spawnSync(process.execPath, ["scripts/verify-upstream.mjs"], {
			cwd: f.root,
			encoding: "utf8",
		});
		assert.notEqual(gate.status, 0);
		assert.match(
			gate.stderr,
			/Unexpected runtime source change|Unexpected untracked runtime source|Prepared runtime base commit changed/,
		);
		assert.equal(fs.existsSync(path.join(f.root, "backend/.generated")), false);
		assert.equal(fs.existsSync(path.join(f.root, "backend/state")), false);
	});

test("clean pinned source is admitted and loader reauthenticates on each build", async (t) => {
	const f = fixture(t);
	for (const name of [
		"system",
		"camera",
		"location",
		"network-policy",
		"calendar",
		"reminders",
	])
		f.write(
			`vendor/eliza/plugins/plugin-native-${name}/android/build/generated/output.bin`,
			"generated output",
		);
	const gate = spawnSync(process.execPath, ["scripts/verify-upstream.mjs"], {
		cwd: f.root,
		encoding: "utf8",
	});
	assert.equal(gate.status, 0, gate.stderr);
	let builds = 0;
	const original = Object.getOwnPropertyDescriptor(globalThis, "Bun");
	Object.defineProperty(globalThis, "Bun", {
		configurable: true,
		value: {
			build: async ({ plugins, metafile }) => {
				assert.equal(plugins[0].name, "authenticated-core-state");
				assert.equal(metafile, true);
				builds++;
				throw new Error("Reached build boundary");
			},
		},
	});
	t.after(() => {
		if (original) Object.defineProperty(globalThis, "Bun", original);
		else delete globalThis.Bun;
	});
	const { loadPinnedRuntime } = await import(
		pathToFileURL(path.join(f.root, "backend/loader.ts"))
	);
	await assert.rejects(loadPinnedRuntime(), /Reached build boundary/);
	assert.equal(builds, 1);
	f.git("update-index", "--skip-worktree", "packages/example/src.ts");
	f.write("vendor/eliza/packages/example/src.ts", "export const value = 2;\n");
	await assert.rejects(loadPinnedRuntime(), /Unexpected runtime source change/);
	assert.equal(builds, 1);
});

test("only the pinned voice builder's untracked tree is admitted under .cache", async (t) => {
	const f = fixture(t);
	f.write("vendor/eliza/.cache/elizavoice-android/tracked.txt", "pinned\n");
	f.git("add", "-f", ".cache/elizavoice-android/tracked.txt");
	f.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "Tracked cache file");
	f.write("upstream.lock.json", JSON.stringify({ commit: f.git("rev-parse", "HEAD") }));
	const { verifyPinnedUpstream } = await import(
		pathToFileURL(path.join(f.root, "scripts/pinned-upstream-source.mjs"))
	);
	f.write("vendor/eliza/.cache/elizavoice-android/espeak-ng/build/out.o", "object");
	verifyPinnedUpstream(f.root);
	f.write("vendor/eliza/.cache/elizavoice-android-extra/out.o", "object");
	assert.throws(() => verifyPinnedUpstream(f.root), /Unexpected untracked runtime source/);
	fs.rmSync(path.join(f.upstream, ".cache/elizavoice-android-extra"), { recursive: true });
	f.write("vendor/eliza/.cache/other/out.o", "object");
	assert.throws(() => verifyPinnedUpstream(f.root), /Unexpected untracked runtime source/);
	fs.rmSync(path.join(f.upstream, ".cache/other"), { recursive: true });
	verifyPinnedUpstream(f.root);
	f.write("vendor/eliza/.cache/elizavoice-android/tracked.txt", "changed\n");
	assert.throws(() => verifyPinnedUpstream(f.root), /Unexpected runtime source change/);
});
