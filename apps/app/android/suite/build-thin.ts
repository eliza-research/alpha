#!/usr/bin/env node
import deployments from "@repo/deployment/deployments.json" with { type: "json" };
import { createHash } from "node:crypto";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSuiteOutputs, loadSuiteRegistry, type SuiteAppEntry } from "./generate-suite.ts";

const SUITE_DIR = dirname(fileURLToPath(import.meta.url));
const ANDROID_DIR = resolve(SUITE_DIR, "..");
const APP_DIR = resolve(ANDROID_DIR, "..");
const REPO_ROOT = resolve(APP_DIR, "../..");
const THIN_APP_DIR = join(SUITE_DIR, "thin-app");
const GENERATED_DIR = join(SUITE_DIR, "generated");
const OUT_DIR = join(SUITE_DIR, "out");
const DEFAULT_APP_IDS = ["notes", "browser", "settings"] as const;
const JAVA_HOME_CANDIDATES = [
  "/opt/homebrew/opt/openjdk@21",
  "/usr/local/opt/openjdk@21",
  "/usr/lib/jvm/temurin-21-jdk-amd64",
  "/usr/lib/jvm/java-21-openjdk-amd64",
  "/usr/lib/jvm/java-21-openjdk",
] as const;

export interface BuildThinOptions {
  readonly appIds: readonly string[];
  readonly release: boolean;
  readonly skipWeb: boolean;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly maxWorkers: number;
  readonly webConcurrency: number;
}

export interface BuiltThinApk {
  readonly id: string;
  readonly view: string;
  readonly applicationId: string;
  readonly mode: "debug" | "release";
  readonly apkPath: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly signerSha256: string | null;
}

function sha256File(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function resolveJavaHome(base: NodeJS.ProcessEnv): string {
  if (base.JAVA_HOME && existsSync(join(base.JAVA_HOME, "bin/java"))) return base.JAVA_HOME;
  for (const candidate of JAVA_HOME_CANDIDATES) {
    if (existsSync(join(candidate, "bin/java"))) return candidate;
  }
  return "/usr/lib/jvm/java-21-openjdk";
}

function resolveAndroidHome(base: NodeJS.ProcessEnv): string {
  return base.ANDROID_HOME ?? base.ANDROID_SDK_ROOT ?? join(homedir(), "Android/Sdk");
}

function resolveDebugKeystore(base: NodeJS.ProcessEnv): string {
  if (base.ALPHA_DEBUG_KEYSTORE && existsSync(base.ALPHA_DEBUG_KEYSTORE)) return base.ALPHA_DEBUG_KEYSTORE;
  return join(ANDROID_DIR, ".android-user/debug.keystore");
}

function ensureSharedDebugKeystore(base: NodeJS.ProcessEnv): string {
  const target = resolveDebugKeystore(base);
  if (existsSync(target)) return target;
  const homeKeystore = join(homedir(), ".android/debug.keystore");
  if (existsSync(homeKeystore)) {
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(homeKeystore, target);
  }
  return target;
}

function resolveGradleExecutable(): { readonly command: string; readonly argsPrefix: readonly string[] } {
  const androidWrapper = join(ANDROID_DIR, "gradlew");
  if (existsSync(androidWrapper)) return { command: androidWrapper, argsPrefix: ["-p", SUITE_DIR] };
  const wrapperDists = join(homedir(), ".gradle/wrapper/dists/gradle-8.13-bin");
  if (existsSync(wrapperDists)) {
    for (const hashDir of readdirSync(wrapperDists)) {
      const candidate = join(wrapperDists, hashDir, "gradle-8.13/bin/gradle");
      if (existsSync(candidate)) return { command: candidate, argsPrefix: ["-p", SUITE_DIR] };
    }
  }
  const elizaWrapper = join(REPO_ROOT, ".eliza/packages/os/android/host-templates/gradlew");
  if (existsSync(elizaWrapper)) return { command: elizaWrapper, argsPrefix: ["-p", SUITE_DIR] };
  return { command: "gradle", argsPrefix: ["-p", SUITE_DIR] };
}

function gradleFlavorTask(appId: string, release: boolean): string {
  const capitalized = `${appId.charAt(0).toUpperCase()}${appId.slice(1)}`;
  return `:thin-app:assemble${capitalized}${release ? "Release" : "Debug"}`;
}

function buildEnvironment(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  delete env.ELIZA_DEV_ALLOW_TEST_MOCKS;
  delete env.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS;
  delete env.ALPHA_FAKES;
  env.JAVA_HOME = resolveJavaHome(base);
  env.ANDROID_HOME = resolveAndroidHome(base);
  env.ANDROID_SDK_ROOT = env.ANDROID_HOME;
  env.ANDROID_USER_HOME = join(ANDROID_DIR, ".android-user");
  const debugKeystore = resolveDebugKeystore(base);
  if (existsSync(debugKeystore)) {
    env.ALPHA_DEBUG_KEYSTORE = debugKeystore;
  }
  return env;
}

function runChecked(command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): void {
  const result = spawnSync(command, [...args], { cwd, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${String(result.status ?? result.signal)}`);
  }
}

function runAsyncChecked(
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  label: string,
): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, [...args], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.on("error", rejectPromise);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolvePromise();
      } else {
        const tail = `${stdout}\n${stderr}`.trim().slice(-2000);
        rejectPromise(new Error(`[${label}] ${command} ${args.join(" ")} exited with ${String(code ?? signal)}\n${tail}`));
      }
    });
  });
}

async function runPool<T>(items: readonly T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const lanes = Array.from({ length: limit }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item !== undefined) {
        await worker(item);
      }
    }
  });
  await Promise.all(lanes);
}

function stageFlavorAssets(app: SuiteAppEntry, distDir: string): void {
  const assetsRoot = join(THIN_APP_DIR, "src", app.id, "assets");
  const publicDir = join(assetsRoot, "public");
  rmSync(publicDir, { recursive: true, force: true });
  mkdirSync(publicDir, { recursive: true });
  cpSync(distDir, publicDir, { recursive: true });
  const capacitorConfig = {
    appId: app.applicationId,
    appName: app.label,
    ...(app.id === "slack" ? { plugins: { AlphaSlackOAuth: { cloudOrigin: deployments.production.cloud, callbackPath: "/oauth/standalone" } } } : {}),
    webDir: "dist",
    loggingBehavior: "none",
    server: { androidScheme: "https" },
    android: { allowMixedContent: false, webContentsDebuggingEnabled: false },
  };
  writeFileSync(join(assetsRoot, "capacitor.config.json"), `${JSON.stringify(capacitorConfig, null, 2)}\n`, "utf8");
  writeFileSync(join(assetsRoot, "capacitor.plugins.json"), "[]\n", "utf8");
}

function readSignerSha256(apkPath: string, androidHome: string): string | null {
  const apksigner = join(androidHome, "build-tools/36.0.0/apksigner");
  if (!existsSync(apksigner)) return null;
  const result = spawnSync(apksigner, ["verify", "--print-certs", apkPath], { encoding: "utf8" });
  if (result.status !== 0) return null;
  const match = /Signer #1 certificate SHA-256 digest:\s*([0-9a-fA-F]{64})/.exec(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  return match?.[1]?.toLowerCase() ?? null;
}

function parseCliArgs(argv: readonly string[]): BuildThinOptions {
  let all = false;
  let release = false;
  let skipWeb = false;
  let dryRun = false;
  let json = false;
  let maxWorkers = 4;
  let webConcurrency = 4;
  let appIds: string[] = [...DEFAULT_APP_IDS];

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] ?? "";
    if (arg === "--all") all = true;
    else if (arg === "--release") release = true;
    else if (arg === "--skip-web") skipWeb = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--json") json = true;
    else if (arg === "--apps") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--apps requires a comma-separated list of app ids");
      index += 1;
      appIds = value.split(",").map((item) => item.trim()).filter(Boolean);
    } else if (arg === "--max-workers") {
      const value = Number(argv[index + 1]);
      if (!Number.isSafeInteger(value) || value < 1 || value > 16) throw new Error("--max-workers must be 1..16");
      index += 1;
      maxWorkers = value;
    } else if (arg === "--web-concurrency") {
      const value = Number(argv[index + 1]);
      if (!Number.isSafeInteger(value) || value < 1 || value > 8) throw new Error("--web-concurrency must be 1..8");
      index += 1;
      webConcurrency = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  const registry = loadSuiteRegistry();
  const thinApps = registry.apps.filter((entry) => entry.surface === "app");
  if (all) {
    appIds = thinApps.map((entry) => entry.id);
  }
  if (appIds.length === 0) throw new Error("At least one app id must be selected");
  const knownThin = new Set(thinApps.map((entry) => entry.id));
  for (const id of appIds) {
    if (!knownThin.has(id)) throw new Error(`Unknown thin app id "${id}" (available: ${[...knownThin].join(", ")})`);
  }
  return { appIds, release, skipWeb, dryRun, json, maxWorkers, webConcurrency };
}

async function main(argv: readonly string[]): Promise<number> {
  const options = parseCliArgs(argv);
  const registryPath = join(SUITE_DIR, "apps.json");
  const registry = loadSuiteRegistry(registryPath);
  const selected = options.appIds.map((id) => {
    const found = registry.apps.find((entry) => entry.id === id && entry.surface === "app");
    if (!found || found.view === null) throw new Error(`Thin app "${id}" not found`);
    return found;
  });

  const env = buildEnvironment(process.env);
  const gradle = resolveGradleExecutable();
  const mode = options.release ? "release" : "debug";
  const tasks = selected.map((app) => gradleFlavorTask(app.id, options.release));
  const gradleArgs = [
    ...gradle.argsPrefix,
    `--max-workers=${String(options.maxWorkers)}`,
    "--no-daemon",
    ...tasks,
  ];

  if (options.dryRun) {
    const plan = {
      ok: true,
      dryRun: true,
      mode,
      count: selected.length,
      webConcurrency: Math.min(options.webConcurrency, selected.length),
      apps: selected.map((app) => ({
        id: app.id,
        view: app.view,
        applicationId: app.applicationId,
        assetsProfile: app.assetsProfile,
        distDir: join(APP_DIR, "dist-suite", app.id),
        flavorAssetsDir: join(THIN_APP_DIR, "src", app.id, "assets"),
        gradleTask: gradleFlavorTask(app.id, options.release),
        outApk: join(OUT_DIR, `${app.id}-${mode}.apk`),
      })),
      environment: {
        JAVA_HOME: env.JAVA_HOME ?? null,
        ANDROID_HOME: env.ANDROID_HOME ?? null,
        ANDROID_USER_HOME: env.ANDROID_USER_HOME ?? null,
        ALPHA_DEBUG_KEYSTORE: env.ALPHA_DEBUG_KEYSTORE ?? null,
      },
      gradle: { command: gradle.command, args: gradleArgs },
    };
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return 0;
  }

  const sharedKeystore = options.release ? null : ensureSharedDebugKeystore(process.env);
  if (sharedKeystore && existsSync(sharedKeystore)) {
    env.ALPHA_DEBUG_KEYSTORE = sharedKeystore;
  }

  const registryRaw = readFileSync(registryPath, "utf8");
  const outputs = buildSuiteOutputs(registry, registryRaw);
  for (const output of outputs) {
    const target = join(GENERATED_DIR, output.relativePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, output.content, "utf8");
  }
  const ipcPolicyPath = resolve(SUITE_DIR, "../alpha-ipc/src/main/assets/alpha-suite-policy.json");
  const policyOut = outputs.find((item) => item.relativePath === "alpha-suite-policy.json");
  if (policyOut) {
    mkdirSync(dirname(ipcPolicyPath), { recursive: true });
    writeFileSync(ipcPolicyPath, policyOut.content, "utf8");
  }

  const viteBin = join(APP_DIR, "node_modules/.bin/vite");
  if (!options.skipWeb) {
    await runPool(selected, options.webConcurrency, async (app) => {
      const distDir = join(APP_DIR, "dist-suite", app.id);
      await runAsyncChecked(
        viteBin,
        ["build", "--outDir", distDir],
        APP_DIR,
        {
          ...env,
          VITE_ALPHA_SURFACE: "app",
          VITE_ALPHA_VIEW: app.view ?? "",
        },
        app.id,
      );
    });
  }

  for (const app of selected) {
    const distDir = join(APP_DIR, "dist-suite", app.id);
    if (!existsSync(join(distDir, "index.html"))) {
      throw new Error(`Missing built web bundle for ${app.id} at ${distDir}/index.html`);
    }
    stageFlavorAssets(app, distDir);
  }

  runChecked(gradle.command, gradleArgs, SUITE_DIR, env);

  mkdirSync(OUT_DIR, { recursive: true });
  const built: BuiltThinApk[] = [];
  for (const app of selected) {
    const apkDir = join(THIN_APP_DIR, "build/outputs/apk", app.id, mode);
    const candidates = existsSync(apkDir)
      ? readdirSync(apkDir).filter((name) => name.endsWith(".apk")).sort()
      : [];
    const sourceName = candidates[0];
    if (!sourceName) {
      throw new Error(`No built APK found for ${app.id} in ${apkDir}`);
    }
    const sourceApk = join(apkDir, sourceName);
    const targetApk = join(OUT_DIR, `${app.id}-${mode}.apk`);
    copyFileSync(sourceApk, targetApk);
    const bytes = readFileSync(targetApk).byteLength;
    built.push({
      id: app.id,
      view: app.view ?? "",
      applicationId: app.applicationId,
      mode,
      apkPath: targetApk,
      bytes,
      sha256: sha256File(targetApk),
      signerSha256: readSignerSha256(targetApk, env.ANDROID_HOME ?? ""),
    });
  }

  const manifest = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    mode,
    alphaCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim(),
    apps: built,
  };
  writeFileSync(join(OUT_DIR, "thin-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ ok: true, ...manifest }, null, 2)}\n`);
  } else {
    for (const apk of built) {
      process.stdout.write(`${apk.id} (${apk.applicationId}) -> ${apk.apkPath} (${apk.bytes} B, signer=${apk.signerSha256 ?? "unsigned"})\n`);
    }
  }
  return 0;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
