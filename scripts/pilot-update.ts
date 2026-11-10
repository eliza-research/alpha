#!/usr/bin/env node
/**
 * Update a provisioned pilot unit in place with a higher-versionCode signed APK.
 *
 *   node scripts/pilot-update.ts --serial <adb serial> --alias <unit-name> \
 *     --apk-manifest <new build>/apk-manifest.json [--variant launcher|standalone] \
 *     [--build release|debug] [--units test-results/pilot-units] [--stock-home <package/activity>]
 *
 * Generalizes scripts/test-installed-upgrade.ts from one domain to the whole app:
 *  1. admit the new APK (as provision-unit.ts does) and the unit's provisioning record;
 *  2. require the installed signer to equal the new APK's signer (the pulled installed
 *     APK is digested with apksigner) and the new versionCode to be greater;
 *  3. move HOME to a stock launcher when Alpha holds it, stop Alpha and read back every app-data domain (files, no_backup, databases,
 *     shared_prefs, app_webview, ...) as per-file SHA-256 inventories;
 *  4. `adb install -r` (data kept), then read back again without launching the app:
 *     the package uid and first-install time must be unchanged and every domain
 *     byte-identical. After the checks, stop the integrity process, restore HOME,
 *     then start the verified replacement and read the on-device agent's status.
 * Readback uses run-as, which Android allows only for debuggable builds. A release unit
 * is read through the in-app integrity export instead (release/DataIntegrityProvider,
 * `content query` as adb's shell, which holds the DUMP permission it requires): every file
 * as an HMAC-SHA-256 of its path and bytes under one random nonce per update, so before and
 * after compare file by file without any name or content leaving the device. An installed
 * build without the export gets the package-identity readback only and the record says so.
 *
 * An explicit --rotation-lineage <public proof file> admits only the exact migration
 * recorded in android/release-signer.json, including unit, APK pair and verifier pins.
 * The ordinary update path still requires the same active signer. An ambiguous install
 * is held for read-only reconciliation with --reconcile-rotation --serial <adb serial>.
 *
 * Rollback is not offered: a lower versionCode cannot replace an install without
 * erasing data, and the rollback design (A-06) is still blocked.
 */
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readHome, restoreHome } from "./android-instrumentation.ts";
import { signerDigest } from "./apk.ts";
import { readReleaseSigner } from "./build-android.ts";
import { pilotRotationRecord, verifyPilotRotation } from "./owner/pilot-rotation.ts";
import { androidEnv, tool } from "./toolchain.ts";
import { beginPilotRotation, claimPilotInstall, completePilotRotation, inspectPilotRotation, observePilotRotation } from "./owner/pilot-rotation-journal.ts";
import { adbFor, admitUnitApk, deviceFacts, installedApkSha256, PACKAGE, packageFacts, parseUnitArgs, requireConsistentApk } from "./provision-unit.ts";
import { apkUpdateAdmission, compareDomains, DOMAIN_SCRIPT, inPlaceUpdateFailures, integrityQuery as sharedIntegrityQuery, parseDomainInventory, parseIntegrityExport, readbackInventory } from "../vendor/eliza/packages/os/scripts/android/apk-release-record.mjs";

type Adb = ReturnType<typeof adbFor>;
type Apk = ReturnType<typeof admitUnitApk>;
type PackageFacts = ReturnType<typeof packageFacts>;
type Home = Parameters<typeof restoreHome>[1] & { stock: string };
type DomainInventory = Record<string, Record<string, string>>;
type Timing = { sleep?: (ms: number) => void; homeAttempts?: number; agentAttempts?: number };
type AgentRestart = { state: "running" | "refused" | "not-running" | "not-verified"; reason?: string };
type UpdateOptions = {
  adb: Adb;
  apk: Pick<Apk, "file" | "sha256" | "versionCode">;
  before: PackageFacts;
  home?: Home | null;
  replacementFile?: string;
  prepareInstall?: (domains: DomainInventory | null) => (() => void) | void;
  nonce?: string;
  timing?: Timing;
};
type Unit = {
  apk?: { variant?: string; build?: string };
  device?: { serialSha256?: string };
  updates?: unknown[];
};
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

// The comparison, inventory and export parsers are shared with every product
// (vendor/eliza/packages/os/scripts/android/apk-release-record.mjs); Alpha binds its package.
export { compareDomains, DOMAIN_SCRIPT, parseDomainInventory, parseIntegrityExport, readbackInventory };
export const updateAdmission = apkUpdateAdmission;

/** Both variants share one package id, so an update never switches the unit's variant or build type. */
export function unitApkMismatch(unit: Unit | null, apk: Pick<Apk, "variant" | "build">) {
  if (unit?.apk?.variant === apk.variant && unit?.apk?.build === apk.build) return null;
  return `provisioned with the ${unit?.apk?.variant ?? "unknown"} ${unit?.apk?.build ?? "unknown"} APK, not ${apk.variant} ${apk.build}; pass the same --variant and --build`;
}

export const INTEGRITY_AUTHORITY = `${PACKAGE}.integrity`;
/** The export query for one nonce; the URI is single-quoted for the device shell ("?" must not glob). */
export const integrityQuery = (nonce: string) => sharedIntegrityQuery(INTEGRITY_AUTHORITY, nonce);

function readExport(adb: Adb, nonce: string): DomainInventory | null {
  return parseIntegrityExport(adb(integrityQuery(nonce), { allowFailure: true, withStderr: true }));
}

function readDomains(adb: Adb): DomainInventory | null {
  return readbackInventory(adb(["shell", "run-as", PACKAGE, "sh", "-c", `'${DOMAIN_SCRIPT}'`], { allowFailure: true, withStderr: true }));
}

const HOME_ROLE = "android.app.role.HOME";
const MAIN_ACTIVITY = `${PACKAGE}/.MainActivity`;
const INTEGRITY_PROCESS = `${PACKAGE}:integrity`;
const pause = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const component = /^[A-Za-z][\w.]*\/[\w.$]+$/;

const holdsHome = (actual: ReturnType<typeof readHome>, activity: string) => actual.holders.length === 1 &&
  actual.holders[0] === activity.split("/")[0] && actual.activity === activity;
const alphaHome = (actual: ReturnType<typeof readHome>) => actual.holders.includes(PACKAGE) || actual.activity.startsWith(`${PACKAGE}/`);

function currentUser(adb: Adb) {
  const user = adb(["shell", "am", "get-current-user"]).trim();
  if (!/^\d+$/.test(user)) throw new Error("Cannot read the current Android user");
  return user;
}

/** Read the selected user's HOME before changing anything on the device. */
export function planHome(adb: Adb, { stockHome = null }: { stockHome?: string | null } = {}): Home | null {
  const user = currentUser(adb);
  const original = readHome(adb, user);
  if (!alphaHome(original)) return null;
  if (!component.test(original.activity) || !holdsHome(original, original.activity))
    throw new Error("Alpha's HOME holder and resolved activity do not agree");
  const activities = adb(["shell", "cmd", "package", "query-activities", "--brief", "--user", user,
    "-a", "android.intent.action.MAIN", "-c", "android.intent.category.HOME"]);
  const candidates = [...new Set(activities.split(/\r?\n/).map(line => line.trim()).filter(line =>
    component.test(line) && !line.startsWith(`${PACKAGE}/`) && !/^com\.android\.settings\/.*FallbackHome$/.test(line)))];
  const stock = stockHome ?? (candidates.length === 1 ? candidates[0] : null);
  if (!stock || !candidates.includes(stock))
    throw new Error(`Alpha holds HOME, so the readback needs another HOME app; pass --stock-home with one of ${JSON.stringify(candidates)}`);
  return { user, original, stock, selected: false, restoration: null };
}

function moveHomeAway(adb: Adb, home: Home) {
  if (currentUser(adb) !== home.user ||
      !holdsHome(readHome(adb, home.user), home.original.activity))
    throw new Error("Android user or HOME changed before the update");
  // Restore even when a command partially applies before returning an error.
  home.selected = true;
  adb(["shell", "cmd", "role", "add-role-holder", "--user", home.user, HOME_ROLE, home.stock.split("/")[0]]);
  adb(["shell", "cmd", "package", "set-home-activity", "--user", home.user, home.stock]);
}

function packageProcesses(adb: Adb) {
  const [header, ...rows] = adb(["shell", "ps", "-A", "-o", "PID,NAME"]).trim().split(/\r?\n/);
  if (!/^\s*PID\s+NAME\s*$/.test(header)) throw new Error("Cannot read the Android process list");
  return rows.flatMap(row => {
    const match = /^\s*(\d+)\s+(\S+.*)$/.exec(row.trimEnd());
    if (!match) throw new Error("Cannot read an Android process entry");
    const [, pid, name] = match;
    return name === PACKAGE || name.startsWith(`${PACKAGE}:`) ? [{ pid, name }] : [];
  });
}

const AGENT_RUNNING = /Detached agent health check passed|adopting it \(no relaunch\)|Agent health restored|Detached agent health restored/;
const AGENT_REFUSED = /Private IPC recovery refused[^\n]*/;
const AGENT_RETRYING = /Detached agent did not become healthy[^\n]*|Agent process exited early[^\n]*/;

/** Read startup logs from the launch time without clearing the device log. */
function restartAgent(adb: Adb, { user, sleep = pause, attempts = 150, intervalMs = 2000 }: { user?: string; sleep?: (ms: number) => void; attempts?: number; intervalMs?: number } = {}): AgentRestart {
  const since = adb(["shell", "date", "+%s"]).trim();
  if (!/^\d+$/.test(since)) throw new Error("Cannot read the Android clock before startup");
  adb(["shell", "am", "start", "-W", ...(user ? ["--user", user] : []), "-n", MAIN_ACTIVITY]);
  let retrying: string | null = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const log = adb(["shell", "logcat", "-d", "-v", "epoch", "-T", `${since}.000`, "-s", "ElizaAgent:V"]);
    const refused = AGENT_REFUSED.exec(log)?.[0];
    if (refused) return { state: "refused", reason: refused.trim() };
    const latest = log.split("\n").findLast(line => AGENT_RUNNING.test(line) || AGENT_RETRYING.test(line));
    if (latest && AGENT_RUNNING.test(latest)) return { state: "running" };
    retrying = latest?.match(AGENT_RETRYING)?.[0].trim() ?? retrying;
    sleep(intervalMs);
  }
  if (retrying) return { state: "not-running", reason: retrying };
  if (!packageProcesses(adb).some(({ name }) => name === PACKAGE))
    return { state: "not-running", reason: "Alpha's main process is not running after the start" };
  if (/ElizaAgentService/.test(adb(["shell", "dumpsys", "activity", "services", PACKAGE])))
    return { state: "not-running", reason: `the agent service did not report running within ${Math.round(attempts * intervalMs / 1000)}s` };
  return { state: "not-verified", reason: "no on-device agent service started" };
}

/** A single update window shared by the same-signer and reviewed-rotation CLI paths. */
export function updateUnit({ adb, apk, before, home = planHome(adb), replacementFile = apk.file,
  prepareInstall, nonce = randomBytes(32).toString("hex"), timing = {} }: UpdateOptions) {
  const failures: string[] = [];
  const appStopped: Record<string, { running: string | null }> = {};
  let touched = false, installAttempted = false, installed = false, installVerified = false;
  let after: PackageFacts | null = null;
  let method: "run-as" | "integrity-export" | null = null;
  let domainsBefore: DomainInventory | null = null;
  let stoppedForRestart = false;
  const user = home?.user ?? currentUser(adb);
  const verifyHome = (label: string) => {
    if (currentUser(adb) !== user) throw new Error(`Android user changed during the ${label} readback window`);
    const held = readHome(adb, user);
    if (home ? !holdsHome(held, home.stock) : alphaHome(held))
      throw new Error(`Stock HOME was not held during the ${label} readback window`);
  };
  const stopped = (label: string) => {
    verifyHome(label);
    const pids = packageProcesses(adb).filter(({ name }) => name !== INTEGRITY_PROCESS).map(({ pid }) => pid).join(" ");
    appStopped[label] = { running: pids || null };
    if (pids) throw new Error(`Alpha was running before the ${label} readback (pid ${pids})`);
  };
  try {
    if (home) moveHomeAway(adb, home);
    verifyHome("pre-update");
    touched = true;
    adb(["shell", "am", "force-stop", PACKAGE]);
    stopped("pre-update");
    const runAs = readDomains(adb);
    method = runAs ? "run-as" : "integrity-export";
    domainsBefore = runAs ?? readExport(adb, nonce);
    // The rotation validation may itself take time. Recheck quiescence before the
    // durable one-shot intent, then dispatch without another fallible device query.
    const recordIntent = prepareInstall?.(domainsBefore);
    stopped("pre-update");
    recordIntent?.();
    installAttempted = true;
    adb(["install", "-r", replacementFile], { timeout: 600_000 });
    installed = true;
    after = packageFacts(adb(["shell", "dumpsys", "package", PACKAGE]));
    const installedSha256 = installedApkSha256(adb);
    stopped("post-update");
    const domainsAfter = !domainsBefore ? null : method === "run-as" ? readDomains(adb) : readExport(adb, nonce);
    stopped("post-update");
    failures.push(...inPlaceUpdateFailures({ apk, before, after, installedSha256, domainsBefore, domainsAfter }));
    installVerified = failures.length === 0;
  } catch (error) {
    failures.push(message(error));
  } finally {
    if (touched || home?.selected) {
      try {
        adb(["shell", "am", "force-stop", PACKAGE]);
        if (packageProcesses(adb).length) throw new Error("Alpha package processes remained after the final force-stop");
        stoppedForRestart = true;
      } catch (error) { failures.push(message(error)); }
    }
    if (home?.selected) restoreHome(adb, home, { sleep: timing.sleep, attempts: timing.homeAttempts });
  }
  if (!installed) failures.push(installAttempted ? "the installer outcome is unconfirmed" : "the update was not installed");
  if (home?.selected && !home.restoration?.restored) failures.push("HOME was not restored to Alpha");
  let agentRestart: AgentRestart | null = null;
  if (installVerified && stoppedForRestart && (!home || home.restoration?.restored)) {
    try {
      if (currentUser(adb) !== user) throw new Error("Android user changed before the restart");
      agentRestart = restartAgent(adb, { user, sleep: timing.sleep, attempts: timing.agentAttempts });
    } catch (error) { agentRestart = { state: "not-running", reason: message(error) }; }
    if (agentRestart.state === "refused" || agentRestart.state === "not-running")
      failures.push(`the agent did not restart: ${agentRestart.reason}`);
  }
  return {
    installAttempted, installed, installVerified,
    packageIdentityPreserved: after !== null && after.userId === before.userId && after.firstInstallTime === before.firstInstallTime,
    appStopped,
    home: home ? { moved: home.selected, stock: home.stock, restoration: home.restoration,
      ...(home.selected && !home.restoration?.restored ? { recovery: `adb -s <serial> shell cmd role add-role-holder --user ${home.user} ${HOME_ROLE} ${PACKAGE} && adb -s <serial> shell cmd package set-home-activity --user ${home.user} ${home.original.activity}` } : {}) } : null,
    dataReadback: domainsBefore
      ? { method: method === "run-as" ? "run-as per-file SHA-256" : "in-app integrity export: per-file HMAC-SHA-256 of path and bytes under one per-update nonce",
        domains: Object.fromEntries(Object.entries(domainsBefore).map(([domain, files]) => [domain, Object.keys(files).length])) }
      : { method: "unavailable", reason: method ? "run-as is refused for a non-debuggable release and the installed build has no integrity export; only package identity was read back" : "the readback did not run" },
    agentRestart,
    failures,
    passed: failures.length === 0,
  };
}

const rotationJournalAnchor = os.homedir();
const rotationJournal = path.join(rotationJournalAnchor, ".local", "state", "alphaphone-pilot-rotation");

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === "--reconcile-rotation") {
    const [, flag, serial] = argv;
    if (argv.length !== 3 || flag !== "--serial" || !/^[A-Za-z0-9._:-]{1,64}$/.test(serial ?? ""))
      throw new Error("Use --reconcile-rotation --serial <adb serial>");
    const adb = adbFor(serial);
    const device = deviceFacts(adb, serial);
    const journal = inspectPilotRotation(rotationJournal, device.serialSha256);
    if (journal.state === "none") {
      console.log(JSON.stringify({ state: "none" }));
      return;
    }
    const installed = packageFacts(adb(["shell", "dumpsys", "package", PACKAGE]));
    console.log(JSON.stringify(observePilotRotation(journal, {
      device, installed, apkSha256: installedApkSha256(adb),
    })));
    return;
  }
  const unitsIndex = argv.findIndex(arg => arg === "--units" || arg.startsWith("--units="));
  let units = "test-results/pilot-units";
  if (unitsIndex >= 0) { units = argv[unitsIndex].includes("=") ? argv[unitsIndex].split("=")[1] : argv[unitsIndex + 1]; argv.splice(unitsIndex, argv[unitsIndex].includes("=") ? 1 : 2); }
  const homeIndex = argv.findIndex(arg => arg === "--stock-home" || arg.startsWith("--stock-home="));
  let stockHome: string | null = null;
  if (homeIndex >= 0) {
    const inline = argv[homeIndex].startsWith("--stock-home=");
    stockHome = inline ? argv[homeIndex].slice("--stock-home=".length) : argv[homeIndex + 1];
    if (!component.test(stockHome ?? "")) throw new Error("--stock-home needs a package/activity");
    argv.splice(homeIndex, inline ? 1 : 2);
  }
  const rotationIndex = argv.indexOf("--rotation-lineage");
  let lineageFile;
  if (rotationIndex >= 0) {
    const requested = argv[rotationIndex + 1];
    if (!requested || requested.startsWith("--")) throw new Error("--rotation-lineage needs a public proof file");
    lineageFile = path.resolve(requested);
    argv.splice(rotationIndex, 2);
  }
  const options = parseUnitArgs(argv);
  const recordFile = path.resolve(units, `${options.alias}.json`);
  if (!fs.existsSync(recordFile)) throw new Error(`${recordFile} is missing; provision the unit with scripts/provision-unit.ts first`);
  const unit: Unit = JSON.parse(fs.readFileSync(recordFile, "utf8"));
  const descriptor = readReleaseSigner();
  const apk = admitUnitApk(options.apkManifest, options, { descriptor });
  const rotation = lineageFile && pilotRotationRecord(descriptor, apk);
  if (rotation) {
    const committed = execFileSync("git", ["--no-replace-objects", "show", "HEAD:android/release-signer.json"]);
    if (!committed.equals(fs.readFileSync("android/release-signer.json")))
      throw new Error("The pilot rotation record must match the reviewed committed descriptor");
  }
  const mismatch = unitApkMismatch(unit, apk);
  if (mismatch) throw new Error(`Unit ${options.alias}: ${mismatch}`);
  const adb = adbFor(options.serial);
  const device = deviceFacts(adb, options.serial);
  const apiLevel = device.sdk;
  if (apiLevel === null || !Number.isSafeInteger(apiLevel) || apiLevel < 1) throw new Error("Device Android API level is unavailable");
  requireConsistentApk(apk, {apiLevel});
  if (device.serialSha256 !== unit.device?.serialSha256) throw new Error(`Serial does not belong to unit ${options.alias}`);
  if (apk.rehearsal && !device.emulator) throw new Error("--build debug is an emulator rehearsal only");

  const releaseInstallLock = claimPilotInstall(rotationJournal, device.serialSha256, rotationJournalAnchor);
  let pulled;
  try {
    const pendingRotation = inspectPilotRotation(rotationJournal, device.serialSha256);
    if (pendingRotation.state === "unknown")
      throw new Error("A pilot rotation outcome is unknown. Use --reconcile-rotation before any further install.");
    if (rotation && pendingRotation.state !== "none")
      throw new Error("The pilot rotation attempt is already consumed");
    const before = packageFacts(adb(["shell", "dumpsys", "package", PACKAGE]));
    pulled = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-installed-"));
    const installedFile = path.join(pulled, "installed.apk");
    const apkPath = /^package:(\/\S+\.apk)$/m.exec(adb(["shell", "pm", "path", PACKAGE]))?.[1];
    if (!apkPath) throw new Error("Alpha Phone is not installed on this unit");
    adb(["pull", apkPath, installedFile], { timeout: 600_000 });
    const installedSigner = signerDigest(installedFile, {apiLevel});
    const replacementFile = lineageFile ? path.join(pulled, "migration.apk") : apk.file;
    let rotationLineageSha256: string | undefined;
    if (lineageFile) {
      fs.copyFileSync(apk.file, replacementFile, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(replacementFile, 0o400);
      rotationLineageSha256 = verifyPilotRotation({
        descriptor, apk, device, before, installedFile, replacementFile, lineageFile,
        packageName: PACKAGE, javaHome: androidEnv().JAVA_HOME, apksigner: tool("apksigner"),
      });
    }
    const newSigner = signerDigest(replacementFile, {apiLevel});
    if (rotationLineageSha256) {
      if (newSigner !== descriptor.signerSha256) throw new Error("The verified migration signer changed");
    } else {
      const problems = updateAdmission({ installedVersionCode: before.versionCode, installedSigner, newVersionCode: apk.versionCode, newSigner });
      if (problems.length) throw new Error(`Update refused: ${problems.join("; ")}`);
    }

    let rotationIntentSha256: string | undefined;
    const prepareInstall = rotation ? (domainsBefore: DomainInventory | null) => {
      if (!before.userId || !before.firstInstallTime ||
          !Object.values(domainsBefore ?? {}).some(files => Object.keys(files).length))
        throw new Error("Migration requires a pre-install package identity and nonempty data readback");
      const currentDevice = deviceFacts(adb, options.serial);
      const currentPackage = packageFacts(adb(["shell", "dumpsys", "package", PACKAGE]));
      if (currentDevice.serialSha256 !== device.serialSha256 || currentDevice.sdk !== device.sdk ||
          currentDevice.buildFingerprintSha256 !== device.buildFingerprintSha256 ||
          currentPackage.userId !== before.userId || currentPackage.firstInstallTime !== before.firstInstallTime ||
          currentPackage.versionCode !== before.versionCode ||
          installedApkSha256(adb) !== rotation.installedApkSha256 ||
          sha256(fs.readFileSync(replacementFile)) !== apk.sha256)
        throw new Error("The device, package identity or migration APK changed after verification");
      return () => {
        rotationIntentSha256 = beginPilotRotation(rotationJournal, device.serialSha256, {
          createdAt: new Date().toISOString(), deviceApi: apiLevel,
          deviceBuildFingerprintSha256: device.buildFingerprintSha256,
          installedApkSha256: rotation.installedApkSha256, replacementApkSha256: apk.sha256,
          installedVersionCode: before.versionCode, replacementVersionCode: apk.versionCode,
          userId: before.userId, firstInstallTime: before.firstInstallTime,
          variant: apk.variant, lineageSha256: rotationLineageSha256,
        });
      };
    } : undefined;
    const update = {
      createdAt: new Date().toISOString(),
      signerApiLevel: device.sdk,
      ...(rotationLineageSha256 ? { rotationLineageSha256 } : {}),
      from: { versionCode: before.versionCode, versionName: before.versionName, signerSha256: installedSigner },
      to: { versionCode: apk.versionCode, versionName: apk.versionName, sha256: apk.sha256, signerSha256: newSigner, build: apk.build },
      ...updateUnit({ adb, apk, before, home: planHome(adb, { stockHome }), replacementFile, prepareInstall }),
      rollback: "not offered (A-06 rollback design blocked)",
    };
    unit.updates = [...(unit.updates ?? []), update];
    fs.writeFileSync(recordFile, `${JSON.stringify(unit, null, 2)}\n`);
    const domains = update.dataReadback.domains;
    console.log(`${options.alias}: ${update.passed ? "updated" : "UPDATE FAILED"} ${update.from.versionCode} -> ${update.to.versionCode}; ${domains ? `${Object.keys(domains).length} data domains read back` : "data readback unavailable"}; agent ${update.agentRestart?.state ?? "not started"}${update.failures.length ? `\n  ${update.failures.join("\n  ")}` : ""}${update.home?.recovery ? `\n  HOME was not restored; run: ${update.home.recovery}` : ""}`);
    // This journal certifies the installed bytes, package identity and data. A
    // later HOME or startup failure is recorded separately and cannot replay it.
    if (rotationIntentSha256 && update.installVerified)
      completePilotRotation(rotationJournal, device.serialSha256, rotationIntentSha256, apk.sha256);
    process.exitCode = update.passed ? 0 : 1;
  } finally {
    try { if (pulled) fs.rmSync(pulled, { recursive: true, force: true }); }
    finally { releaseInstallLock(); }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
export { sha256 };
