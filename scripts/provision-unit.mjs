#!/usr/bin/env node
/**
 * Provision one pilot unit from a verified APK build and write its per-unit record.
 *
 *   node scripts/provision-unit.mjs --serial <adb serial> --alias <unit-name> \
 *     --apk-manifest artifacts/apk-manifest.json [--variant launcher|standalone] \
 *     [--build release|debug] [--output test-results/pilot-units] [--home-wait-ms 0]
 *
 * Steps: admit the APK from the verify-apks manifest (a release must be distributable:
 * signed by android/release-signer.json's certificate with an advancing versionCode,
 * flag-off, with the packaged resident runtime, qualified speech and no unresolved
 * licence blocker; anything else is refused with each blocker named. --build debug is
 * for emulator rehearsal only, is refused on a phone and is recorded as such), refuse a unit that
 * already has the package (use scripts/pilot-update.mjs), install, check the
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
import path from "node:path";
import { fileURLToPath } from "node:url";
import { signerDigest } from "./apk.mjs";
import { readReleaseSigner, releaseAdmission } from "./build-android.mjs";
import { releaseBlockers } from "./release-blockers.mjs";
import { androidEnv, tool } from "./toolchain.mjs";

export const PACKAGE = "ai.elizaresearch.alphaphone";
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

export function parseUnitArgs(argv, { requireAlias = true } = {}) {
  const options = { serial: null, alias: null, apkManifest: null, variant: "launcher", build: "release", output: "test-results/pilot-units", homeWaitMs: 0 };
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
  if (!/^[A-Za-z0-9._:-]{1,64}$/.test(options.serial ?? "")) throw new Error("--serial <adb serial> is required");
  if (requireAlias && !/^[a-z0-9][a-z0-9-]{0,39}$/.test(options.alias ?? "")) throw new Error("--alias must be a short lowercase unit name (a-z, 0-9, -); never a person's name or the serial");
  if (!options.apkManifest) throw new Error("--apk-manifest <path to verify-apks apk-manifest.json> is required");
  if (!["launcher", "standalone"].includes(options.variant)) throw new Error("--variant must be launcher or standalone");
  if (!["release", "debug"].includes(options.build)) throw new Error("--build must be release or debug");
  if (!Number.isSafeInteger(options.homeWaitMs) || options.homeWaitMs < 0) throw new Error("--home-wait-ms must be a non-negative integer");
  return options;
}

/**
 * Pick and admit the APK row from a verify-apks manifest. A release must be distributable
 * with no named blocker (scripts/release-blockers.mjs) against the committed signer
 * descriptor; a debug row is accepted only for --build debug and is labelled rehearsal.
 */
export function admitUnitApk(manifestFile, { variant, build }, { descriptor = readReleaseSigner() } = {}) {
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  if (manifest.testMocks !== false) throw new Error(`${manifestFile} is a test-mocks build; pilot units get distribution builds only`);
  const row = manifest.results?.find(entry => entry.variant === variant && entry.mode === build);
  if (!row) throw new Error(`${manifestFile} has no ${variant} ${build} APK`);
  const file = path.resolve(path.dirname(manifestFile), path.basename(row.file));
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
  const actual = sha256(fs.readFileSync(file));
  if (actual !== row.sha256) throw new Error(`${file} does not match its verified manifest row`);
  // The manifest-level flag is checked above; a row that disagrees with it is refused for either build.
  if (row.testMocks !== false) throw new Error(`${file} is recorded as a test-mocks build; pilot units get distribution builds only`);
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
    signerSha256: row.signerSha256 ?? null, signerApiLevel: row.signerApiLevel ?? null, distributable: row.distributable === true, runtime: row.runtime ?? null, rehearsal: build === "debug" };
}

/** Facts read from the APK file itself. A fact that cannot be read is null, which no check accepts. */
export function apkFacts(file, {apiLevel} = {}) {
  const attempt = read => { try { return read(); } catch { return null; } };
  return {
    testMocks: attempt(() => JSON.parse(execFileSync("unzip", ["-p", file, "assets/public/build-flags.json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })).testMocks ?? null),
    debuggable: attempt(() => /android:debuggable[^\n]*0xffffffff/.test(execFileSync(tool("aapt"), ["dump", "xmltree", file, "AndroidManifest.xml"], { encoding: "utf8", env: androidEnv(), maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"] }))),
    signerSha256: attempt(() => signerDigest(file, {apiLevel})),
    runtime: attempt(() => apkRuntimeIdentity(file).runtime),
  };
}

/**
 * Ways the admitted file contradicts the manifest row that admitted it. apk-manifest.json is an
 * unsigned record, so a row edited by hand (and re-hashed) could describe a release the file is
 * not. What the file itself proves is checked before anything is installed: flag-off web bundle,
 * build type, the packaged resident runtime and the signing certificate against
 * android/release-signer.json. Speech qualification and licence blockers cannot be re-derived
 * from the file; for those the manifest written by verify-apks remains the record.
 */
export function apkContradictions(apk, { descriptor = readReleaseSigner(), apiLevel, facts = apkFacts(apk.file, {apiLevel}) } = {}) {
  const problems = [];
  if (facts.testMocks !== false) problems.push("its web bundle is not a verified flag-off build");
  if (apk.build === "release") {
    if (facts.debuggable !== false) problems.push("it is debuggable or its build type could not be read, so it is not a release build");
    if (facts.runtime !== "PACKAGED") problems.push("it does not package the resident runtime");
    if (!facts.signerSha256 || facts.signerSha256 !== descriptor.signerSha256)
      problems.push(`it is signed by ${facts.signerSha256 ?? "no verified signer"}, not the certificate in android/release-signer.json`);
  } else if (facts.debuggable !== true) problems.push("it is not a debuggable build, so it is not the debug rehearsal APK");
  return problems;
}

/** Refuse, before any device is touched, an APK whose own contents contradict its admitted row. */
export function requireConsistentApk(apk, options) {
  const problems = apkContradictions(apk, options);
  if (problems.length) throw new Error(`${apk.file} contradicts the manifest row that admitted it:\n${problems.map(item => `  - ${item}`).join("\n")}`);
}

/** Parse `dumpsys package <pkg>` for the facts a unit record needs. */
export function packageFacts(dumpsys) {
  const field = name => new RegExp(`^\\s*${name}=(\\S+)`, "m").exec(dumpsys)?.[1] ?? null;
  const versionCode = /versionCode=(\d+)/.exec(dumpsys)?.[1];
  return { versionCode: versionCode ? Number(versionCode) : null, versionName: field("versionName"), firstInstallTime: /firstInstallTime=([^\n]+)/.exec(dumpsys)?.[1]?.trim() ?? null,
    lastUpdateTime: /lastUpdateTime=([^\n]+)/.exec(dumpsys)?.[1]?.trim() ?? null, userId: field("(?:userId|appId)") };
}

export function apkRuntimeIdentity(apk) {
  const entry = name => spawnSync("unzip", ["-p", apk, name], { maxBuffer: 1 << 26 });
  const stamp = entry("assets/agent/alpha-source.json");
  if (stamp.status !== 0 || !stamp.stdout.length) return { runtime: "NOT_PACKAGED" };
  const source = JSON.parse(stamp.stdout.toString("utf8"));
  const bundle = entry("assets/agent/agent-bundle.js");
  return { runtime: "PACKAGED", base: source.base, patches: source.patches, agentBundleSha256: bundle.status === 0 ? sha256(bundle.stdout) : null };
}

export function adbFor(serial) {
  return (args, { timeout = 120_000, allowFailure = false, withStderr = false } = {}) => {
    const result = spawnSync("adb", ["-s", serial, ...args], { encoding: "utf8", timeout, maxBuffer: 64 << 20 });
    if (!allowFailure && (result.error || result.status !== 0)) throw new Error(`adb ${args.slice(0, 3).join(" ")} failed: ${result.error?.message ?? (result.stderr || result.stdout).trim()}`);
    // withStderr keeps device-side refusals (such as run-as on a release) visible to the caller.
    return `${result.stdout ?? ""}${withStderr ? `\n${result.stderr ?? ""}` : ""}`.trim();
  };
}

export function deviceFacts(adb, serial) {
  const prop = name => adb(["shell", "getprop", name]);
  const emulator = prop("ro.kernel.qemu") === "1" || prop("ro.boot.qemu") === "1" || /^emulator-\d+$/.test(serial);
  return { serialSha256: sha256(serial), emulator, model: prop("ro.product.model"), sdk: Number(prop("ro.build.version.sdk")) || null,
    abi: prop("ro.product.cpu.abi"), buildFingerprintSha256: sha256(prop("ro.build.fingerprint")) };
}

export function installedApkSha256(adb, pkg = PACKAGE) {
  const apkPath = /^package:(\/\S+\.apk)$/m.exec(adb(["shell", "pm", "path", pkg], { allowFailure: true }))?.[1];
  return apkPath ? adb(["shell", "sha256sum", apkPath]).split(/\s+/)[0] : null;
}

export function homeRoleHolder(adb) {
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
  if (!Number.isSafeInteger(device.sdk) || device.sdk < 1) throw new Error("Device Android API level is unavailable");
  requireConsistentApk(apk, {apiLevel: device.sdk});
  if (apk.rehearsal && !device.emulator) throw new Error("--build debug is an emulator rehearsal; physical pilot units get the signed release");
  if (adb(["shell", "pm", "list", "packages", PACKAGE], { allowFailure: true }).split(/\r?\n/).includes(`package:${PACKAGE}`))
    throw new Error("Alpha Phone is already installed on this unit; use scripts/pilot-update.mjs for an update");
  const output = path.resolve(options.output, `${options.alias}.json`);
  if (fs.existsSync(output)) throw new Error(`${output} already exists; a unit is provisioned once`);

  adb(["install", apk.file], { timeout: 600_000 });
  const installedSha256 = installedApkSha256(adb);
  if (installedSha256 !== apk.sha256) throw new Error("Installed bytes differ from the admitted APK");
  const installed = packageFacts(adb(["shell", "dumpsys", "package", PACKAGE]));
  if (installed.versionCode !== apk.versionCode) throw new Error(`Installed versionCode ${installed.versionCode} differs from ${apk.versionCode}`);
  let home = { chooserOpened: false, holder: homeRoleHolder(adb), selectedAlpha: false };
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
    runtimeIdentity: apkRuntimeIdentity(apk.file),
    homeRole: home,
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
  console.log(`${output}: ${record.evidence}; HOME ${home.selectedAlpha ? "is Alpha" : `holder ${home.holder ?? "unknown"}${home.chooserOpened ? " (chooser opened for the operator)" : ""}`}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
