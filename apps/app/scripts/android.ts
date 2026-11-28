#!/usr/bin/env node
// spec/app/image/index.md, "Story: Stage Alpha into an image"; spec/agent/index.md, "Story: Build the pack only from the pinned eliza"; spec/agent/index.md, "The launch names the pack's pinned workflow worker, and the agent refuses any other with its configuration code"
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { generateAndroidHost, stageRuntimePayload } from "@elizaos/os";
import { packPrepared, prepared } from "@repo/eliza-harness";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { androidPaths, identity, production, signInCallbackPath, updateManifestUrl } from "../capacitor.config.ts";
import { releaseBlockedByLicences } from "../gen/app__image__licences.ts";
import { inventory as licenceInventory } from "./licences.ts";
import { localOcrAssets } from "./ocr-assets.ts";

export const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(app, "../..");
const android = join(app, androidPaths.project);
const artifacts = join(app, "artifacts");
const agentPack = join(root, "apps/agent");
const variant = "launcher";
const abis = ["arm64-v8a", "x86_64"] as const;
const voiceAssets = "assets/paradee-voice/v1/";
const nodeLicence = "assets/agent/notices/node/LICENSE";
const nodeLicenceBySource = new Map([
  ["a7f6204ff63b6a2cd274d48903285abb86ed53a99070e532d4c2fd787457d9e6", "8e603aa87c70d36e497004f0dec63111511cb61b7d65ace12e10ea791599286c"],
]);
const mockSwitches = ["ELIZA_DEV_ALLOW_TEST_MOCKS", "VITE_ELIZA_DEV_ALLOW_TEST_MOCKS", "ALPHA_FAKES"];
const signingNames = ["ELIZAOS_KEYSTORE_PATH", "ELIZAOS_KEYSTORE_PASSWORD", "ELIZAOS_KEY_ALIAS", "ELIZAOS_KEY_PASSWORD"];
const usage = "Usage: node scripts/android.ts <pin|inputs|pack|stage|web|host|build [--release]|verify [--debug-only|--release-only]|audit DIR>";
const JAVA_HOME_CANDIDATES = [
  "/opt/homebrew/opt/openjdk@21",
  "/usr/local/opt/openjdk@21",
  "/usr/lib/jvm/temurin-21-jdk-amd64",
  "/usr/lib/jvm/java-21-openjdk-amd64",
  "/usr/lib/jvm/java-21-openjdk",
];
const RELEASE_SIGNER_FILE = join(app, "aosp/signing/release-signer.json");
const SIGN_IN_OWNED_PREFIXES = ["/api/public/", "/api/v1/api-keys/"];
const UNSAFE_ZIP_ENTRY = /[*?[\]\\]|\0/;
const publishedDelibes = {
  filename: "delibes-8m-eses.gguf",
  apk: "https://github.com/AlphaPhone/alpha/releases/download/app-stable-alphacompute/alpha-phone-114.apk",
  apkBytes: 576_256_512,
  offset: 485_778_460,
  bytes: 31_275_328,
  sha256: "3b635dc24a8952254066daad77ff64aa08368a8b5a689abf4be05bdf2b0afe51",
};

const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const readJson = (file: string): unknown => JSON.parse(readFileSync(file, "utf8"));
const record = (value: unknown): Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
const writeJson = (file: string, value: unknown) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function defaultJavaHome(): string {
  for (const candidate of JAVA_HOME_CANDIDATES) {
    if (existsSync(join(candidate, "bin/java"))) return candidate;
  }
  return JAVA_HOME_CANDIDATES[JAVA_HOME_CANDIDATES.length - 1] ?? "/usr/lib/jvm/java-21-openjdk";
}

function unexpectedDirtyLines(cwd: string, ignoredUntracked: RegExp): string[] {
  const status = git(cwd, "status", "--porcelain");
  if (status === "") return [];
  return status.split(/\r?\n/).filter((line) => line !== "" && !ignoredUntracked.test(line));
}

function releaseSignerMeta(): { readonly signerSha256: string; readonly versionCode: number } {
  const data = record(readJson(RELEASE_SIGNER_FILE));
  const signerSha256 = typeof data.signerSha256 === "string" ? data.signerSha256 : "";
  const versionCode = typeof data.versionCode === "number" && Number.isSafeInteger(data.versionCode) && data.versionCode > 0 ? data.versionCode : 121;
  return { signerSha256, versionCode };
}

/** The environment every build step runs in: never the test mocks, Java and the Android SDK found. */
export function environment(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const name of mockSwitches) delete env[name];
  env.ANDROID_HOME = base.ANDROID_HOME ?? base.ANDROID_SDK_ROOT ?? join(process.env.HOME ?? "", "Android/Sdk");
  env.JAVA_HOME = base.JAVA_HOME ?? defaultJavaHome();
  env.ANDROID_USER_HOME = join(android, ".android-user");
  return env;
}

function run(command: string, args: readonly string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  const result = spawnSync(command, [...args], { cwd: options.cwd ?? app, env: options.env ?? environment(), stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} exited with ${result.status ?? result.signal}`);
}

const platform = Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer);
type PlatformServices = Layer.Success<typeof platform>;
const runEffect = <A, E>(program: Effect.Effect<A, E, PlatformServices>): Promise<A> =>
  Effect.runPromise(Effect.provide(program, platform));

interface Problem { readonly input: string; readonly problem: string; readonly fix: string }

/** eliza.lock.json pins a commit of eliza's develop line, built and linked as `.eliza`, with no edit in its source. */
export function pinProblems(): Problem[] {
  const lock = record(readJson(join(root, "eliza.lock.json")));
  const commit = typeof lock.commit === "string" ? lock.commit : "";
  const problems: Problem[] = [];
  if (lock.branch !== "develop") problems.push({ input: "eliza.lock.json", problem: `branch is ${String(lock.branch)}, not develop`, fix: "Pin a reviewed commit of eliza develop" });
  let checkout: string;
  try {
    checkout = prepared().root;
  } catch (refused) {
    return [...problems, { input: ".eliza", problem: refused instanceof Error ? refused.message : String(refused), fix: "pnpm eliza" }];
  }
  const head = git(checkout, "rev-parse", "HEAD");
  if (head !== commit) problems.push({ input: ".eliza", problem: `the checkout is at ${head}, the lock pins ${commit}`, fix: "pnpm eliza" });
  if (unexpectedDirtyLines(checkout, /^\?\? (?:\.alpha\/|.*\/\.cxx\/)/).length > 0) {
    problems.push({ input: ".eliza", problem: "the pinned checkout has edits or untracked files", fix: "Never edit the pinned checkout; land the change upstream and repin" });
  }
  try {
    git(checkout, "merge-base", "--is-ancestor", commit, "refs/remotes/origin/develop");
  } catch {
    problems.push({ input: "eliza.lock.json", problem: `${commit} is not on eliza's origin/develop in ${checkout}`, fix: `git -C ${checkout} fetch origin develop, then pin a commit it holds` });
  }
  return problems;
}

/** Everything the APK build needs before Gradle runs, with the command that supplies what is missing. */
export function inputProblems(env: NodeJS.ProcessEnv = environment()): Problem[] {
  const problems = pinProblems();
  const sdk = env.ANDROID_HOME ?? "";
  if (!existsSync(join(env.JAVA_HOME ?? "", "bin/java"))) problems.push({ input: "JDK 21", problem: `no java under JAVA_HOME ${env.JAVA_HOME}`, fix: "Set JAVA_HOME to a JDK 21" });
  for (const tool of ["build-tools/36.0.0/apksigner", "build-tools/36.0.0/aapt", "build-tools/36.0.0/zipalign", "platforms/android-36/android.jar"])
    if (!existsSync(join(sdk, tool))) problems.push({ input: "Android SDK", problem: `${tool} is missing under ${sdk}`, fix: "sdkmanager 'build-tools;36.0.0' 'platforms;android-36'" });
  if (!existsSync(join(sdk, "ndk/28.2.13676358/source.properties")) || !existsSync(join(sdk, "cmake/3.22.1/bin/cmake")))
    problems.push({ input: "Local speech toolchain", problem: "the pinned NDK or CMake is missing", fix: "sdkmanager 'ndk;28.2.13676358' 'cmake;3.22.1'" });
  if (env.ELIZA_INFERENCE_ENGINE_DIR && !existsSync(join(env.ELIZA_INFERENCE_ENGINE_DIR, "tools/omnivoice/CMakeLists.txt")))
    problems.push({ input: "Local speech engine", problem: "the supplied engine checkout does not exist", fix: "Unset ELIZA_INFERENCE_ENGINE_DIR or point it at the engine in .eliza/packages/os/android/local-inference/engine.lock.json" });
  const set = signingNames.filter((name) => (env[name] ?? "").trim() !== "");
  if (set.length > 0 && set.length < signingNames.length) problems.push({ input: "release signing", problem: `only ${set.join(", ")} are set`, fix: `Set all of ${signingNames.join(", ")} or none` });
  return problems;
}

function refuseOn(problems: readonly Problem[]) {
  if (problems.length === 0) return;
  for (const { input, problem, fix } of problems) process.stderr.write(`MISSING ${input}: ${problem}. Run: ${fix}\n`);
  process.exitCode = 2;
  throw new Error(`${problems.length} Android build input(s) missing`);
}

function voiceDirectory() {
  return join(android, ".cache", "voice", prepared().commit);
}

function voiceRecord(directory: string) {
  const at = prepared();
  const module = join(at.root, "packages/os/android/local-inference");
  const expectedEngine = record(record(readJson(join(module, "engine.lock.json"))).engine).commit;
  const receipt = record(readJson(join(directory, "build-record.json")));
  if (receipt.sourceCommit !== at.commit || receipt.nativeCommit !== expectedEngine || !Array.isArray(receipt.files)) {
    throw new Error("The local speech build receipt differs from the pinned Eliza source and engine");
  }
  return receipt.files.map(record);
}

/** Seed Eliza's cache with the verified, uncompressed Delibes model member in Alpha v114. */
async function verifiedDelibesCache(module: string): Promise<string | undefined> {
  const pin = record(record(readJson(join(module, "inputs.json"))).spanish);
  const model = publishedDelibes;
  if (pin.enabled !== true || pin.path !== `tts/paradee/${model.filename}` || pin.bytes !== model.bytes || pin.sha256 !== model.sha256) return undefined;

  const cache = join(android, ".cache", "voice-models", model.sha256);
  const target = join(cache, model.filename);
  const cached = lstatSync(target, { throwIfNoEntry: false });
  if (cached?.isFile() && cached.size === model.bytes && sha256(readFileSync(target)) === model.sha256) return cache;

  const range = `${model.offset}-${model.offset + model.bytes - 1}`;
  const response = await fetch(model.apk, {
    headers: { Range: `bytes=${range}`, "Accept-Encoding": "identity" },
    signal: AbortSignal.timeout(90_000),
  });
  const body = response.body;
  if (response.status !== 206 || response.headers.get("content-range") !== `bytes ${range}/${model.apkBytes}` || body === null) {
    await body?.cancel();
    throw new Error("Alpha v114 did not return the exact Delibes model byte range");
  }
  const bytes = new Uint8Array(model.bytes);
  let downloaded = 0;
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > bytes.byteLength - downloaded) throw new Error("The Delibes model exceeded its pinned size");
      bytes.set(value, downloaded);
      downloaded += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (downloaded !== model.bytes || sha256(bytes) !== model.sha256) throw new Error("The Delibes model does not match its pinned size and SHA-256");

  mkdirSync(cache, { recursive: true });
  const temporary = mkdtempSync(join(cache, ".partial-"));
  try {
    const pending = join(temporary, "model");
    writeFileSync(pending, bytes);
    renameSync(pending, target);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
  return cache;
}

async function stageVoice(env: NodeJS.ProcessEnv) {
  const at = prepared();
  const module = join(at.root, "packages/os/android/local-inference");
  const engineLock = record(record(readJson(join(module, "engine.lock.json"))).engine);
  const expectedEngine = String(engineLock.commit);
  const engine = resolve(env.ELIZA_INFERENCE_ENGINE_DIR ?? join(android, ".cache", "voice-engine", expectedEngine));
  if (!env.ELIZA_INFERENCE_ENGINE_DIR && !existsSync(join(engine, "tools/omnivoice/CMakeLists.txt"))) {
    mkdirSync(engine, { recursive: true });
    run("git", ["init", "--quiet", engine], { env });
    run("git", ["fetch", "--no-tags", "--depth=1", String(engineLock.repository), expectedEngine], { cwd: engine, env });
    run("git", ["checkout", "--detach", expectedEngine], { cwd: engine, env });
  }
  if (git(engine, "rev-parse", "HEAD") !== expectedEngine || unexpectedDirtyLines(engine, /^\?\? (?:build\/|.*\.cxx\/)/).length > 0) {
    throw new Error("Local speech needs the clean engine revision recorded in Eliza's engine.lock.json");
  }
  const directory = voiceDirectory();
  if (!existsSync(join(directory, "build-record.json"))) {
    const modelCache = await verifiedDelibesCache(module);
    run(process.execPath, [
      join(module, "scripts/build-native.ts"), "--workspace", join(android, ".cache", "voice-work", expectedEngine), "--out", directory,
      ...(modelCache === undefined ? [] : ["--model-cache", modelCache]),
    ], { env: { ...env, ELIZA_INFERENCE_ENGINE_DIR: engine } });
  }
  voiceRecord(directory);
  return { engine, directory };
}

/** Alpha's agent pack (apps/agent), built from the pinned eliza for the production cloud. */
export function buildPack() {
  run(process.execPath, [join(root, "vibestack/spec.ts"), "tasks", "@repo/agent#build"], { cwd: root });
}

const packBundle = () => join(agentPack, "dist/bundle");
const packHost = () => join(agentPack, "dist/host");

/** The exact workflow worker emitted by the pack's pinned Eliza checkout. */
function workflowWorker() {
  const name = "@elizaos/plugin-workflow";
  const plugin = packPrepared([name]).packages.get(name);
  if (plugin === undefined) throw new Error(`The reviewed agent pack has no ${name}`);
  const dir = join(plugin, "dist");
  const { executable } = record(readJson(join(dir, "workflow-worker.json")));
  if (typeof executable !== "string" || executable === "") throw new Error("The reviewed workflow worker manifest has no executable");
  return { dir, executable };
}

/** The staged runtime payload: libeliza_node.so per ABI, agent.mjs, its manifest and inventory, for the bundle the pack built. */
export async function stageRuntime(): Promise<string> {
  const bundle = packBundle();
  const entry = join(bundle, "agent.mjs");
  const manifestFile = join(bundle, "manifest.json");
  if (!existsSync(entry) || !existsSync(manifestFile)) throw new Error("The agent pack is not built: node scripts/android.ts pack");
  const worker = workflowWorker();
  const workerBytes = readFileSync(join(worker.dir, worker.executable));
  const digest = createHash("sha256")
    .update(prepared().commit)
    .update("\0")
    .update(abis.join(","))
    .update("\0")
    .update(readFileSync(entry))
    .update("\0")
    .update(readFileSync(manifestFile))
    .update("\0")
    .update(worker.executable)
    .update("\0")
    .update(workerBytes)
    .digest("hex")
    .slice(0, 16);
  const runtimes = join(android, "runtime");
  const output = join(runtimes, digest);
  if (!existsSync(join(output, "android/app/src/main/assets/agent/inventory.json"))) {
    rmSync(output, { recursive: true, force: true });
    try {
      await runEffect(stageRuntimePayload({ abi: [...abis], bundleDir: bundle, workflowWorker: worker, output }));
    } catch (cause) {
      const failure = record(cause);
      if (failure._tag !== "PayloadRefused" || typeof failure.reason !== "string") throw cause;
      const subject = typeof failure.subject === "string" && failure.subject !== "" ? ` (${failure.subject})` : "";
      throw new Error(`Android runtime payload refused: ${failure.reason}${subject}`, { cause });
    }
  }
  if (existsSync(runtimes)) for (const other of readdirSync(runtimes)) if (other !== digest) rmSync(join(runtimes, other), { recursive: true, force: true });
  const data = join(android, "agent");
  mkdirSync(data, { recursive: true });
  for (const file of ["host.json", "character.json", "policy.json"]) copyFileSync(join(packHost(), file), join(data, file));
  return output;
}

/**
 * The Android Gradle plugin's asset merge gunzips every asset named `*.gz` once and drops the extension. eliza's
 * generated host keeps the runtime payload's inventoried archives (elizaOS/eliza#40652); the page's own `*.gz`
 * assets, the OCR training data `public/ocr/eng.traineddata.gz`, are wrapped in one more gzip layer as
 * `<name>.gz` after `cap copy`, which the merge unwraps back to the exact bytes and name. `verify` audits both.
 */
export function keepGzipAssets(assets: string) {
  if (!existsSync(assets)) return;
  for (const name of readdirSync(assets, { recursive: true }).map(String)) {
    const file = join(assets, name);
    if (!name.endsWith(".gz") || name.endsWith(".gz.gz") || !lstatSync(file).isFile()) continue;
    writeFileSync(`${file}.gz`, gzipSync(readFileSync(file)));
    rmSync(file);
  }
}

/** The page, built with the test mocks off, and the record that says so. */
export function buildWeb() {
  run(process.execPath, [join(root, "vibestack/spec.ts"), "tasks", "@repo/app#build"], { cwd: root });
  writeJson(join(app, androidPaths.web, "build-flags.json"), { testMocks: false });
}

const REQUIRED_DIRECTIVES: readonly (readonly [string, readonly string[]])[] = [
  ["default-src", ["'self'"]],
  ["script-src", ["'self'", "'wasm-unsafe-eval'"]],
  ["object-src", ["'none'"]],
  ["base-uri", ["'none'"]],
];
const DEVELOPMENT_TEXT = [
  "10.0.2.2", "127.0.0.1:", "http://localhost:", "ALPHA_FAKES", "/test/fakes/", "/__control/",
  "api-staging.eliza.app", "cloud-staging.eliza.app", "staging.eliza.app", "staging.alphacompute.cc",
  "api-staging.alphaphone.dev", "cloud-staging.alphaphone.dev",
  "xoxp-alpha-team-owner-initial", "xoxp-design-guild-owner-initial", "tg-sess-initial-owner",
  "Maya Chen", "Ben Ortiz", "Harbour Cafe", "Harbour Gallery",
];
const TEST_ONLY_PATH = /(?:^|\/)(?:fixtures?(?:[.-][^/]*)?\.(?:js|mjs|css|json)|[^/]+\.meta(?:[.-][^/]*)?\.js|[^/]+\.stories(?:[.-][^/]*)?\.js|storybook-static\/|mockServiceWorker\.js$)/i;
const ENGINE_PATH = /\.(?:onnx|ort|gguf|tflite|safetensors|pte)$|onnxruntime|ort-wasm|sherpa|k2fsa/i;
const TEXT_FILE = /\.(?:html?|js|mjs|cjs|css|json|txt|svg|xml|webmanifest)$/i;

function parseCsp(policy: string): Map<string, readonly string[]> {
  const directives = new Map<string, readonly string[]>();
  for (const part of policy.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    const name = tokens[0]?.toLowerCase();
    if (name !== undefined && !directives.has(name)) directives.set(name, tokens.slice(1));
  }
  return directives;
}

function scanDirectoryEntries(directory: string): { readonly files: string[]; readonly symlinks: string[] } {
  const files: string[] = [];
  const symlinks: string[] = [];
  for (const name of readdirSync(directory, { recursive: true, encoding: "utf8" })) {
    const normalized = name.split("\\").join("/");
    const stat = lstatSync(join(directory, name));
    if (stat.isSymbolicLink()) symlinks.push(normalized);
    else if (stat.isFile()) files.push(normalized);
  }
  return { files, symlinks };
}

/** What in a built page shows a mock, fixture or developer surface: the production bundle audit. */
export function auditBundle(directory: string): string[] {
  if (!existsSync(join(directory, "index.html"))) return [`${directory} holds no index.html`];
  const findings: string[] = [];
  const flags = existsSync(join(directory, "build-flags.json")) ? record(readJson(join(directory, "build-flags.json"))) : undefined;
  if (flags?.testMocks !== false) findings.push("build-flags.json does not record testMocks:false");
  const html = readFileSync(join(directory, "index.html"), "utf8");
  const policy = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i.exec(html)?.[1]?.replaceAll("&#39;", "'");
  if (policy === undefined) findings.push("index.html carries no Content-Security-Policy");
  else {
    const parsed = parseCsp(policy);
    for (const [name, requiredTokens] of REQUIRED_DIRECTIVES) {
      const tokens = parsed.get(name);
      if (tokens === undefined || requiredTokens.some((token) => !tokens.includes(token))) {
        findings.push(`the Content-Security-Policy lacks ${name} ${requiredTokens.join(" ")}`);
      }
    }
    for (const [name, tokens] of parsed) {
      if (tokens.includes("'unsafe-eval'")) findings.push(`the Content-Security-Policy allows 'unsafe-eval' in ${name}`);
    }
    if (parsed.get("script-src")?.includes("'unsafe-inline'") === true) {
      findings.push("the Content-Security-Policy allows 'unsafe-inline' in script-src");
    }
  }
  for (const [name, expected] of localOcrAssets()) {
    const location = join(directory, "ocr", name);
    const stat = lstatSync(location, { throwIfNoEntry: false });
    if (stat === undefined || !stat.isFile() || !readFileSync(location).equals(expected.bytes)) {
      findings.push(`ocr/${name}: missing or differs from the locked OCR dependency`);
    }
  }
  const terms = join(directory, "ocr/tessdata-LICENSE.txt");
  const termsStat = lstatSync(terms, { throwIfNoEntry: false });
  if (termsStat === undefined || !termsStat.isFile() || !readFileSync(terms).equals(readFileSync(join(app, "public/ocr/tessdata-LICENSE.txt")))) {
    findings.push("ocr/tessdata-LICENSE.txt: missing or differs from the packaged training data license");
  }
  const { files, symlinks } = scanDirectoryEntries(directory);
  for (const symlink of symlinks) findings.push(`${symlink}: symbolic link in production bundle`);
  for (const file of files) {
    if (file.endsWith(".map")) findings.push(`${file}: source map`);
    if (TEST_ONLY_PATH.test(file)) findings.push(`${file}: test-only module`);
    if (ENGINE_PATH.test(file)) findings.push(`${file}: on-device inference engine or model`);
    if (!TEXT_FILE.test(file)) continue;
    const text = readFileSync(join(directory, file), "utf8");
    for (const marker of DEVELOPMENT_TEXT) if (text.includes(marker)) findings.push(`${file}: ${marker}`);
    if (/xoxb-[A-Za-z0-9]/.test(text)) findings.push(`${file}: Slack bot token literal`);
  }
  return findings;
}

/** android/host.json with this checkout's identity, cloud and App Link host. */
export function hostProfile() {
  const profile = record(readJson(join(android, "host.json")));
  const placeholders = record(profile.manifestPlaceholders);
  const fields: readonly unknown[] = Array.isArray(profile.buildConfigFields) ? (profile.buildConfigFields as readonly unknown[]) : [];
  const computed = [
    { name: "CLOUD_API_ORIGIN", type: "String", value: production.cloud },
    { name: "CLOUD_APP_LINK_HOST", type: "String", value: production.appLinkHost },
    { name: "ALPHA_UPDATE_MANIFEST_URL", type: "String", value: updateManifestUrl },
  ];
  return {
    ...profile,
    manifestPlaceholders: { ...placeholders, appLinkHost: production.appLinkHost, signInCallbackPath, alphaUpdateChannel: "public", alphaUpdateManifestSha256: `sha256:${sha256(updateManifestUrl)}` },
    buildConfigFields: [...fields.filter((field) => !computed.some((own) => own.name === record(field).name)), ...computed],
  };
}

const MARKER = ".eliza-consumer-host.json";

/** Writes the Gradle host eliza's generator owns beside Alpha's authored sources in android/. */
export async function generateHost(runtime: string) {
  const marker = join(android, MARKER);
  if (!existsSync(marker)) writeJson(marker, { schema: 2, output: androidPaths.project, appId: identity.appId, files: [] });
  const version = String(record(readJson(join(app, "package.json"))).version);
  const envCode = Number(process.env.ELIZAOS_VERSION_CODE ?? "");
  const versionCode = Number.isSafeInteger(envCode) && envCode > 0 ? envCode : releaseSignerMeta().versionCode;
  const host = await runEffect(generateAndroidHost({
    consumerRoot: app,
    dependencyRoot: join(app, "node_modules"),
    output: android,
    identity: { appId: identity.appId, appName: identity.appName, version, versionCode },
    profile: hostProfile(),
    runtime,
  }));
  writeJson(join(android, "app/src/main/assets/capacitor.plugins.json"), []);
  return host;
}

interface BuildConsumer {
  buildAndroidConsumer(options: Record<string, unknown>): { files: readonly string[] };
}

const consumerModule: string = "@elizaos/os/android/build-consumer.mjs";

/** Both distributions of the launcher: the debug APK, its instrumentation APK and, with `release`, the unsigned release APK and its mapping. */
export async function build(release: boolean) {
  const env = environment();
  refuseOn(inputProblems(env));
  run(process.execPath, [join(app, "scripts/licences.ts"), "--check"], { env });
  const voice = await stageVoice(env);
  buildPack();
  const runtime = await stageRuntime();
  buildWeb();
  const findings = auditBundle(join(app, androidPaths.web));
  if (findings.length > 0) throw new Error(`The production bundle audit failed:\n${findings.join("\n")}`);
  const host = await generateHost(runtime);
  process.stdout.write(`Generated the ${host.appId} Android host (${host.files.length} files, Gradle ${host.toolchain})\n`);
  const consumer = (await import(consumerModule)) as BuildConsumer;
  consumer.buildAndroidConsumer({
    root: app,
    environment: {
      ...env,
      ORG_GRADLE_PROJECT_elizaInferenceEngineDir: voice.engine,
      ORG_GRADLE_PROJECT_elizaParadeeNativeDir: voice.directory,
    },
    variants: [variant],
    release,
    lint: false,
    androidTest: true,
    daemon: false,
    project: androidPaths.project,
    output: "artifacts",
    androidTestOutput: "instrumentation",
    mappings: release,
    signing: { environment: signingNames },
    gradleArguments: ["-PelizaSpeechBridgeCapacitor=true"],
    prepare: [
      { command: join(app, "node_modules/.bin/cap"), args: ["copy", "android"] },
      () => keepGzipAssets(join(app, androidPaths.project, "app/src/main/assets/public")),
    ],
    record: {
      name: "build-config.json",
      metadata: {
        createdAt: new Date().toISOString(), testMocks: false, release, applicationId: identity.appId, variant,
        cloud: production.cloud, versionOverride: { code: env.ELIZAOS_VERSION_CODE ?? null, name: env.ELIZAOS_VERSION_NAME ?? null },
        alphaCommit: git(root, "rev-parse", "HEAD"), elizaCommit: String(record(readJson(join(root, "eliza.lock.json"))).commit),
      },
    },
    verify: { command: process.execPath, args: [fileURLToPath(import.meta.url), "verify", ...(release ? [] : ["--debug-only"])] },
  });
  if (!release) for (const name of [`${variant}-release.apk`, `${variant}-release-unsigned.apk`, `mapping/${variant}-release-mapping.txt`]) rmSync(join(artifacts, name), { force: true });
  mkdirSync(join(artifacts, "sbom"), { recursive: true });
  rmSync(join(artifacts, "sbom/alpha.cdx.json"), { force: true });
  run(process.execPath, [join(app, "scripts/licences.ts"), "--check", "--sbom", join(artifacts, "sbom/alpha.cdx.json")], { env });
}

function buildTool(name: string, env: NodeJS.ProcessEnv): string {
  const tool = join(env.ANDROID_HOME ?? "", "build-tools/36.0.0", name);
  if (!existsSync(tool)) throw new Error(`Missing ${name}: install Android SDK build-tools;36.0.0`);
  return tool;
}

const INFERENCE_ENTRY = /\.(gguf|onnx|ort|tflite|safetensors|pte|task)$|(^|\/)lib[^/]*(llama|ggml|mtmd|onnxruntime|sherpa|whisper|piper|executorch|elizainference|omnivoice)[^/]*\.so|(^|\/)llama(-omnivoice)?-server$|^assets\/([^/]+\/)*models?\//i;
const REQUIRED_CLASSES = [
  ...["AlphaDevicePlugin", "AlphaCloudSpeechPlugin", "AlphaLocalSpeechPlugin", "AlphaBrowserPlugin", "AlphaCarrierSetupPlugin", "AlphaCallStatePlugin",
    "AlphaOngoingCallPlugin", "AlphaAgentService", "AlphaCalendarPlugin", "AlphaTelephonyPlugin", "AlphaContactsPlugin", "AlphaResetPlugin", "AlphaActionJournalPlugin",
    "AlphaFilesPlugin", "AlphaSelectedDocumentsPlugin", "AlphaInboxAttachmentsPlugin", "AlphaPhotoLibraryPlugin", "AlphaPhotosPlugin", "AlphaPhotosPermissionsPlugin",
    "AlphaMediaEnrollmentPlugin", "AlphaScanPlugin"].map((name) => `Lai/alphacompute/alphaphone/${name};`),
  "Lai/eliza/plugins/camera/CameraPlugin;",
  "Lai/eliza/plugins/filesystem/FilesPlugin;",
  "Lai/eliza/plugins/signin/SignInCallbackActivity;",
  ...["PermittedPhotosPlugin", "PermittedMediaCatalog", "OwnedPhotoEdits", "OwnedVideoPlayback", "OwnedCaptures",
    "SelectedDocuments", "DocumentDestinations"].map((name) => `Lai/eliza/plugins/media/${name};`),
];

interface Row {
  readonly mode: "debug" | "release";
  readonly variant: string;
  readonly flavor: string;
  readonly file: string;
  readonly name: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly signed: boolean;
  readonly signerSha256: string | null;
  readonly debuggable: boolean;
  readonly versionCode: number;
  readonly versionName: string;
  readonly abis: readonly string[];
  readonly testMocks: false;
  readonly bundleAudit: "passed";
  readonly runtime: "PACKAGED";
  readonly runtimeNotices: boolean;
  readonly runtimeProfile: "native";
  readonly voiceHost: { readonly packaged: boolean; readonly differences: readonly string[]; readonly qualified: boolean };
  readonly licenceBlockers: readonly string[];
  readonly distributable: boolean;
  readonly blockers: readonly string[];
}

function assertSafeZipEntry(entry: string): void {
  if (entry === "" || entry.startsWith("/") || UNSAFE_ZIP_ENTRY.test(entry) || entry.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`Refusing unsafe archive entry path: ${entry}`);
  }
}

export function verifyCloudRoutes(name: string, capacitor: Record<string, unknown>): void {
  const cloud = record(record(capacitor.plugins).ElizaCloud);
  const groups = Array.isArray(cloud.routes) ? cloud.routes : [];
  if (groups.length === 0) throw new Error(`${name} carries no ElizaCloud.routes table`);
  for (const item of groups) {
    const group = record(item);
    if (!Array.isArray(group.prefixes) || group.prefixes.length === 0 ||
        group.prefixes.some((prefix) => typeof prefix !== "string" || !prefix.startsWith("/")) ||
        typeof group.id !== "string" || !Array.isArray(group.routes) || group.routes.length === 0) {
      throw new Error(`${name} carries a malformed ElizaCloud route group`);
    }
    for (const entry of group.routes) {
      const route = record(entry);
      const routePath = route.path;
      if (typeof route.method !== "string" || route.method === "" ||
          typeof routePath !== "string" || !routePath.startsWith("/")) {
        throw new Error(`${name} carries a malformed ElizaCloud route`);
      }
      if (SIGN_IN_OWNED_PREFIXES.some((prefix) => routePath === prefix.slice(0, -1) || routePath.startsWith(prefix))) {
        throw new Error(`${name} puts sign-in-owned route ${routePath} in ElizaCloud.routes`);
      }
    }
  }
}

function verifyApkSignature(file: string, name: string, mode: "debug" | "release", env: NodeJS.ProcessEnv): { readonly signed: boolean; readonly signerSha256: string | null } {
  const result = spawnSync(buildTool("apksigner", env), ["verify", "--print-certs", file], { encoding: "utf8" });
  if (result.error) throw result.error;
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0) {
    const unsignedOutput = /DOES NOT VERIFY|No JAR signatures|Missing META-INF|No APK Signature Scheme/i.test(output);
    if (mode === "release" && unsignedOutput) return { signed: false, signerSha256: null };
    throw new Error(`${name} failed apksigner verification: ${output.trim()}`);
  }
  if (/Signer #2\b/.test(output)) throw new Error(`${name} carries multiple signers (Signer #2 present)`);
  const matches = [...output.matchAll(/Signer #(\d+) certificate SHA-256 digest:\s*([0-9a-fA-F]{64})/g)];
  if (matches.length !== 1 || matches[0]?.[1] !== "1" || matches[0][2] === undefined) {
    throw new Error(`${name} has no single verifiable Signer #1 digest`);
  }
  const signerSha256 = matches[0][2].toLowerCase();
  if (mode === "release") {
    const expected = releaseSignerMeta().signerSha256.toLowerCase();
    if (expected !== "" && signerSha256 !== expected) {
      throw new Error(`${name} is signed by ${signerSha256}, not Alpha's enrolled signer ${expected}`);
    }
  }
  return { signed: true, signerSha256 };
}

function currentLicenceBlockers(): readonly string[] {
  const found = licenceInventory();
  if (!releaseBlockedByLicences([...found.openSourceFlags], found.fontCheck)) return [];
  const blockers: string[] = [];
  if (found.fontCheck !== "FontResolved") blockers.push(`font-check:${found.fontCheck}`);
  if (releaseBlockedByLicences([...found.openSourceFlags], "FontResolved")) {
    for (const flag of found.openSourceFlags) blockers.push(`open-source:${flag}`);
  }
  return blockers;
}

/** Checks inventoried APK bytes against the locked Node source's license and the pinned binary for each packaged ABI. */
function recordedRuntimeNotices({ entries, listed, packagedAbis }: {
  readonly entries: readonly string[];
  readonly listed: readonly Record<string, unknown>[];
  readonly packagedAbis: readonly string[];
}): boolean {
  const notices = listed.filter((row) => row.path === nodeLicence);
  if (notices.length !== 1 || entries.filter((entry) => entry === nodeLicence).length !== 1) return false;
  const lock = record(readJson(join(prepared().root, "packages/os/aosp/runtime/node.lock.json")));
  const expected = typeof lock.sourceSha256 === "string" ? nodeLicenceBySource.get(lock.sourceSha256) : undefined;
  if (expected === undefined || notices[0]?.sha256 !== expected || !Array.isArray(lock.entries)) return false;
  const pinned = lock.entries.map(record);
  return packagedAbis.every((abi) => {
    const binaries = listed.filter((row) => row.path === `lib/${abi}/libeliza_node.so`);
    const candidates = pinned.filter((row) => row.abi === abi);
    const binaryDigest = candidates[0]?.sha256;
    return binaries.length === 1 && candidates.length === 1 && typeof binaryDigest === "string" && binaries[0]?.sha256 === binaryDigest;
  });
}

/** One APK, checked: identity, version, payload, page audit and classes. Throws on the first broken rule. */
export function checkApk(file: string, mode: "debug" | "release", env: NodeJS.ProcessEnv = environment(), options: { readonly allowMissingVoiceReceipt?: boolean } = {}): Row {
  const name = relative(artifacts, file);
  const bytes = readFileSync(file);
  const aapt = buildTool("aapt", env);
  const badging = execFileSync(aapt, ["dump", "badging", file], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const packageLine = /^package: name='([^']+)' versionCode='(\d+)' versionName='([^']*)'/m.exec(badging);
  if (packageLine === null || packageLine[1] !== identity.appId) throw new Error(`${name} is not ${identity.appId}`);
  const versionCode = Number(packageLine[2]);
  const expected = env.ELIZAOS_VERSION_CODE;
  if (expected !== undefined && expected !== "" && versionCode !== Number(expected)) throw new Error(`${name} has versionCode ${versionCode}, not ELIZAOS_VERSION_CODE ${expected}`);
  const debuggable = badging.includes("application-debuggable");
  if (debuggable !== (mode === "debug")) throw new Error(`${name} is ${debuggable ? "" : "not "}debuggable`);
  const entries = execFileSync(aapt, ["list", file], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).split("\n").filter((entry) => entry !== "");
  const bunLibraries = entries.filter((entry) => /^lib\/[^/]+\/libeliza_bun\.so$/.test(entry));
  if (bunLibraries.length > 0) throw new Error(`${name} carries the Bun runtime: ${bunLibraries.join(", ")}`);
  const abiList = entries.flatMap((entry) => /^lib\/([^/]+)\/libeliza_node\.so$/.exec(entry)?.slice(1) ?? []);
  const wantedAbis = mode === "release" ? ["arm64-v8a"] : [...abis];
  if (abiList.slice().sort().join() !== wantedAbis.slice().sort().join()) throw new Error(`${name} carries libeliza_node.so for ${abiList.join(", ") || "no ABI"}, not ${wantedAbis.join(", ")}`);
  const read = (entry: string, limit = 1024 * 1024 * 1024) => {
    assertSafeZipEntry(entry);
    return execFileSync("unzip", ["-p", file, entry], { maxBuffer: limit });
  };
  const voiceFiles = new Set<string>();
  const voiceDir = voiceDirectory();
  const hasVoiceReceipt = existsSync(join(voiceDir, "build-record.json"));
  if (hasVoiceReceipt || options.allowMissingVoiceReceipt !== true) {
    for (const row of voiceRecord(voiceDir)) {
      const source = String(row.path);
      const library = /^jniLibs\/([^/]+)\/libelizainference\.so$/.exec(source);
      if (library && !wantedAbis.includes(library[1] ?? "")) continue;
      if (!source.startsWith(voiceAssets) && library === null) continue;
      const entryPath = library ? source.replace(/^jniLibs\//, "lib/") : source;
      assertSafeZipEntry(entryPath);
      if (voiceFiles.has(entryPath)) throw new Error(`The local speech build receipt lists a duplicate path: ${entryPath}`);
      voiceFiles.add(entryPath);
      if (!entries.includes(entryPath) || sha256(read(entryPath)) !== row.sha256) throw new Error(`${name}'s ${entryPath} differs from its local speech receipt`);
    }
  } else {
    for (const entry of entries) {
      if (entry.startsWith(voiceAssets) || wantedAbis.some((abi) => entry === `lib/${abi}/libelizainference.so`)) {
        voiceFiles.add(entry);
      }
    }
  }
  if (!voiceFiles.has(`${voiceAssets}manifest.json`) || ![...voiceFiles].some((entryPath) => entryPath.startsWith(`${voiceAssets}asr/`) && entryPath.endsWith(".gguf"))
      || ![...voiceFiles].some((entryPath) => entryPath.startsWith(`${voiceAssets}tts/`) && entryPath.endsWith(".gguf"))
      || wantedAbis.some((abi) => !voiceFiles.has(`lib/${abi}/libelizainference.so`) || !entries.includes(`lib/${abi}/libparadeevoicejni.so`))) {
    throw new Error(`${name} lacks the packaged local speech engine or models`);
  }
  const unexpected = entries.filter((entry) => INFERENCE_ENTRY.test(entry) && !voiceFiles.has(entry));
  if (unexpected.length > 0) throw new Error(`${name} carries unrecorded inference files: ${unexpected.join(", ")}`);
  const inventory = record(JSON.parse(read("assets/agent/inventory.json").toString("utf8")));
  const listed = Array.isArray(inventory.files) ? inventory.files.map(record) : [];
  for (const required of ["assets/agent/agent.mjs", "assets/agent/manifest.json"]) if (!listed.some((row) => row.path === required)) throw new Error(`${name}'s inventory lists no ${required}`);
  for (const row of listed) {
    const entryPath = String(row.path);
    if (entryPath.startsWith("lib/") && !wantedAbis.some((abi) => entryPath.startsWith(`lib/${abi}/`))) continue;
    if (!entries.includes(entryPath)) throw new Error(`${name} lacks its inventoried ${entryPath}`);
    if (sha256(read(entryPath)) !== row.sha256) throw new Error(`${name}'s ${entryPath} differs from its inventory`);
  }
  const runtimeNotices = recordedRuntimeNotices({ entries, listed, packagedAbis: wantedAbis });
  for (const data of ["host.json", "character.json", "policy.json"]) if (!entries.includes(`assets/agent/${data}`)) throw new Error(`${name} carries no agent ${data}`);
  const pluginManifest = "assets/capacitor.plugins.json";
  if (!entries.includes(pluginManifest)) throw new Error(`${name} lacks the Capacitor plugin discovery manifest`);
  const discovered: unknown = JSON.parse(read(pluginManifest).toString("utf8"));
  if (!Array.isArray(discovered) || discovered.length !== 0) throw new Error(`${name} carries discovered plugins outside the Android host registration`);
  const capacitor = record(JSON.parse(read("assets/capacitor.config.json").toString("utf8")));
  const signIn = record(record(capacitor.plugins).ElizaSignIn);
  if (signIn.testEnvironments !== false) throw new Error(`${name} registers test cloud environments`);
  verifyCloudRoutes(name, capacitor);
  const environments: unknown = signIn.environments;
  const registration = Array.isArray(environments) && environments.length === 1 ? record(environments[0]) : {};
  if (signIn.clientId !== identity.appId || signIn.googleMode !== "browser" || registration.name !== "production"
      || registration.apiOrigin !== production.cloud || registration.appLinkHost !== production.appLinkHost
      || registration.redirectPath !== signInCallbackPath) {
    throw new Error(`${name} lacks the production Alpha Cloud sign-in registration`);
  }
  const page = mkdtempSync(join(tmpdir(), "alpha-apk-page-"));
  try {
    execFileSync("unzip", ["-q", file, "assets/public/*", "-d", page]);
    const findings = auditBundle(join(page, "assets/public"));
    if (findings.length > 0) throw new Error(`${name}'s page fails the production bundle audit:\n${findings.join("\n")}`);
  } finally {
    rmSync(page, { recursive: true, force: true });
  }
  const classes = execFileSync(buildTool("dexdump", env), [file], { encoding: "utf8", maxBuffer: 1024 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  const missing = REQUIRED_CLASSES.filter((descriptor) => !classes.includes(`Class descriptor  : '${descriptor}'`));
  if (missing.length > 0) throw new Error(`${name} lacks ${missing.join(", ")}`);
  const { signed, signerSha256 } = verifyApkSignature(file, name, mode, env);
  const allRuntimeNotices = runtimeNotices && entries.includes("assets/public/licenses/THIRD_PARTY_NOTICES.txt") && entries.includes("assets/public/licenses/third-party-notices.json");
  const licenceBlockers = currentLicenceBlockers();
  const blockers = [
    ...(mode === "debug" ? ["debug build"] : []),
    ...(signed ? [] : ["unsigned release"]),
    ...(allRuntimeNotices ? [] : ["Node runtime notices missing or unverified"]),
    ...licenceBlockers,
  ];
  return {
    mode, variant, flavor: variant, file: name, name, sha256: sha256(bytes), bytes: bytes.byteLength, signed, signerSha256, debuggable, versionCode, versionName: packageLine[3] ?? "",
    abis: abiList, testMocks: false, bundleAudit: "passed", runtime: "PACKAGED", runtimeNotices: allRuntimeNotices, runtimeProfile: "native",
    voiceHost: { packaged: true, differences: [], qualified: true }, licenceBlockers,
    distributable: blockers.length === 0, blockers,
  };
}

/** Writes the APK manifest after checking both variants or the selected build. */
export function verify(env: NodeJS.ProcessEnv = environment(), options: { readonly releaseOnly?: boolean; readonly debugOnly?: never } | { readonly debugOnly: true; readonly releaseOnly?: never } = {}) {
  const debug = join(artifacts, `${variant}-debug.apk`);
  const release = [`${variant}-release.apk`, `${variant}-release-unsigned.apk`].map((name) => join(artifacts, name)).filter((file) => existsSync(file));
  const results: ReturnType<typeof checkApk>[] = [];
  if (!options.releaseOnly) {
    if (!existsSync(debug)) throw new Error(`artifacts/${variant}-debug.apk is missing`);
    results.push(checkApk(debug, "debug", env));
  }
  if (!options.debugOnly) {
    const [file] = release;
    if (release.length !== 1 || file === undefined) throw new Error(`artifacts/ must hold exactly one ${variant} release APK, holds ${release.length}`);
    results.push(checkApk(file, "release", env, { allowMissingVoiceReceipt: options.releaseOnly === true }));
  }
  if (new Set(results.map((row) => row.versionCode)).size !== 1) throw new Error("The debug and release APKs have different version codes");
  const tests = join(artifacts, "instrumentation", `${variant}-androidTest.apk`);
  const manifest = {
    schema: 1, applicationId: identity.appId, variant, testMocks: false,
    version: { code: results[0]?.versionCode ?? 0, name: results[0]?.versionName ?? "" },
    instrumentation: existsSync(tests) ? { file: relative(artifacts, tests), sha256: sha256(readFileSync(tests)) } : null,
    results,
  };
  writeJson(join(artifacts, "apk-manifest.json"), manifest);
  for (const row of results) process.stdout.write(`${row.mode} ${row.file} versionCode ${row.versionCode} ${row.abis.join(",")} ${row.signed ? `signed ${row.signerSha256}` : "unsigned"}, page audit passed, runtime packaged, Node notices ${row.runtimeNotices ? "verified" : "unverified"}\n`);
  return manifest;
}

async function main(argv: readonly string[]) {
  const [command, ...rest] = argv;
  switch (command) {
    case "inputs": {
      const problems = inputProblems();
      for (const { input, problem, fix } of problems) process.stdout.write(`MISSING ${input}: ${problem}. Run: ${fix}\n`);
      if (problems.length === 0) process.stdout.write(`Every Android build input is present for eliza ${String(record(readJson(join(root, "eliza.lock.json"))).commit)}\n`);
      return problems.length === 0 ? 0 : 2;
    }
    case "pin":
      refuseOn(pinProblems());
      process.stdout.write(`The pinned eliza ${prepared().commit} is clean and on eliza's origin/develop\n`);
      return 0;
    case "pack":
      refuseOn(pinProblems());
      buildPack();
      return 0;
    case "stage":
      process.stdout.write(`Staged the agent runtime in ${relative(app, await stageRuntime())}\n`);
      return 0;
    case "web":
      buildWeb();
      return auditOutcome(join(app, androidPaths.web));
    case "audit":
      return auditOutcome(resolve(rest[0] ?? join(app, androidPaths.web)));
    case "host": {
      const host = await generateHost(await stageRuntime());
      process.stdout.write(`Generated the ${host.appId} Android host (${host.files.length} files, Gradle ${host.toolchain})\n`);
      return 0;
    }
    case "build":
      if (rest.some((arg) => arg !== "--release")) throw new Error(usage);
      await build(rest.includes("--release"));
      return 0;
    case "verify":
      if (rest.length > 1 || rest.some((arg) => arg !== "--release-only" && arg !== "--debug-only")) throw new Error(usage);
      verify(environment(), rest[0] === "--debug-only" ? { debugOnly: true } : { releaseOnly: rest[0] === "--release-only" });
      return 0;
    default:
      process.stderr.write(`${usage}\n`);
      return 2;
  }
}

function auditOutcome(directory: string) {
  const findings = auditBundle(directory);
  for (const finding of findings) process.stderr.write(`DENY ${finding}\n`);
  if (findings.length === 0) process.stdout.write(`PASS ${relative(app, directory) || "."}: no mock, fixture or developer surface\n`);
  return findings.length === 0 ? 0 : 1;
}

if (import.meta.main) {
  try {
    process.exitCode = await main(process.argv.slice(2)) || process.exitCode;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode ||= 1;
  }
}
