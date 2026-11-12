#!/usr/bin/env bun
/**
 * Provision one pilot unit from a verified APK build and write its per-unit record.
 *
 *   bun scripts/provision-unit.ts --serial <adb serial> --alias <unit-name> \
 *     --apk-manifest artifacts/apk-manifest.json [--variant launcher|standalone] \
 *     [--build release|debug] [--output test-results/pilot-units] [--home-wait-ms 0]
 *
 * Steps: admit the APK from the verify-apks manifest (a release must be distributable:
 * signed by android/release-signer.json's certificate with an advancing versionCode,
 * flag-off, with the packaged resident runtime, qualified speech and no unresolved
 * licence blocker; anything else is refused with each blocker named. --build debug is
 * for emulator rehearsal only, is refused on a phone and is recorded as such), refuse a unit that
 * already has the package (use scripts/pilot-update.ts), install, check the
 * installed bytes and versionCode, open the default-HOME chooser for the operator
 * (the choice is the operator's; it is never automated), read the HOME role holder
 * and the packaged runtime identity, and write <output>/<alias>.json.
 *
 * The record holds no secrets and no raw serial (only its SHA-256). It is a
 * provisioning record: on an emulator it is class E evidence, on a phone it is not
 * device or user acceptance by itself.
 */
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseXmlTree, signerDigest } from "./apk.ts";
import type {ApkMode, ApkVariant} from "./apk.ts";
import type {ReleaseSigner} from "./build-android.ts";
import {aaptManifestTree, manifestTreeIsDebuggable, readApkBuildFlags} from "../vendor/eliza/packages/os/scripts/android/image-apk-admission.mjs";
import { readReleaseSigner, releaseAdmission } from "./build-android.ts";
import { releaseBlockers } from "./release-blockers.ts";
import { androidEnv, tool } from "./toolchain.ts";
import { updateArtifactDigest } from "./update-artifact.ts";
import { apkUpdateChannelOrLegacy, assertProvisioningUpdateChannel, recordedProvisioningUpdateChannel, type UpdateChannel } from "./update-channel.ts";

export const PACKAGE = "ai.alphacompute.alphaphone";
const sha256 = (bytes: string | NodeJS.ArrayBufferView) => createHash("sha256").update(bytes).digest("hex");

export interface VerifiedApkRow extends Record<string, unknown> {
  variant: ApkVariant;
  mode: ApkMode;
  file: string;
  sha256: string;
  versionCode: number | null;
  versionName: string | null;
  signed: boolean;
  signerSha256?: string | null;
  signerApiLevel?: number | null;
  testMocks?: boolean;
  distributable?: boolean;
  runtime?: "PACKAGED" | "NOT_PACKAGED";
  releaseAdmission?: Partial<ReturnType<typeof releaseAdmission>>;
}
interface ApkManifest {
  testMocks?: boolean;
  updateChannel?: unknown;
  results?: VerifiedApkRow[];
}
interface UnitArgs {
  serial: string | null;
  alias: string | null;
  apkManifest: string | null;
  variant: string;
  build: string;
  output: string;
  homeWaitMs: number;
}
interface ApkConsistencyOptions {
  descriptor?: ReleaseSigner;
  apiLevel?: number;
  facts?: ReturnType<typeof apkFacts>;
}
type Adb = ReturnType<typeof adbFor>;

export function parseUnitArgs(argv: readonly string[], { requireAlias = true } = {}) {
  const options: UnitArgs = { serial: null, alias: null, apkManifest: null, variant: "launcher", build: "release", output: "test-results/pilot-units", homeWaitMs: 0 };
  for (let index = 0; index < argv.length; index++) {
    const [flag, inline] = argv[index].split(/=(.*)/s);
    const next = () => { const value = inline ?? argv[++index]; if (value === undefined) throw new Error(`${flag} needs a value`); return value; };
    if (flag === "--serial") options.serial = next();
    else if (flag === "--alias") options.alias = next();
    else if (flag === "--apk-manifest") options.apkManifest = next();
    else if (flag === "--variant") options.variant = next();
    else if (flag === "--build") options.build = next();
    else if (flag === "--output") options.output = next();
    else if (flag === "--home-wait-ms") options.homeWaitMs = Number(next());
    else throw new Error(`Unknown option ${argv[index]}`);
  }
  if (!options.serial || !/^[A-Za-z0-9._:-]{1,64}$/.test(options.serial)) throw new Error("--serial <adb serial> is required");
  if (requireAlias && !/^[a-z0-9][a-z0-9-]{0,39}$/.test(options.alias ?? "")) throw new Error("--alias must be a short lowercase unit name (a-z, 0-9, -); never a person's name or the serial");
  if (!options.apkManifest) throw new Error("--apk-manifest <path to verify-apks apk-manifest.json> is required");
  if (options.variant !== "launcher" && options.variant !== "standalone") throw new Error("--variant must be launcher or standalone");
  if (options.build !== "release" && options.build !== "debug") throw new Error("--build must be release or debug");
  if (!Number.isSafeInteger(options.homeWaitMs) || options.homeWaitMs < 0) throw new Error("--home-wait-ms must be a non-negative integer");
  const variant: ApkVariant = options.variant;
  const build: ApkMode = options.build;
  return { ...options, serial: options.serial, apkManifest: options.apkManifest, variant, build };
}

export function readUnitApkManifest(file: string): ApkManifest {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * Pick and admit the APK row from a verify-apks manifest. A release must be distributable
 * with no named blocker (scripts/release-blockers.ts) against the committed signer
 * descriptor; a debug row is accepted only for --build debug and is labelled rehearsal.
 */
export function admitUnitApk(manifestFile: string, { variant, build }: {variant: ApkVariant; build: ApkMode},
  {descriptor = readReleaseSigner(), manifest = readUnitApkManifest(manifestFile)}: {descriptor?: ReleaseSigner; manifest?: ApkManifest} = {}) {
  if (manifest.testMocks !== false) throw new Error(`${manifestFile} is a test-mocks build; pilot units get distribution builds only`);
  const row = manifest.results?.find(entry => entry.variant === variant && entry.mode === build);
  if (!row) throw new Error(`${manifestFile} has no ${variant} ${build} APK`);
  const file = path.resolve(path.dirname(manifestFile), path.basename(row.file));
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
  const actual = updateArtifactDigest(file).sha256;
  if (actual !== row.sha256) throw new Error(`${file} does not match its verified manifest row`);
  // The manifest-level flag is checked above; a row that disagrees with it is refused for either build.
  if (row.testMocks !== false) throw new Error(`${file} is recorded as a test-mocks build; pilot units get distribution builds only`);
  const updateChannel = build === "release" ? recordedProvisioningUpdateChannel(manifest.updateChannel, row.updateChannel) : null;
  if (build === "release") {
    // Judged against the current signer descriptor and against what verify-apks recorded:
    // signing, versionCode, flag-off audit, packaged runtime, speech qualification and the one
    // proprietary-font check. Open-source licence flags are never a blocker (decision P-09).
    const recorded = row.releaseAdmission ? [...(row.releaseAdmission.failures ?? []), ...(row.releaseAdmission.blockers ?? [])] : [];
    const blockers = [...new Set([...releaseBlockers(row, { manifestTestMocks: manifest.testMocks, admission: releaseAdmission(row, descriptor) }), ...recorded])];
    if (blockers.length) throw new Error(`${file} cannot be provisioned: it is not distributable. Unresolved blockers:\n${blockers.map(item => `  - ${item}`).join("\n")}\n` +
      "Pilot and acceptance units get distributable releases only; --build debug rehearses the same steps on a disposable emulator.");
  }
  return { file, sha256: actual, variant, build, versionCode: row.versionCode, versionName: row.versionName, signed: row.signed === true,
    updateChannel, signerSha256: row.signerSha256 ?? null, signerApiLevel: row.signerApiLevel ?? null, distributable: row.distributable === true, runtime: row.runtime ?? null, rehearsal: build === "debug" };
}

/** Facts read from the APK file itself. A fact that cannot be read is null, which no check accepts. */
export function apkFacts(file: string, {apiLevel}: {apiLevel?: number} = {}) {
  const attempt = <T,>(read: () => T): T | null => { try { return read(); } catch { return null; } };
  const tree = attempt(() => aaptManifestTree(file, {aapt: tool("aapt"), env: androidEnv()}));
  return {
    testMocks: attempt(() => (readApkBuildFlags(file) as {testMocks?: unknown} | null)?.testMocks ?? null),
    debuggable: tree === null ? null : manifestTreeIsDebuggable(tree),
    updateChannel: tree === null ? null : attempt(() => apkUpdateChannelOrLegacy(parseXmlTree(tree)) ?? ("legacy" as const)),
    signerSha256: attempt(() => signerDigest(file, {apiLevel})),
    runtime: attempt(() => apkRuntimeIdentity(file).runtime),
  };
}

/**
 * Ways the admitted file contradicts the manifest row that admitted it. apk-manifest.json is an
 * unsigned record, so a row edited by hand (and re-hashed) could describe a release the file is
 * not. What the file itself proves is checked before anything is installed: flag-off web bundle,
 * build type, the packaged resident runtime, update channel and the signing certificate against
 * android/release-signer.json. Speech qualification and licence blockers cannot be re-derived
 * from the file; for those the manifest written by verify-apks remains the record.
 */
export function apkContradictions(apk: {file: string; build: ApkMode; updateChannel?: UpdateChannel | null},
  { descriptor = readReleaseSigner(), apiLevel, facts = apkFacts(apk.file, {apiLevel}) }: ApkConsistencyOptions = {}) {
  const problems: string[] = [];
  if (facts.testMocks !== false) problems.push("its web bundle is not a verified flag-off build");
  if (apk.build === "release") {
    if (facts.debuggable !== false) problems.push("it is debuggable or its build type could not be read, so it is not a release build");
    if (facts.runtime !== "PACKAGED") problems.push("it does not package the resident runtime");
    if (!facts.updateChannel) problems.push("its compiled update channel could not be verified");
    else {
      try {
        assertProvisioningUpdateChannel(facts.updateChannel === "legacy" ? null : facts.updateChannel, apk.updateChannel ?? null);
      } catch (error) {
        problems.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (!facts.signerSha256 || facts.signerSha256 !== descriptor.signerSha256)
      problems.push(`it is signed by ${facts.signerSha256 ?? "no verified signer"}, not the certificate in android/release-signer.json`);
  } else if (facts.debuggable !== true) problems.push("it is not a debuggable build, so it is not the debug rehearsal APK");
  return problems;
}

/** Refuse, before any device is touched, an APK whose own contents contradict its admitted row. */
export function requireConsistentApk(apk: Parameters<typeof apkContradictions>[0], options?: ApkConsistencyOptions) {
  const problems = apkContradictions(apk, options);
  if (problems.length) throw new Error(`${apk.file} contradicts the manifest row that admitted it:\n${problems.map(item => `  - ${item}`).join("\n")}`);
}

/** Copy the admitted bytes into the caller's private temporary directory before inspecting and installing them. */
export function snapshotUnitApk(apk: ReturnType<typeof admitUnitApk>, directory: string) {
  const file = path.join(directory, "candidate.apk");
  fs.copyFileSync(apk.file, file, fs.constants.COPYFILE_EXCL | fs.constants.COPYFILE_FICLONE);
  fs.chmodSync(file, 0o400);
  if (updateArtifactDigest(file).sha256 !== apk.sha256) throw new Error(`${apk.file} changed after APK admission`);
  return { ...apk, file };
}

/** Parse `dumpsys package <pkg>` for the facts a unit record needs. */
export function packageFacts(dumpsys: string) {
  const field = (name: string) => new RegExp(`^\\s*${name}=(\\S+)`, "m").exec(dumpsys)?.[1] ?? null;
  const versionCode = /versionCode=(\d+)/.exec(dumpsys)?.[1];
  return { versionCode: versionCode ? Number(versionCode) : null, versionName: field("versionName"), firstInstallTime: /firstInstallTime=([^\n]+)/.exec(dumpsys)?.[1]?.trim() ?? null,
    lastUpdateTime: /lastUpdateTime=([^\n]+)/.exec(dumpsys)?.[1]?.trim() ?? null, userId: field("(?:userId|appId)") };
}

/** SHA-256 of one APK entry, extracted to a scratch file so no size limit applies. Null when it cannot be read. */
function entrySha256(apk: string, name: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-entry-"));
  try {
    const file = path.join(dir, "entry");
    const fd = fs.openSync(file, "w");
    let status;
    try { status = spawnSync("unzip", ["-p", apk, name], { stdio: ["ignore", fd, "ignore"] }).status; } finally { fs.closeSync(fd); }
    if (status !== 0) return null;
    const hash = createHash("sha256");
    const chunk = Buffer.alloc(1 << 20);
    const input = fs.openSync(file, "r");
    try { for (let read; (read = fs.readSync(input, chunk, 0, chunk.length, null)) > 0;) hash.update(chunk.subarray(0, read)); } finally { fs.closeSync(input); }
    return hash.digest("hex");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/** The resident runtime an APK packages. A packaged runtime whose bundle cannot be hashed throws: a unit record never carries a null identity. */
export function apkRuntimeIdentity(apk: string) {
  const stamp = spawnSync("unzip", ["-p", apk, "assets/agent/alpha-source.json"], { maxBuffer: 1 << 20 });
  if (stamp.status !== 0 || !stamp.stdout?.length) return { runtime: "NOT_PACKAGED" as const };
  const source: {base?: string; patches?: unknown[]} = JSON.parse(stamp.stdout.toString("utf8"));
  const agentBundleSha256 = entrySha256(apk, "assets/agent/agent-bundle.js");
  if (!agentBundleSha256) throw new Error(`${apk} stamps a packaged runtime but assets/agent/agent-bundle.js cannot be read`);
  return { runtime: "PACKAGED" as const, base: source.base, patches: source.patches, agentBundleSha256 };
}

export function adbFor(serial: string) {
  return (args: string[], { timeout = 120_000, allowFailure = false, withStderr = false }: {
    timeout?: number; allowFailure?: boolean; withStderr?: boolean;
  } = {}) => {
    const result = spawnSync("adb", ["-s", serial, ...args], { encoding: "utf8", timeout, maxBuffer: 64 << 20 });
    if (!allowFailure && (result.error || result.status !== 0)) throw new Error(`adb ${args.slice(0, 3).join(" ")} failed: ${result.error?.message ?? (result.stderr || result.stdout).trim()}`);
    // withStderr keeps device-side refusals (such as run-as on a release) visible to the caller.
    return `${result.stdout ?? ""}${withStderr ? `\n${result.stderr ?? ""}` : ""}`.trim();
  };
}

export function deviceFacts(adb: Adb, serial: string) {
  const prop = (name: string) => adb(["shell", "getprop", name]);
  const emulator = prop("ro.kernel.qemu") === "1" || prop("ro.boot.qemu") === "1" || /^emulator-\d+$/.test(serial);
  return { serialSha256: sha256(serial), emulator, model: prop("ro.product.model"), sdk: Number(prop("ro.build.version.sdk")) || null,
    abi: prop("ro.product.cpu.abi"), buildFingerprintSha256: sha256(prop("ro.build.fingerprint")) };
}

export function installedApkSha256(adb: Adb, pkg = PACKAGE) {
  const apkPath = /^package:(\/\S+\.apk)$/m.exec(adb(["shell", "pm", "path", pkg], { allowFailure: true }))?.[1];
  return apkPath ? adb(["shell", "sha256sum", apkPath]).split(/\s+/)[0] : null;
}

export function homeRoleHolder(adb: Adb) {
  const holders = adb(["shell", "cmd", "role", "get-role-holders", "android.app.role.HOME"], { allowFailure: true });
  return holders.split(/[;\s]+/).filter(Boolean)[0] ?? null;
}

function sourceCommit() {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { return null; }
}

async function main() {
  const options = parseUnitArgs(process.argv.slice(2));
  const apk = admitUnitApk(options.apkManifest, options);
  const adb = adbFor(options.serial);
  if (adb(["get-state"]) !== "device") throw new Error("Unit is not online");
  const device = deviceFacts(adb, options.serial);
  if (device.sdk === null || !Number.isSafeInteger(device.sdk) || device.sdk < 1) throw new Error("Device Android API level is unavailable");
  if (apk.rehearsal && !device.emulator) throw new Error("--build debug is an emulator rehearsal; physical pilot units get the signed release");
  if (adb(["shell", "pm", "list", "packages", PACKAGE], { allowFailure: true }).split(/\r?\n/).includes(`package:${PACKAGE}`))
    throw new Error("Alpha Phone is already installed on this unit; use scripts/pilot-update.ts for an update");
  const output = path.resolve(options.output, `${options.alias}.json`);
  if (fs.existsSync(output)) throw new Error(`${output} already exists; a unit is provisioned once`);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-provision-"));
  let runtimeIdentity: ReturnType<typeof apkRuntimeIdentity>;
  try {
    const candidate = snapshotUnitApk(apk, directory);
    requireConsistentApk(candidate, {apiLevel: device.sdk});
    // Read before install so an unreadable bundle fails with nothing on the unit.
    runtimeIdentity = apkRuntimeIdentity(candidate.file);
    adb(["install", candidate.file], { timeout: 600_000 });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }

  const installedSha256 = installedApkSha256(adb);
  if (installedSha256 !== apk.sha256) throw new Error("Installed bytes differ from the admitted APK");
  const installed = packageFacts(adb(["shell", "dumpsys", "package", PACKAGE]));
  if (installed.versionCode !== apk.versionCode) throw new Error(`Installed versionCode ${installed.versionCode} differs from ${apk.versionCode}`);
  const home = { chooserOpened: false, holder: homeRoleHolder(adb), selectedAlpha: false };
  if (apk.variant === "launcher") {
    // Opens Android's own default-Home chooser; the operator makes the choice on the unit.
    adb(["shell", "am", "start", "-a", "android.settings.HOME_SETTINGS"]);
    home.chooserOpened = true;
    const deadline = Date.now() + options.homeWaitMs;
    while (Date.now() < deadline && homeRoleHolder(adb) !== PACKAGE) await new Promise(resolve => setTimeout(resolve, 1000));
    home.holder = homeRoleHolder(adb);
    home.selectedAlpha = home.holder === PACKAGE;
  }
  const record = {
    schema: 1,
    alias: options.alias,
    createdAt: new Date().toISOString(),
    sourceCommit: sourceCommit(),
    evidence: device.emulator ? "emulator provisioning rehearsal (class E)" : "pilot unit provisioning record",
    notEvidenceFor: ["device acceptance", "user acceptance", "real integrations"],
    device,
    apk: { variant: apk.variant, build: apk.build, sha256: apk.sha256, versionCode: apk.versionCode, versionName: apk.versionName,
      signed: apk.signed, signerSha256: apk.signerSha256, signerApiLevel: device.sdk, distributable: apk.distributable, rehearsal: apk.rehearsal },
    installed: { sha256: installedSha256, versionCode: installed.versionCode, versionName: installed.versionName, firstInstallTime: installed.firstInstallTime },
    runtimeIdentity,
    homeRole: home,
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
  console.log(`${output}: ${record.evidence}; HOME ${home.selectedAlpha ? "is Alpha" : `holder ${home.holder ?? "unknown"}${home.chooserOpened ? " (chooser opened for the operator)" : ""}`}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
